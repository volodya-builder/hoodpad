// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoolCheck {
    function isPool(address pool) external view returns (bool);
}

/// @title VotePower — «голос за шкуру» (proof-of-skin voting)
/// @notice Voting power is earned, not claimed: every trade fee you pay on a
///         hood bonding curve adds to your voting power for the current
///         7-day epoch. Once per epoch you commit your power to a token.
///         When the treasury buys back the round's winner, a share of the
///         bought tokens is distributed pro-rata to everyone who voted for
///         it. Unused power expires with the epoch.
///
///         Sybil-resistance: power costs real fees already paid into the
///         protocol, so farming votes with empty wallets is impossible.
contract VotePower is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EPOCH_LENGTH = 7 days;

    IPoolCheck public immutable factory;   // registered pools may record fees
    address    public immutable treasury;  // may fund epoch rewards
    address    public immutable guardian;  // may tune minPower (deployer)

    /// @notice Minimum earned power (fee-wei) required to vote.
    ///         Power = fees paid = 1% of volume, so e.g. 0.0025 ETH
    ///         means roughly $500 of trading volume per round.
    uint256 public minPower;

    // epoch => trader => fee-wei earned this epoch
    mapping(uint256 => mapping(address => uint256)) public powerOf;
    // epoch => trader => token voted for (0 = not voted)
    mapping(uint256 => mapping(address => address)) public choiceOf;
    // epoch => token => committed power total
    mapping(uint256 => mapping(address => uint256)) public totalFor;

    struct Reward { address token; uint256 amount; }
    mapping(uint256 => Reward) public rewardOf;                  // epoch => funded reward
    mapping(uint256 => mapping(address => bool)) public claimed; // epoch => trader => paid

    event PowerEarned(address indexed trader, uint256 indexed epoch, uint256 fee);
    event Voted(address indexed trader, uint256 indexed epoch, address indexed token, uint256 power);
    event RewardFunded(uint256 indexed epoch, address indexed token, uint256 amount);
    event RewardClaimed(uint256 indexed epoch, address indexed trader, uint256 amount);

    error NotPool();
    error NotTreasury();
    error AlreadyVoted();
    error ZeroToken();
    error EpochNotFinished();
    error AlreadyFunded();
    error NothingToClaim();
    error PowerTooLow();
    error NotGuardian();

    event MinPowerSet(uint256 minPower);

    constructor(address factory_, address treasury_, uint256 minPower_) {
        require(factory_ != address(0) && treasury_ != address(0), "zero addr");
        factory = IPoolCheck(factory_);
        treasury = treasury_;
        guardian = msg.sender;
        minPower = minPower_;
    }

    /// @notice Guardian can tune the voting threshold (e.g. as ETH/USD moves).
    function setMinPower(uint256 minPower_) external {
        if (msg.sender != guardian) revert NotGuardian();
        minPower = minPower_;
        emit MinPowerSet(minPower_);
    }

    // ------------------------------------------------------------- epochs

    function epoch() public view returns (uint256) {
        return block.timestamp / EPOCH_LENGTH;
    }

    function epochEndsIn() external view returns (uint256) {
        return EPOCH_LENGTH - (block.timestamp % EPOCH_LENGTH);
    }

    // ------------------------------------------------------------- power

    /// @notice Called by pools on every trade: fee paid => voting power.
    ///         If the trader already voted this epoch, the new power is
    ///         committed to their choice automatically.
    function recordFee(address trader, uint256 fee) external {
        if (!factory.isPool(msg.sender)) revert NotPool();
        if (fee == 0 || trader == address(0)) return;
        uint256 e = epoch();
        powerOf[e][trader] += fee;
        address voted = choiceOf[e][trader];
        if (voted != address(0)) totalFor[e][voted] += fee;
        emit PowerEarned(trader, e, fee);
    }

    // ------------------------------------------------------------- voting

    /// @notice Commit this epoch's power (current + future) to `token`.
    ///         Requires at least `minPower` earned this epoch (~$500 volume).
    function vote(address token) external {
        if (token == address(0)) revert ZeroToken();
        uint256 e = epoch();
        if (choiceOf[e][msg.sender] != address(0)) revert AlreadyVoted();
        uint256 p = powerOf[e][msg.sender];
        if (p < minPower) revert PowerTooLow();
        choiceOf[e][msg.sender] = token;
        totalFor[e][token] += p;
        emit Voted(msg.sender, e, token, p);
    }

    // ------------------------------------------------------------- rewards

    /// @notice Treasury funds the reward for a FINISHED epoch after buying
    ///         back its winner. Tokens must be transferred to this contract
    ///         in the same transaction (treasury does transfer + fund).
    function fundReward(uint256 epochId, address token, uint256 amount) external nonReentrant {
        if (msg.sender != treasury) revert NotTreasury();
        if (epochId >= epoch()) revert EpochNotFinished();
        if (rewardOf[epochId].token != address(0)) revert AlreadyFunded();
        rewardOf[epochId] = Reward(token, amount);
        emit RewardFunded(epochId, token, amount);
    }

    /// @notice Claim your share of a finished, funded epoch you voted right on.
    function claim(uint256 epochId) external nonReentrant returns (uint256 amount) {
        Reward memory r = rewardOf[epochId];
        if (r.token == address(0)) revert NothingToClaim();
        if (claimed[epochId][msg.sender]) revert NothingToClaim();
        if (choiceOf[epochId][msg.sender] != r.token) revert NothingToClaim();
        uint256 total = totalFor[epochId][r.token];
        if (total == 0) revert NothingToClaim();

        claimed[epochId][msg.sender] = true;
        amount = (r.amount * powerOf[epochId][msg.sender]) / total;
        if (amount == 0) revert NothingToClaim();
        IERC20(r.token).safeTransfer(msg.sender, amount);
        emit RewardClaimed(epochId, msg.sender, amount);
    }

    /// @notice UI helper: pending claim for `trader` in `epochId` (0 if none).
    function pendingReward(uint256 epochId, address trader) external view returns (uint256) {
        Reward memory r = rewardOf[epochId];
        if (r.token == address(0) || claimed[epochId][trader]) return 0;
        if (choiceOf[epochId][trader] != r.token) return 0;
        uint256 total = totalFor[epochId][r.token];
        if (total == 0) return 0;
        return (r.amount * powerOf[epochId][trader]) / total;
    }
}
