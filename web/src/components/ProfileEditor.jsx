import React, { useEffect, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { publicClient } from "../lib/web3.js";
import { profileRegistryAbi } from "../lib/abi.js";
import { PROFILE_REGISTRY_ADDRESS, PROFILES_LIVE } from "../lib/config.js";
import { fileToDataUrl } from "../lib/image.js";
import { useProfile, invalidateProfile } from "../lib/profiles.js";
import Icon from "./Icon.jsx";

// Настройка своего профиля: имя, аватар, X, Telegram, сайт — одной
// транзакцией в ProfileRegistry (пишет только сам кошелёк). Аватар
// сжимается на месте до 256px и ~30 КБ, чтобы транзакция была дешёвой.
const AVA_SIZE = 256;
const AVA_BUDGET = 40_000; // символов data-URI (~30 КБ)

export default function ProfileEditor({ wallet, onDone }) {
  const { t } = useLang();
  const addr = wallet?.account;
  const cur = useProfile(addr);
  const [open, setOpen] = useState(false);
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
      const hash = clear
        ? await wallet.walletClient.writeContract({ address: PROFILE_REGISTRY_ADDRESS, abi: profileRegistryAbi, functionName: "clearProfile", args: [] })
        : await wallet.walletClient.writeContract({ address: PROFILE_REGISTRY_ADDRESS, abi: profileRegistryAbi, functionName: "setProfile",
            args: [f.name.trim().slice(0, 32), f.avatar, f.x.trim().slice(0, 120), f.telegram.trim().slice(0, 120), f.website.trim().slice(0, 200)] });
      await publicClient.waitForTransactionReceipt({ hash });
      invalidateProfile(addr);
      setOpen(false); onDone?.();
    } catch (e2) { setErr(e2.shortMessage || e2.message || String(e2)); }
    setBusy(false);
  };

  if (!open) {
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
            <input value={f.x} onChange={set("x")} maxLength={120} placeholder="X: @ник или ссылка" />
            <input value={f.telegram} onChange={set("telegram")} maxLength={120} placeholder="Telegram: @ник или ссылка" />
            <input value={f.website} onChange={set("website")} maxLength={200} placeholder={t("Сайт: https://…")} />
          </div>
        </div>
      </div>
      <div className="pe-foot">
        <span className="dim">{t("Профиль хранится в блокчейне — одна транзакция, пишет только ваш кошелёк. Пустое поле снимает значение.")}</span>
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
