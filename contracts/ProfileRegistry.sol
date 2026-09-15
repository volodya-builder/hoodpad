// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ProfileRegistry — профили пользователей hood
/// @notice Имя, аватар и соцсети кошелька — в блокчейне, как и метадата
///         монет: сайт ничего не хранит, подделать чужой профиль нельзя
///         (пишет только сам кошелёк). Аватар — data-URI картинки, сжатой
///         на сайте до ~10–30 КБ; лимиты ниже — от мусора и от газа.
///         Пустая строка в поле — поле снимается. Владельца у контракта нет.
contract ProfileRegistry {
    struct Profile {
        string name;      // до 32 символов
        string avatar;    // data:image/… до 64 КБ или https://… до 200 символов
        string x;         // ник или ссылка, до 120
        string telegram;  // ник или ссылка, до 120
        string website;   // ссылка, до 200
        uint64 updatedAt; // 0 — профиля нет
    }

    uint256 public constant MAX_NAME = 32;
    uint256 public constant MAX_AVATAR = 64 * 1024;
    uint256 public constant MAX_HANDLE = 120;
    uint256 public constant MAX_URL = 200;

    mapping(address => Profile) private _profiles;

    event ProfileSet(address indexed who, string name, bool hasAvatar);
    event ProfileCleared(address indexed who);

    /// @notice Профиль кошелька; updatedAt == 0 — профиля нет.
    function profileOf(address who) external view returns (Profile memory) {
        return _profiles[who];
    }

    /// @notice Профили пачкой — для списков держателей и сделок.
    function profilesOf(address[] calldata whos) external view returns (Profile[] memory out) {
        out = new Profile[](whos.length);
        for (uint256 i = 0; i < whos.length; i++) out[i] = _profiles[whos[i]];
    }

    /// @notice Задать свой профиль. Пустое поле — снять.
    function setProfile(
        string calldata name,
        string calldata avatar,
        string calldata x,
        string calldata telegram,
        string calldata website
    ) external {
        require(bytes(name).length <= MAX_NAME * 4, "name too long");   // до 32 символов UTF-8
        require(bytes(avatar).length <= MAX_AVATAR, "avatar too big");
        require(bytes(x).length <= MAX_HANDLE && bytes(telegram).length <= MAX_HANDLE, "handle too long");
        require(bytes(website).length <= MAX_URL, "url too long");
        if (bytes(avatar).length > 0) {
            bytes calldata a = bytes(avatar);
            // только картинка data-URI или https-ссылка — не скрипты и не что попало
            bool dataImg = a.length > 11 && a[0] == "d" && a[1] == "a" && a[2] == "t" && a[3] == "a" && a[4] == ":"
                && a[5] == "i" && a[6] == "m" && a[7] == "a" && a[8] == "g" && a[9] == "e" && a[10] == "/";
            bool https = a.length > 8 && a.length <= MAX_URL && a[0] == "h" && a[1] == "t" && a[2] == "t" && a[3] == "p"
                && a[4] == "s" && a[5] == ":" && a[6] == "/" && a[7] == "/";
            require(dataImg || https, "avatar: data:image or https");
        }
        _profiles[msg.sender] = Profile(name, avatar, x, telegram, website, uint64(block.timestamp));
        emit ProfileSet(msg.sender, name, bytes(avatar).length > 0);
    }

    /// @notice Стереть свой профиль целиком.
    function clearProfile() external {
        delete _profiles[msg.sender];
        emit ProfileCleared(msg.sender);
    }
}
