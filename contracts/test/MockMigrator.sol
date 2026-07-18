// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityMigrator} from "../interfaces/ILiquidityMigrator.sol";

/// @notice Test double: records what it received on migration.
contract MockMigrator is ILiquidityMigrator {
    address public lastToken;
    uint256 public lastTokenAmount;
    uint256 public lastEthAmount;
    uint256 public migrations;

    event MockMigrated(address token, uint256 tokenAmount, uint256 ethAmount);

    function migrate(address token, uint256 tokenAmount) external payable override {
        lastToken = token;
        lastTokenAmount = tokenAmount;
        lastEthAmount = msg.value;
        migrations += 1;
        // sanity: the tokens must already be here
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "tokens not received");
        emit MockMigrated(token, tokenAmount, msg.value);
    }
}
