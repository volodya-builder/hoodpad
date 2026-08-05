// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILiquidityMigratorQuote} from "./interfaces/ILiquidityMigratorQuote.sol";

/// @title BondingCurvePoolQuote
/// @notice Та же constant-product кривая, что BondingCurvePoolV2, но валюта
///         кривой — произвольный ERC20 (токенизированная акция Robinhood,
///         стейбл и т.п.) вместо нативного ETH. Покупка тянет quote через
///         transferFrom (нужен approve), продажа и клеймы платят в quote.
///
/// @dev    Ожидается «обычный» ERC20 без комиссий на трансфер и без хуков
///         (Robinhood Stock Tokens ровно такие: 18 decimals, без ребейзов —
///         корпоративные действия у них меняют оракульную цену, а не балансы).
///         Фабрика допускает только whitelisted quote — токены с fee-on-transfer
///         туда не попадают.
contract BondingCurvePoolQuote is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------- immutables
    IERC20  public immutable token;
    IERC20  public immutable quote;
    address public immutable factory;
    address public immutable creator;

    uint256 public immutable totalSupply;
    uint256 public immutable saleCap;
    uint256 public immutable virtualQuote;
    uint16  public immutable feeBps;
    uint16  public immutable creatorFeeShareBps;

    /// @notice Потолок суммарных покупок создателя (в quote). Задаётся
    ///         фабрикой как доля от virtualQuote — тот же смысл, что
    ///         CREATOR_BUY_CAP в ETH-пуле: нельзя скупить низ кривой мешком.
    uint256 public immutable creatorBuyCap;

    // ------------------------------------------------------------- state
    uint256 public quoteReserve;
    uint256 public tokensSold;
    bool    public graduated;
    bool    public migrated;

    uint256 public protocolFeesAccrued;
    uint256 public creatorFeesAccrued;
    uint256 public creatorSpent;

    // ------------------------------------------------------------- events
    event Buy(address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee);
    event Graduated(uint256 quoteReserve, uint256 dexTokenReserve);
    event Migrated(address indexed migrator, uint256 quoteAmount, uint256 tokenAmount);
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
        address quote_,
        address creator_,
        uint256 totalSupply_,
        uint256 saleCap_,
        uint256 virtualQuote_,
        uint16  feeBps_,
        uint16  creatorFeeShareBps_,
        uint256 creatorBuyCap_
    ) {
        require(saleCap_ < totalSupply_, "cap>=supply");
        require(token_ != address(0) && creator_ != address(0) && quote_ != address(0), "zero addr");
        require(token_ != quote_, "token==quote");
        require(virtualQuote_ > 0, "zero virtual");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        factory = msg.sender;
        token = IERC20(token_);
        quote = IERC20(quote_);
        creator = creator_;
        totalSupply = totalSupply_;
        saleCap = saleCap_;
        virtualQuote = virtualQuote_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
        creatorBuyCap = creatorBuyCap_;
    }

    // ------------------------------------------------------------- views

    function spotPrice() external view returns (uint256) {
        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        return (x * 1e18) / y;
    }

    function quoteBuy(uint256 quoteInGross) public view returns (uint256 tokensOut) {
        uint256 fee = (quoteInGross * feeBps) / 10_000;
        uint256 quoteIn = quoteInGross - fee;
        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * quoteIn) / (x + quoteIn);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 quoteOutGross) {
        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        quoteOutGross = (x * tokensIn) / (y + tokensIn);
    }

    // ------------------------------------------------------------- trading

    /// @notice Покупка за quote. Нужен approve на quoteInGross.
    function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (graduated) revert TradingClosed();
        if (quoteInGross == 0) revert ZeroAmount();

        // Кап создателя — как в ETH-пуле, суммарно за жизнь кривой.
        if (recipient == creator || msg.sender == creator) {
            creatorSpent += quoteInGross;
            if (creatorSpent > creatorBuyCap) revert CreatorCapExceeded();
        }

        // Забираем всю сумму сразу; сдачу вернём переводом ниже.
        quote.safeTransferFrom(msg.sender, address(this), quoteInGross);

        uint256 fee = (quoteInGross * feeBps) / 10_000;
        uint256 quoteIn = quoteInGross - fee;

        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * quoteIn) / (x + quoteIn);

        uint256 refund;
        uint256 remaining = saleCap - tokensSold;
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            uint256 quoteNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut);
            if (quoteNeeded > quoteIn) quoteNeeded = quoteIn;
            uint256 grossNeeded = (quoteNeeded * 10_000 + (10_000 - feeBps) - 1) / (10_000 - feeBps);
            if (grossNeeded > quoteInGross) grossNeeded = quoteInGross;
            refund = quoteInGross - grossNeeded;
            fee = grossNeeded - quoteNeeded;
            quoteIn = quoteNeeded;
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut == 0) revert ZeroAmount();

        // effects
        quoteReserve += quoteIn;
        tokensSold += tokensOut;
        _accrueFees(fee);

        bool willGraduate = tokensSold >= saleCap;
        if (willGraduate) {
            graduated = true;
        }

        // interactions
        token.safeTransfer(recipient, tokensOut);
        if (refund > 0) quote.safeTransfer(msg.sender, refund);

        emit Buy(recipient, quoteIn, tokensOut, fee);
        if (willGraduate) {
            emit Graduated(quoteReserve, totalSupply - saleCap);
        }
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut)
        external
        nonReentrant
        returns (uint256 quoteToUser)
    {
        if (graduated) revert TradingClosed();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        uint256 quoteOutGross = (x * tokensIn) / (y + tokensIn);
        if (quoteOutGross > quoteReserve) quoteOutGross = quoteReserve;

        uint256 fee = (quoteOutGross * feeBps) / 10_000;
        quoteToUser = quoteOutGross - fee;
        if (quoteToUser < minQuoteOut) revert SlippageExceeded();

        // effects
        quoteReserve -= quoteOutGross;
        tokensSold -= tokensIn;
        _accrueFees(fee);

        // interactions
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        quote.safeTransfer(msg.sender, quoteToUser);

        emit Sell(msg.sender, tokensIn, quoteToUser, fee);
    }

    // ------------------------------------------------------------- migration

    function migrate() external nonReentrant {
        if (!graduated) revert NotGraduated();
        if (migrated) revert AlreadyMigrated();
        migrated = true;

        address migrator = IFactoryConfigQuote(factory).migrator();
        uint256 tokenAmount = totalSupply - saleCap;
        uint256 quoteAmount = quoteReserve;
        quoteReserve = 0;

        token.safeTransfer(migrator, tokenAmount);
        quote.safeTransfer(migrator, quoteAmount);
        ILiquidityMigratorQuote(migrator).migrateQuote(address(token), address(quote), tokenAmount, quoteAmount);

        emit Migrated(migrator, quoteAmount, tokenAmount);
    }

    // ------------------------------------------------------------- fees

    function claimCreatorFees(address to) external nonReentrant {
        if (msg.sender != creator) revert NotAuthorized();
        require(to != address(0), "zero recipient");
        uint256 amount = creatorFeesAccrued;
        creatorFeesAccrued = 0;
        quote.safeTransfer(to, amount);
        emit FeesClaimed(to, amount, true);
    }

    function claimProtocolFees() external nonReentrant {
        address treasury = IFactoryConfigQuote(factory).treasury();
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        quote.safeTransfer(treasury, amount);
        emit FeesClaimed(treasury, amount, false);
    }

    // ------------------------------------------------------------- internal

    function _accrueFees(uint256 fee) internal {
        if (fee == 0) return;
        uint256 creatorCut = (fee * creatorFeeShareBps) / 10_000;
        creatorFeesAccrued += creatorCut;
        protocolFeesAccrued += fee - creatorCut;
    }
}

interface IFactoryConfigQuote {
    function migrator() external view returns (address);
    function treasury() external view returns (address);
}
