// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title BrokerCats — NFT-коты, привязанные к реальным акциям
/// @notice Фэнтези-спорт на токенизированных акциях Robinhood Chain:
///         минт кота случайно назначает тикер (из ростера) и редкость-множитель.
///         Ежедневные результаты считаются по реальным движениям акций
///         (Chainlink-фиды) и публикуются офф-чейн ботом — как очки Арены.
///         НИКАКОЙ «доходности» контракт не обещает и не платит: награды
///         подиуму приходят из казны существующим механизмом выкупов.
///
/// @dev    ERC721 реализован минимально и без внешних библиотек: свежий
///         OpenZeppelin ERC721 требует Cancun (mcopy), а мы собираемся под
///         paris ради совместимости с L2. Логика стандартная: owner/approve/
///         transfer/safeTransfer + метаданные через baseURI.
///         Случайность минта — blockhash+id: для игровой редкости достаточно
///         (манипуляция ради Legendary-кота дороже кота); для денежных лотерей
///         использовали бы VRF.
contract BrokerCats is Ownable {
    // ------------------------------------------------------------- ERC721 core
    string public constant name = "hood Broker Cats";
    string public constant symbol = "HCAT";

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // ------------------------------------------------------------- game data
    struct Roster {
        string ticker;   // "NVDA"
        address feed;    // Chainlink AggregatorV3 этой акции (для UI и ботов)
    }

    struct Cat {
        uint16 rosterId;
        uint8 rarity;    // 0 Common ×1, 1 Rare ×2, 2 Epic ×3, 3 Legendary ×5
    }

    uint256 public constant MAX_SUPPLY = 3000;
    uint256 public immutable mintPrice;
    address public immutable proceeds;

    Roster[] public roster;
    mapping(uint256 => Cat) public catOf;
    uint256 public totalMinted;
    string public baseURI;

    event CatMinted(address indexed to, uint256 indexed id, uint16 rosterId, uint8 rarity);
    event RosterAdded(uint16 indexed id, string ticker, address feed);

    constructor(uint256 mintPrice_, address proceeds_, string memory baseURI_) Ownable(msg.sender) {
        require(proceeds_ != address(0), "zero proceeds");
        require(mintPrice_ > 0, "zero price");
        mintPrice = mintPrice_;
        proceeds = proceeds_;
        baseURI = baseURI_;
    }

    // ------------------------------------------------------------- admin

    function addRoster(string calldata ticker, address feed) external onlyOwner {
        require(roster.length < 64, "roster full");
        roster.push(Roster(ticker, feed));
        emit RosterAdded(uint16(roster.length - 1), ticker, feed);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    function rosterCount() external view returns (uint256) {
        return roster.length;
    }

    // ------------------------------------------------------------- mint

    /// @notice Минт: фикс-цена, случайный тикер и редкость. Выручка сразу
    ///         уходит в proceeds — на контракте деньги не лежат.
    function mint() external payable returns (uint256 id) {
        require(msg.value == mintPrice, "wrong price");
        require(totalMinted < MAX_SUPPLY, "sold out");
        require(roster.length > 0, "roster empty");

        id = ++totalMinted;

        uint256 rnd = uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1), msg.sender, id
        )));
        catOf[id] = Cat(uint16(rnd % roster.length), _rollRarity(uint8((rnd >> 128) % 100)));

        _mint(msg.sender, id);
        emit CatMinted(msg.sender, id, catOf[id].rosterId, catOf[id].rarity);

        (bool ok, ) = proceeds.call{value: msg.value}("");
        require(ok, "proceeds send failed");
    }

    /// @dev Common 60% ×1 · Rare 25% ×2 · Epic 11% ×3 · Legendary 4% ×5
    function _rollRarity(uint8 roll) internal pure returns (uint8) {
        if (roll < 60) return 0;
        if (roll < 85) return 1;
        if (roll < 96) return 2;
        return 3;
    }

    function rarityMultiplier(uint8 rarity) public pure returns (uint8) {
        if (rarity == 0) return 1;
        if (rarity == 1) return 2;
        if (rarity == 2) return 3;
        return 5;
    }

    /// @notice Кот целиком: тикер, фид, редкость — одним вызовом для фронта.
    function catInfo(uint256 id)
        external
        view
        returns (string memory ticker, address feed, uint8 rarity, uint8 multiplier)
    {
        require(_ownerOf[id] != address(0), "no cat");
        Cat memory c = catOf[id];
        Roster memory r = roster[c.rosterId];
        return (r.ticker, r.feed, c.rarity, rarityMultiplier(c.rarity));
    }

    // ------------------------------------------------------------- ERC721

    function ownerOf(uint256 tokenId) public view returns (address o) {
        o = _ownerOf[tokenId];
        require(o != address(0), "no token");
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        require(msg.sender == o || isApprovedForAll[o][msg.sender], "not authorized");
        getApproved[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address o = ownerOf(tokenId);
        require(o == from, "wrong from");
        require(to != address(0), "zero to");
        require(
            msg.sender == o || msg.sender == getApproved[tokenId] || isApprovedForAll[o][msg.sender],
            "not authorized"
        );
        delete getApproved[tokenId];
        unchecked {
            balanceOf[from] -= 1;
            balanceOf[to] += 1;
        }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, data);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf[tokenId] != address(0), "no token");
        return string(abi.encodePacked(baseURI, _toString(tokenId)));
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f // ERC721Metadata
            || interfaceId == 0x01ffc9a7; // ERC165
    }

    // ------------------------------------------------------------- internal

    function _mint(address to, uint256 tokenId) internal {
        require(_ownerOf[tokenId] == address(0), "exists");
        unchecked { balanceOf[to] += 1; }
        _ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
        _checkReceiver(address(0), to, tokenId, "");
    }

    function _checkReceiver(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
                    == IERC721Receiver.onERC721Received.selector,
                "unsafe receiver"
            );
        }
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 len;
        while (tmp > 0) { len++; tmp /= 10; }
        bytes memory out = new bytes(len);
        while (v > 0) {
            out[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(out);
    }
}
