// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILiquidityMigratorQuote} from "./interfaces/ILiquidityMigratorQuote.sol";

interface IPoolInfoQ {
    function creator() external view returns (address);
    function factory() external view returns (address);
    function token() external view returns (address);
}

interface IFactoryRegistryQ {
    function poolOf(address token) external view returns (address);
}

interface IUniswapV3PoolStateQ {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);

    function liquidity() external view returns (uint128);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface INonfungiblePositionManagerQ {
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

/// @title UniswapV3MigratorQuote
/// @notice Зеркало UniswapV3Migrator для кривых с ERC20-валютой (акции RWA,
///         стейблы): на градации создаёт full-range позицию «токен/quote» в
///         Uniswap V3 и навсегда запирает NFT здесь. Все защиты цены — как в
///         боевом ETH-миграторе (см. его шапку):
///           1. quote при выравнивании не тратится НИКОГДА — только продажа
///              наших токенов при завышенной цене;
///           2. бюджет выравнивания ограничен ALIGN_BUDGET_BPS;
///           3. ликвидность льётся только по цене в допуске, иначе revert и
///              миграцию можно повторить;
///           4. излишки — в казну (dustSink), не создателю.
contract UniswapV3MigratorQuote is ILiquidityMigratorQuote, Ownable {
    using SafeERC20 for IERC20;

    INonfungiblePositionManagerQ public immutable positionManager;
    uint24 public constant POOL_FEE = 3000;
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;

    uint256 public constant MAX_SQRT_DEVIATION_BPS = 100; // 1%
    uint256 public constant MIN_DEPOSIT_BPS = 9_000;      // 90%
    uint256 public constant ALIGN_BUDGET_BPS = 100;       // 1%

    address public dustSink;

    address private _swapPool;
    address private _swapToken; // каким токеном платим в колбэке (наш токен)
    address private _swapQuote; // парный quote — для определения стороны token0/token1

    error PoolPriceManipulated(uint160 expectedSqrtPriceX96, uint160 actualSqrtPriceX96);
    error UnknownPool();

    event LiquidityLocked(
        address indexed token,
        address indexed quote,
        address v3Pool,
        uint256 positionId,
        uint256 tokenAmount,
        uint256 quoteAmount
    );
    event PriceAligned(address indexed v3Pool, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96);
    event DustSwept(address indexed token, uint256 tokenAmount, uint256 quoteAmount);

    constructor(address positionManager_) Ownable(msg.sender) {
        require(positionManager_ != address(0), "zero addr");
        positionManager = INonfungiblePositionManagerQ(positionManager_);
    }

    function setDustSink(address sink) external onlyOwner {
        require(dustSink == address(0), "already set");
        require(sink != address(0), "zero addr");
        dustSink = sink;
    }

    function migrateQuote(address token, address quote, uint256 tokenAmount, uint256 quoteAmount)
        external
        override
    {
        require(tokenAmount > 0 && quoteAmount > 0, "empty migration");
        require(token != quote, "token==quote");
        // Звать может только настоящий пул этого токена из его же фабрики.
        if (IFactoryRegistryQ(IPoolInfoQ(msg.sender).factory()).poolOf(token) != msg.sender) {
            revert UnknownPool();
        }

        (address token0, address token1) = token < quote ? (token, quote) : (quote, token);
        (uint256 amount0, uint256 amount1) = token < quote
            ? (tokenAmount, quoteAmount)
            : (quoteAmount, tokenAmount);

        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(amount1, 1 << 192, amount0)));

        address v3Pool = positionManager.createAndInitializePoolIfNecessary(
            token0, token1, POOL_FEE, sqrtPriceX96
        );

        _swapQuote = quote;
        _alignPrice(v3Pool, token, tokenAmount, sqrtPriceX96, token < quote);
        _swapQuote = address(0);

        uint256 positionId = _mintLocked(token0, token1, amount0, amount1, sqrtPriceX96, v3Pool);
        _sweepDust(token, quote);

        emit LiquidityLocked(token, quote, v3Pool, positionId, tokenAmount, quoteAmount);
    }

    // ------------------------------------------------------------- internal

    /// @dev Как в ETH-миграторе: продаём ТОЛЬКО наш токен и только когда цена
    ///      завышена. Quote не тратится никогда — иначе выкупали бы мешок у
    ///      манипулятора за собранные акции.
    function _alignPrice(
        address v3Pool,
        address token,
        uint256 tokenAmount,
        uint160 target,
        bool tokenIsZero
    ) internal {
        (uint160 cur, , , , , , ) = IUniswapV3PoolStateQ(v3Pool).slot0();
        if (_within(cur, target)) return;

        bool emptyPool = IUniswapV3PoolStateQ(v3Pool).liquidity() == 0;

        bool sellDirection = tokenIsZero ? cur > target : cur < target;
        if (!emptyPool && !sellDirection) return;

        bool zeroForOne = emptyPool ? cur > target : tokenIsZero;
        uint256 budget = emptyPool ? 1 : (tokenAmount * ALIGN_BUDGET_BPS) / 10_000;
        if (budget == 0) return;

        _swapPool = v3Pool;
        _swapToken = token;
        _swapTokenIsZero = tokenIsZero; // наш токен — token0 пула?
        try IUniswapV3PoolStateQ(v3Pool).swap(
            address(this),
            zeroForOne,
            int256(budget),
            target,
            abi.encode(token)
        ) {} catch { /* не вышло — ниже сработает проверка цены */ }
        _swapPool = address(0);
        _swapToken = address(0);

        (uint160 after_, , , , , , ) = IUniswapV3PoolStateQ(v3Pool).slot0();
        emit PriceAligned(v3Pool, cur, after_);
    }

    function _within(uint160 actual, uint160 expected_) internal pure returns (bool) {
        uint256 expected = uint256(expected_);
        uint256 diff = uint256(actual) > expected ? uint256(actual) - expected : expected - uint256(actual);
        return diff * 10_000 <= expected * MAX_SQRT_DEVIATION_BPS;
    }

    function _mintLocked(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint160 target,
        address v3Pool
    ) internal returns (uint256 positionId) {
        (uint160 cur, , , , , , ) = IUniswapV3PoolStateQ(v3Pool).slot0();
        if (!_within(cur, target)) revert PoolPriceManipulated(target, cur);

        uint256 have0 = IERC20(token0).balanceOf(address(this));
        uint256 have1 = IERC20(token1).balanceOf(address(this));
        if (amount0 > have0) amount0 = have0;
        if (amount1 > have1) amount1 = have1;

        IERC20(token0).forceApprove(address(positionManager), amount0);
        IERC20(token1).forceApprove(address(positionManager), amount1);

        (positionId, , , ) = positionManager.mint(
            INonfungiblePositionManagerQ.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: (amount0 * MIN_DEPOSIT_BPS) / 10_000,
                amount1Min: (amount1 * MIN_DEPOSIT_BPS) / 10_000,
                recipient: address(this), // NFT заперт навсегда
                deadline: block.timestamp
            })
        );

        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);
    }

    function _sweepDust(address token, address quote) internal {
        address to = dustSink;
        if (to == address(0)) return;
        uint256 tokLeft = IERC20(token).balanceOf(address(this));
        uint256 qLeft = IERC20(quote).balanceOf(address(this));
        if (tokLeft > 0) IERC20(token).safeTransfer(to, tokLeft);
        if (qLeft > 0) IERC20(quote).safeTransfer(to, qLeft);
        emit DustSwept(token, tokLeft, qLeft);
    }

    /// @dev Оплата нашего же свапа: платим ТОЛЬКО нашим токеном. Наш токен —
    ///      token0, если _swapTokenIsZero. Пул может потребовать оплату лишь
    ///      той стороны, что соответствует нашему токену; попытка списать quote
    ///      (другую сторону) отклоняется — quote не тратится никогда.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(msg.sender == _swapPool && _swapPool != address(0), "bad pool");
        address token = abi.decode(data, (address));
        require(token == _swapToken, "bad token");
        if (_swapTokenIsZero) {
            require(amount0Delta > 0 && amount1Delta <= 0, "quote spend blocked");
            IERC20(token).safeTransfer(msg.sender, uint256(amount0Delta));
        } else {
            require(amount1Delta > 0 && amount0Delta <= 0, "quote spend blocked");
            IERC20(token).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }

    bool private _swapTokenIsZero;

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}
