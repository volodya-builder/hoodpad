// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title HoodChat
/// @notice Fully on-chain chat for hood tokens. A message is just an event:
///         no storage, no moderation keys, no backend — anyone can post,
///         authorship is proven by the sender's signature, history lives
///         in the chain forever. Reading is free (event logs).
contract HoodChat {
    event Message(
        address indexed token,
        address indexed sender,
        string text,
        uint256 timestamp
    );

    error BadLength();

    /// @param token the token this message belongs to (its chat room)
    /// @param text  1..280 bytes
    function post(address token, string calldata text) external {
        uint256 len = bytes(text).length;
        if (len == 0 || len > 280) revert BadLength();
        emit Message(token, msg.sender, text, block.timestamp);
    }
}
