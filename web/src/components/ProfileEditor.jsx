import React, { useEffect, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { PROFILES_LIVE } from "../lib/config.js";
import { fileToDataUrl } from "../lib/image.js";
import { useProfile, saveProfile } from "../lib/profiles.js";
import Icon from "./Icon.jsx";

// Настройка своего профиля: имя, аватар, X, Telegram, сайт — бесплатно,
// одной подписью кошелька (без транзакции и газа; см. lib/profiles.js).
// Аватар сжимается на месте до 256px и ~30 КБ.
const AVA_SIZE = 256;
const AVA_BUDGET = 40_000; // символов data-URI (~30 КБ)

export default function ProfileEditor({ wallet, onDone, open: openProp, onOpenChange, noTrigger }) {
  const { t } = useLang();
  const addr = wallet?.account;
  const cur = useProfile(addr);
  const [openS, setOpenS] = useState(false);
  // Открытием может управлять родитель (страница профиля: клик по аватарке)
  const open = openProp ?? openS;
  const setOpen = (v) => { setOpenS(v); onOpenChange?.(v); };
  const [f, setF] = useState({ name: "", avatar: "", x: "", telegram: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (cur) setF({ name: cur.name || "", avatar: cur.avatar || "", x: cur.x || "", telegram: cur.telegram || "", website: cur.website || "" });
  }, [cur?.at]); // eslint-disable-line

  if (!PROFILES_LIVE) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { setF({ ...f, avatar: await fileToDataUrl(file, { size: AVA_SIZE, budget: AVA_BUDGET }) }); setErr(""); }
    catch (e2) { setErr(t("Не удалось прочитать картинку.")); }
  };
  const save = async (clear = false) => {
    if (!wallet?.walletClient) return;
    setBusy(true); setErr("");
    try {
      await saveProfile(wallet, clear ? { name: "", avatar: "", x: "", telegram: "", website: "" } : f);
      setOpen(false); onDone?.();
    } catch (e2) { setErr(e2.shortMessage || e2.message || String(e2)); }
    setBusy(false);
  };

  if (!open) {
    if (noTrigger) return null;
    return (
      <button className="btn pe-open" onClick={() => setOpen(true)}>
        <Icon name="user" size={14} /> {cur && cur.name ? t("Изменить профиль") : t("Настроить профиль")}
      </button>
    );
  }
  return (
    <div className="pe">
      <div className="pe-row">
        <label className="pe-ava" title={t("Загрузить аватар")}>
          {f.avatar ? <img src={f.avatar} alt="" /> : <Icon name="image" size={22} style={{ margin: 0 }} />}
          <input type="file" accept="image/*" onChange={onFile} hidden />
          <span className="pe-ava-hint">{t("аватар")}</span>
        </label>
        <div className="pe-fields">
          <input value={f.name} onChange={set("name")} maxLength={32} placeholder={t("Имя (до 32 символов)")} />
          <div className="pe-grid">
            <input value={f.x} onChange={set("x")} maxLength={120} placeholder={t("X: @ник или ссылка")} />
            <input value={f.telegram} onChange={set("telegram")} maxLength={120} placeholder={t("Telegram: @ник или ссылка")} />
            <input value={f.website} onChange={set("website")} maxLength={200} placeholder={t("Сайт: https://…")} />
          </div>
        </div>
      </div>
      <div className="pe-foot">
        <span className="dim">{t("Бесплатно: кошелёк только подписывает, без транзакции и комиссии. Пустое поле снимает значение.")}</span>
        <div className="pe-btns">
          {cur && <button className="btn" disabled={busy} onClick={() => save(true)}>{t("Стереть")}</button>}
          <button className="btn" disabled={busy} onClick={() => setOpen(false)}>{t("Отмена")}</button>
          <button className="btn btn-primary" disabled={busy || (!f.name.trim() && !f.avatar && !f.x && !f.telegram && !f.website)} onClick={() => save(false)}>
            {busy ? t("Подпишите в кошельке…") : t("Сохранить")}
          </button>
        </div>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
