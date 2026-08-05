// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILiquidityMigratorQuote {
    /// @param token       градуировавший токен (уже переведён мигратору)
    /// @param quote       ERC20-валюта кривой (акция/стейбл; уже переведена мигратору)
    /// @param tokenAmount сколько токенов передано под ликвидность
    /// @param quoteAmount сколько quote передано под ликвидность
    function migrateQuote(address token, address quote, uint256 tokenAmount, uint256 quoteAmount) external;
}
