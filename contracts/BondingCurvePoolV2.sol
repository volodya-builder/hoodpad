// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILiquidityMigrator} from "./interfaces/ILiquidityMigrator.sol";

interface IVotePowerHook {
    function recordFee(address trader, uint256 fee) external;
}

/// @title BondingCurvePoolV2
/// @notice Same constant-product curve as v1 with one addition: every trade
///         fee is reported to VotePower — the fee you pay becomes your
///         voting power for the current epoch («голос за шкуру»).
contract BondingCurvePoolV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------- immutables
    IERC20  public immutable token;
    address public immutable factory;
    address public immutable creator;

    uint256 public immutable totalSupply;
    uint256 public immutable saleCap;
    uint256 public immutable virtualEth;
    uint16  public immutable feeBps;
    uint16  public immutable creatorFeeShareBps;

    // ------------------------------------------------------------- state
    uint256 public ethReserve;
    uint256 public tokensSold;
    bool    public graduated;
    bool    public migrated;

    uint256 public protocolFeesAccrued;
    uint256 public creatorFeesAccrued;

    // ------------------------------------------------------------- events
    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee);
    event Graduated(uint256 ethReserve, uint256 dexTokenReserve);
    event Migrated(address indexed migrator, uint256 ethAmount, uint256 tokenAmount);
    event FeesClaimed(address indexed to, uint256 amount, bool isCreator);

    error TradingClosed();
    error SlippageExceeded();
    error ZeroAmount();
    error NotGraduated();
    error AlreadyMigrated();
    error NotAuthorized();

    constructor(
        address token_,
        address creator_,
        uint256 totalSupply_,
        uint256 saleCap_,
        uint256 virtualEth_,
        uint16  feeBps_,
        uint16  creatorFeeShareBps_
    ) {
        require(saleCap_ < totalSupply_, "cap>=supply");
        require(token_ != address(0) && creator_ != address(0), "zero addr");
        require(feeBps_ <= 500, "fee>5%");
        require(creatorFeeShareBps_ <= 10_000, "share>100%");
        factory = msg.sender;
        token = IERC20(token_);
        creator = creator_;
        totalSupply = totalSupply_;
        saleCap = saleCap_;
        virtualEth = virtualEth_;
        feeBps = feeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
    }

    // ------------------------------------------------------------- views

    function spotPrice() external view returns (uint256) {
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        return (x * 1e18) / y;
    }

    function quoteBuy(uint256 ethInGross) public view returns (uint256 tokensOut) {
        uint256 fee = (ethInGross * feeBps) / 10_000;
        uint256 ethIn = ethInGross - fee;
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * ethIn) / (x + ethIn);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOutGross) {
        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        ethOutGross = (x * tokensIn) / (y + tokensIn);
    }

    // ------------------------------------------------------------- trading

    function buy(uint256 minTokensOut, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (graduated) revert TradingClosed();
        if (msg.value == 0) revert ZeroAmount();

        uint256 fee = (msg.value * feeBps) / 10_000;
        uint256 ethIn = msg.value - fee;

        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        tokensOut = (y * ethIn) / (x + ethIn);

        uint256 refund;
        uint256 remaining = saleCap - tokensSold;
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            uint256 ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut);
            if (ethNeeded > ethIn) ethNeeded = ethIn;
            uint256 grossNeeded = (ethNeeded * 10_000 + (10_000 - feeBps) - 1) / (10_000 - feeBps);
            if (grossNeeded > msg.value) grossNeeded = msg.value;
            refund = msg.value - grossNeeded;
            fee = grossNeeded - ethNeeded;
            ethIn = ethNeeded;
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut == 0) revert ZeroAmount();

        // effects
        ethReserve += ethIn;
        tokensSold += tokensOut;
        _accrueFees(fee);

        bool willGraduate = tokensSold >= saleCap;
        if (willGraduate) {
            graduated = true;
        }

        // interactions
        _reportFee(msg.sender, fee);
        token.safeTransfer(recipient, tokensOut);
        if (refund > 0) _sendEth(msg.sender, refund);

        emit Buy(recipient, ethIn, tokensOut, fee);
        if (willGraduate) {
            emit Graduated(ethReserve, totalSupply - saleCap);
        }
    }

    function sell(uint256 tokensIn, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 ethToUser)
    {
        if (graduated) revert TradingClosed();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 x = virtualEth + ethReserve;
        uint256 y = totalSupply - tokensSold;
        uint256 ethOutGross = (x * tokensIn) / (y + tokensIn);
        if (ethOutGross > ethReserve) ethOutGross = ethReserve;

        uint256 fee = (ethOutGross * feeBps) / 10_000;
        ethToUser = ethOutGross - fee;
        if (ethToUser < minEthOut) revert SlippageExceeded();

        // effects
        ethReserve -= ethOutGross;
        tokensSold -= tokensIn;
        _accrueFees(fee);

        // interactions
        _reportFee(msg.sender, fee);
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        _sendEth(msg.sender, ethToUser);

        emit Sell(msg.sender, tokensIn, ethToUser, fee);
    }

    // ------------------------------------------------------------- migration

    function migrate() external nonReentrant {
        if (!graduated) revert NotGraduated();
        if (migrated) revert AlreadyMigrated();
        migrated = true;

        address migrator = IFactoryConfigV2(factory).migrator();
        uint256 tokenAmount = totalSupply - saleCap;
        uint256 ethAmount = ethReserve;
        ethReserve = 0;

        token.safeTransfer(migrator, tokenAmount);
        ILiquidityMigrator(migrator).migrate{value: ethAmount}(address(token), tokenAmount);

        emit Migrated(migrator, ethAmount, tokenAmount);
    }

    // ------------------------------------------------------------- fees

    function claimCreatorFees(address to) external nonReentrant {
        if (msg.sender != creator) revert NotAuthorized();
        uint256 amount = creatorFeesAccrued;
        creatorFeesAccrued = 0;
        _sendEth(to, amount);
        emit FeesClaimed(to, amount, true);
    }

    function claimProtocolFees() external nonReentrant {
        address treasury = IFactoryConfigV2(factory).treasury();
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        _sendEth(treasury, amount);
        emit FeesClaimed(treasury, amount, false);
    }

    // ------------------------------------------------------------- internal

    function _accrueFees(uint256 fee) internal {
        if (fee == 0) return;
        uint256 creatorCut = (fee * creatorFeeShareBps) / 10_000;
        creatorFeesAccrued += creatorCut;
        protocolFeesAccrued += fee - creatorCut;
    }

    /// @dev Fee => voting power. Never blocks a trade: if the hook is unset
    ///      or reverts, the trade proceeds without power accrual.
    function _reportFee(address trader, uint256 fee) internal {
        address hook = IFactoryConfigV2(factory).votePower();
        if (hook == address(0) || fee == 0) return;
        try IVotePowerHook(hook).recordFee(trader, fee) {} catch {}
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}

interface IFactoryConfigV2 {
    function migrator() external view returns (address);
    function treasury() external view returns (address);
    function votePower() external view returns (address);
}
