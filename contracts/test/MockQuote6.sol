// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Валюта с НЕ-18 знаками — как USDG (6) или CBBTC (8).
///         Нужна отдельно: вся остальная тестовая обвязка работает на 18
///         знаках, и если кривая где-то молча считает по 18, на USDG это
///         вылезет только в мейннете, на чужих деньгах.
contract MockQuote6 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
