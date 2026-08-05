// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurvePoolQuote} from "./BondingCurvePoolQuote.sol";

/// @title LaunchpadFactoryQuote
/// @notice Фабрика токенов на кривой с ERC20-валютой (токенизированные акции
///         Robinhood, стейблы). Экономика та же (1% комиссия, 50% создателю),
///         но валюта — whitelisted quote-токен. Whitelist защищает от
///         fee-on-transfer / ребейз / хук-токенов, которые ломают инвариант
///         кривой: пускаем только проверенные Stock Tokens и стейблы.
contract LaunchpadFactoryQuote is Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant SALE_CAP     =   800_000_000e18;

    uint256 public constant MAX_NAME_LEN = 64;
    uint256 public constant MAX_SYMBOL_LEN = 12;
    uint256 public constant MAX_URI_LEN = 200_000;
    uint256 public constant CONFIG_DELAY = 48 hours;

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
    mapping(address => address) public quoteOf; // token => quote

    /// @dev name/symbol/metadataURI не дублируем в событии — они читаются
    ///      прямо с токена (name(), symbol(), metadataURI()). Так и лаконичнее,
    ///      и не упираемся в stack-too-deep без via-ir.
    event TokenCreated(
        address indexed token,
        address indexed pool,
        address indexed creator,
        address quote
    );
    event QuoteSet(address indexed quote, bool allowed, uint256 virtualQuote, uint256 creatorBuyCap);
    event ConfigUpdated(address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps);
    event ConfigProposed(address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt);
    event ConfigCancelled();

    constructor(address treasury_, address migrator_) Ownable(msg.sender) {
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        treasury = treasury_;
        migrator = migrator_;
    }

    // ------------------------------------------------------------- quotes

    /// @notice Добавить/обновить разрешённую quote-валюту (акция/стейбл).
    function setQuote(address quote, bool allowed, uint256 virtualQuote_, uint256 creatorBuyCap_)
        external
        onlyOwner
    {
        require(quote != address(0), "zero quote");
        if (allowed) require(virtualQuote_ > 0, "zero virtual");
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
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address quote,
        address creatorWallet
    ) external returns (address tokenAddr, address poolAddr) {
        require(bytes(name).length > 0 && bytes(name).length <= MAX_NAME_LEN, "name len");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= MAX_SYMBOL_LEN, "symbol len");
        require(bytes(metadataURI).length <= MAX_URI_LEN, "uri len");
        require(quoteConfig[quote].allowed, "quote not allowed");
        address creator_ = creatorWallet == address(0) ? msg.sender : creatorWallet;
        return _launch(name, symbol, metadataURI, quote, creator_);
    }

    /// @dev Вся тяжёлая работа в одной внутренней функции — createToken держит
    ///      минимальный стек, иначе emit с тремя calldata-строками упирается
    ///      в stack-too-deep (без via-ir).
    function _launch(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address quote,
        address creator_
    ) internal returns (address tokenAddr, address poolAddr) {
        QuoteConfig memory qc = quoteConfig[quote];
        BondingCurvePoolQuote pool = new BondingCurvePoolQuote(
            _predictTokenAddress(), quote, creator_,
            TOTAL_SUPPLY, SALE_CAP, qc.virtualQuote, feeBps, creatorFeeShareBps, qc.creatorBuyCap
        );
        LaunchToken token = new LaunchToken(name, symbol, metadataURI, address(pool), TOTAL_SUPPLY);
        require(address(token) == address(pool.token()), "addr mismatch");

        tokenAddr = address(token);
        poolAddr = address(pool);
        allTokens.push(tokenAddr);
        poolOf[tokenAddr] = poolAddr;
        isPool[poolAddr] = true;
        quoteOf[tokenAddr] = quote;

        emit TokenCreated(tokenAddr, poolAddr, creator_, quote);
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
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        pendingConfig = PendingConfig(treasury_, migrator_, feeBps_, creatorFeeShareBps_, block.timestamp + CONFIG_DELAY);
        emit ConfigProposed(treasury_, migrator_, feeBps_, creatorFeeShareBps_, block.timestamp + CONFIG_DELAY);
    }

    function applyConfig() external onlyOwner {
        PendingConfig memory p = pendingConfig;
        require(p.readyAt != 0, "no pending");
        require(block.timestamp >= p.readyAt, "timelock");
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
        require(allTokens.length == 0, "already launched");
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        treasury = treasury_;
        migrator = migrator_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
        emit ConfigUpdated(treasury_, migrator_, feeBps_, creatorFeeShareBps_);
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
