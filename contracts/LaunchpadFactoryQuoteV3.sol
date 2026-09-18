// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {DividendToken} from "./DividendToken.sol";
import {BondingCurvePoolQuoteV3} from "./BondingCurvePoolQuoteV3.sol";

/// @title LaunchpadFactoryQuoteV3
/// @notice Фабрика токенов на кривой с ERC20-валютой (токенизированные акции
///         Robinhood, стейблы). Пулы BondingCurvePoolQuoteV3 — со стартовым
///         налогом против снайперов (99% → 0 за пять секунд). Экономика та же
///         (1% комиссия, доля создателя из initConfig), валюта — whitelisted quote-токен. Whitelist защищает от
///         fee-on-transfer / ребейз / хук-токенов, которые ломают инвариант
///         кривой: пускаем только проверенные Stock Tokens и стейблы.
contract LaunchpadFactoryQuoteV3 is Ownable2Step {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant SALE_CAP     =   800_000_000e18;

    uint256 public constant MAX_NAME_LEN = 64;
    uint256 public constant MAX_SYMBOL_LEN = 12;
    uint256 public constant MAX_URI_LEN = 200_000;
    uint256 public constant CONFIG_DELAY = 48 hours;
    uint256 public constant CONFIG_GRACE = 7 days; // после готовности заявка живёт неделю

    uint16 public feeBps = 100;
    uint16 public creatorFeeShareBps = 5000;

    address public treasury;
    address public migrator;

    /// @notice Разрешённые quote-валюты и их параметры кривой.
    ///  virtualQuote — «виртуальный» резерв (аналог VIRTUAL_ETH): задаёт
    ///   стартовую цену и порог градации (= 4 × virtualQuote собранных).
    ///  creatorBuyCap — потолок покупок создателя в этой валюте.
    struct QuoteConfig {
        bool allowed;
        uint256 virtualQuote;
        uint256 creatorBuyCap;
    }
    mapping(address => QuoteConfig) public quoteConfig;
    address[] public allowedQuotes;

    struct PendingConfig {
        address treasury;
        address migrator;
        uint16 feeBps;
        uint16 creatorFeeShareBps;
        uint256 readyAt;
    }
    PendingConfig public pendingConfig;

    address[] public allTokens;
    mapping(address => address) public poolOf;
    mapping(address => bool) public isPool;
    /// @notice Запуск монет открыт только после initConfig (иначе чужой
    ///         createToken сразу после деплоя запирал бы первичную настройку).
    bool public configured;
    mapping(address => address) public quoteOf; // token => quote

    /// @dev name/symbol/metadataURI не дублируем в событии — они читаются
    ///      прямо с токена (name(), symbol(), metadataURI()). Так и лаконичнее,
    ///      и не упираемся в stack-too-deep без via-ir.
    event TokenCreated(
        address indexed token,
        address indexed pool,
        address indexed creator,
        address quote,
        uint16 divBps
    );

    /// @notice Потолок налога в пользу холдеров. Выбирает создатель: 0–3%.
    uint16 public constant MAX_DIV_BPS = 300;
    error ZeroAddr();
    error ZeroVirtual();
    error BadName();
    error BadSymbol();
    error BadUri();
    error NotConfigured();
    error QuoteNotAllowed();
    error DivTooHigh();
    error AddrMismatch();
    error NoPending();
    error Timelock();
    error Expired();
    error AlreadyLaunched();
    error MigratorNoCode();
    error FeeTooHigh();
    error ShareTooHigh();

    event QuoteSet(address indexed quote, bool allowed, uint256 virtualQuote, uint256 creatorBuyCap);
    event ConfigUpdated(address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps);
    event ConfigProposed(address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt);
    event ConfigCancelled();

    constructor(address treasury_, address migrator_) Ownable(msg.sender) {
        if (!(treasury_ != address(0) && migrator_ != address(0))) revert ZeroAddr();
        treasury = treasury_;
        migrator = migrator_;
    }

    // ------------------------------------------------------------- quotes

    /// @notice Добавить/обновить разрешённую quote-валюту (акция/стейбл).
    function setQuote(address quote, bool allowed, uint256 virtualQuote_, uint256 creatorBuyCap_)
        external
        onlyOwner
    {
        if (!(quote != address(0))) revert ZeroAddr();
        if (allowed) if (!(virtualQuote_ > 0)) revert ZeroVirtual();
        bool existed = quoteConfig[quote].virtualQuote != 0 || quoteConfig[quote].allowed;
        quoteConfig[quote] = QuoteConfig({ allowed: allowed, virtualQuote: virtualQuote_, creatorBuyCap: creatorBuyCap_ });
        if (!existed && allowed) allowedQuotes.push(quote);
        emit QuoteSet(quote, allowed, virtualQuote_, creatorBuyCap_);
    }

    function allowedQuotesCount() external view returns (uint256) {
        return allowedQuotes.length;
    }

    // ------------------------------------------------------------- launch

    /// @notice Запустить токен на кривой с валютой `quote`. Первая покупка
    ///         создателя — отдельным вызовом buy() с approve (ERC20 не может
    ///         прийти вместе с деплоем, как ETH).
    /// @param divBps налог в пользу холдеров с каждой сделки кривой, bps
    ///        (0, 100, 200 или 300 в форме; контракт допускает любое до 300).
    ///        Берётся в валюте монеты и раздаётся по балансам. Неизменяем.
    /// @param exempt до 32 адресов, освобождённых от стартового налога
    ///        (команда, партнёры); создатель освобождён всегда.
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address quote,
        address creatorWallet,
        uint16 divBps,
        address[] calldata exempt
    ) external returns (address tokenAddr, address poolAddr) {
        if (!(bytes(name).length > 0 && bytes(name).length <= MAX_NAME_LEN)) revert BadName();
        if (!(bytes(symbol).length > 0 && bytes(symbol).length <= MAX_SYMBOL_LEN)) revert BadSymbol();
        if (!(bytes(metadataURI).length <= MAX_URI_LEN)) revert BadUri();
        if (!(configured)) revert NotConfigured();
        if (!(quoteConfig[quote].allowed)) revert QuoteNotAllowed();
        if (!(divBps <= MAX_DIV_BPS)) revert DivTooHigh();
        address creator_ = creatorWallet == address(0) ? msg.sender : creatorWallet;
        return _launch(name, symbol, metadataURI, quote, creator_, divBps, exempt);
    }

    /// @dev Деплой пула и токена — в двух внутренних функциях с коротким
    ///      стеком: три calldata-строки плюс массив освобождённых упираются в
    ///      stack-too-deep (без via-ir).
    function _launch(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address quote,
        address creator_,
        uint16 divBps,
        address[] calldata exempt
    ) internal returns (address tokenAddr, address poolAddr) {
        poolAddr = _newPool(quote, creator_, divBps, exempt);
        tokenAddr = _newToken(name, symbol, metadataURI, poolAddr, quote, divBps);
        if (!(tokenAddr == address(BondingCurvePoolQuoteV3(poolAddr).token()))) revert AddrMismatch();

        allTokens.push(tokenAddr);
        poolOf[tokenAddr] = poolAddr;
        isPool[poolAddr] = true;
        quoteOf[tokenAddr] = quote;

        emit TokenCreated(tokenAddr, poolAddr, creator_, quote, divBps);
    }

    function _newPool(address quote, address creator_, uint16 divBps, address[] calldata exempt) internal returns (address) {
        QuoteConfig memory qc = quoteConfig[quote];
        return address(new BondingCurvePoolQuoteV3(BondingCurvePoolQuoteV3.Params({
            token: _predictTokenAddress(),
            quote: quote,
            creator: creator_,
            totalSupply: TOTAL_SUPPLY,
            saleCap: SALE_CAP,
            virtualQuote: qc.virtualQuote,
            feeBps: feeBps,
            creatorFeeShareBps: creatorFeeShareBps,
            creatorBuyCap: qc.creatorBuyCap,
            divBps: divBps,
            exempt: exempt
        })));
    }

    function _newToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address pool,
        address quote,
        uint16 divBps
    ) internal returns (address) {
        return address(new DividendToken(name, symbol, metadataURI, pool, quote, divBps, TOTAL_SUPPLY));
    }

    function _predictTokenAddress() internal view returns (address) {
        uint256 nonce = _nonce() + 1;
        return _computeCreateAddress(address(this), nonce);
    }

    function _nonce() internal view returns (uint256 n) {
        return 1 + allTokens.length * 2;
    }

    function _computeCreateAddress(address deployer, uint256 nonce) internal pure returns (address) {
        bytes memory data;
        if (nonce == 0x00) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        } else if (nonce <= 0x7f) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, uint8(nonce));
        } else if (nonce <= 0xff) {
            data = abi.encodePacked(bytes1(0xd7), bytes1(0x94), deployer, bytes1(0x81), uint8(nonce));
        } else if (nonce <= 0xffff) {
            data = abi.encodePacked(bytes1(0xd8), bytes1(0x94), deployer, bytes1(0x82), uint16(nonce));
        } else if (nonce <= 0xffffff) {
            data = abi.encodePacked(bytes1(0xd9), bytes1(0x94), deployer, bytes1(0x83), uint24(nonce));
        } else {
            data = abi.encodePacked(bytes1(0xda), bytes1(0x94), deployer, bytes1(0x84), uint32(nonce));
        }
        return address(uint160(uint256(keccak256(data))));
    }

    // ------------------------------------------------------------- admin

    function proposeConfig(address treasury_, address migrator_, uint16 feeBps_, uint16 creatorFeeShareBps_)
        external
        onlyOwner
    {
        _checkConfig(treasury_, migrator_, feeBps_, creatorFeeShareBps_);
        pendingConfig = PendingConfig(treasury_, migrator_, feeBps_, creatorFeeShareBps_, block.timestamp + CONFIG_DELAY);
        emit ConfigProposed(treasury_, migrator_, feeBps_, creatorFeeShareBps_, block.timestamp + CONFIG_DELAY);
    }

    function applyConfig() external onlyOwner {
        PendingConfig memory p = pendingConfig;
        if (!(p.readyAt != 0)) revert NoPending();
        if (!(block.timestamp >= p.readyAt)) revert Timelock();
        if (!(block.timestamp <= p.readyAt + CONFIG_GRACE)) revert Expired();
        treasury = p.treasury;
        migrator = p.migrator;
        feeBps = p.feeBps;
        creatorFeeShareBps = p.creatorFeeShareBps;
        delete pendingConfig;
        emit ConfigUpdated(p.treasury, p.migrator, p.feeBps, p.creatorFeeShareBps);
    }

    function cancelConfig() external onlyOwner {
        delete pendingConfig;
        emit ConfigCancelled();
    }

    function initConfig(address treasury_, address migrator_, uint16 feeBps_, uint16 creatorFeeShareBps_)
        external
        onlyOwner
    {
        if (!(allTokens.length == 0)) revert AlreadyLaunched();
        _checkConfig(treasury_, migrator_, feeBps_, creatorFeeShareBps_);
        treasury = treasury_;
        migrator = migrator_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
        configured = true;
        emit ConfigUpdated(treasury_, migrator_, feeBps_, creatorFeeShareBps_);
    }

    /// @dev Общие проверки: мигратор обязан быть контрактом (пустой адрес
    ///      заморозил бы градацию всех монет).
    function _checkConfig(address treasury_, address migrator_, uint16 feeBps_, uint16 creatorFeeShareBps_) internal view {
        if (!(treasury_ != address(0) && migrator_ != address(0))) revert ZeroAddr();
        if (!(migrator_.code.length > 0)) revert MigratorNoCode();
        if (!(feeBps_ <= 500)) revert FeeTooHigh();
        if (!(creatorFeeShareBps_ <= 10_000)) revert ShareTooHigh();
    }

    // ------------------------------------------------------------- views

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function tokens(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = allTokens.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = allTokens[i];
        }
    }
}
