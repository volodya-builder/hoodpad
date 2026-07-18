// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurvePool} from "./BondingCurvePool.sol";

/// @title LaunchpadFactory
/// @notice One-transaction, permissionless token launches on Robinhood Chain.
///
///         createToken() deploys a fixed-supply ERC20 + its bonding-curve
///         pool, optionally executing the creator's first buy in the same
///         transaction (snipe protection: the creator is guaranteed the
///         first fill).
///
///         Curve economics (defaults):
///           total supply : 1,000,000,000 tokens
///           on the curve : 800,000,000 (80%)
///           DEX reserve  : 200,000,000 (20%) + ~6.5 ETH, locked forever
///           trade fee    : 1% — 20% to the creator, 80% to the buyback
///                          treasury (ETH there can only buy tokens back)
contract LaunchpadFactory is Ownable {
    // ------------------------------------------------------------- config
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant SALE_CAP     =   800_000_000e18;
    uint256 public constant VIRTUAL_ETH  = 1.625 ether; // -> graduates at 6.5 ETH

    uint16 public feeBps = 100;              // 1% per trade
    uint16 public creatorFeeShareBps = 2000; // creator 20%; the other 80% goes
                                             // to the BuybackTreasury (set as `treasury`)

    address public treasury;
    address public migrator;

    // ------------------------------------------------------------- registry
    address[] public allTokens;
    mapping(address => address) public poolOf; // token => pool

    event TokenCreated(
        address indexed token,
        address indexed pool,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI
    );
    event ConfigUpdated(address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps);

    constructor(address treasury_, address migrator_) Ownable(msg.sender) {
        treasury = treasury_;
        migrator = migrator_;
    }

    // ------------------------------------------------------------- launch

    /// @notice Launch a token. Any ETH sent is used as the creator's first buy.
    /// @param creatorWallet receives the creator fee share (70%) and the
    ///        developer buy; pass address(0) to use msg.sender.
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creatorWallet
    ) external payable returns (address tokenAddr, address poolAddr) {
        address creator_ = creatorWallet == address(0) ? msg.sender : creatorWallet;
        // Deploy pool first (needs token address) — use CREATE2-free two-step:
        // predict is unnecessary; deploy pool with token=0 impossible, so
        // deploy token to the pool address computed after pool creation is
        // circular. Instead: deploy pool, then token minted straight to it.
        BondingCurvePool pool = new BondingCurvePool(
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

        emit TokenCreated(tokenAddr, poolAddr, creator_, name, symbol, metadataURI);

        // Creator's first buy in the same tx (front-run protection).
        if (msg.value > 0) {
            pool.buy{value: msg.value}(0, creator_);
        }
    }

    /// @dev Address of the *next* contract this factory deploys with CREATE.
    ///      The pool is deployed at nonce N, the token at nonce N+1.
    function _predictTokenAddress() internal view returns (address) {
        // RLP encoding of [address, nonce] for nonce+1 (the token deploy).
        uint256 nonce = _nonce() + 1;
        return _computeCreateAddress(address(this), nonce);
    }

    function _nonce() internal view returns (uint256 n) {
        // Factory nonce = 1 (deployment) + 2 * number of launches so far.
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

    function setConfig(
        address treasury_,
        address migrator_,
        uint16 feeBps_,
        uint16 creatorFeeShareBps_
    ) external onlyOwner {
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
