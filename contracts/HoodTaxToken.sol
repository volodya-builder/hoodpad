// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title HoodTaxToken — tax-токен hood (v1, аналог flap tax token)
/// @notice ERC20 с налогом на сделки через отмеченные пулы (курва/AMM):
///         покупка и продажа облагаются раздельными ставками (до 10%).
///         Собранный налог делится по зашитой при деплое аллокации:
///           • mktBps  — кошельку создателя (дев/маркетинг), сразу;
///           • burnBps — сжигается, сразу (дефляция);
///           • divBps  — дивиденды холдерам в самом токене (клейм);
///           • lpBps   — копится на контракте под ликвидность, flushLp()
///                       отправляет накопленное в lpSink (казна/локер).
///         Право на дивиденды: баланс >= minShare и адрес не исключён.
///         Аллокация и ставки неизменяемы. Controller (фабрика) может только
///         отмечать пулы и отказаться от роли (renounce) — никаких минтов,
///         пауз и чёрных списков.
/// @dev    Дивиденды — классический magnified-per-share, но поверх «теневого»
///         дивидендного баланса: divBalance = balance, если адрес имеет право,
///         иначе 0. Это даёт честный учёт порога minShare без циклов по холдерам.
contract HoodTaxToken is ERC20 {
    uint256 private constant MAG = 2 ** 128;
    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_TAX_BPS = 1_000; // 10%

    struct TaxConfig {
        uint16 buyTaxBps;
        uint16 sellTaxBps;
        uint16 mktBps;   // доля налога кошельку создателя
        uint16 burnBps;  // доля налога на сжигание
        uint16 divBps;   // доля налога в дивиденды
        uint16 lpBps;    // доля налога в ликвидность
        uint256 minShare; // мин. баланс для права на дивиденды
    }

    uint16 public immutable buyTaxBps;
    uint16 public immutable sellTaxBps;
    uint16 public immutable mktBps;
    uint16 public immutable burnBps;
    uint16 public immutable divBps;
    uint16 public immutable lpBps;
    uint256 public immutable minShare;

    address public immutable creatorWallet;
    address public immutable lpSink;
    address public controller; // фабрика; может отметить пулы и отречься

    string public metadataURI;

    mapping(address => bool) public taxedPools;  // курва + AMM-пулы
    mapping(address => bool) public taxExempt;   // не платят налог (инфраструктура)

    // --- дивиденды (в самом токене) поверх теневого баланса
    uint256 public magnifiedDividendPerShare;
    uint256 public divSupply;                    // сумма теневых балансов
    uint256 public lpReserve;                    // токены, накопленные под ликвидность
    mapping(address => uint256) public divBalance;
    mapping(address => int256) private corrections;
    mapping(address => uint256) public withdrawn;

    bool private _inTax; // защита от рекурсии внутренних переводов налога

    event PoolSet(address indexed pool, bool taxed);
    event TaxTaken(address indexed payer, uint256 amount, bool isBuy);
    event DividendsDistributed(uint256 amount);
    event DividendClaimed(address indexed holder, uint256 amount);
    event LpFlushed(uint256 amount);
    event ControllerRenounced();

    modifier onlyController() {
        require(msg.sender == controller, "not controller");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address mintTo,
        uint256 totalSupply_,
        address creatorWallet_,
        address lpSink_,
        TaxConfig memory cfg
    ) ERC20(name_, symbol_) {
        require(cfg.buyTaxBps <= MAX_TAX_BPS && cfg.sellTaxBps <= MAX_TAX_BPS, "tax > 10%");
        require(cfg.mktBps + cfg.burnBps + cfg.divBps + cfg.lpBps == BPS, "alloc != 100%");
        require(creatorWallet_ != address(0) && lpSink_ != address(0), "zero addr");

        metadataURI = metadataURI_;
        buyTaxBps = cfg.buyTaxBps;
        sellTaxBps = cfg.sellTaxBps;
        mktBps = cfg.mktBps;
        burnBps = cfg.burnBps;
        divBps = cfg.divBps;
        lpBps = cfg.lpBps;
        minShare = cfg.minShare;
        creatorWallet = creatorWallet_;
        lpSink = lpSink_;
        controller = msg.sender;

        // инфраструктура не платит налог и не участвует в дивидендах
        taxExempt[address(this)] = true;
        taxExempt[creatorWallet_] = true;
        taxExempt[lpSink_] = true;
        taxExempt[msg.sender] = true;

        _mint(mintTo, totalSupply_);
    }

    // ---------------------------------------------------------------- admin

    function setPool(address pool, bool taxed) external onlyController {
        require(pool != address(0), "zero pool");
        taxedPools[pool] = taxed;
        _refreshDivBalance(pool);
        emit PoolSet(pool, taxed);
    }

    function renounceController() external onlyController {
        controller = address(0);
        emit ControllerRenounced();
    }

    // ---------------------------------------------------------------- tax core

    function _update(address from, address to, uint256 value) internal override {
        // внутренние переводы налога и mint/burn — без повторного налога
        if (_inTax || from == address(0) || to == address(0)) {
            super._update(from, to, value);
            _afterMove(from, to);
            return;
        }

        bool isBuy = taxedPools[from];
        bool isSell = taxedPools[to];
        bool exempt = taxExempt[from] || taxExempt[to];

        if ((isBuy || isSell) && !exempt) {
            uint16 rate = isBuy ? buyTaxBps : sellTaxBps;
            uint256 fee = (value * rate) / BPS;
            if (fee > 0) {
                _inTax = true;
                super._update(from, to, value - fee);
                super._update(from, address(this), fee);
                // регистрируем участников ДО раздачи: покупатель этой же сделки
                // участвует в дивидендах с её налога (если проходит порог)
                _afterMove(from, to);

                uint256 toBurn = (fee * burnBps) / BPS;
                uint256 toMkt = (fee * mktBps) / BPS;
                uint256 toDiv = (fee * divBps) / BPS;
                // остаток (включая пыль округления) — в ликвидность
                uint256 toLp = fee - toBurn - toMkt - toDiv;

                if (toBurn > 0) _burn(address(this), toBurn);
                if (toMkt > 0) super._update(address(this), creatorWallet, toMkt);
                if (toDiv > 0) _distribute(toDiv);
                lpReserve += toLp;
                _inTax = false;

                emit TaxTaken(isBuy ? to : from, fee, isBuy);
                return; // _afterMove уже выполнен выше
            }
        }

        super._update(from, to, value);
        _afterMove(from, to);
    }

    /// @dev Дивидендная доля налога: если есть кому раздавать — увеличиваем
    ///      счётчик на акцию; если правомочных холдеров нет — в ликвидность.
    function _distribute(uint256 amount) private {
        if (divSupply == 0) {
            lpReserve += amount;
            return;
        }
        magnifiedDividendPerShare += (amount * MAG) / divSupply;
        emit DividendsDistributed(amount);
    }

    // ---------------------------------------------------------------- dividends

    function _eligible(address a) private view returns (bool) {
        return !taxExempt[a] && !taxedPools[a] && a != address(this) && balanceOf(a) >= minShare;
    }

    /// @dev Пересчёт теневого дивидендного баланса адреса после изменения его
    ///      обычного баланса (или статуса). Коррекции — как в классической
    ///      magnified-схеме, чтобы прошлое не переписывалось.
    function _refreshDivBalance(address a) private {
        if (a == address(0)) return;
        uint256 nb = _eligible(a) ? balanceOf(a) : 0;
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

    function _afterMove(address from, address to) private {
        _refreshDivBalance(from);
        _refreshDivBalance(to);
    }

    function accumulativeDividendOf(address a) public view returns (uint256) {
        return uint256(int256(magnifiedDividendPerShare * divBalance[a]) + corrections[a]) / MAG;
    }

    function withdrawableDividendOf(address a) public view returns (uint256) {
        return accumulativeDividendOf(a) - withdrawn[a];
    }

    /// @notice Забрать накопленные дивиденды (в этом токене).
    function claim() external returns (uint256 amount) {
        amount = withdrawableDividendOf(msg.sender);
        if (amount > 0) {
            withdrawn[msg.sender] += amount;
            _inTax = true;
            super._update(address(this), msg.sender, amount);
            _inTax = false;
            _refreshDivBalance(msg.sender);
            emit DividendClaimed(msg.sender, amount);
        }
    }

    // ---------------------------------------------------------------- lp

    /// @notice Отправить накопленную ликвидностную долю в lpSink. Может любой.
    function flushLp() external {
        uint256 amount = lpReserve;
        require(amount > 0, "nothing to flush");
        lpReserve = 0;
        _inTax = true;
        super._update(address(this), lpSink, amount);
        _inTax = false;
        emit LpFlushed(amount);
    }
}
