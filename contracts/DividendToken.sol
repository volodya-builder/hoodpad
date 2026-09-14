// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DividendToken
/// @notice Токен монеты, у которой холдерам капает валюта курвы.
///
///         Как у flap: создатель при запуске выбирает налог (0–3%), и с
///         каждой сделки на кривой эта доля берётся В ВАЛЮТЕ МОНЕТЫ (USDG,
///         NVDA, WETH — за что она торгуется) и делится между холдерами
///         пропорционально балансу. Держишь — капает, продал — перестало.
///         Свопов нет: валюта уже та, что надо, и её нечем нагнуть.
///
///         Сам токен — обычный ERC20 без владельца, минта, паузы и чёрных
///         списков. Единственная привилегия — у пула кривой: только он
///         вносит дивиденды и только он может исключить адрес из раздачи
///         (и делает это ровно для DEX-пула после градации).
///
/// @dev    Учёт — классический magnified-per-share поверх «дивидендного
///         баланса»: divBalance = balance для обычных адресов и 0 для
///         исключённых (пул кривой держит нераспроданный сапплай и получать
///         с него дивиденды не должен). Тот же приём, что в HoodTaxToken.
///
///         Раздача идёт, только когда дивидендных долей не меньше
///         MIN_DIV_SUPPLY: при крошечном divSupply perShare улетает в такие
///         числа, что произведение perShare × balance не влезает в int256, и
///         переводы встают навсегда. Пока долей мало, налог копится в pot и
///         раздаётся первой же нормальной сделкой.
contract DividendToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant MAG = 2 ** 128;
    /// @dev 1000 токенов = 0.0001% сапплая. Любая ненулевая покупка даёт
    ///      на порядки больше; это защита от dust, не порог для людей.
    uint256 public constant MIN_DIV_SUPPLY = 1_000e18;

    /// @notice Off-chain метадата (картинка, описание, соцсети) — неизменяема.
    string public metadataURI;

    address public immutable pool;
    IERC20  public immutable quote;
    /// @notice Налог на сделки кривой в пользу холдеров, в bps (100 = 1%).
    uint16  public immutable divBps;

    // ------------------------------------------------------------- state
    mapping(address => bool) public excluded;
    mapping(address => uint256) public divBalance;
    mapping(address => int256) private corrections;
    mapping(address => uint256) public withdrawn;

    uint256 public divSupply;
    uint256 public magnifiedDividendPerShare;
    /// @notice Налог, собранный, пока раздавать было некому. Уйдёт первой
    ///         же раздачей.
    uint256 public pot;
    /// @notice Всего роздано за жизнь монеты (для витрины).
    uint256 public totalDistributed;

    event DividendsDistributed(uint256 amount);
    event DividendClaimed(address indexed holder, uint256 amount);
    event Excluded(address indexed account, bool excluded);

    error NotPool();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address pool_,
        address quote_,
        uint16  divBps_,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) {
        require(pool_ != address(0) && quote_ != address(0), "zero addr");
        require(divBps_ <= 300, "div>3%");
        metadataURI = metadataURI_;
        pool = pool_;
        quote = IERC20(quote_);
        divBps = divBps_;
        // Пул держит сапплай — из раздачи исключён с первой секунды.
        excluded[pool_] = true;
        excluded[address(this)] = true;
        _mint(pool_, totalSupply_);
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    // ------------------------------------------------------------- pool

    /// @notice Пул внёс налог: валюта уже переведена на этот контракт, здесь
    ///         только учёт. Зовёт только пул, до перевода токенов покупателю
    ///         (на покупке) и после перевода токенов от продавца (на продаже):
    ///         свой же налог участнику сделки не достаётся.
    function notifyDividend(uint256 amount) external onlyPool {
        if (amount == 0 && pot == 0) return;
        if (divSupply < MIN_DIV_SUPPLY) {
            pot += amount;
            return;
        }
        uint256 total = amount + pot;
        pot = 0;
        magnifiedDividendPerShare += (total * MAG) / divSupply;
        totalDistributed += total;
        emit DividendsDistributed(total);
    }

    /// @notice Исключить адрес из раздачи (или вернуть). Только пул, и пул
    ///         зовёт это ровно раз — для DEX-пула после градации: иначе
    ///         ликвидность, запертая навсегда, копила бы дивиденды, которые
    ///         никто никогда не заберёт.
    function setExcluded(address account, bool value) external onlyPool {
        if (account == address(0) || excluded[account] == value) return;
        excluded[account] = value;
        _refreshDivBalance(account);
        emit Excluded(account, value);
    }

    // ------------------------------------------------------------- holders

    function accumulativeDividendOf(address a) public view returns (uint256) {
        return uint256(int256(magnifiedDividendPerShare * divBalance[a]) + corrections[a]) / MAG;
    }

    function withdrawableDividendOf(address a) public view returns (uint256) {
        return accumulativeDividendOf(a) - withdrawn[a];
    }

    /// @notice Забрать накопленное — в валюте монеты, себе на кошелёк.
    function claim() external nonReentrant returns (uint256 amount) {
        return _claim(msg.sender);
    }

    /// @notice Выплатить холдеру его накопленное. Звать может кто угодно —
    ///         деньги всё равно уходят только самому холдеру. Это для бота
    ///         автовыплат: людям не нужно жать «забрать».
    function claimFor(address holder) external nonReentrant returns (uint256 amount) {
        return _claim(holder);
    }

    function _claim(address holder) private returns (uint256 amount) {
        amount = withdrawableDividendOf(holder);
        if (amount == 0) return 0;
        withdrawn[holder] += amount;
        quote.safeTransfer(holder, amount);
        emit DividendClaimed(holder, amount);
    }

    // ------------------------------------------------------------- accounting

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        _refreshDivBalance(from);
        _refreshDivBalance(to);
    }

    /// @dev Пересчёт дивидендного баланса после изменения обычного. Коррекции —
    ///      чтобы уже розданное не переписывалось задним числом.
    function _refreshDivBalance(address a) private {
        if (a == address(0)) return;
        uint256 nb = excluded[a] ? 0 : balanceOf(a);
        uint256 ob = divBalance[a];
        if (nb == ob) return;
        if (nb > ob) {
            corrections[a] -= int256(magnifiedDividendPerShare * (nb - ob));
            divSupply += nb - ob;
        } else {
            corrections[a] += int256(magnifiedDividendPerShare * (ob - nb));
            divSupply -= ob - nb;
        }
        divBalance[a] = nb;
    }
}
