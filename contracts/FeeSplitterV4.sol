// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoolV4 {
    function token() external view returns (address);
    function creator() external view returns (address);
    function quote() external view returns (address);
    function claimProtocolFees() external;
}

interface IFactoryV4 {
    function poolOf(address token) external view returns (address);
}

interface IAgentTreasuryV4 {
    function fund(address token) external payable;
    function fundErc20(address token, address asset, uint256 amount) external;
}

/// @title FeeSplitterV4
/// @notice Протокольная доля комиссии каждой сделки делится здесь, а не в
///         пуле. Ставится казной обеих фабрик (ETH и за валюту), пулы не
///         меняются: они по-прежнему шлют протокольную долю на один адрес.
///
///         Экономика (решение владельца 14.09.2026), при creatorFeeShareBps
///         = 7000 в пуле сюда приходит 30% комиссии:
///
///             монета с ИИ:  создатель 70% · команда 20% · агент монеты 10%
///             монета без:   создатель 80% · команда 20%
///
///         Есть ли у монеты ИИ — решает её создатель, один раз и навсегда:
///         `enableAi(token)`. Включить можно позже, выключить — нельзя,
///         иначе включали бы ради витрины и тут же забирали 10% обратно.
///         Пока флаг не поставлен, лишние 10% уходят создателю.
///
///         Старые монеты с creatorFeeShareBps = 5000 присылают сюда 50%:
///         пропорция та же — команде 2/3 входящего, треть агенту/создателю.
///
///         ETH-пулы платят пушем (`claimProtocolFees` шлёт ETH с самого пула,
///         msg.sender здесь — пул). Пулы за валюту платят ERC20-переводом,
///         без колбэка, поэтому для них `claim(pool)`: сплиттер сам дёргает
///         выплату и считает, сколько именно этот пул прислал — так USDG
///         десяти разных монет не смешиваются.
///
///         Ни у кого нет права что-то здесь менять: ни адресов, ни долей.
///         Создателю, чей кошелёк не принимает перевод, сумма откладывается
///         и забирается `withdraw*` — выплата комиссий из-за него не встаёт.
contract FeeSplitterV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable team;
    IAgentTreasuryV4 public immutable agentTreasury;
    IFactoryV4 public immutable ethFactory;   // address(0) — ETH-фабрики нет
    IFactoryV4 public immutable quoteFactory; // address(0) — фабрики за валюту нет

    /// @notice Доля команды от ВХОДЯЩЕГО: teamNum/teamDen. 2/3 при 30% => 20%.
    uint256 public immutable teamNum;
    uint256 public immutable teamDen;

    /// @notice У монеты включён ИИ (решение создателя, необратимо).
    mapping(address => bool) public aiOf;

    /// @notice Отложенные суммы для создателей, чьи кошельки не приняли перевод.
    mapping(address => uint256) public pendingEth;
    mapping(address => mapping(address => uint256)) public pendingErc20; // кому => валюта => сумма
    mapping(address => uint256) public totalPendingErc20;                // валюта => сумма (для sweep)

    uint256 private constant PUSH_GAS = 60_000;

    event AiEnabled(address indexed token, address indexed creator);
    event SplitEth(address indexed token, uint256 toTeam, uint256 toAgent, uint256 toCreator);
    event SplitErc20(address indexed token, address indexed asset, uint256 toTeam, uint256 toAgent, uint256 toCreator);
    event Deferred(address indexed to, address indexed asset, uint256 amount);
    event Withdrawn(address indexed to, address indexed asset, uint256 amount);
    event Swept(address indexed asset, uint256 amount);

    constructor(
        address team_,
        address agentTreasury_,
        address ethFactory_,
        address quoteFactory_,
        uint256 teamNum_,
        uint256 teamDen_
    ) {
        require(team_ != address(0) && agentTreasury_ != address(0), "zero addr");
        require(ethFactory_ != address(0) || quoteFactory_ != address(0), "no factory");
        require(teamDen_ > 0 && teamNum_ <= teamDen_, "bad share");
        team = team_;
        agentTreasury = IAgentTreasuryV4(agentTreasury_);
        ethFactory = IFactoryV4(ethFactory_);
        quoteFactory = IFactoryV4(quoteFactory_);
        teamNum = teamNum_;
        teamDen = teamDen_;
    }

    // ------------------------------------------------------------ реестр ИИ

    /// @notice Создатель включает ИИ своей монете. Навсегда.
    function enableAi(address token) external {
        address pool = poolOf(token);
        require(pool != address(0), "unknown token");
        require(IPoolV4(pool).creator() == msg.sender, "not creator");
        require(!aiOf[token], "already on");
        aiOf[token] = true;
        emit AiEnabled(token, msg.sender);
    }

    /// @notice Пул монеты в любой из фабрик; address(0) — монета не наша.
    function poolOf(address token) public view returns (address pool) {
        if (address(ethFactory) != address(0)) {
            pool = ethFactory.poolOf(token);
            if (pool != address(0)) return pool;
        }
        if (address(quoteFactory) != address(0)) pool = quoteFactory.poolOf(token);
    }

    /// @notice Сколько от входящего достаётся команде, в bps — для сайта.
    function teamShareBps() external view returns (uint256) {
        return (teamNum * 10_000) / teamDen;
    }

    // ---------------------------------------------------------- ETH-пулы

    /// @dev `claimProtocolFees()` ETH-пула шлёт сюда со всем газом. Не пул
    ///      (пожертвование, случайный перевод) — всё команде, без реверта.
    receive() external payable nonReentrant {
        (address token, address creator) = _resolveEthPool(msg.sender);
        _splitEth(token, creator, msg.value);
    }

    function _resolveEthPool(address pool) internal view returns (address token, address creator) {
        if (address(ethFactory) == address(0)) return (address(0), address(0));
        try IPoolV4(pool).token() returns (address t) { token = t; } catch { return (address(0), address(0)); }
        if (token == address(0) || ethFactory.poolOf(token) != pool) return (address(0), address(0));
        try IPoolV4(pool).creator() returns (address c) { creator = c; } catch { creator = address(0); }
    }

    function _splitEth(address token, address creator, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            _sendEth(team, amount);
            emit SplitEth(address(0), amount, 0, 0);
            return;
        }
        uint256 toTeam = (amount * teamNum) / teamDen;
        uint256 rest = amount - toTeam;
        uint256 toAgent;
        uint256 toCreator;

        if (rest > 0) {
            if (aiOf[token]) {
                // Сломанная казна агента не должна останавливать выплату
                // комиссий — тогда её доля уходит команде.
                try agentTreasury.fund{value: rest}(token) { toAgent = rest; }
                catch { toTeam += rest; }
            } else if (creator != address(0)) {
                toCreator = rest;
                if (!_tryEth(creator, rest)) {
                    pendingEth[creator] += rest;
                    emit Deferred(creator, address(0), rest);
                }
            } else {
                toTeam += rest;
            }
        }
        _sendEth(team, toTeam);
        emit SplitEth(token, toTeam, toAgent, toCreator);
    }

    // ------------------------------------------------------- пулы за валюту

    /// @notice Забрать протокольную долю у пула за валюту и поделить её.
    ///         Зовёт кто угодно (казначей по расписанию, сам создатель).
    function claim(address pool) external nonReentrant {
        require(address(quoteFactory) != address(0), "no quote factory");
        address token = IPoolV4(pool).token();
        require(token != address(0) && quoteFactory.poolOf(token) == pool, "not a pool");
        IERC20 asset = IERC20(IPoolV4(pool).quote());

        uint256 before = asset.balanceOf(address(this));
        IPoolV4(pool).claimProtocolFees();
        uint256 got = asset.balanceOf(address(this)) - before;
        if (got == 0) return;

        address creator = IPoolV4(pool).creator();
        uint256 toTeam = (got * teamNum) / teamDen;
        uint256 rest = got - toTeam;
        uint256 toAgent;
        uint256 toCreator;

        if (rest > 0) {
            if (aiOf[token]) {
                asset.forceApprove(address(agentTreasury), rest);
                try agentTreasury.fundErc20(token, address(asset), rest) { toAgent = rest; }
                catch { toTeam += rest; }
                asset.forceApprove(address(agentTreasury), 0);
            } else if (creator != address(0)) {
                toCreator = rest;
                if (!_tryErc20(asset, creator, rest)) {
                    pendingErc20[creator][address(asset)] += rest;
                    totalPendingErc20[address(asset)] += rest;
                    emit Deferred(creator, address(asset), rest);
                }
            } else {
                toTeam += rest;
            }
        }
        if (toTeam > 0) asset.safeTransfer(team, toTeam);
        emit SplitErc20(token, address(asset), toTeam, toAgent, toCreator);
    }

    // ------------------------------------------------------- отложенное

    function withdrawEth() external nonReentrant {
        uint256 amount = pendingEth[msg.sender];
        require(amount > 0, "nothing");
        pendingEth[msg.sender] = 0;
        _sendEth(msg.sender, amount);
        emit Withdrawn(msg.sender, address(0), amount);
    }

    function withdrawErc20(address asset) external nonReentrant {
        uint256 amount = pendingErc20[msg.sender][asset];
        require(amount > 0, "nothing");
        pendingErc20[msg.sender][asset] = 0;
        totalPendingErc20[asset] -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    /// @notice Валюта, попавшая сюда мимо пулов (прямой перевод), — команде.
    ///         Отложенные суммы создателей не трогаются.
    function sweep(address asset) external nonReentrant {
        uint256 free = IERC20(asset).balanceOf(address(this)) - totalPendingErc20[asset];
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

    /// @dev transfer без реверта: и «нет return», и «false», и revert
    ///      одинаково значат «не дошло» — тогда сумма откладывается.
    function _tryErc20(IERC20 asset, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = address(asset).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }
}
