// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBuyablePool {
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256);
    function token() external view returns (IERC20);
}

interface IPoolRegistry {
    function poolOf(address token) external view returns (address);
}

/// @title BuybackTreasury
/// @notice The platform's share of trading fees (80%) flows here, and the
///         ETH can leave ONLY through token buybacks — there is no
///         withdrawal function by design. The owner selectively picks
///         which token to buy back and how much ETH to spend. Bought
///         tokens can be burned (sent to the dead address) for verifiable
///         deflation, or held by the treasury.
contract BuybackTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolRegistry public immutable factory;

    uint256 public totalReceived;   // lifetime ETH received
    uint256 public totalSpent;      // lifetime ETH spent on buybacks
    mapping(address => uint256) public boughtOf;  // token => tokens bought
    mapping(address => uint256) public burnedOf;  // token => tokens burned

    event Received(address indexed from, uint256 amount);
    event Buyback(address indexed token, address indexed pool, uint256 ethIn, uint256 tokensOut);
    event Burned(address indexed token, uint256 amount);

    error UnknownToken();
    error InsufficientTreasury();

    constructor(address factory_) Ownable(msg.sender) {
        factory = IPoolRegistry(factory_);
    }

    receive() external payable {
        totalReceived += msg.value;
        emit Received(msg.sender, msg.value);
    }

    /// @notice Selectively buy back `token` on its bonding curve with
    ///         `ethAmount` from the treasury. Owner-only by design —
    ///         the platform picks which coins to support.
    function buyback(address token, uint256 ethAmount, uint256 minTokensOut)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (ethAmount > address(this).balance) revert InsufficientTreasury();
        address pool = factory.poolOf(token);
        if (pool == address(0)) revert UnknownToken();

        tokensOut = IBuyablePool(pool).buy{value: ethAmount}(minTokensOut, address(this));
        totalSpent += ethAmount;
        boughtOf[token] += tokensOut;
        emit Buyback(token, pool, ethAmount, tokensOut);
    }

    /// @notice Burn treasury-held tokens forever (verifiable deflation).
    function burn(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(DEAD, amount);
        burnedOf[token] += amount;
        emit Burned(token, amount);
    }

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
