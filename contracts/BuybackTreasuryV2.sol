// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBuyablePool {
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256);
}

interface IPoolRegistry {
    function poolOf(address token) external view returns (address);
}

interface IVotePowerFund {
    function fundReward(uint256 epochId, address token, uint256 amount) external;
}

/// @title BuybackTreasuryV2 — казна, которая платит голосовавшим
/// @notice The protocol's fee share flows here. ETH can leave ONLY through
///         buybacks — no withdrawal function exists by design. New in v2:
///         a configurable share of every buyback is distributed to the
///         traders who voted for the winning token (via VotePower), the
///         rest is burned. The treasury also keeps an on-chain registry of
///         every token it ever bought — the future hood index reads it.
contract BuybackTreasuryV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolRegistry public immutable factory;
    address public votePower;               // set once after deploy
    /// @notice Share of bought tokens sent to voters. 0 by design: voters'
    ///         reward IS the buyback+burn pump of the token they voted for.
    ///         Kept configurable in case the community votes it in later.
    uint16  public rewardBps = 0;

    uint256 public totalReceived;
    uint256 public totalSpent;
    mapping(address => uint256) public boughtOf;
    mapping(address => uint256) public burnedOf;
    mapping(address => uint256) public rewardedOf;   // token => sent to voters

    // -------- portfolio registry (для будущего индекса) --------
    address[] public portfolio;                       // every token ever bought
    mapping(address => bool) public inPortfolio;
    mapping(address => bool) public delisted;         // guardian-excluded

    event Received(address indexed from, uint256 amount);
    event Buyback(address indexed token, address indexed pool, uint256 ethIn, uint256 tokensOut);
    event VotersRewarded(uint256 indexed epochId, address indexed token, uint256 amount);
    event Burned(address indexed token, uint256 amount);
    event PortfolioAdded(address indexed token);
    event Delisted(address indexed token, string reason);
    event Relisted(address indexed token);

    error UnknownToken();
    error InsufficientTreasury();
    error AlreadySet();

    constructor(address factory_) Ownable(msg.sender) {
        factory = IPoolRegistry(factory_);
    }

    receive() external payable {
        totalReceived += msg.value;
        emit Received(msg.sender, msg.value);
    }

    /// @notice One-time wiring: VotePower is deployed after the treasury.
    function setVotePower(address votePower_) external onlyOwner {
        if (votePower != address(0)) revert AlreadySet();
        require(votePower_ != address(0), "zero addr");
        votePower = votePower_;
    }

    function setRewardBps(uint16 rewardBps_) external onlyOwner {
        require(rewardBps_ <= 10_000, "bps>100%");
        rewardBps = rewardBps_;
    }

    // ------------------------------------------------------------- buyback

    /// @notice Buy back `token`, send `rewardBps` of the bought tokens to
    ///         the voters of finished epoch `epochId` and burn the rest.
    function buybackAndReward(
        address token,
        uint256 ethAmount,
        uint256 minTokensOut,
        uint256 epochId
    ) external onlyOwner nonReentrant returns (uint256 tokensOut) {
        tokensOut = _buy(token, ethAmount, minTokensOut);

        uint256 toVoters = (tokensOut * rewardBps) / 10_000;
        uint256 toBurn = tokensOut - toVoters;

        if (toVoters > 0 && votePower != address(0)) {
            IERC20(token).safeTransfer(votePower, toVoters);
            IVotePowerFund(votePower).fundReward(epochId, token, toVoters);
            rewardedOf[token] += toVoters;
            emit VotersRewarded(epochId, token, toVoters);
        }
        if (toBurn > 0) {
            IERC20(token).safeTransfer(DEAD, toBurn);
            burnedOf[token] += toBurn;
            emit Burned(token, toBurn);
        }
    }

    /// @notice Plain buyback into the treasury portfolio (no distribution).
    function buyback(address token, uint256 ethAmount, uint256 minTokensOut)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        tokensOut = _buy(token, ethAmount, minTokensOut);
    }

    /// @notice Burn treasury-held tokens (verifiable deflation).
    function burn(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(DEAD, amount);
        burnedOf[token] += amount;
        emit Burned(token, amount);
    }

    // ------------------------------------------------------------- guardian

    /// @notice Guardian: exclude a token from the (future) index — safety
    ///         valve for dead or manipulated tokens. On-chain and public.
    function delist(address token, string calldata reason) external onlyOwner {
        delisted[token] = true;
        emit Delisted(token, reason);
    }

    function relist(address token) external onlyOwner {
        delisted[token] = false;
        emit Relisted(token);
    }

    // ------------------------------------------------------------- views

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function portfolioCount() external view returns (uint256) {
        return portfolio.length;
    }

    /// @notice Token holdings of the treasury (index NAV building block).
    function heldOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ------------------------------------------------------------- internal

    function _buy(address token, uint256 ethAmount, uint256 minTokensOut)
        internal
        returns (uint256 tokensOut)
    {
        if (ethAmount > address(this).balance) revert InsufficientTreasury();
        address pool = factory.poolOf(token);
        if (pool == address(0)) revert UnknownToken();

        tokensOut = IBuyablePool(pool).buy{value: ethAmount}(minTokensOut, address(this));
        totalSpent += ethAmount;
        boughtOf[token] += tokensOut;
        if (!inPortfolio[token]) {
            inPortfolio[token] = true;
            portfolio.push(token);
            emit PortfolioAdded(token);
        }
        emit Buyback(token, pool, ethAmount, tokensOut);
    }
}
