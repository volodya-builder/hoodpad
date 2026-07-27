// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILiquidityMigrator} from "./interfaces/ILiquidityMigrator.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
}

/// @dev Пул, вызывающий migrate(), знает своего создателя — ему и вернём пыль.
interface IPoolCreator {
    function creator() external view returns (address);
}

/// @dev Читаем фактическую цену пула: если пул кто-то создал заранее с
///      искажённой ценой, createAndInitializePoolIfNecessary молча оставит
///      её — и наша ликвидность легла бы по цене атакующего.
interface IUniswapV3PoolState {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
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

    /// @notice Допуск на отклонение фактической цены пула от расчётной, в bps
    ///         от sqrtPrice (100 = 1% по sqrt ≈ 2% по цене). Если пул был
    ///         инициализирован заранее по другой цене — миграция ревертится.
    uint256 public constant MAX_SQRT_DEVIATION_BPS = 100;

    /// @notice Минимальная доля желаемых сумм, которую обязана принять позиция.
    uint256 public constant MIN_DEPOSIT_BPS = 9_000; // 90%

    error PoolPriceManipulated(uint160 expectedSqrtPriceX96, uint160 actualSqrtPriceX96);

    event LiquidityLocked(
        address indexed token,
        address indexed v3Pool,
        uint256 positionId,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    constructor(address positionManager_, address weth_) {
        require(positionManager_ != address(0) && weth_ != address(0), "zero addr");
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

        _requireFairPrice(v3Pool, sqrtPriceX96);

        IERC20(token).forceApprove(address(positionManager), tokenAmount);
        IERC20(address(weth)).forceApprove(address(positionManager), ethAmount);

        (uint256 positionId, , uint256 used0, uint256 used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                // реальные минимумы вместо нулей: позиция обязана принять
                // как минимум 90% каждой стороны, иначе транзакция отменяется
                amount0Min: (amount0 * MIN_DEPOSIT_BPS) / 10_000,
                amount1Min: (amount1 * MIN_DEPOSIT_BPS) / 10_000,
                recipient: address(this), // NFT locked here forever
                deadline: block.timestamp
            })
        );

        // Остаток («пыль») после создания позиции возвращаем создателю токена,
        // чтобы он не запирался в контракте навсегда.
        bool tokenIs0 = token < address(weth);
        _refundDust(
            token,
            tokenAmount - (tokenIs0 ? used0 : used1),  // остаток токена
            ethAmount - (tokenIs0 ? used1 : used0)     // остаток WETH
        );

        emit LiquidityLocked(token, v3Pool, positionId, tokenAmount, ethAmount);
    }

    /// @dev ЗАЩИТА ОТ ПОДМЕНЫ ЦЕНЫ. createAndInitializePoolIfNecessary
    ///      инициализирует пул ТОЛЬКО если он ещё не инициализирован.
    ///      Атакующий может создать его заранее по искажённой цене — тогда
    ///      вся градуированная ликвидность легла бы по его цене и была бы
    ///      немедленно выкуплена арбитражем. Сверяем факт с расчётом.
    ///      При расхождении транзакция отменяется: средства остаются в
    ///      бондинг-пуле, миграцию можно повторить позже — атакующему
    ///      пришлось бы вечно держать капитал в кривом пуле без выгоды.
    function _requireFairPrice(address v3Pool, uint160 expectedSqrtPriceX96) internal view {
        (uint160 actual, , , , , , ) = IUniswapV3PoolState(v3Pool).slot0();
        uint256 expected = uint256(expectedSqrtPriceX96);
        uint256 diff = uint256(actual) > expected ? uint256(actual) - expected : expected - uint256(actual);
        if (diff * 10_000 > expected * MAX_SQRT_DEVIATION_BPS) {
            revert PoolPriceManipulated(expectedSqrtPriceX96, actual);
        }
    }

    /// @dev Best-effort возврат остатков создателю пула. Если получатель не
    ///      принимает средства — миграция всё равно проходит (нет грифинга).
    function _refundDust(address token, uint256 leftoverToken, uint256 leftoverWeth) internal {
        address creator = address(0);
        try IPoolCreator(msg.sender).creator() returns (address c) { creator = c; }
        catch { return; }
        if (creator == address(0)) return;
        if (leftoverToken > 0) IERC20(token).safeTransfer(creator, leftoverToken);
        if (leftoverWeth > 0) {
            weth.withdraw(leftoverWeth);
            (bool ok, ) = creator.call{value: leftoverWeth}("");
            ok; // проигнорировано намеренно
        }
    }

    /// @dev Принимаем ETH при разворачивании WETH.
    receive() external payable {}

    /// @dev Accept NFT transfers from the position manager.
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}
