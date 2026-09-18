// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IEthPoolA3 {
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256);
    function migrated() external view returns (bool);
}

interface IQuotePoolA3 {
    function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient) external returns (uint256);
    function quote() external view returns (address);
    function migrated() external view returns (bool);
}

interface IFactoryA3 {
    function poolOf(address token) external view returns (address);
}

interface IQuoteFactoryA3 {
    function poolOf(address token) external view returns (address);
    function quoteOf(address token) external view returns (address);
}

interface IZapA3 {
    function buyWithEth(address token, uint256 minTokensOut, uint256 deadline) external payable returns (uint256);
    /// @dev Маршрут валюта ⇄ WETH, заданный владельцу запа: mid == 0 — один хоп
    ///      WETH⇄валюта (fee1); иначе WETH⇄mid (fee1) и mid⇄валюта (fee2).
    function routeOf(address quote) external view returns (address mid, uint24 fee1, uint24 fee2);
    function hasRoute(address quote) external view returns (bool);
}

interface IWETH9A3 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniswapV3FactoryA3 {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3PoolA3 {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
}

/// @title ArenaTreasuryV3 — казна, которая копит в ETH и умеет покупать на DEX
/// @notice То же, что ArenaTreasuryV2 (деньги уходят только на выкуп монет
///         платформы и их сжигание, вывода нет; валюту умеет менять на ETH по
///         маршрутам запа; оператор — горячий кошелёк бота), плюс то, чего в
///         V2 не хватало: выкуп ГРАДУИРОВАВШЕЙ монеты на Uniswap V3.
///
///         Кривая монеты после градации закрыта, ликвидность заперта в пуле
///         Uniswap (токен/WETH у ETH-монет, токен/валюта у монет за акции).
///         buybackDex меняет ETH казны на монету прямо через этот пул (для
///         монеты за валюту — сначала ETH → валюта по маршруту запа) и сжигает
///         купленное в той же транзакции. Так арена и выкуп hood работают и
///         до, и после градации — монета не выпадает из выкупов никогда.
///
///         Роли те же: владелец назначает оператора и может передать
///         владение (в два шага); оператор — ключ бота, у него нет прав ни на
///         что, кроме обмена в ETH и выкупов. Утечка ключа бота = максимум
///         лишний выкуп монеты платформы, деньги с казны не уходят.
contract ArenaTreasuryV3 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IFactoryA3 public immutable ethFactory;        // address(0) — ETH-фабрики нет
    IQuoteFactoryA3 public immutable quoteFactory; // address(0) — фабрики за валюту нет
    /// @notice Комиссия пулов Uniswap V3, куда мигратор запирает ликвидность.
    uint24 public constant DEX_FEE = 3000;
    IZapA3 public immutable zap;              // маршруты обмена и покупка валютных монет за ETH
    IWETH9A3 public immutable weth;
    IUniswapV3FactoryA3 public immutable v3Factory;

    /// @notice Сколько монеты сожжено казной за всё время.
    mapping(address => uint256) public burnedOf;
    /// @notice Сколько ETH потрачено на выкупы за всё время.
    uint256 public totalEthSpent;
    /// @notice Сколько ETH получено обменом валюты за всё время.
    uint256 public totalEthConverted;
    /// @notice Оператор — кошелёк бота: обмен в ETH и выкупы, не больше.
    address public operator;

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

    event OperatorSet(address indexed operator);

    error NoRoute();
    error BadCallback();
    error Slippage();
    error NotOperator();
    error NotPlatformToken();
    error NotMigrated();

    /// @dev Владелец или оператор.
    modifier onlyOperator() {
        if (msg.sender != owner() && msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address owner_,
        address operator_,
        address ethFactory_,
        address quoteFactory_,
        address zap_,
        address weth_,
        address v3Factory_
    ) Ownable(owner_) {
        require(ethFactory_ != address(0) || quoteFactory_ != address(0), "no factory");
        require(zap_ != address(0) && weth_ != address(0) && v3Factory_ != address(0), "zero addr");
        ethFactory = IFactoryA3(ethFactory_);
        quoteFactory = IQuoteFactoryA3(quoteFactory_);
        zap = IZapA3(zap_);
        weth = IWETH9A3(weth_);
        v3Factory = IUniswapV3FactoryA3(v3Factory_);
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Сменить кошелёк бота. address(0) — только владелец.
    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @dev Доля арены от сплиттера, сдача ETH от запа, ETH от WETH.withdraw.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ------------------------------------------------------------- обмен в ETH

    /// @notice Поменять валюту казны на ETH по маршруту запа. minEthOut —
    ///         защита от проскальзывания (бот считает её по симуляции).
    ///         Для WETH — просто распаковка.
    function toEth(address asset, uint256 amount, uint256 minEthOut)
        external
        onlyOperator
        nonReentrant
        returns (uint256 ethOut)
    {
        require(asset != address(0) && amount > 0, "bad args");
        uint256 assetBefore = IERC20(asset).balanceOf(address(this));
        require(amount <= assetBefore, "bad amount");
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
        // В тонком пуле V3 может взять меньше запрошенного (цена упёрлась в
        // край диапазона) — в событии честная сумма, остаток лежит здесь.
        uint256 spent = asset == address(weth) ? amount : assetBefore - IERC20(asset).balanceOf(address(this));
        emit Converted(asset, spent, ethOut);
    }

    // ------------------------------------------------------------- выкупы

    /// @notice Выкупить ETH-монету за ETH у её кривой и сжечь.
    function buybackEth(address token, uint256 ethAmount, uint256 minTokensOut, string calldata note)
        external
        onlyOperator
        nonReentrant
        returns (uint256 tokensOut)
    {
        address pool = address(ethFactory) != address(0) ? ethFactory.poolOf(token) : address(0);
        require(pool != address(0), "not an eth token");
        require(ethAmount > 0 && ethAmount <= address(this).balance, "bad amount");
        tokensOut = IEthPoolA3(pool).buy{value: ethAmount}(minTokensOut, address(this));
        totalEthSpent += ethAmount;
        _burn(token);
        emit Buyback(token, address(0), ethAmount, tokensOut, note);
    }

    /// @notice Выкупить монету за валюту, платя ETH через зап, и сжечь.
    ///         Сдача от кривой (валюта или ETH) остаётся в казне.
    function buybackViaZap(address token, uint256 ethAmount, uint256 minTokensOut, uint256 deadline, string calldata note)
        external
        onlyOperator
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
        onlyOperator
        nonReentrant
        returns (uint256 tokensOut)
    {
        address pool = address(quoteFactory) != address(0) ? quoteFactory.poolOf(token) : address(0);
        require(pool != address(0), "not a quote token");
        IERC20 asset = IERC20(IQuotePoolA3(pool).quote());
        require(quoteAmount > 0 && quoteAmount <= asset.balanceOf(address(this)), "bad amount");
        asset.forceApprove(pool, quoteAmount);
        tokensOut = IQuotePoolA3(pool).buy(quoteAmount, minTokensOut, address(this));
        asset.forceApprove(pool, 0);
        _burn(token);
        emit Buyback(token, address(asset), quoteAmount, tokensOut, note);
    }

    /// @notice Выкупить градуировавшую монету на Uniswap V3 за ETH казны и
    ///         сжечь. ETH-монета — через пул токен/WETH; монета за валюту —
    ///         сначала ETH → валюта по маршруту запа, затем пул токен/валюта.
    ///         minTokensOut — защита от проскальзывания (бот считает по симуляции).
    function buybackDex(address token, uint256 ethAmount, uint256 minTokensOut, string calldata note)
        external
        onlyOperator
        nonReentrant
        returns (uint256 tokensOut)
    {
        require(ethAmount > 0 && ethAmount <= address(this).balance, "bad amount");
        address pool = address(ethFactory) != address(0) ? ethFactory.poolOf(token) : address(0);
        bool isEth = pool != address(0);
        address quote = address(0);
        if (!isEth) {
            pool = address(quoteFactory) != address(0) ? quoteFactory.poolOf(token) : address(0);
            if (pool == address(0)) revert NotPlatformToken();
            quote = quoteFactory.quoteOf(token);
        }
        // Пока ликвидность не уехала на DEX, там нечего покупать: любой пул
        // Uniswap с этим адресом — чужой, покупать в нём казна не должна.
        if (!IEthPoolA3(pool).migrated()) revert NotMigrated();
        weth.deposit{value: ethAmount}();
        tokensOut = (isEth || quote == address(weth))
            ? _swap(address(weth), token, DEX_FEE, ethAmount)
            : _swap(quote, token, DEX_FEE, _wethToQuote(quote, ethAmount));
        if (tokensOut < minTokensOut) revert Slippage();
        totalEthSpent += ethAmount;
        _burn(token);
        emit Buyback(token, address(0), ethAmount, tokensOut, note);
    }

    // ------------------------------------------------------------- внутреннее

    /// @dev WETH → валюта по маршруту запа (один или два хопа).
    function _wethToQuote(address quote, uint256 wethIn) internal returns (uint256) {
        if (!zap.hasRoute(quote)) revert NoRoute();
        (address mid, uint24 fee1, uint24 fee2) = zap.routeOf(quote);
        if (mid == address(0)) return _swap(address(weth), quote, fee1, wethIn);
        return _swap(mid, quote, fee2, _swap(address(weth), mid, fee1, wethIn));
    }

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
        (int256 a0, int256 a1) = IUniswapV3PoolA3(pool).swap(
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
