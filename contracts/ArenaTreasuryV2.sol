// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IEthPoolA2 {
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256);
}

interface IQuotePoolA2 {
    function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient) external returns (uint256);
    function quote() external view returns (address);
}

interface IFactoryA2 {
    function poolOf(address token) external view returns (address);
}

interface IZapA2 {
    function buyWithEth(address token, uint256 minTokensOut, uint256 deadline) external payable returns (uint256);
    /// @dev Маршрут валюта ⇄ WETH, заданный владельцу запа: mid == 0 — один хоп
    ///      WETH⇄валюта (fee1); иначе WETH⇄mid (fee1) и mid⇄валюта (fee2).
    function routeOf(address quote) external view returns (address mid, uint24 fee1, uint24 fee2);
    function hasRoute(address quote) external view returns (bool);
}

interface IWETH9A2 {
    function withdraw(uint256) external;
}

interface IUniswapV3FactoryA2 {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3PoolA2 {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
}

/// @title ArenaTreasuryV2 — казна, которая копит в ETH
/// @notice То же, что ArenaTreasury (деньги уходят только на выкуп монет
///         платформы и их сжигание, вывода нет), плюс одно умение, которого
///         не хватало (решение владельца 17.09.2026): валюту, пришедшую от
///         монет за акции/крипту (GME, USDG…), казна умеет сама поменять на
///         ETH через Uniswap V3 — по тем же маршрутам, что использует зап.
///
///         Зачем: арена — общая для всех монет, и подиум дня может состоять
///         из ETH-монет, а фонд лежать в GME. В ETH казна может выкупить
///         любую монету (ETH-монету — у кривой, монету за валюту — через зап).
///         Поэтому бот арены сначала зовёт toEth() для каждой валюты, а потом
///         платит подиуму из ETH.
///
///         Обмен только владелец (бот) и только в сторону ETH: увести деньги
///         куда-то ещё невозможно — ETH остаётся на этом же контракте.
contract ArenaTreasuryV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IFactoryA2 public immutable ethFactory;   // address(0) — ETH-фабрики нет
    IFactoryA2 public immutable quoteFactory; // address(0) — фабрики за валюту нет
    IZapA2 public immutable zap;              // маршруты обмена и покупка валютных монет за ETH
    IWETH9A2 public immutable weth;
    IUniswapV3FactoryA2 public immutable v3Factory;

    /// @notice Сколько монеты сожжено казной за всё время.
    mapping(address => uint256) public burnedOf;
    /// @notice Сколько ETH потрачено на выкупы за всё время.
    uint256 public totalEthSpent;
    /// @notice Сколько ETH получено обменом валюты за всё время.
    uint256 public totalEthConverted;

    // Пул V3, от которого ждём колбэк прямо сейчас (как в CurveZap).
    address private _expectPool;
    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    event Received(address indexed from, uint256 amount);
    /// @param asset address(0) — платили ETH, иначе валюта монеты.
    event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note);
    event Burned(address indexed token, uint256 amount);
    /// @notice Валюта казны обменяна на ETH (ETH остался здесь же).
    event Converted(address indexed asset, uint256 amountIn, uint256 ethOut);

    error NoRoute();
    error BadCallback();
    error Slippage();

    constructor(address owner_, address ethFactory_, address quoteFactory_, address zap_, address weth_, address v3Factory_)
        Ownable(owner_)
    {
        require(ethFactory_ != address(0) || quoteFactory_ != address(0), "no factory");
        require(zap_ != address(0) && weth_ != address(0) && v3Factory_ != address(0), "zero addr");
        ethFactory = IFactoryA2(ethFactory_);
        quoteFactory = IFactoryA2(quoteFactory_);
        zap = IZapA2(zap_);
        weth = IWETH9A2(weth_);
        v3Factory = IUniswapV3FactoryA2(v3Factory_);
    }

    /// @dev Доля арены от сплиттера, сдача ETH от запа, ETH от WETH.withdraw.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ------------------------------------------------------------- обмен в ETH

    /// @notice Поменять валюту казны на ETH по маршруту запа. minEthOut —
    ///         защита от проскальзывания (бот считает её по курсу).
    ///         Для WETH — просто распаковка.
    function toEth(address asset, uint256 amount, uint256 minEthOut)
        external
        onlyOwner
        nonReentrant
        returns (uint256 ethOut)
    {
        require(asset != address(0) && amount > 0, "bad args");
        require(amount <= IERC20(asset).balanceOf(address(this)), "bad amount");
        uint256 wethOut;
        if (asset == address(weth)) {
            wethOut = amount;
        } else {
            if (!zap.hasRoute(asset)) revert NoRoute();
            (address mid, uint24 fee1, uint24 fee2) = zap.routeOf(asset);
            if (mid == address(0)) {
                wethOut = _swap(asset, address(weth), fee1, amount);
            } else {
                uint256 midOut = _swap(asset, mid, fee2, amount);
                wethOut = _swap(mid, address(weth), fee1, midOut);
            }
        }
        if (wethOut < minEthOut) revert Slippage();
        uint256 before = address(this).balance;
        weth.withdraw(wethOut);
        ethOut = address(this).balance - before;
        totalEthConverted += ethOut;
        emit Converted(asset, amount, ethOut);
    }

    // ------------------------------------------------------------- выкупы

    /// @notice Выкупить ETH-монету за ETH у её кривой и сжечь.
    function buybackEth(address token, uint256 ethAmount, uint256 minTokensOut, string calldata note)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        address pool = address(ethFactory) != address(0) ? ethFactory.poolOf(token) : address(0);
        require(pool != address(0), "not an eth token");
        require(ethAmount > 0 && ethAmount <= address(this).balance, "bad amount");
        tokensOut = IEthPoolA2(pool).buy{value: ethAmount}(minTokensOut, address(this));
        totalEthSpent += ethAmount;
        _burn(token);
        emit Buyback(token, address(0), ethAmount, tokensOut, note);
    }

    /// @notice Выкупить монету за валюту, платя ETH через зап, и сжечь.
    ///         Сдача от кривой (валюта или ETH) остаётся в казне.
    function buybackViaZap(address token, uint256 ethAmount, uint256 minTokensOut, uint256 deadline, string calldata note)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        require(address(quoteFactory) != address(0) && quoteFactory.poolOf(token) != address(0), "not a quote token");
        require(ethAmount > 0 && ethAmount <= address(this).balance, "bad amount");
        tokensOut = zap.buyWithEth{value: ethAmount}(token, minTokensOut, deadline);
        totalEthSpent += ethAmount;
        _burn(token);
        emit Buyback(token, address(0), ethAmount, tokensOut, note);
    }

    /// @notice Выкупить монету за валюту из валюты, лежащей в казне, и сжечь.
    ///         Оставлено на случай, когда обмен в ETH невыгоден (нет маршрута).
    function buybackQuote(address token, uint256 quoteAmount, uint256 minTokensOut, string calldata note)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        address pool = address(quoteFactory) != address(0) ? quoteFactory.poolOf(token) : address(0);
        require(pool != address(0), "not a quote token");
        IERC20 asset = IERC20(IQuotePoolA2(pool).quote());
        require(quoteAmount > 0 && quoteAmount <= asset.balanceOf(address(this)), "bad amount");
        asset.forceApprove(pool, quoteAmount);
        tokensOut = IQuotePoolA2(pool).buy(quoteAmount, minTokensOut, address(this));
        asset.forceApprove(pool, 0);
        _burn(token);
        emit Buyback(token, address(asset), quoteAmount, tokensOut, note);
    }

    // ------------------------------------------------------------- внутреннее

    /// @dev Всё, что казна держит в этой монете, — в печь.
    function _burn(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) return;
        IERC20(token).safeTransfer(DEAD, bal);
        burnedOf[token] += bal;
        emit Burned(token, bal);
    }

    /// @dev Обмен «ровно столько на входе» прямо через пул V3 (как CurveZap).
    ///      Лимит цены — край диапазона; защита от проскальзывания — на итоге.
    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) internal returns (uint256 amountOut) {
        address pool = v3Factory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert NoRoute();
        bool zeroForOne = tokenIn < tokenOut;
        _expectPool = pool;
        (int256 a0, int256 a1) = IUniswapV3PoolA2(pool).swap(
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
}
