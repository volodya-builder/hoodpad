// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoolV6 {
    function token() external view returns (address);
    function quote() external view returns (address);
    function claimProtocolFees() external;
}

interface IFactoryV6 {
    function poolOf(address token) external view returns (address);
}

/// @title FeeSplitterV6 — делёж комиссий платформы (перезапуск 09.2026)
/// @notice Комиссия сделки 1%. Пул сразу отдаёт создателю его долю
///         (creatorFeeShareBps = 7000 → 70%), остаток (30%) приходит сюда и
///         делится на три казны в пропорции, заданной при деплое:
///
///             создатель 70% · арена 10% · выкуп монеты hood 10% · команда 10%
///
///         Здесь это arenaNum/den → казна арены (ежедневный выкуп-сжигание
///         подиума), buybackNum/den → казна выкупа монеты hood, остальное —
///         команде. ИИ-агентов в этой версии нет.
///
///         ETH-пулы платят пушем (`claimProtocolFees` шлёт ETH с самого пула,
///         msg.sender здесь — пул). Пулы за валюту платят ERC20-переводом
///         без колбэка, поэтому для них `claim(pool)` — может звать любой.
///
///         Ни у кого нет права что-то здесь менять: ни адресов, ни долей.
///         Казна, не принявшая ETH (не должно случаться), не останавливает
///         выплату: её доля уходит команде.
contract FeeSplitterV6 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable team;
    address public immutable arena;
    address public immutable buyback;
    IFactoryV6 public immutable ethFactory;
    IFactoryV6 public immutable quoteFactory;

    uint256 public immutable arenaNum;
    uint256 public immutable buybackNum;
    uint256 public immutable den;

    /// @dev Газ на пуш ETH контракту-казне: хватает на receive() с записью
    ///      пары слотов, но не даёт получателю сжечь газ выплаты.
    uint256 internal constant PUSH_GAS = 60_000;

    event SplitEth(address indexed token, uint256 toArena, uint256 toBuyback, uint256 toTeam);
    event SplitErc20(address indexed token, address indexed asset, uint256 toArena, uint256 toBuyback, uint256 toTeam);
    event Swept(address indexed asset, uint256 amount);

    constructor(
        address team_,
        address arena_,
        address buyback_,
        address ethFactory_,
        address quoteFactory_,
        uint256 arenaNum_,
        uint256 buybackNum_,
        uint256 den_
    ) {
        require(team_ != address(0) && arena_ != address(0) && buyback_ != address(0), "zero addr");
        require(ethFactory_ != address(0) || quoteFactory_ != address(0), "no factory");
        require(den_ > 0 && arenaNum_ + buybackNum_ <= den_, "bad share");
        team = team_;
        arena = arena_;
        buyback = buyback_;
        ethFactory = IFactoryV6(ethFactory_);
        quoteFactory = IFactoryV6(quoteFactory_);
        arenaNum = arenaNum_;
        buybackNum = buybackNum_;
        den = den_;
    }

    // ------------------------------------------------------------- views

    /// @notice Пул монеты в любой из фабрик; address(0) — монета не наша.
    function poolOf(address token) public view returns (address pool) {
        if (address(ethFactory) != address(0)) {
            pool = ethFactory.poolOf(token);
            if (pool != address(0)) return pool;
        }
        if (address(quoteFactory) != address(0)) pool = quoteFactory.poolOf(token);
    }

    /// @notice Доля команды от входящего, bps — для сайта.
    function teamShareBps() external view returns (uint256) {
        return ((den - arenaNum - buybackNum) * 10_000) / den;
    }

    /// @notice Доля казны арены от входящего, bps.
    function arenaShareBps() external view returns (uint256) {
        return (arenaNum * 10_000) / den;
    }

    /// @notice Доля казны выкупа hood от входящего, bps.
    function buybackShareBps() external view returns (uint256) {
        return (buybackNum * 10_000) / den;
    }

    // ---------------------------------------------------------- ETH-пулы

    /// @dev `claimProtocolFees()` ETH-пула шлёт сюда со всем газом. Не пул
    ///      (пожертвование, случайный перевод) — всё команде, без реверта.
    receive() external payable nonReentrant {
        address token = _resolveEthPool(msg.sender);
        _splitEth(token, msg.value);
    }

    function _resolveEthPool(address pool) internal view returns (address token) {
        if (address(ethFactory) == address(0) || pool.code.length == 0) return address(0);
        try IPoolV6(pool).token() returns (address t) { token = t; } catch { return address(0); }
        if (token == address(0) || ethFactory.poolOf(token) != pool) return address(0);
    }

    function _splitEth(address token, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            _sendEth(team, amount);
            emit SplitEth(address(0), 0, 0, amount);
            return;
        }
        uint256 toArena = (amount * arenaNum) / den;
        uint256 toBuyback = (amount * buybackNum) / den;
        uint256 toTeam = amount - toArena - toBuyback;

        // Казны — контракты с простым receive(); не приняла — команде,
        // выплата комиссий из-за этого не встаёт.
        if (toArena > 0 && !_tryEth(arena, toArena)) { toTeam += toArena; toArena = 0; }
        if (toBuyback > 0 && !_tryEth(buyback, toBuyback)) { toTeam += toBuyback; toBuyback = 0; }

        _sendEth(team, toTeam);
        emit SplitEth(token, toArena, toBuyback, toTeam);
    }

    // ------------------------------------------------------ пулы за валюту

    /// @notice Забрать комиссии пула за валюту и разделить. Звать может кто
    ///         угодно: деньги идут только по зашитым адресам.
    function claim(address pool) external nonReentrant {
        address token = IPoolV6(pool).token();
        require(token != address(0) && address(quoteFactory) != address(0)
            && quoteFactory.poolOf(token) == pool, "not our pool");
        IERC20 asset = IERC20(IPoolV6(pool).quote());

        uint256 before = asset.balanceOf(address(this));
        IPoolV6(pool).claimProtocolFees();
        uint256 got = asset.balanceOf(address(this)) - before;
        if (got == 0) return;

        uint256 toArena = (got * arenaNum) / den;
        uint256 toBuyback = (got * buybackNum) / den;
        uint256 toTeam = got - toArena - toBuyback;
        if (toArena > 0) asset.safeTransfer(arena, toArena);
        if (toBuyback > 0) asset.safeTransfer(buyback, toBuyback);
        if (toTeam > 0) asset.safeTransfer(team, toTeam);
        emit SplitErc20(token, address(asset), toArena, toBuyback, toTeam);
    }

    /// @notice Валюта, попавшая сюда мимо пулов (прямой перевод), — команде.
    function sweep(address asset) external nonReentrant {
        uint256 free = IERC20(asset).balanceOf(address(this));
        require(free > 0, "nothing");
        IERC20(asset).safeTransfer(team, free);
        emit Swept(asset, free);
    }

    // ------------------------------------------------------------ helpers

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }

    /// @dev Пуш с ограниченным газом: контракт-получатель не может ни
    ///      сжечь весь газ выплаты, ни уронить её реверт-ом.
    function _tryEth(address to, uint256 amount) internal returns (bool ok) {
        (ok, ) = to.call{value: amount, gas: PUSH_GAS}("");
    }
}
