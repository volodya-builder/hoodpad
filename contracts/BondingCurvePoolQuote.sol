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
///
///         ДИВИДЕНДЫ. Сверх комиссии площадки (feeBps) с каждой сделки берётся
///         divBps в пользу холдеров — в этой же валюте — и уходит в токен
///         (DividendToken), который раздаёт их по балансам. Ставку выбирает
///         создатель при запуске, 0–3%, и она неизменяема, как и всё здесь.
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
    /// @notice Налог в пользу холдеров, bps. Считается от той же базы, что fee.
    uint16  public immutable divBps;

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
    /// @notice Всего отдано холдерам за жизнь кривой (в quote).
    uint256 public dividendsPaid;

    // ------------------------------------------------------------- events
    event Buy(address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee);
    event Graduated(uint256 quoteReserve, uint256 dexTokenReserve);
    event Migrated(address indexed migrator, uint256 quoteAmount, uint256 tokenAmount);
    event FeesClaimed(address indexed to, uint256 amount, bool isCreator);
    event Dividend(uint256 amount);

    error TradingClosed();
    error CreatorCapExceeded();
    error SlippageExceeded();
    error ZeroAmount();
    error NotGraduated();
    error AlreadyMigrated();
    error NotAuthorized();

    struct Params {
        address token;
        address quote;
        address creator;
        uint256 totalSupply;
        uint256 saleCap;
        uint256 virtualQuote;
        uint16  feeBps;
        uint16  creatorFeeShareBps;
        uint256 creatorBuyCap;
        uint16  divBps;
    }

    constructor(Params memory p) {
        require(p.saleCap < p.totalSupply, "cap>=supply");
        require(p.token != address(0) && p.creator != address(0) && p.quote != address(0), "zero addr");
        require(p.token != p.quote, "token==quote");
        require(p.virtualQuote > 0, "zero virtual");
        require(p.feeBps <= 500, "fee>5%");
        require(p.divBps <= 300, "div>3%");
        require(p.creatorFeeShareBps <= 10_000, "share>100%");
        factory = msg.sender;
        token = IERC20(p.token);
        quote = IERC20(p.quote);
        creator = p.creator;
        totalSupply = p.totalSupply;
        saleCap = p.saleCap;
        virtualQuote = p.virtualQuote;
        feeBps = p.feeBps;
        creatorFeeShareBps = p.creatorFeeShareBps;
        creatorBuyCap = p.creatorBuyCap;
        divBps = p.divBps;
    }

    // ------------------------------------------------------------- views

    function spotPrice() external view returns (uint256) {
        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        return (x * 1e18) / y;
    }

    function quoteBuy(uint256 quoteInGross) public view returns (uint256 tokensOut) {
        uint256 fee = (quoteInGross * feeBps) / 10_000;
        uint256 div = (quoteInGross * divBps) / 10_000;
        uint256 quoteIn = quoteInGross - fee - div;
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
        uint256 div = (quoteInGross * divBps) / 10_000;
        uint256 quoteIn = quoteInGross - fee - div;

        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * quoteIn) / (x + quoteIn);

        uint256 refund;
        uint256 remaining = saleCap - tokensSold;
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            uint256 quoteNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut);
            if (quoteNeeded > quoteIn) quoteNeeded = quoteIn;
            uint256 keepBps = 10_000 - feeBps - divBps;
            uint256 grossNeeded = (quoteNeeded * 10_000 + keepBps - 1) / keepBps;
            if (grossNeeded > quoteInGross) grossNeeded = quoteInGross;
            refund = quoteInGross - grossNeeded;
            fee = (grossNeeded * feeBps) / 10_000;
            // Остаток после комиссии и самой покупки — в дивиденды: так сумма
            // сходится до вея, ничего не зависает на контракте.
            div = grossNeeded - quoteNeeded - fee;
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
        // Дивиденды — ДО перевода токенов покупателю: свой налог идёт тем,
        // кто уже держит, а не самому покупателю.
        _payDividend(div);
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
        uint256 div = (quoteOutGross * divBps) / 10_000;
        quoteToUser = quoteOutGross - fee - div;
        if (quoteToUser < minQuoteOut) revert SlippageExceeded();

        // effects
        quoteReserve -= quoteOutGross;
        tokensSold -= tokensIn;
        _accrueFees(fee);

        // interactions
        // Сначала забираем токены продавца, потом дивиденды: продал — в
        // раздаче своего же налога не участвуешь.
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        _payDividend(div);
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
        address v3Pool = ILiquidityMigratorQuote(migrator)
            .migrateQuote(address(token), address(quote), tokenAmount, quoteAmount);

        // Ликвидность на DEX заперта навсегда — дивиденды ей ни к чему, а
        // сапплай у неё большой. Исключаем, пока налог с кривой не роздан
        // кому не надо. Мигратору доверяем адрес: ему же доверили деньги.
        if (divBps > 0 && v3Pool != address(0)) {
            IDividendToken(address(token)).setExcluded(v3Pool, true);
        }

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

    /// @dev Переводим налог в токен и говорим ему учесть. Валюта уходит с пула
    ///      сразу — на пуле дивиденды не задерживаются ни на блок.
    function _payDividend(uint256 div) internal {
        if (div == 0) return;
        dividendsPaid += div;
        quote.safeTransfer(address(token), div);
        IDividendToken(address(token)).notifyDividend(div);
        emit Dividend(div);
    }
}

interface IDividendToken {
    function notifyDividend(uint256 amount) external;
    function setExcluded(address account, bool value) external;
}

interface IFactoryConfigQuote {
    function migrator() external view returns (address);
    function treasury() external view returns (address);
}
