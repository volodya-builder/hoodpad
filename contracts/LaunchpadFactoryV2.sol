// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurvePoolV2} from "./BondingCurvePoolV2.sol";

/// @title LaunchpadFactoryV2
/// @notice hood economics: 1% trade fee split 50% creator / 20% team /
///         30% buyback treasury, and every pool reports paid fees to
///         VotePower — «голос за шкуру». Curve: 1B supply, 800M on the
///         curve, graduation at 6.5 ETH into a permanently locked DEX
///         position.
contract LaunchpadFactoryV2 is Ownable {
    // ------------------------------------------------------------- config
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant SALE_CAP     =   800_000_000e18;
    uint256 public constant VIRTUAL_ETH  = 1.625 ether; // -> graduates at 6.5 ETH

    /// @notice Потолок первой покупки создателя. Без него создатель забирал
    ///         сколь угодно большой мешок по стартовой цене и мог сливать его
    ///         в выкупы казны — то есть выкачивать общий призовой фонд.
    uint256 public constant CREATOR_MAX_FIRST_BUY = 0.13 ether; // ~2% кривой

    /// @notice Лимиты метаданных: неограниченные строки ломают вёрстку
    ///         списков и раздувают кэш у каждого посетителя.
    uint256 public constant MAX_NAME_LEN = 64;
    uint256 public constant MAX_SYMBOL_LEN = 12;
    uint256 public constant MAX_URI_LEN = 200_000;

    /// @notice Задержка смены критичной конфигурации (мигратор/казна).
    ///         Владелец не может внезапно подменить мигратор и увести
    ///         ликвидность негradуировавших пулов — у всех есть 48 часов,
    ///         чтобы увидеть заявку и выйти.
    uint256 public constant CONFIG_DELAY = 48 hours;

    uint16 public feeBps = 100;              // 1% per trade
    uint16 public creatorFeeShareBps = 5000; // creator 50%; остальные 50% идут в
                                             // FeeSplitter (team 40% => 20% всего,
                                             // treasury 60% => 30% всего)

    address public treasury;   // FeeSplitter (team + BuybackTreasuryV2)
    address public migrator;
    address public votePower;  // fee => voting power hook

    // заявка на смену конфигурации (таймлок)
    struct PendingConfig {
        address treasury;
        address migrator;
        address votePower;
        uint16 feeBps;
        uint16 creatorFeeShareBps;
        uint256 readyAt;
    }
    PendingConfig public pendingConfig;

    // ------------------------------------------------------------- registry
    address[] public allTokens;
    mapping(address => address) public poolOf; // token => pool
    mapping(address => bool) public isPool;    // pool => registered (VotePower auth)

    event TokenCreated(
        address indexed token,
        address indexed pool,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI
    );
    event ConfigUpdated(address treasury, address migrator, address votePower, uint16 feeBps, uint16 creatorFeeShareBps);
    event ConfigProposed(address treasury, address migrator, address votePower, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt);
    event ConfigCancelled();

    constructor(address treasury_, address migrator_) Ownable(msg.sender) {
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        treasury = treasury_;
        migrator = migrator_;
    }

    // ------------------------------------------------------------- launch

    /// @notice Launch a token. Any ETH sent is used as the creator's first buy.
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creatorWallet
    ) external payable returns (address tokenAddr, address poolAddr) {
        require(bytes(name).length > 0 && bytes(name).length <= MAX_NAME_LEN, "name len");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= MAX_SYMBOL_LEN, "symbol len");
        require(bytes(metadataURI).length <= MAX_URI_LEN, "uri len");
        require(msg.value <= CREATOR_MAX_FIRST_BUY, "first buy > cap");
        address creator_ = creatorWallet == address(0) ? msg.sender : creatorWallet;
        BondingCurvePoolV2 pool = new BondingCurvePoolV2(
            _predictTokenAddress(),
            creator_,
            TOTAL_SUPPLY,
            SALE_CAP,
            VIRTUAL_ETH,
            feeBps,
            creatorFeeShareBps
        );
        LaunchToken token = new LaunchToken(name, symbol, metadataURI, address(pool), TOTAL_SUPPLY);
        require(address(token) == address(pool.token()), "addr mismatch");

        tokenAddr = address(token);
        poolAddr = address(pool);
        allTokens.push(tokenAddr);
        poolOf[tokenAddr] = poolAddr;
        isPool[poolAddr] = true;

        emit TokenCreated(tokenAddr, poolAddr, creator_, name, symbol, metadataURI);

        if (msg.value > 0) {
            pool.buy{value: msg.value}(0, creator_);
        }
    }

    /// @dev Address of the *next* contract this factory deploys with CREATE.
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

    /// @notice Шаг 1: заявить смену конфигурации. Вступит в силу через
    ///         CONFIG_DELAY — до этого все видят заявку в событии и могут выйти.
    function proposeConfig(
        address treasury_,
        address migrator_,
        address votePower_,
        uint16 feeBps_,
        uint16 creatorFeeShareBps_
    ) external onlyOwner {
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        pendingConfig = PendingConfig({
            treasury: treasury_,
            migrator: migrator_,
            votePower: votePower_,
            feeBps: feeBps_,
            creatorFeeShareBps: creatorFeeShareBps_,
            readyAt: block.timestamp + CONFIG_DELAY
        });
        emit ConfigProposed(treasury_, migrator_, votePower_, feeBps_, creatorFeeShareBps_, block.timestamp + CONFIG_DELAY);
    }

    /// @notice Шаг 2: применить заявку после истечения таймлока.
    function applyConfig() external onlyOwner {
        PendingConfig memory p = pendingConfig;
        require(p.readyAt != 0, "no pending");
        require(block.timestamp >= p.readyAt, "timelock");
        treasury = p.treasury;
        migrator = p.migrator;
        votePower = p.votePower;
        feeBps = p.feeBps;
        creatorFeeShareBps = p.creatorFeeShareBps;
        delete pendingConfig;
        emit ConfigUpdated(p.treasury, p.migrator, p.votePower, p.feeBps, p.creatorFeeShareBps);
    }

    /// @notice Отозвать заявку (например, если передумали).
    function cancelConfig() external onlyOwner {
        delete pendingConfig;
        emit ConfigCancelled();
    }

    /// @dev Первичная настройка сразу после деплоя — один раз и без задержки,
    ///      пока в фабрике ещё нет ни одного токена (терять нечего).
    function initConfig(
        address treasury_,
        address migrator_,
        address votePower_,
        uint16 feeBps_,
        uint16 creatorFeeShareBps_
    ) external onlyOwner {
        require(allTokens.length == 0, "already launched");
        require(treasury_ != address(0) && migrator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        treasury = treasury_;
        migrator = migrator_;
        votePower = votePower_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
        emit ConfigUpdated(treasury_, migrator_, votePower_, feeBps_, creatorFeeShareBps_);
    }

    /// @dev Возврат сдачи от пула, если первая покупка упёрлась в кривую:
    ///      деньги принадлежат создателю токена, ему и уходят.
    receive() external payable {
        require(isPool[msg.sender], "only pools");
        address to = BondingCurvePoolV2(payable(msg.sender)).creator();
        (bool ok, ) = to.call{value: msg.value}("");
        require(ok, "refund failed");
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
