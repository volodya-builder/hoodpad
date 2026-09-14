// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Фабрика, какой её видит сплиттер: только poolOf.
contract MockFactoryV4 {
    mapping(address => address) public poolOf;
    function set(address token, address pool) external { poolOf[token] = pool; }
}

/// ETH-пул: умеет назвать токен и создателя и переслать ETH со всем газом,
/// как боевой claimProtocolFees.
contract MockEthPoolV4 {
    address public token;
    address public creator;
    constructor(address token_, address creator_) { token = token_; creator = creator_; }
    receive() external payable {}
    function pay(address to, uint256 amount) external {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}

/// Пул за валюту: при claimProtocolFees переводит накопленное на казну.
contract MockQuotePoolV4 {
    using SafeERC20 for IERC20;
    address public token;
    address public creator;
    address public quote;
    address public treasury;
    constructor(address token_, address creator_, address quote_, address treasury_) {
        token = token_; creator = creator_; quote = quote_; treasury = treasury_;
    }
    function claimProtocolFees() external {
        uint256 bal = IERC20(quote).balanceOf(address(this));
        if (bal > 0) IERC20(quote).safeTransfer(treasury, bal); // как боевой пул
    }
}

/// Создатель-контракт, который сначала не принимает переводы, а потом
/// забирает отложенное сам.
contract MockCreatorV4 {
    bool public accept;
    receive() external payable { require(accept, "no thanks"); }
    function setAccept(bool v) external { accept = v; }
    function pullEth(address splitter) external {
        (bool ok, ) = splitter.call(abi.encodeWithSignature("withdrawEth()"));
        require(ok, "withdraw failed");
    }
    function pullErc20(address splitter, address asset) external {
        (bool ok, ) = splitter.call(abi.encodeWithSignature("withdrawErc20(address)", asset));
        require(ok, "withdraw failed");
    }
}

/// Казна агента, у которой всё сломано — и ETH, и ERC20.
contract BrokenTreasuryV4 {
    function fund(address) external payable { revert("broken"); }
    function fundErc20(address, address, uint256) external pure { revert("broken"); }
}

/// ERC20 в стиле USDT: transfer ничего не возвращает.
contract NoReturnToken {
    string public constant name = "NoRet";
    string public constant symbol = "NORET";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external {
        require(!blocked[to], "blocked");
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount;
    }
    /// Кому-то нельзя переводить — как чёрный список у стейблкоинов.
    mapping(address => bool) public blocked;
    function block_(address a, bool v) external { blocked[a] = v; }
}
