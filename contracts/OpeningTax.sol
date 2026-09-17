// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title OpeningTax — стартовый налог против снайперов (как у Pons)
/// @notice Первые секунды после запуска монеты покупка облагается налогом,
///         который стартует с 99% и за пять секунд падает до нуля. Снайпер-бот,
///         который бьёт в первый блок, отдаёт почти всё в комиссию; человек,
///         который открывает страницу через минуту, налога не видит вообще.
///
///         Правила:
///           - только покупки; продажи не облагаются никогда;
///           - создатель монеты освобождён (его покупка в той же транзакции,
///             что и создание, идёт без налога), плюс до 32 адресов, которые
///             создатель называет при запуске — команда, партнёры, свои кошельки;
///           - налог не сжигается: он попадает в общий котёл комиссий и делится
///             как обычная комиссия сделки (создатель / арена / выкуп / команда);
///           - секунды считаются по времени блока: покупки внутри одной
///             секунды платят одинаково.
///
///         Шкала (доля от суммы покупки): 0-я секунда 99%, 1-я 25%, 2-я 3%,
///         3-я 0,4%, 4-я 0,05%, с 5-й — ноль. Таблица вместо экспоненты:
///         те же числа, что заявляет Pons, и ни одного дробного вычисления.
abstract contract OpeningTax {
    /// @notice Момент запуска (время блока создания пула).
    uint256 public immutable launchedAt;
    // Окно налога — 5 секунд (шкала ниже); отдельной константы нет, чтобы
    // не раздувать байткод фабрики, в которую пул встроен целиком.
    /// @notice Сколько адресов можно освободить от налога сверх создателя.
    uint256 public constant MAX_EXEMPT = 32;

    /// @notice Освобождён от стартового налога.
    mapping(address => bool) public taxExempt;
    address[] private _exempt;

    event OpeningTaxPaid(address indexed buyer, uint256 amount, uint16 bps);
    event TaxExempted(address indexed account);

    error TooManyExempt();

    constructor(address creator_, address[] memory exempt_) {
        launchedAt = block.timestamp;
        if (exempt_.length > MAX_EXEMPT) revert TooManyExempt();
        _setExempt(creator_);
        for (uint256 i = 0; i < exempt_.length; i++) _setExempt(exempt_[i]);
    }

    // ------------------------------------------------------------- views

    /// @notice Налог прямо сейчас, bps от суммы покупки.
    function openingTaxBps() public view returns (uint16) {
        return openingTaxBpsAt(block.timestamp);
    }

    /// @notice Налог в момент `ts`, bps. Ноль с пятой секунды.
    function openingTaxBpsAt(uint256 ts) public view returns (uint16) {
        if (ts < launchedAt) return 9_900;
        uint256 s = ts - launchedAt;
        if (s == 0) return 9_900;
        if (s == 1) return 2_500;
        if (s == 2) return 300;
        if (s == 3) return 40;
        if (s == 4) return 5;
        return 0;
    }

    /// @notice Освобождённые адреса (создатель — первым).
    function exemptList() external view returns (address[] memory) {
        return _exempt;
    }

    // ------------------------------------------------------------- internal

    /// @dev Ставка налога для этой покупки, bps: ноль, если окно закрыто или
    ///      платит / получает освобождённый адрес (для покупки через зап или
    ///      фабрику важен получатель, не отправитель). Саму сумму считает пул —
    ///      у него есть точные числа после всех округлений.
    function _openingTaxBps(address payer, address recipient) internal view returns (uint16) {
        uint16 bps = openingTaxBps();
        if (bps == 0) return 0;
        if (taxExempt[recipient] || taxExempt[payer]) return 0;
        return bps;
    }

    function _setExempt(address a) private {
        if (a == address(0) || taxExempt[a]) return;
        taxExempt[a] = true;
        _exempt.push(a);
        emit TaxExempted(a);
    }
}
