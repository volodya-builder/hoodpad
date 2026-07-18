// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pluggable liquidity migrator. When a token graduates from the
///         bonding curve, the pool sends the DEX reserve (tokens + ETH)
///         here and the migrator creates a permanently locked DEX position.
interface ILiquidityMigrator {
    /// @param token       the graduated token (already transferred to the migrator)
    /// @param tokenAmount amount of tokens transferred for liquidity
    /// @dev   ETH for liquidity is sent as msg.value.
    function migrate(address token, uint256 tokenAmount) external payable;
}
