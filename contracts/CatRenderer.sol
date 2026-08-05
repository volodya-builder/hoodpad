// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CatRenderer — метаданные и картинка котов прямо в блокчейне
/// @notice Отдаёт tokenURI как data:application/json;base64 с встроенной SVG.
///         Ни IPFS, ни сервера, ни отдельной загрузки 10 500 картинок:
///         кот рисуется из своей редкости и тикера в момент запроса.
///
/// @dev    Почему так, а не baseURI + id. Редкость и тикер решаются он-чейн
///         в момент минта (commit-reveal в боксе), поэтому заранее выложить
///         статические метаданные под каждый id невозможно — пришлось бы
///         держать сервер, который дорисовывает файл после каждой продажи.
///         Он-чейн рендер снимает эту зависимость целиком: маркетплейсы
///         увидят кота сразу после минта, даже если сайт лежит.
contract CatRenderer {
    string[5] private RARITY_NAME = ["Common", "Rare", "Epic", "Mythic", "Legendary"];
    // цвета совпадают с палитрой сайта
    string[5] private RARITY_COLOR = ["#8b93a7", "#4aa3e0", "#a06bff", "#e0559a", "#f5b544"];
    uint8[5]  private RARITY_MULT  = [1, 2, 3, 5, 8];

    /// @notice Полные метаданные кота: JSON с картинкой внутри.
    /// @dev    Сборка разнесена по мелким функциям: без via-ir длинные
    ///         abi.encodePacked не помещаются в стек, а весь проект
    ///         компилируется обычным путём (evmVersion paris, без via-ir).
    function tokenURI(uint256 id, string calldata ticker, uint8 rarity)
        external
        view
        returns (string memory)
    {
        require(rarity <= 4, "bad rarity");
        string memory image = _b64(bytes(_svg(id, ticker, RARITY_COLOR[rarity], RARITY_NAME[rarity])));
        return string(abi.encodePacked(
            "data:application/json;base64,",
            _b64(bytes(_json(id, ticker, rarity, image)))
        ));
    }

    function _json(uint256 id, string calldata ticker, uint8 rarity, string memory image)
        private
        view
        returns (string memory)
    {
        return string(abi.encodePacked(
            '{"name":"hood cat #', _toString(id),
            '","description":"Broker cat of the hood launchpad. Rarity sets the weight of treasury payouts in tokenized stocks; unclaimed dividends travel with the cat.',
            '","image":"data:image/svg+xml;base64,', image,
            '","attributes":[', _attrs(ticker, rarity), ']}'
        ));
    }

    function _attrs(string calldata ticker, uint8 rarity) private view returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Rarity","value":"', RARITY_NAME[rarity], '"},',
            '{"trait_type":"Ticker","value":"', ticker, '"},',
            '{"trait_type":"Payout weight","value":', _toString(RARITY_MULT[rarity]), '}'
        ));
    }

    /// @dev Карточка кота: тёмный фон, рамка цвета редкости, пиксель-кот,
    ///      тикер и вес выплат. Всё в 400x400, без внешних ссылок.
    ///      Собирается по частям: один большой encodePacked не влезает в
    ///      стек без via-ir, а весь проект компилируется без него.
    function _svg(uint256 id, string calldata ticker, string memory color, string memory rname)
        private
        pure
        returns (string memory)
    {
        return string(abi.encodePacked(_head(color), _cat(color), _labels(id, ticker, color, rname)));
    }

    function _head(string memory color) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
            '<stop offset="0" stop-color="', color, '" stop-opacity="0.28"/>',
            '<stop offset="1" stop-color="#0b0e14" stop-opacity="0"/></linearGradient></defs>',
            '<rect width="400" height="400" rx="28" fill="#0b0e14"/>',
            '<rect width="400" height="400" rx="28" fill="url(#g)"/>',
            '<rect x="6" y="6" width="388" height="388" rx="24" fill="none" stroke="', color, '" stroke-width="3"/>'
        ));
    }

    function _labels(uint256 id, string calldata ticker, string memory color, string memory rname)
        private
        pure
        returns (string memory)
    {
        return string(abi.encodePacked(_tickerText(ticker), _rarityText(color, rname), _idText(id)));
    }

    function _tickerText(string calldata ticker) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="200" y="300" font-family="monospace" font-size="34" font-weight="bold" fill="#ffffff" text-anchor="middle">$',
            ticker, '</text>'
        ));
    }

    function _rarityText(string memory color, string memory rname) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="200" y="332" font-family="monospace" font-size="18" fill="', color,
            '" text-anchor="middle">', rname, '</text>'
        ));
    }

    function _idText(uint256 id) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="200" y="364" font-family="monospace" font-size="14" fill="#8b93a7" text-anchor="middle">hood cat #',
            _toString(id), '</text></svg>'
        ));
    }

    /// @dev Пиксель-кот в цвете редкости — тот же силуэт, что на сайте.
    function _cat(string memory color) private pure returns (string memory) {
        return string(abi.encodePacked(
            // силуэт: уши, голова, тело. Масштаб 5 от сетки 32x32,
            // сдвиг подобран так, чтобы кот стоял по центру карточки
            '<g fill="', color, '" transform="translate(125,44) scale(5)">',
            '<rect x="1" y="1" width="4" height="5"/>',           // левое ухо
            '<rect x="13" y="1" width="4" height="5"/>',          // правое ухо
            '<rect x="1" y="5" width="16" height="12" rx="2"/>',  // голова
            '<rect x="5" y="17" width="8" height="9" rx="2"/>',   // тело
            '<rect x="3" y="26" width="3" height="3"/>',          // левая лапа
            '<rect x="12" y="26" width="3" height="3"/>',         // правая лапа
            '</g>',
            // морда: тёмные глаза и нос поверх головы (координаты в пикселях
            // холста, а не в сетке — так проще держать их на месте)
            '<g fill="#0b0e14">',
            '<rect x="150" y="98" width="14" height="14" rx="4"/>',  // левый глаз
            '<rect x="181" y="98" width="14" height="14" rx="4"/>',  // правый глаз
            '<rect x="166" y="120" width="13" height="7" rx="3"/>',  // нос
            '</g>'
        ));
    }

    // ------------------------------------------------------------- utils

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 t = v; t != 0; t /= 10) digits++;
        bytes memory buf = new bytes(digits);
        while (v != 0) { buf[--digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    bytes private constant B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// @dev Компактный base64: маркетплейсы ожидают data-URI именно в нём.
    function _b64(bytes memory data) private pure returns (string memory) {
        if (data.length == 0) return "";
        uint256 encLen = 4 * ((data.length + 2) / 3);
        bytes memory out = new bytes(encLen);
        bytes memory table = B64;
        uint256 i;
        uint256 j;
        for (; i + 3 <= data.length; i += 3) {
            uint256 n = (uint256(uint8(data[i])) << 16) | (uint256(uint8(data[i + 1])) << 8) | uint8(data[i + 2]);
            out[j++] = table[(n >> 18) & 63];
            out[j++] = table[(n >> 12) & 63];
            out[j++] = table[(n >> 6) & 63];
            out[j++] = table[n & 63];
        }
        if (data.length - i == 1) {
            uint256 n = uint256(uint8(data[i])) << 16;
            out[j++] = table[(n >> 18) & 63];
            out[j++] = table[(n >> 12) & 63];
            out[j++] = "=";
            out[j] = "=";
        } else if (data.length - i == 2) {
            uint256 n = (uint256(uint8(data[i])) << 16) | (uint256(uint8(data[i + 1])) << 8);
            out[j++] = table[(n >> 18) & 63];
            out[j++] = table[(n >> 12) & 63];
            out[j++] = table[(n >> 6) & 63];
            out[j] = "=";
        }
        return string(out);
    }
}
