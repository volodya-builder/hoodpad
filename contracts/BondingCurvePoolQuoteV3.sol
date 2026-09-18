// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILiquidityMigratorQuote} from "./interfaces/ILiquidityMigratorQuote.sol";
import {OpeningTax} from "./OpeningTax.sol";

/// @title BondingCurvePoolQuoteV3
/// @notice BondingCurvePoolQuote плюс стартовый налог против снайперов
///         (OpeningTax): первые пять секунд после запуска покупка облагается
///         налогом 99% → 0, только покупки, создатель и названные им адреса
///         освобождены; налог идёт в тот же котёл комиссий. Порядок вычетов при
///         покупке: налог с полной суммы, затем комиссия и дивиденды с остатка.
///
///         Та же constant-product кривая, что BondingCurvePoolV2, но валюта
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
contract BondingCurvePoolQuoteV3 is ReentrancyGuard, OpeningTax {
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
    /// @notice Сколько стартового налога собрано за жизнь кривой (в quote).
    uint256 public openingTaxPaid;

    // ------------------------------------------------------------- events
    event Buy(address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee);
    event Graduated(uint256 quoteReserve, uint256 dexTokenReserve);
    event Migrated(address indexed migrator, uint256 quoteAmount, uint256 tokenAmount);
    event MigrationDeferred();
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
        address[] exempt;
    }

    constructor(Params memory p) OpeningTax(p.creator, p.exempt) {
        require(p.saleCap < p.totalSupply, "cap");
        require(p.token != address(0) && p.creator != address(0) && p.quote != address(0), "zero addr");
        require(p.token != p.quote, "t==q");
        require(p.virtualQuote > 0, "virtual");
        require(p.feeBps <= 500, "fee>5%");
        require(p.divBps <= 300, "div>3%");
        require(p.creatorFeeShareBps <= 10_000, "share");
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

    /// @notice Оценка покупки без стартового налога (после пятой секунды —
    ///         точная). Для первых секунд — quoteBuyFor с адресом покупателя.
    function quoteBuy(uint256 quoteInGross) public view returns (uint256 tokensOut) {
        return _quote(quoteInGross, 0);
    }

    /// @notice Оценка покупки для конкретного получателя с учётом налога.
    function quoteBuyFor(address recipient, uint256 quoteInGross) external view returns (uint256 tokensOut) {
        return _quote(quoteInGross, _openingTaxBps(recipient, recipient));
    }

    function _quote(uint256 gross, uint16 taxBps) internal view returns (uint256 tokensOut) {
        uint256 base = gross - (gross * taxBps) / 10_000;
        uint256 fee = (base * feeBps) / 10_000;
        uint256 div = (base * divBps) / 10_000;
        uint256 quoteIn = base - fee - div;
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

    /// @dev Разбор суммы покупки: налог, комиссия, дивиденды, в кривую,
    ///      сдача. В структуре, а не в локальных переменных — иначе стек.
    struct BuyMath {
        uint16  taxBps;
        uint256 tax;
        uint256 fee;
        uint256 div;
        uint256 quoteIn;
        uint256 tokensOut;
        uint256 refund;
    }

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

        BuyMath memory m = _buyMath(quoteInGross, _openingTaxBps(msg.sender, recipient));
        tokensOut = m.tokensOut;
        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut == 0) revert ZeroAmount();

        // effects
        quoteReserve += m.quoteIn;
        tokensSold += tokensOut;
        _accrueFees(m.fee + m.tax);
        if (m.tax > 0) {
            openingTaxPaid += m.tax;
            emit OpeningTaxPaid(recipient, m.tax, m.taxBps);
        }

        bool willGraduate = tokensSold >= saleCap;
        if (willGraduate) {
            graduated = true;
        }

        // interactions
        // Дивиденды — ДО перевода токенов покупателю: свой налог идёт тем,
        // кто уже держит, а не самому покупателю.
        _payDividend(m.div);
        token.safeTransfer(recipient, tokensOut);
        if (m.refund > 0) quote.safeTransfer(msg.sender, m.refund);

        emit Buy(recipient, m.quoteIn, tokensOut, m.fee + m.tax);
        if (willGraduate) {
            emit Graduated(quoteReserve, totalSupply - saleCap);
            // Как у Pons: на DEX в той же покупке; сорвалось — доделает migrate()
            try this.migrateSelf() {} catch {
                emit MigrationDeferred();
            }
        }
    }

    /// @dev Стартовый налог — с полной суммы, комиссия и дивиденды — с остатка,
    ///      остальное в кривую. Если покупка упирается в потолок кривой —
    ///      берём ровно столько, сколько нужно, остальное возвращаем.
    function _buyMath(uint256 gross, uint16 taxBps) internal view returns (BuyMath memory m) {
        m.taxBps = taxBps;
        m.tax = (gross * taxBps) / 10_000;
        m.fee = ((gross - m.tax) * feeBps) / 10_000;
        m.div = ((gross - m.tax) * divBps) / 10_000;
        m.quoteIn = gross - m.tax - m.fee - m.div;

        uint256 x = virtualQuote + quoteReserve;
        uint256 y = totalSupply - tokensSold;
        m.tokensOut = (y * m.quoteIn) / (x + m.quoteIn);

        uint256 remaining = saleCap - tokensSold;
        if (m.tokensOut >= remaining) {
            m.tokensOut = remaining;
            uint256 quoteNeeded = (x * remaining + (y - remaining) - 1) / (y - remaining);
            if (quoteNeeded > m.quoteIn) quoteNeeded = m.quoteIn;
            // сколько нужно внести, чтобы после налога, комиссии и дивидендов
            // осталось quoteNeeded
            uint256 keep = (10_000 - uint256(taxBps)) * (10_000 - uint256(feeBps) - uint256(divBps)); // из 1e8
            uint256 grossNeeded = (quoteNeeded * 100_000_000 + keep - 1) / keep;
            if (grossNeeded > gross) grossNeeded = gross;
            m.refund = gross - grossNeeded;
            m.tax = (grossNeeded * taxBps) / 10_000;
            m.fee = ((grossNeeded - m.tax) * feeBps) / 10_000;
            // Остаток после налога, комиссии и самой покупки — в дивиденды: так
            // сумма сходится до вея, ничего не зависает на контракте.
            m.div = grossNeeded - m.tax - quoteNeeded - m.fee;
            m.quoteIn = quoteNeeded;
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
        _migrate();
    }

    /// @dev Вызов из buy() той же транзакции; только сам контракт.
    function migrateSelf() external {
        if (msg.sender != address(this)) revert NotAuthorized();
        _migrate();
    }

    function _migrate() internal {
        if (!graduated) revert NotGraduated();
        if (migrated) revert AlreadyMigrated();
        migrated = true;

        address migrator = IFactoryConfigQuoteV3(factory).migrator();
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
            IDividendTokenV3(address(token)).setExcluded(v3Pool, true);
        }

        emit Migrated(migrator, quoteAmount, tokenAmount);
    }

    // ------------------------------------------------------------- fees

    function claimCreatorFees(address to) external nonReentrant {
        if (msg.sender != creator) revert NotAuthorized();
        require(to != address(0), "to=0");
        uint256 amount = creatorFeesAccrued;
        creatorFeesAccrued = 0;
        quote.safeTransfer(to, amount);
        emit FeesClaimed(to, amount, true);
    }

    function claimProtocolFees() external nonReentrant {
        address treasury = IFactoryConfigQuoteV3(factory).treasury();
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
        IDividendTokenV3(address(token)).notifyDividend(div);
        emit Dividend(div);
    }
}

interface IDividendTokenV3 {
    function notifyDividend(uint256 amount) external;
    function setExcluded(address account, bool value) external;
}

interface IFactoryConfigQuoteV3 {
    function migrator() external view returns (address);
    function treasury() external view returns (address);
}
