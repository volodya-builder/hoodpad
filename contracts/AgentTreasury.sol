// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentTreasury
/// @notice Per-token budgets for the AI agents that run hood projects.
///
///         Funded automatically by the fee splitter out of each token's own
///         trade fees (10% of a 1% fee). Coins launched against ETH fund the
///         budget in ETH; coins launched against an asset (USDG, a stock)
///         fund it in that asset — the budget is kept per (token, asset), the
///         operator converts when paying model bills. Spent by an off-chain
///         operator that pays for model calls. Both sides are on-chain and
///         public: anyone can read how much a token's agent has earned and
///         how much it has burned, so the claim "the agent pays for itself"
///         is verifiable rather than promised.
///
///         Deliberately minimal: no pause, no upgrade, no way for the operator
///         to take more than a token has actually earned.
contract AgentTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Wallet allowed to draw budgets to pay model bills.
    address public operator;

    /// @notice Unspent ETH credited to each token's agent.
    mapping(address => uint256) public budget;

    /// @notice Lifetime ETH totals, kept for the token page and for audits.
    mapping(address => uint256) public funded;
    mapping(address => uint256) public spent;

    /// @notice Same three counters for ERC20 assets: token => asset => amount.
    mapping(address => mapping(address => uint256)) public budgetErc20;
    mapping(address => mapping(address => uint256)) public fundedErc20;
    mapping(address => mapping(address => uint256)) public spentErc20;

    /// @notice Agent switched off by the owner.
    mapping(address => bool) public disabled;

    event Funded(address indexed token, uint256 amount, uint256 budgetAfter);
    event Spent(address indexed token, uint256 amount, string reason, uint256 budgetAfter);
    event FundedErc20(address indexed token, address indexed asset, uint256 amount, uint256 budgetAfter);
    event SpentErc20(address indexed token, address indexed asset, uint256 amount, string reason, uint256 budgetAfter);
    event OperatorChanged(address indexed previous, address indexed current);
    event AgentDisabled(address indexed token, bool disabled);

    error NotOperator();
    error InsufficientBudget(uint256 requested, uint256 available);

    constructor(address operator_) Ownable(msg.sender) {
        require(operator_ != address(0), "zero operator");
        operator = operator_;
        emit OperatorChanged(address(0), operator_);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Credit a token's agent budget in ETH. Called by the splitter.
    /// @dev Accepts funds for a disabled agent too — the budget simply waits
    ///      until it is switched back on, rather than being lost.
    function fund(address token) external payable {
        require(token != address(0), "zero token");
        budget[token] += msg.value;
        funded[token] += msg.value;
        emit Funded(token, msg.value, budget[token]);
    }

    /// @notice Credit a token's agent budget in an ERC20 asset. The caller
    ///         approves first; the amount actually received is what counts
    ///         (fee-on-transfer assets would credit less, never more).
    function fundErc20(address token, address asset, uint256 amount) external nonReentrant {
        require(token != address(0) && asset != address(0), "zero addr");
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = IERC20(asset).balanceOf(address(this)) - before;
        budgetErc20[token][asset] += got;
        fundedErc20[token][asset] += got;
        emit FundedErc20(token, asset, got, budgetErc20[token][asset]);
    }

    /// @notice Draw from a token's ETH budget to pay for model usage.
    /// @param reason Short free-text label, e.g. "claude-opus 1.2M tokens".
    function spend(address token, uint256 amount, string calldata reason)
        external
        onlyOperator
        nonReentrant
    {
        uint256 available = budget[token];
        if (amount > available) revert InsufficientBudget(amount, available);
        budget[token] = available - amount;
        spent[token] += amount;
        (bool ok, ) = operator.call{value: amount}("");
        require(ok, "payout failed");
        emit Spent(token, amount, reason, budget[token]);
    }

    /// @notice Draw from a token's ERC20 budget.
    function spendErc20(address token, address asset, uint256 amount, string calldata reason)
        external
        onlyOperator
        nonReentrant
    {
        uint256 available = budgetErc20[token][asset];
        if (amount > available) revert InsufficientBudget(amount, available);
        budgetErc20[token][asset] = available - amount;
        spentErc20[token][asset] += amount;
        IERC20(asset).safeTransfer(operator, amount);
        emit SpentErc20(token, asset, amount, reason, budgetErc20[token][asset]);
    }

    function setOperator(address operator_) external onlyOwner {
        require(operator_ != address(0), "zero operator");
        emit OperatorChanged(operator, operator_);
        operator = operator_;
    }

    function setDisabled(address token, bool value) external onlyOwner {
        disabled[token] = value;
        emit AgentDisabled(token, value);
    }
}
