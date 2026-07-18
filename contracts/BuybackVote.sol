// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BuybackVote
/// @notice Weekly advisory poll: which token should the treasury buy back?
///         One wallet — one vote per weekly epoch. Votes are events signed
///         by the voter's wallet: impossible to forge, free to read, stored
///         in the chain forever. The poll is advisory — the platform owner
///         makes the final buyback call (and says so in the UI).
contract BuybackVote {
    uint256 public constant EPOCH_LENGTH = 7 days;

    event Vote(address indexed token, address indexed voter, uint256 indexed epoch);

    mapping(uint256 => mapping(address => bool)) public voted;

    error AlreadyVoted();
    error ZeroToken();

    function epoch() public view returns (uint256) {
        return block.timestamp / EPOCH_LENGTH;
    }

    /// @notice Seconds until the current round ends.
    function epochEndsIn() external view returns (uint256) {
        return EPOCH_LENGTH - (block.timestamp % EPOCH_LENGTH);
    }

    function vote(address token) external {
        if (token == address(0)) revert ZeroToken();
        uint256 e = epoch();
        if (voted[e][msg.sender]) revert AlreadyVoted();
        voted[e][msg.sender] = true;
        emit Vote(token, msg.sender, e);
    }
}
