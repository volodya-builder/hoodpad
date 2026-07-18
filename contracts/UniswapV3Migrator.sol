// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILiquidityMigrator} from "./interfaces/ILiquidityMigrator.sol";

interface IWETH9 {
    function deposit() external payable;
    function approve(address, uint256) external returns (bool);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/// @title UniswapV3Migrator
/// @notice Receives a graduated token's DEX reserve (tokens + ETH), creates
///         a full-range Uniswap V3 position and keeps the LP NFT locked in
///         this contract forever — there is no function to withdraw it.
///         That makes graduated liquidity permanent by construction.
contract UniswapV3Migrator is ILiquidityMigrator {
    using SafeERC20 for IERC20;

    INonfungiblePositionManager public immutable positionManager;
    IWETH9 public immutable weth;
    uint24 public constant POOL_FEE = 3000;      // 0.3%
    int24 public constant TICK_LOWER = -887220;  // full range for spacing 60
    int24 public constant TICK_UPPER = 887220;

    event LiquidityLocked(
        address indexed token,
        address indexed v3Pool,
        uint256 positionId,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    constructor(address positionManager_, address weth_) {
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = IWETH9(weth_);
    }

    function migrate(address token, uint256 tokenAmount) external payable override {
        uint256 ethAmount = msg.value;
        require(tokenAmount > 0 && ethAmount > 0, "empty migration");

        // Wrap ETH.
        weth.deposit{value: ethAmount}();

        // Sort the pair.
        (address token0, address token1) = token < address(weth)
            ? (token, address(weth))
            : (address(weth), token);
        (uint256 amount0, uint256 amount1) = token < address(weth)
            ? (tokenAmount, ethAmount)
            : (ethAmount, tokenAmount);

        // Initial price: sqrtPriceX96 = sqrt(amount1/amount0) * 2^96.
        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(amount1, 1 << 192, amount0)));

        address v3Pool = positionManager.createAndInitializePoolIfNecessary(
            token0,
            token1,
            POOL_FEE,
            sqrtPriceX96
        );

        IERC20(token).forceApprove(address(positionManager), tokenAmount);
        IERC20(address(weth)).approve(address(positionManager), ethAmount);

        (uint256 positionId, , , ) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this), // NFT locked here forever
                deadline: block.timestamp
            })
        );

        emit LiquidityLocked(token, v3Pool, positionId, tokenAmount, ethAmount);
    }

    /// @dev Accept NFT transfers from the position manager.
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}
