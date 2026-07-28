// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILiquidityMigrator} from "./interfaces/ILiquidityMigrator.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
}

interface IPoolInfo {
    function creator() external view returns (address);
    function factory() external view returns (address);
    function token() external view returns (address);
}

interface IFactoryRegistry {
    function poolOf(address token) external view returns (address);
}

interface IUniswapV3PoolState {
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
/// @notice Принимает резерв градуировавшего токена (200M токенов + 6.5 ETH),
///         создаёт full-range позицию Uniswap V3 и НАВСЕГДА запирает её NFT
///         в этом контракте — функции вывода не существует.
///
/// @dev БЕЗОПАСНОСТЬ ЦЕНЫ. Пул Uniswap V3 может инициализировать кто угодно и
///      бесплатно, поэтому на момент градации цена в пуле может быть чужой.
///      Правила, которым следует этот контракт:
///        1. Никогда не покупаем токены за ETH при выравнивании. Токены у нас
///           уже есть; тратя ETH, мы бы выкупали мешок у того, кто подстроил
///           цену. Разрешён только один безопасный тип свапа — продажа токенов,
///           когда цена завышена.
///        2. Бюджет выравнивания жёстко ограничен ALIGN_BUDGET_BPS.
///        3. Ликвидность заливается только по цене в пределах допуска; иначе
///           транзакция отменяется, средства остаются в бондинг-пуле и
///           миграцию можно повторить (в пустом пуле цену возвращает любой
///           свап на пыль, атакующему приходится держать реальный капитал,
///           который съедают арбитражники).
///        4. Излишки уходят в казну выкупа, а не создателю — чтобы манипуляция
///           ценой не была способом что-то себе выручить.
contract UniswapV3Migrator is ILiquidityMigrator, Ownable {
    using SafeERC20 for IERC20;

    INonfungiblePositionManager public immutable positionManager;
    IWETH9 public immutable weth;
    uint24 public constant POOL_FEE = 3000;      // 0.3%
    int24 public constant TICK_LOWER = -887220;  // full range for spacing 60
    int24 public constant TICK_UPPER = 887220;

    /// @notice Допуск отклонения цены пула от расчётной (bps от sqrtPrice).
    uint256 public constant MAX_SQRT_DEVIATION_BPS = 100; // 1%
    /// @notice Позиция обязана принять не меньше этой доли средств.
    uint256 public constant MIN_DEPOSIT_BPS = 9_000;      // 90%
    /// @notice Максимум токенов на выравнивание цены (доля от переданных).
    uint256 public constant ALIGN_BUDGET_BPS = 100;       // 1%

    /// @notice Куда уходят излишки. Ставится один раз после деплоя казны.
    address public dustSink;

    address private _swapPool; // пул, у которого мы прямо сейчас двигаем цену

    error PoolPriceManipulated(uint160 expectedSqrtPriceX96, uint160 actualSqrtPriceX96);
    error UnknownPool();

    event LiquidityLocked(
        address indexed token,
        address indexed v3Pool,
        uint256 positionId,
        uint256 tokenAmount,
        uint256 ethAmount
    );
    event PriceAligned(address indexed v3Pool, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96);
    event DustSwept(address indexed token, uint256 tokenAmount, uint256 ethAmount);

    constructor(address positionManager_, address weth_) Ownable(msg.sender) {
        require(positionManager_ != address(0) && weth_ != address(0), "zero addr");
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = IWETH9(weth_);
    }

    /// @notice Однократно задать получателя излишков (BuybackTreasuryV2).
    function setDustSink(address sink) external onlyOwner {
        require(dustSink == address(0), "already set");
        require(sink != address(0), "zero addr");
        dustSink = sink;
    }

    function migrate(address token, uint256 tokenAmount) external payable override {
        uint256 ethAmount = msg.value;
        require(tokenAmount > 0 && ethAmount > 0, "empty migration");
        // Звать может только настоящий пул этого токена: иначе кто угодно
        // подсунул бы фальшивую «фабрику» и увёл остатки контракта.
        if (IFactoryRegistry(IPoolInfo(msg.sender).factory()).poolOf(token) != msg.sender) {
            revert UnknownPool();
        }

        weth.deposit{value: ethAmount}();

        (address token0, address token1) = token < address(weth)
            ? (token, address(weth))
            : (address(weth), token);
        (uint256 amount0, uint256 amount1) = token < address(weth)
            ? (tokenAmount, ethAmount)
            : (ethAmount, tokenAmount);

        // Расчётная цена: sqrtPriceX96 = sqrt(amount1/amount0) * 2^96
        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(amount1, 1 << 192, amount0)));

        address v3Pool = positionManager.createAndInitializePoolIfNecessary(
            token0, token1, POOL_FEE, sqrtPriceX96
        );

        _alignPrice(v3Pool, token, tokenAmount, sqrtPriceX96, token < address(weth));

        uint256 positionId = _mintLocked(token0, token1, amount0, amount1, sqrtPriceX96, v3Pool);
        _sweepDust(token);

        emit LiquidityLocked(token, v3Pool, positionId, tokenAmount, ethAmount);
    }

    // ------------------------------------------------------------- internal

    /// @dev Возврат цены к расчётной. Продаём ТОЛЬКО токены и только когда
    ///      цена завышена: так мы получаем ETH по цене выше справедливой.
    ///      Обратное направление (тратить ETH) запрещено — именно там пряталась
    ///      возможность выкупить мешок у манипулятора за все 6.5 ETH.
    function _alignPrice(
        address v3Pool,
        address token,
        uint256 tokenAmount,
        uint160 target,
        bool tokenIsZero
    ) internal {
        (uint160 cur, , , , , , ) = IUniswapV3PoolState(v3Pool).slot0();
        if (_within(cur, target)) return;

        // В ПУСТОМ пуле (ликвидность 0) цена двигается в любую сторону даром:
        // платить некому. Это самый частый случай — атакующий инициализировал
        // пул бесплатно. Возвращаем цену пылинкой в нужном направлении.
        bool emptyPool = IUniswapV3PoolState(v3Pool).liquidity() == 0;

        // При наличии чужой ликвидности разрешён ТОЛЬКО безопасный свап:
        // продажа наших токенов при завышенной цене. Покупать токены за ETH
        // нельзя — так мы выкупали бы мешок у того, кто подстроил цену.
        bool sellDirection = tokenIsZero ? cur > target : cur < target;
        if (!emptyPool && !sellDirection) return; // ниже сработает проверка цены

        bool zeroForOne = emptyPool ? cur > target : tokenIsZero;
        uint256 budget = emptyPool ? 1 : (tokenAmount * ALIGN_BUDGET_BPS) / 10_000;
        if (budget == 0) return;

        _swapPool = v3Pool;
        try IUniswapV3PoolState(v3Pool).swap(
            address(this),
            zeroForOne,
            int256(budget),
            target,
            abi.encode(token)
        ) {} catch { /* не вышло — ниже сработает проверка цены */ }
        _swapPool = address(0);

        (uint160 after_, , , , , , ) = IUniswapV3PoolState(v3Pool).slot0();
        emit PriceAligned(v3Pool, cur, after_);
    }

    function _within(uint160 actual, uint160 expected_) internal pure returns (bool) {
        uint256 expected = uint256(expected_);
        uint256 diff = uint256(actual) > expected ? uint256(actual) - expected : expected - uint256(actual);
        return diff * 10_000 <= expected * MAX_SQRT_DEVIATION_BPS;
    }

    /// @dev Заливка ликвидности. Суммы — от ПЕРЕДАННЫХ значений, а не от
    ///      баланса: иначе посторонний перевод на контракт ломал бы минимумы
    ///      и блокировал градацию. Минимумы реальные — по чужой цене не льём.
    function _mintLocked(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint160 target,
        address v3Pool
    ) internal returns (uint256 positionId) {
        (uint160 cur, , , , , , ) = IUniswapV3PoolState(v3Pool).slot0();
        if (!_within(cur, target)) revert PoolPriceManipulated(target, cur);

        // на выравнивание могла уйти часть токенов — берём фактический минимум
        uint256 have0 = IERC20(token0).balanceOf(address(this));
        uint256 have1 = IERC20(token1).balanceOf(address(this));
        if (amount0 > have0) amount0 = have0;
        if (amount1 > have1) amount1 = have1;

        IERC20(token0).forceApprove(address(positionManager), amount0);
        IERC20(token1).forceApprove(address(positionManager), amount1);

        (positionId, , , ) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: (amount0 * MIN_DEPOSIT_BPS) / 10_000,
                amount1Min: (amount1 * MIN_DEPOSIT_BPS) / 10_000,
                recipient: address(this), // NFT заперт здесь навсегда
                deadline: block.timestamp
            })
        );

        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);
    }

    /// @dev Излишки — в казну выкупа (не создателю и не манипулятору).
    function _sweepDust(address token) internal {
        address to = dustSink;
        if (to == address(0)) return; // не задан — остаётся здесь, заперто
        uint256 tokLeft = IERC20(token).balanceOf(address(this));
        uint256 wethLeft = IERC20(address(weth)).balanceOf(address(this));
        if (tokLeft > 0) IERC20(token).safeTransfer(to, tokLeft);
        if (wethLeft > 0) {
            weth.withdraw(wethLeft);
            (bool ok, ) = to.call{value: wethLeft}("");
            ok; // намеренно игнорируем: сбой не должен срывать миграцию
        }
        emit DustSwept(token, tokLeft, wethLeft);
    }

    /// @dev Оплата нашего же свапа. Пул берём из памяти контракта, а не из
    ///      calldata — иначе колбэк был бы открытым входом для вывода токенов.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(msg.sender == _swapPool && _swapPool != address(0), "bad pool");
        address token = abi.decode(data, (address));
        // платим только токеном — ETH при выравнивании не тратится никогда
        if (amount0Delta > 0 && token < address(weth)) IERC20(token).safeTransfer(msg.sender, uint256(amount0Delta));
        else if (amount1Delta > 0 && token > address(weth)) IERC20(token).safeTransfer(msg.sender, uint256(amount1Delta));
        else revert("eth spend blocked");
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}
