import React, { useEffect, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { listWallets, missingWallets, isMobile } from "../lib/web3.js";

// ============================================================================
//  Окно «Подключить кошелёк» (17.09.2026, просьба владельца: «чтоб все
//  кошельки можно было выбирать, включая Ledger»).
//
//  Три группы:
//   1. Установлены — расширения, которые объявились по EIP-6963 (MetaMask,
//      OKX, Rabby, Phantom…), с их собственными иконками. Клик — подключение.
//   2. Другие — известные кошельки, которых в браузере нет: на компьютере
//      «Установить», на телефоне «Открыть в приложении» (deep link).
//  Ledger — отдельная подсказка: аппаратный кошелёк подключают через
//  MetaMask / OKX / Rabby (там он как аккаунт) или через WalletConnect
//  из Ledger Live. Выбор запоминается; сменить — в меню кошелька.
//  Это ЗАПАСНОЕ окно: с Project ID (WC_PROJECT_ID) сайт показывает полное
//  окно Reown AppKit (lib/appkit.js) — реестр 540+ кошельков, QR, поиск.
// ============================================================================

const Tile = ({ icon, name }) => icon
  ? <img className="wm-ico" src={icon} alt="" />
  : <span className="wm-ico wm-ico-ph">{(name || "?").slice(0, 1)}</span>;

export default function WalletModal({ open, onClose, onPick, busy }) {
  const { t } = useLang();
  const [tick, setTick] = useState(0);
  const [ledger, setLedger] = useState(false);
  // расширения объявляются асинхронно — пару раз перечитаем список после открытия
  useEffect(() => {
    if (!open) return;
    setLedger(false);
    const a = setTimeout(() => setTick((x) => x + 1), 300);
    const b = setTimeout(() => setTick((x) => x + 1), 1200);
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(a); clearTimeout(b); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;

  const installed = listWallets();
  const missing = missingWallets();
  const mobile = isMobile();

  return (
    <div className="modal-back open" onClick={onClose}>
      <div className="tos-modal wm" onClick={(e) => e.stopPropagation()} data-tick={tick}>
        <div className="tos-body">
          <div className="wm-head">
            <h2 className="tos-title">{t("Подключить кошелёк")}</h2>
            <button type="button" className="wm-x" onClick={onClose} aria-label={t("Закрыть")}>×</button>
          </div>

          {installed.length > 0 && (
            <div className="wm-group">
              <div className="wm-k">{t("Установлены")}</div>
              {installed.map((w) => (
                <button type="button" className="wm-item" key={w.rdns} disabled={!!busy} onClick={() => onPick(w.rdns)}>
                  <Tile icon={w.icon} name={w.name} />
                  <span className="wm-name">{w.name}</span>
                  <span className="wm-chip">{busy === w.rdns ? t("Подключение…") : t("Установлен")}</span>
                </button>
              ))}
            </div>
          )}
          {installed.length === 0 && !mobile && (
            <div className="wm-empty">{t("Кошельки в браузере не найдены.")}</div>
          )}


          <div className="wm-group">
            <div className="wm-k">{t("Другие кошельки")}</div>
            {missing.map((k) => {
              const href = mobile && k.mobile ? k.mobile() : k.install;
              return (
                <a className="wm-item" key={k.id} href={href} target={mobile && k.mobile ? "_self" : "_blank"} rel="noreferrer">
                  <Tile icon="" name={k.name} />
                  <span className="wm-name">{k.name}</span>
                  <span className="wm-chip dim">{mobile && k.mobile ? t("Открыть в приложении") : t("Установить")}</span>
                </a>
              );
            })}
            <button type="button" className={`wm-item ${ledger ? "on" : ""}`} onClick={() => setLedger(!ledger)}>
              <Tile icon="" name="Ledger" />
              <span className="wm-name">Ledger</span>
              <span className="wm-chip dim">{t("Как подключить")}</span>
            </button>
            {ledger && (
              <div className="wm-help">
                {t("Ledger подключается через MetaMask, OKX Wallet или Rabby: в расширении «Добавить аппаратный кошелёк» → Ledger, затем выберите это расширение здесь. Либо через WalletConnect из Ledger Live.")}
              </div>
            )}
          </div>

          <div className="wm-foot">{t("Выбор запомним — сменить можно в меню кошелька.")}</div>
        </div>
      </div>
    </div>
  );
}
