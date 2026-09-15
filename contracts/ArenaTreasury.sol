// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IEthPoolA {
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256);
}

interface IQuotePoolA {
    function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient) external returns (uint256);
    function quote() external view returns (address);
}

interface IFactoryA {
    function poolOf(address token) external view returns (address);
}

interface IZapA {
    function buyWithEth(address token, uint256 minTokensOut, uint256 deadline) external payable returns (uint256);
}

/// @title ArenaTreasury — казна арены
/// @notice Сюда FeeSplitterV5 присылает долю арены (20% каждой торговой
///         комиссии): ETH от ETH-монет и валюту (USDG, токен-акции) от монет
///         за валюту. Деньги отсюда уходят ТОЛЬКО на выкуп монет платформы
///         с рынка и их сжигание — функции вывода нет по замыслу, как и у
///         прежней казны выкупа. Что и когда выкупать, решает бот арены
///         (owner) по подиуму дня; правила подсчёта у него общие с сайтом
///         (web/src/lib/arena-core.js), поэтому подиум на экране и выкуп
///         в блокчейне не могут разойтись.
///
///         Три способа выкупа:
///           • buybackEth    — ETH-монета за ETH напрямую у её кривой;
///           • buybackViaZap — монета за валюту, платим ETH: зап меняет ETH
///                             на валюту и покупает на кривой одной сделкой;
///           • buybackQuote  — монета за валюту из валюты, что уже лежит здесь
///                             (пришла от сплиттера как доля арены).
///         Купленное сжигается в той же транзакции (перевод на 0x…dEaD).
contract ArenaTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IFactoryA public immutable ethFactory;   // address(0) — ETH-фабрики нет
    IFactoryA public immutable quoteFactory; // address(0) — фабрики за валюту нет
    IZapA public immutable zap;              // address(0) — без запа: валютные монеты только за их валюту

    /// @notice Сколько монеты сожжено казной за всё время.
    mapping(address => uint256) public burnedOf;
    /// @notice Сколько ETH потрачено на выкупы за всё время.
    uint256 public totalEthSpent;

    event Received(address indexed from, uint256 amount);
    /// @param asset address(0) — платили ETH, иначе валюта монеты.
    event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note);
    event Burned(address indexed token, uint256 amount);

    constructor(address owner_, address ethFactory_, address quoteFactory_, address zap_) Ownable(owner_) {
        require(ethFactory_ != address(0) || quoteFactory_ != address(0), "no factory");
        ethFactory = IFactoryA(ethFactory_);
        quoteFactory = IFactoryA(quoteFactory_);
        zap = IZapA(zap_);
    }

    /// @dev Доля арены от сплиттера и сдача ETH от запа.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

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
        tokensOut = IEthPoolA(pool).buy{value: ethAmount}(minTokensOut, address(this));
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
        require(address(zap) != address(0), "no zap");
        require(address(quoteFactory) != address(0) && quoteFactory.poolOf(token) != address(0), "not a quote token");
        require(ethAmount > 0 && ethAmount <= address(this).balance, "bad amount");
        tokensOut = zap.buyWithEth{value: ethAmount}(token, minTokensOut, deadline);
        totalEthSpent += ethAmount;
        _burn(token);
        emit Buyback(token, address(0), ethAmount, tokensOut, note);
    }

    /// @notice Выкупить монету за валюту из валюты, лежащей в казне, и сжечь.
    function buybackQuote(address token, uint256 quoteAmount, uint256 minTokensOut, string calldata note)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensOut)
    {
        address pool = address(quoteFactory) != address(0) ? quoteFactory.poolOf(token) : address(0);
        require(pool != address(0), "not a quote token");
        IERC20 asset = IERC20(IQuotePoolA(pool).quote());
        require(quoteAmount > 0 && quoteAmount <= asset.balanceOf(address(this)), "bad amount");
        asset.forceApprove(pool, quoteAmount);
        tokensOut = IQuotePoolA(pool).buy(quoteAmount, minTokensOut, address(this));
        asset.forceApprove(pool, 0);
        _burn(token);
        emit Buyback(token, address(asset), quoteAmount, tokensOut, note);
    }

    /// @dev Всё, что казна держит в этой монете, — в печь.
    function _burn(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) return;
        IERC20(token).safeTransfer(DEAD, bal);
        burnedOf[token] += bal;
        emit Burned(token, bal);
    }
}
