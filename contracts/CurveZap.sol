// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CurveZap — купить и продать монету за валюту, платя ETH
/// @notice Монеты quote-фабрики торгуются за акцию или крипту (AAPL, USDG…),
///         и дивиденды холдерам идут в ней же. Но у покупателя на кошельке —
///         ETH. Этот контракт делает то же, что терминал вроде GMGN: берёт
///         ETH, меняет его на валюту монеты через Uniswap V3 и тут же покупает
///         монету на кривой — в одной транзакции. Продажа — в обратную сторону:
///         монета → валюта → ETH на кошелёк.
///
///         Обмен идёт на деньги самого покупателя и с его же лимитом
///         проскальзывания (minTokensOut / minEthOut). Никакого общего котла,
///         который можно было бы нагнуть за счёт всех, здесь нет — это
///         принципиальное отличие от «контракт сам покупает акцию на налог».
///
///         Контракт ничего не хранит между транзакциями: что пришло, то в той
///         же транзакции ушло пользователю. Сдача валюты (если покупка упёрлась
///         в потолок кривой) возвращается покупателю в валюте — честно и
///         без второго обмена, который добавил бы ещё одно проскальзывание.
///
/// @dev    Меняем прямо через пул Uniswap V3 с колбэком — как мигратор. Роутер
///         не нужен: его адрес на этой сети не задокументирован, а прямой своп
///         через пул — это ровно то, что роутер делает внутри. Маршрут для
///         каждой валюты задаёт владелец: один хоп через WETH-пул или два —
///         через USDG (у MSFT WETH-пула нет). Подбирать маршрут на лету в
///         транзакции нельзя: лишний газ и лишняя поверхность для манипуляции.
contract CurveZap is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IWETH9Z public immutable weth;
    IUniswapV3FactoryZ public immutable v3Factory;
    IHoodFactoryZ public immutable hood;

    /// @notice Маршрут WETH → валюта. mid == 0: один хоп (fee1). Иначе два:
    ///         WETH → mid (fee1) → валюта (fee2). Продажа идёт тем же путём назад.
    struct Route { address mid; uint24 fee1; uint24 fee2; }
    mapping(address => Route) public routeOf;
    mapping(address => bool) public hasRoute;

    // Пул, от которого мы ждём колбэк прямо сейчас. Ставится перед свопом и
    // снимается сразу после: колбэк от кого угодно ещё — реверт.
    address private _expectPool;

    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    event RouteSet(address indexed quote, address mid, uint24 fee1, uint24 fee2, bool enabled);
    event BoughtWithEth(address indexed token, address indexed buyer, uint256 ethIn, uint256 quoteIn, uint256 tokensOut, uint256 quoteRefund);
    event SoldForEth(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 ethOut);

    error Expired();
    error NoRoute();
    error UnknownToken();
    error Slippage();
    error BadCallback();
    error ZeroAmount();

    constructor(address weth_, address v3Factory_, address hood_) Ownable(msg.sender) {
        require(weth_ != address(0) && v3Factory_ != address(0) && hood_ != address(0), "zero addr");
        weth = IWETH9Z(weth_);
        v3Factory = IUniswapV3FactoryZ(v3Factory_);
        hood = IHoodFactoryZ(hood_);
    }

    receive() external payable {
        // Только WETH может вернуть нам ETH (withdraw). Случайный перевод — реверт.
        require(msg.sender == address(weth), "no direct eth");
    }

    // ------------------------------------------------------------- admin

    /// @notice Задать маршрут для валюты. Для самого WETH маршрут не нужен.
    function setRoute(address quote, address mid, uint24 fee1, uint24 fee2, bool enabled) external onlyOwner {
        require(quote != address(0) && quote != address(weth), "bad quote");
        if (enabled) {
            // Пулы должны существовать — иначе первая же покупка сгорит газом.
            address a = mid == address(0) ? quote : mid;
            require(v3Factory.getPool(address(weth), a, fee1) != address(0), "no pool 1");
            if (mid != address(0)) require(v3Factory.getPool(mid, quote, fee2) != address(0), "no pool 2");
        }
        routeOf[quote] = Route(mid, fee1, fee2);
        hasRoute[quote] = enabled;
        emit RouteSet(quote, mid, fee1, fee2, enabled);
    }

    /// @notice Вернуть владельцу то, что случайно прислали на контракт.
    ///         В правильном потоке здесь никогда ничего не лежит.
    function rescue(address token, address to) external onlyOwner {
        require(to != address(0), "zero to");
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }

    // ------------------------------------------------------------- views

    /// @notice Можно ли купить эту монету за ETH через zap.
    function supported(address token) external view returns (bool) {
        address quote = hood.quoteOf(token);
        if (quote == address(0) || hood.poolOf(token) == address(0)) return false;
        return quote == address(weth) || hasRoute[quote];
    }

    // ------------------------------------------------------------- buy

    /// @notice Купить монету за ETH. Всё, что не влезло в кривую (потолок),
    ///         возвращается в валюте монеты. Оценку tokensOut до отправки
    ///         даёт симуляция этого же вызова (eth_call) — она точная.
    function buyWithEth(address token, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        (address quote, address pool) = _resolve(token);

        weth.deposit{value: msg.value}();
        uint256 quoteIn = quote == address(weth) ? msg.value : _toQuote(quote, msg.value);
        if (quoteIn == 0) revert ZeroAmount();

        IERC20(quote).forceApprove(pool, quoteIn);
        tokensOut = ICurvePoolZ(pool).buy(quoteIn, minTokensOut, msg.sender);
        IERC20(quote).forceApprove(pool, 0);

        // Кривая вернула сдачу (упёрлись в потолок) — отдаём покупателю.
        uint256 refund = IERC20(quote).balanceOf(address(this));
        if (refund > 0) {
            if (quote == address(weth)) {
                weth.withdraw(refund);
                _sendEth(msg.sender, refund);
            } else {
                IERC20(quote).safeTransfer(msg.sender, refund);
            }
        }
        emit BoughtWithEth(token, msg.sender, msg.value, quoteIn, tokensOut, refund);
    }

    // ------------------------------------------------------------- sell

    /// @notice Продать монету и получить ETH. Нужен approve монеты на zap.
    ///         Проскальзывание проверяется один раз, в ETH на выходе: это и
    ///         кривая, и обмен вместе.
    function sellForEth(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (tokensIn == 0) revert ZeroAmount();
        (address quote, address pool) = _resolve(token);

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        IERC20(token).forceApprove(pool, tokensIn);
        uint256 quoteOut = ICurvePoolZ(pool).sell(tokensIn, 0);
        IERC20(token).forceApprove(pool, 0);

        ethOut = quote == address(weth) ? quoteOut : _toWeth(quote, quoteOut);
        if (ethOut < minEthOut) revert Slippage();
        weth.withdraw(ethOut);
        _sendEth(msg.sender, ethOut);
        emit SoldForEth(token, msg.sender, tokensIn, quoteOut, ethOut);
    }

    // ------------------------------------------------------------- swaps

    function _resolve(address token) internal view returns (address quote, address pool) {
        quote = hood.quoteOf(token);
        pool = hood.poolOf(token);
        if (quote == address(0) || pool == address(0)) revert UnknownToken();
        if (quote != address(weth) && !hasRoute[quote]) revert NoRoute();
    }

    function _toQuote(address quote, uint256 wethIn) internal returns (uint256) {
        Route memory r = routeOf[quote];
        if (r.mid == address(0)) return _swap(address(weth), quote, r.fee1, wethIn);
        uint256 midOut = _swap(address(weth), r.mid, r.fee1, wethIn);
        return _swap(r.mid, quote, r.fee2, midOut);
    }

    function _toWeth(address quote, uint256 quoteIn) internal returns (uint256) {
        Route memory r = routeOf[quote];
        if (r.mid == address(0)) return _swap(quote, address(weth), r.fee1, quoteIn);
        uint256 midOut = _swap(quote, r.mid, r.fee2, quoteIn);
        return _swap(r.mid, address(weth), r.fee1, midOut);
    }

    /// @dev Обмен «ровно столько на входе» прямо через пул V3. Лимит цены —
    ///      край диапазона: защита от проскальзывания стоит снаружи, на
    ///      итоговой сумме, а не на каждом хопе.
    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) internal returns (uint256 amountOut) {
        address pool = v3Factory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert NoRoute();
        bool zeroForOne = tokenIn < tokenOut;
        _expectPool = pool;
        (int256 a0, int256 a1) = IUniswapV3PoolZ(pool).swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(tokenIn)
        );
        _expectPool = address(0);
        int256 out = zeroForOne ? a1 : a0;
        amountOut = out < 0 ? uint256(-out) : 0;
    }

    /// @dev Пул просит оплату входа. Платим ровно тому пулу, которого ждём.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _expectPool || _expectPool == address(0)) revert BadCallback();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "eth send failed");
    }
}

interface IWETH9Z {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniswapV3FactoryZ {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3PoolZ {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
}

interface IHoodFactoryZ {
    function quoteOf(address token) external view returns (address);
    function poolOf(address token) external view returns (address);
}

interface ICurvePoolZ {
    function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient) external returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut) external returns (uint256);
}
