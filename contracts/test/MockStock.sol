// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Тест-заглушка токенизированной акции / стейбла: обычный ERC20
///         (18 decimals, без комиссий и ребейзов) с открытым mint для тестов.
contract MockStock is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
