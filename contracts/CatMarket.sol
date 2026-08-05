// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICatsNFT {
    function ownerOf(uint256 id) external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
    function catOf(uint256 id) external view returns (uint16 rosterId, uint8 rarity);
}

/// @title CatMarket — биржа NFT-котов hood
/// @notice Простой эскроу-маркетплейс: продавец листит кота (кот переезжает
///         на контракт), покупатель платит нативной монетой, 2% уходит казне,
///         остальное продавцу, кот — покупателю. Отмена возвращает кота.
///         Дивиденды кота (CatStockVault) копятся НА КОТЕ, поэтому при
///         продаже они автоматически переходят покупателю — это часть цены.
/// @dev    Эскроу вместо approve-модели сознательно: рынок маленький, зато
///         листинг невозможно «увести» перепродажей мимо биржи, и все
///         активные лоты тривиально перечисляются он-чейн без индексера.
contract CatMarket is ReentrancyGuard {
    uint16 public constant FEE_BPS = 200; // 2% с продажи — в казну
    uint16 public constant BPS = 10_000;

    ICatsNFT public immutable cats;
    address public immutable treasury;

    struct Listing {
        address seller;
        uint96 price; // до ~79 млрд ETH — за глаза
    }

    mapping(uint256 => Listing) public listingOf; // catId => лот (seller=0 — нет)
    uint256[] private _listed;                    // активные id (с дырками после снятия)
    mapping(uint256 => uint256) private _listedIdx;

    event Listed(uint256 indexed id, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed id, address indexed seller);
    event Bought(uint256 indexed id, address indexed buyer, address indexed seller, uint256 price, uint256 fee);

    error NotSeller();
    error NotListed();
    error WrongPrice();
    error ZeroPrice();

    constructor(address cats_, address treasury_) {
        require(cats_ != address(0) && treasury_ != address(0), "zero addr");
        cats = ICatsNFT(cats_);
        treasury = treasury_;
    }

    // ------------------------------------------------------------- листинг

    /// @notice Выставить кота на продажу. Нужен approve на этот контракт.
    function list(uint256 id, uint96 price) external nonReentrant {
        if (price == 0) revert ZeroPrice();
        cats.transferFrom(msg.sender, address(this), id); // эскроу
        listingOf[id] = Listing(msg.sender, price);
        _listedIdx[id] = _listed.length;
        _listed.push(id);
        emit Listed(id, msg.sender, price);
    }

    /// @notice Снять кота с продажи — он возвращается продавцу.
    function cancel(uint256 id) external nonReentrant {
        Listing memory l = listingOf[id];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        _remove(id);
        cats.transferFrom(address(this), msg.sender, id);
        emit Cancelled(id, msg.sender);
    }

    /// @notice Купить кота по цене лота. 2% — казне, остальное продавцу.
    function buy(uint256 id) external payable nonReentrant {
        Listing memory l = listingOf[id];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value != l.price) revert WrongPrice();
        _remove(id);

        uint256 fee = (msg.value * FEE_BPS) / BPS;
        (bool okT, ) = treasury.call{value: fee}("");
        require(okT, "fee send failed");
        (bool okS, ) = l.seller.call{value: msg.value - fee}("");
        require(okS, "seller send failed");

        cats.transferFrom(address(this), msg.sender, id);
        emit Bought(id, msg.sender, l.seller, msg.value, fee);
    }

    // ------------------------------------------------------------- views

    function listedCount() external view returns (uint256) {
        return _listed.length;
    }

    /// @notice Страница активных лотов для фронта: id, продавец, цена, редкость.
    function listings(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, address[] memory sellers, uint256[] memory prices, uint8[] memory rarities)
    {
        uint256 n = _listed.length;
        if (offset >= n) return (new uint256[](0), new address[](0), new uint256[](0), new uint8[](0));
        uint256 end = offset + limit > n ? n : offset + limit;
        uint256 m = end - offset;
        ids = new uint256[](m);
        sellers = new address[](m);
        prices = new uint256[](m);
        rarities = new uint8[](m);
        for (uint256 i = 0; i < m; i++) {
            uint256 id = _listed[offset + i];
            Listing memory l = listingOf[id];
            (, uint8 rar) = cats.catOf(id);
            ids[i] = id;
            sellers[i] = l.seller;
            prices[i] = l.price;
            rarities[i] = rar;
        }
    }

    // ------------------------------------------------------------- internal

    /// @dev swap-and-pop из списка активных лотов
    function _remove(uint256 id) internal {
        delete listingOf[id];
        uint256 idx = _listedIdx[id];
        uint256 lastId = _listed[_listed.length - 1];
        _listed[idx] = lastId;
        _listedIdx[lastId] = idx;
        _listed.pop();
        delete _listedIdx[id];
    }
}
