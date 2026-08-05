// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICatsMintable {
    function mintFromBox(address to, uint8 rarity, uint256 seed) external returns (uint256 id);
}

/// @title CatBox — кейсы с котами (CS:GO-style), лимит 10 000 на всю игру
/// @notice Игрок покупает бокс, затем открывает его во ВТОРОЙ транзакции.
///         Рандом — commit-reveal: сид складывается из хэша будущего блока
///         (неизвестного на момент покупки) и адреса игрока. Ни игрок, ни
///         майнер не могут подобрать выигрыш: игрок не знает будущий блок,
///         а блок уже зафиксирован до открытия и не выбирается заново.
///
/// @dev    Шансы совпадают с BrokerCats: Common 60 / Rare 24 / Epic 10 /
///         Mythic 5 / Legendary 1 (%). Выручка уходит в proceeds (казна) сразу
///         при покупке. Открывать можно не раньше следующего блока и не позже
///         REVEAL_WINDOW блоков — иначе бокс переоткрывается с новым коммитом
///         (иначе сид стал бы недоступен: blockhash хранится 256 блоков).
contract CatBox is ReentrancyGuard {
    uint256 public constant MAX_BOXES = 10_000;
    uint256 public constant REVEAL_WINDOW = 200; // блоков на открытие

    ICatsMintable public immutable cats;
    address public immutable proceeds;
    uint256 public immutable boxPrice;

    uint256 public sold;      // куплено боксов (лимит 10k)
    uint256 public opened;    // открыто боксов

    struct Box {
        address owner;
        uint64 commitBlock; // блок покупки; сид = blockhash(commitBlock+1)
        bool opened;
    }

    mapping(uint256 => Box) public boxOf; // boxId => бокс
    mapping(address => uint256[]) private _boxesOf;

    event BoxBought(address indexed buyer, uint256 indexed boxId, uint64 commitBlock);
    event BoxOpened(address indexed opener, uint256 indexed boxId, uint256 catId, uint8 rarity);
    event BoxRecommitted(uint256 indexed boxId, uint64 newCommitBlock);

    error SoldOut();
    error WrongPrice();
    error NotOwner();
    error AlreadyOpened();
    error TooEarly();
    error Expired();

    constructor(address cats_, address proceeds_, uint256 boxPrice_) {
        require(cats_ != address(0) && proceeds_ != address(0), "zero addr");
        require(boxPrice_ > 0, "zero price");
        cats = ICatsMintable(cats_);
        proceeds = proceeds_;
        boxPrice = boxPrice_;
    }

    // ------------------------------------------------------------- покупка

    /// @notice Купить бокс. Открыть можно начиная со следующего блока.
    function buy() external payable nonReentrant returns (uint256 boxId) {
        if (msg.value != boxPrice) revert WrongPrice();
        if (sold >= MAX_BOXES) revert SoldOut();

        boxId = ++sold;
        boxOf[boxId] = Box({ owner: msg.sender, commitBlock: uint64(block.number), opened: false });
        _boxesOf[msg.sender].push(boxId);

        emit BoxBought(msg.sender, boxId, uint64(block.number));

        (bool ok, ) = proceeds.call{value: msg.value}("");
        require(ok, "proceeds send failed");
    }

    // ------------------------------------------------------------- открытие

    /// @notice Открыть бокс: минтит кота случайной редкости владельцу бокса.
    function open(uint256 boxId) external nonReentrant returns (uint256 catId, uint8 rarity) {
        Box storage b = boxOf[boxId];
        if (b.owner != msg.sender) revert NotOwner();
        if (b.opened) revert AlreadyOpened();

        uint256 target = uint256(b.commitBlock) + 1;
        if (block.number <= target) revert TooEarly();
        if (block.number > target + REVEAL_WINDOW) revert Expired();

        bytes32 bh = blockhash(target);
        // подстраховка: если хэш недоступен (не должен, окно < 256) — переоткрыть
        if (bh == bytes32(0)) revert Expired();

        b.opened = true;
        opened += 1;

        uint256 seed = uint256(keccak256(abi.encodePacked(bh, msg.sender, boxId)));
        rarity = _rollRarity(uint8(seed % 100));
        catId = cats.mintFromBox(msg.sender, rarity, seed);

        emit BoxOpened(msg.sender, boxId, catId, rarity);
    }

    /// @notice Если окно открытия пропущено — заново зафиксировать блок.
    ///         Бокс не сгорает: игрок не теряет покупку из-за простоя.
    function recommit(uint256 boxId) external {
        Box storage b = boxOf[boxId];
        if (b.owner != msg.sender) revert NotOwner();
        if (b.opened) revert AlreadyOpened();
        uint256 target = uint256(b.commitBlock) + 1;
        require(block.number > target + REVEAL_WINDOW, "still openable");
        b.commitBlock = uint64(block.number);
        emit BoxRecommitted(boxId, uint64(block.number));
    }

    /// @dev Common 60% · Rare 24% · Epic 10% · Mythic 5% · Legendary 1%
    function _rollRarity(uint8 roll) internal pure returns (uint8) {
        if (roll < 60) return 0;
        if (roll < 84) return 1;
        if (roll < 94) return 2;
        if (roll < 99) return 3;
        return 4;
    }

    // ------------------------------------------------------------- views

    function boxesLeft() external view returns (uint256) {
        return MAX_BOXES - sold;
    }

    function boxesOf(address user) external view returns (uint256[] memory) {
        return _boxesOf[user];
    }

    /// @notice Готов ли бокс к открытию прямо сейчас (для UI).
    function openable(uint256 boxId) external view returns (bool ready, bool expired) {
        Box memory b = boxOf[boxId];
        if (b.owner == address(0) || b.opened) return (false, false);
        uint256 target = uint256(b.commitBlock) + 1;
        expired = block.number > target + REVEAL_WINDOW;
        ready = block.number > target && !expired;
    }
}
