// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILiquidityMigrator} from "./interfaces/ILiquidityMigrator.sol";
import {OpeningTax} from "./OpeningTax.sol";

interface IVotePowerHookV3 {
    function recordFee(address trader, uint256 fee) external;
}

/// @title BondingCurvePoolV3
/// @notice Та же constant-product кривая, что BondingCurvePoolV2, плюс
///         стартовый налог против снайперов (OpeningTax): первые пять секунд
///         после запуска покупка облагается налогом 99% → 0, только покупки,
///         создатель и названные им адреса освобождены. Налог попадает в тот же
///         котёл комиссий и делится по тем же долям (creatorFeeShareBps).
///
///         Порядок вычетов при покупке: сначала налог с полной суммы, потом
///         обычная комиссия с остатка, остаток — в кривую. В событии Buy поле
///         fee — всё, что ушло площадке (комиссия + налог); налог отдельно —
///         в событии OpeningTaxPaid.
contract BondingCurvePoolV3 is ReentrancyGuard, OpeningTax {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------- immutables
    IERC20  public immutable token;
    address public immutable factory;
    address public immutable creator;

    uint256 public immutable totalSupply;
    uint256 public immutable saleCap;
    uint256 public immutable virtualEth;
    uint16  public immutable feeBps;
    uint16  public immutable creatorFeeShareBps;

    // ------------------------------------------------------------- state
    uint256 public ethReserve;
    uint256 public tokensSold;
    bool    public graduated;
    bool    public migrated;

    uint256 public protocolFeesAccrued;
    uint256 public creatorFeesAccrued;
    /// @notice Сколько стартового налога собрано за жизнь кривой.
    uint256 public openingTaxPaid;

    /// @notice Потолок суммарных покупок создателя на этой кривой (~2% от 4 ETH).
    uint256 public constant CREATOR_BUY_CAP = 0.08 ether;
    uint256 public creatorSpent;

    // ------------------------------------------------------------- events
    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee);
    event Graduated(uint256 ethReserve, uint256 dexTokenReserve);
    event Migrated(address indexed migrator, uint256 ethAmount, uint256 tokenAmount);
    /// @notice Перенос на DEX в покупке-градации не прошёл — доделает migrate().
    event MigrationDeferred();
    event FeesClaimed(address indexed to, uint256 amount, bool isCreator);

    error TradingClosed();
    error CreatorCapExceeded();
    error SlippageExceeded();
    error ZeroAmount();
    error NotGraduated();
    error AlreadyMigrated();
    error NotAuthorized();

    constructor(
        address token_,
        address creator_,
        uint256 totalSupply_,
        uint256 saleCap_,
        uint256 virtualEth_,
        uint16  feeBps_,
        uint16  creatorFeeShareBps_,
        address[] memory exempt_
    ) OpeningTax(creator_, exempt_) {
        require(saleCap_ < totalSupply_, "cap>=supply");
        require(token_ != address(0) && creator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        factory = msg.sender;
        token = IERC20(token_);
        creator = creator_;
        totalSupply = totalSupply_;
        saleCap = saleCap_;
        virtualEth = virtualEth_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
    }

    // ------------------------------------------------------------- views

    function spotPrice() external view returns (uint256) {
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        return (x * 1e18) / y;
    }

    /// @notice Оценка покупки без стартового налога (после пятой секунды —
    ///         точная). Для первых секунд — quoteBuyFor с адресом покупателя.
    function quoteBuy(uint256 ethInGross) public view returns (uint256 tokensOut) {
        return _quote(ethInGross, 0);
    }

    /// @notice Оценка покупки для конкретного получателя с учётом налога.
    function quoteBuyFor(address recipient, uint256 ethInGross) external view returns (uint256 tokensOut) {
        return _quote(ethInGross, _openingTaxBps(recipient, recipient));
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOutGross) {
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        ethOutGross = (x * tokensIn) / (y + tokensIn);
    }

    function _quote(uint256 gross, uint16 taxBps) internal view returns (uint256 tokensOut) {
        uint256 afterTax = gross - (gross * taxBps) / 10_000;
        uint256 ethIn = afterTax - (afterTax * feeBps) / 10_000;
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * ethIn) / (x + ethIn);
    }

    // ------------------------------------------------------------- trading

    function buy(uint256 minTokensOut, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (graduated) revert TradingClosed();
        if (msg.value == 0) revert ZeroAmount();

        // Кап создателя — суммарно за жизнь кривой, обходу через прямой вызов
        // пула не поддаётся.
        if (recipient == creator || msg.sender == creator) {
            creatorSpent += msg.value;
            if (creatorSpent > CREATOR_BUY_CAP) revert CreatorCapExceeded();
        }

        // Стартовый налог — с полной суммы, обычная комиссия — с остатка.
        uint16 taxBps = _openingTaxBps(msg.sender, recipient);
        uint256 tax = (msg.value * taxBps) / 10_000;
        uint256 fee = ((msg.value - tax) * feeBps) / 10_000;
        uint256 ethIn = msg.value - tax - fee;

        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * ethIn) / (x + ethIn);

        uint256 refund;
        uint256 remaining = saleCap - tokensSold;
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            uint256 ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut);
            if (ethNeeded > ethIn) ethNeeded = ethIn;
            // сколько нужно внести, чтобы после налога и комиссии осталось ethNeeded
            uint256 keep = (10_000 - uint256(taxBps)) * (10_000 - uint256(feeBps)); // из 1e8
            uint256 grossNeeded = (ethNeeded * 100_000_000 + keep - 1) / keep;
            if (grossNeeded > msg.value) grossNeeded = msg.value;
            refund = msg.value - grossNeeded;
            tax = (grossNeeded * taxBps) / 10_000;
            fee = grossNeeded - tax - ethNeeded; // остаток округления — в комиссию
            ethIn = ethNeeded;
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut == 0) revert ZeroAmount();

        // effects
        ethReserve += ethIn;
        tokensSold += tokensOut;
        _accrueFees(fee + tax);
        if (tax > 0) {
            openingTaxPaid += tax;
            emit OpeningTaxPaid(recipient, tax, taxBps);
        }

        bool willGraduate = tokensSold >= saleCap;
        if (willGraduate) {
            graduated = true;
        }

        // interactions
        _reportFee(msg.sender, fee + tax);
        token.safeTransfer(recipient, tokensOut);
        if (refund > 0) _sendEth(msg.sender, refund);

        emit Buy(recipient, ethIn, tokensOut, fee + tax);
        if (willGraduate) {
            emit Graduated(ethReserve, totalSupply - saleCap);
            // Как у Pons: ликвидность уезжает на DEX в той же покупке, что
            // добила кривую, — без паузы. Если перенос сорвался (цена в пуле
            // Uniswap сбита сильнее допуска мигратора), покупку не ломаем:
            // деньги остаются на кривой, migrate() дозовёт бот или кто угодно.
            try this.migrateSelf() {} catch {
                emit MigrationDeferred();
            }
        }
    }

    function sell(uint256 tokensIn, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 ethToUser)
    {
        if (graduated) revert TradingClosed();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        uint256 ethOutGross = (x * tokensIn) / (y + tokensIn);
        if (ethOutGross > ethReserve) ethOutGross = ethReserve;

        uint256 fee = (ethOutGross * feeBps) / 10_000;
        ethToUser = ethOutGross - fee;
        if (ethToUser < minEthOut) revert SlippageExceeded();

        // effects
        ethReserve -= ethOutGross;
        tokensSold -= tokensIn;
        _accrueFees(fee);

        // interactions
        _reportFee(msg.sender, fee);
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        _sendEth(msg.sender, ethToUser);

        emit Sell(msg.sender, tokensIn, ethToUser, fee);
    }

    // ------------------------------------------------------------- migration

    function migrate() external nonReentrant {
        _migrate();
    }

    /// @dev Вызов из buy() той же транзакции (см. там). Только сам контракт;
    ///      замок nonReentrant уже держит buy(), поэтому здесь его нет.
    function migrateSelf() external {
        if (msg.sender != address(this)) revert NotAuthorized();
        _migrate();
    }

    function _migrate() internal {
        if (!graduated) revert NotGraduated();
        if (migrated) revert AlreadyMigrated();
        migrated = true;

        address migrator = IFactoryConfigV3(factory).migrator();
        uint256 tokenAmount = totalSupply - saleCap;
        uint256 ethAmount = ethReserve;
        ethReserve = 0;

        token.safeTransfer(migrator, tokenAmount);
        ILiquidityMigrator(migrator).migrate{value: ethAmount}(address(token), tokenAmount);

        emit Migrated(migrator, ethAmount, tokenAmount);
    }

    // ------------------------------------------------------------- fees

    function claimCreatorFees(address to) external nonReentrant {
        if (msg.sender != creator) revert NotAuthorized();
        require(to != address(0), "zero recipient"); // иначе комиссии сгорают
        uint256 amount = creatorFeesAccrued;
        creatorFeesAccrued = 0;
        _sendEth(to, amount);
        emit FeesClaimed(to, amount, true);
    }

    function claimProtocolFees() external nonReentrant {
        address treasury = IFactoryConfigV3(factory).treasury();
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        _sendEth(treasury, amount);
        emit FeesClaimed(treasury, amount, false);
    }

    // ------------------------------------------------------------- internal

    function _accrueFees(uint256 fee) internal {
        if (fee == 0) return;
        uint256 creatorCut = (fee * creatorFeeShareBps) / 10_000;
        creatorFeesAccrued += creatorCut;
        protocolFeesAccrued += fee - creatorCut;
    }

    /// @dev Хук голосования: никогда не блокирует сделку (см. V2).
    function _reportFee(address trader, uint256 fee) internal {
        address hook = IFactoryConfigV3(factory).votePower();
        if (hook == address(0) || fee == 0 || hook.code.length == 0) return;
        try IVotePowerHookV3(hook).recordFee{gas: 150_000}(trader, fee) {} catch {}
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}

interface IFactoryConfigV3 {
    function migrator() external view returns (address);
    function treasury() external view returns (address);
    function votePower() external view returns (address);
}
