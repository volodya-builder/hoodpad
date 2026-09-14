// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IV3CallbackM {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @dev Мок пула Uniswap V3, который РЕАЛЬНО меняет токены по фиксированному
///      курсу: amountOut = amountIn * num / den. Держит запас tokenOut, вход
///      забирает через колбэк — как настоящий пул. Нужен zap-тестам: мок
///      мигратора цену только «двигает», а деньги не переводит.
contract MockV3SwapPool {
    address public immutable token0;
    address public immutable token1;
    uint256 public num; // курс token0 -> token1: out1 = in0 * num / den
    uint256 public den;
    bool public greedy; // если true — берёт вход, а отдаёт ноль (нечестный пул)

    constructor(address a, address b, uint256 num_, uint256 den_) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        num = num_; den = den_;
    }

    function setGreedy(bool g) external { greedy = g; }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact in only");
        uint256 amountIn = uint256(amountSpecified);
        uint256 amountOut = zeroForOne ? amountIn * num / den : amountIn * den / num;
        if (greedy) amountOut = 0;
        address tokenIn  = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? token1 : token0;
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        if (amountOut > 0) IERC20(tokenOut).transfer(recipient, amountOut);
        (amount0, amount1) = zeroForOne
            ? (int256(amountIn), -int256(amountOut))
            : (-int256(amountOut), int256(amountIn));
        IV3CallbackM(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(tokenIn).balanceOf(address(this)) >= before + amountIn, "not paid");
    }
}

/// @dev Мок фабрики V3: getPool по паре и тиру.
contract MockV3Factory {
    mapping(bytes32 => address) public pools;
    function key(address a, address b, uint24 fee) public pure returns (bytes32) {
        (address x, address y) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(x, y, fee));
    }
    function setPool(address a, address b, uint24 fee, address pool) external { pools[key(a, b, fee)] = pool; }
    function getPool(address a, address b, uint24 fee) external view returns (address) { return pools[key(a, b, fee)]; }
}

/// @dev Мок WETH9: deposit/withdraw + обычный ERC20 (минимально).
contract MockWETH {
    string public name = "Wrapped Ether"; string public symbol = "WETH"; uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 a) external { balanceOf[msg.sender] -= a; (bool ok,) = msg.sender.call{value: a}(""); require(ok); }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        if (f != msg.sender) { allowance[f][msg.sender] -= a; }
        balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
    function totalSupply() external view returns (uint256) { return address(this).balance; }
}
