// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IBrokerCats {
    function ownerOf(uint256 id) external view returns (address);
    function catOf(uint256 id) external view returns (uint16 rosterId, uint8 rarity);
    function rarityMultiplier(uint8 rarity) external pure returns (uint8);
}

/// @title CatStockVault — дивиденды холдерам NFT-котов в токенизированных акциях
/// @notice Казна (или кто угодно) заливает сюда акции траншами (fund), контракт
///         раскладывает транш по котам пропорционально весу редкости
///         (Common ×1 … Legendary ×5). Дивиденды копятся НА КОТЕ: продал кота —
///         невыплаченное уехало с ним к новому владельцу (кот несёт ценность).
///         Кот, сминченный после транша, прошлые транши не получает.
///
/// @dev    Источник денег — реальные комиссии платформы, которые казна
///         конвертирует в акции. Контракт ничего не обещает и не начисляет
///         сам: нет транша — нет дивидендов. Никакой «доходности в день».
///         Учёт: на каждый payout-токен — magnifiedPerWeight; для кота при
///         регистрации фиксируется стартовая отметка по каждому токену.
///         Список payout-токенов ограничен, добавляет owner.
contract CatStockVault is Ownable {
    using SafeERC20 for IERC20;

    uint256 private constant MAG = 2 ** 128;
    uint256 public constant MAX_PAYOUT_TOKENS = 16;

    IBrokerCats public immutable cats;

    address[] public payoutTokens;                 // акции, которыми платим
    mapping(address => bool) public isPayoutToken;
    mapping(address => uint256) public magPerWeight; // token => magnified per weight

    uint256 public totalWeight;                    // сумма весов зарегистрированных котов
    mapping(uint256 => uint16) public weightOf;    // catId => вес (0 = не зарегистрирован)
    mapping(uint256 => mapping(address => uint256)) public startMag; // catId => token => отметка
    mapping(uint256 => mapping(address => uint256)) public claimed;  // catId => token => выплачено

    event PayoutTokenAdded(address indexed token);
    event CatRegistered(uint256 indexed id, uint16 weight);
    event Funded(address indexed token, uint256 amount, uint256 totalWeight);
    event Claimed(uint256 indexed id, address indexed token, address indexed to, uint256 amount);

    constructor(address cats_) Ownable(msg.sender) {
        require(cats_ != address(0), "zero cats");
        cats = IBrokerCats(cats_);
    }

    // ------------------------------------------------------------- admin

    /// @notice Добавить акцию в список валют выплат (например SPY, NVDA).
    function addPayoutToken(address token) external onlyOwner {
        require(token != address(0), "zero token");
        require(!isPayoutToken[token], "exists");
        require(payoutTokens.length < MAX_PAYOUT_TOKENS, "too many");
        isPayoutToken[token] = true;
        payoutTokens.push(token);
        emit PayoutTokenAdded(token);
    }

    function payoutTokensCount() external view returns (uint256) {
        return payoutTokens.length;
    }

    // ------------------------------------------------------------- registry

    /// @notice Регистрация кота в дивидендах. Зовёт контракт котов при минте;
    ///         на всякий случай может позвать и владелец кота (идемпотентно).
    function register(uint256 id) external {
        require(msg.sender == address(cats) || cats.ownerOf(id) == msg.sender, "not authorized");
        if (weightOf[id] != 0) return; // уже зарегистрирован
        (, uint8 rarity) = cats.catOf(id);
        uint16 wgt = cats.rarityMultiplier(rarity);
        weightOf[id] = wgt;
        totalWeight += wgt;
        // стартовые отметки: прошлые транши коту не достаются
        for (uint256 i = 0; i < payoutTokens.length; i++) {
            startMag[id][payoutTokens[i]] = magPerWeight[payoutTokens[i]];
        }
        emit CatRegistered(id, wgt);
    }

    // ------------------------------------------------------------- funding

    /// @notice Залить транш акций на раздачу всем зарегистрированным котам.
    ///         Нужен approve на amount. Может звать кто угодно (казна, спонсор).
    function fund(address token, uint256 amount) external {
        require(isPayoutToken[token], "not payout token");
        require(amount > 0, "zero amount");
        require(totalWeight > 0, "no cats");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        magPerWeight[token] += (amount * MAG) / totalWeight;
        emit Funded(token, amount, totalWeight);
    }

    // ------------------------------------------------------------- claims

    /// @notice Сколько акций token накоплено котом id и ещё не выплачено.
    function pendingOf(uint256 id, address token) public view returns (uint256) {
        uint16 wgt = weightOf[id];
        if (wgt == 0) return 0;
        uint256 accrued = ((magPerWeight[token] - startMag[id][token]) * wgt) / MAG;
        return accrued - claimed[id][token];
    }

    /// @notice Забрать дивиденды кота во всех валютах. Может только владелец кота.
    function claim(uint256 id, address to) external {
        require(cats.ownerOf(id) == msg.sender, "not cat owner");
        require(to != address(0), "zero recipient");
        for (uint256 i = 0; i < payoutTokens.length; i++) {
            address token = payoutTokens[i];
            uint256 amount = pendingOf(id, token);
            if (amount == 0) continue;
            claimed[id][token] += amount;
            IERC20(token).safeTransfer(to, amount);
            emit Claimed(id, token, to, amount);
        }
    }

    /// @notice Суммарные невыплаченные дивиденды кота по всем валютам (для UI).
    function pendingAll(uint256 id)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        tokens = payoutTokens;
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = pendingOf(id, tokens[i]);
        }
    }
}
