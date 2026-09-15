import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { modelLogo, makerOf } from "../lib/models.mjs";
import Icon from "./Icon.jsx";

// Выбор монеты с поиском и картинками — вместо голого <select> на вкладке
// «ИИ» (просьба владельца 15.09.2026). Кнопка показывает выбранную монету
// (логотип, тикер, имя, модель ИИ); по клику — окно с поиском по тикеру,
// имени и адресу и списком: монеты с включённым ИИ первыми.
//
// tokens — список с главной (token, symbol, name, meta.image, meta.ai,
// meta.aiName, aiOn); value — адрес выбранной; onChange(адрес).

function Logo({ src, size = 30 }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span className="cp-logo cp-logo-ph" style={{ width: size, height: size }}><Icon name="image" size={Math.round(size * 0.5)} style={{ margin: 0 }} /></span>;
  return <img className="cp-logo" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} />;
}

function AiChip({ x, t }) {
  const id = String(x.meta?.ai || "");
  if (!id || !makerOf(id)) return <span className="cp-ai off">{t("без ИИ")}</span>;
  const name = String(x.meta?.aiName || id.split("/")[1] || id).slice(0, 22);
  return (
    <span className={`cp-ai ${x.aiOn ? "on" : "off"}`} title={x.aiOn ? t("ИИ включён") : t("ИИ не включён создателем")}>
      <img src={modelLogo(id)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      {name}
    </span>
  );
}

export default function CoinPicker({ tokens, value, onChange }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);
  const list = tokens || [];
  const cur = list.find((x) => x.token.toLowerCase() === String(value || "").toLowerCase()) || null;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? list.filter((x) => `$${x.symbol}`.toLowerCase().includes(s) || String(x.symbol).toLowerCase().includes(s)
          || String(x.name || "").toLowerCase().includes(s) || x.token.toLowerCase().includes(s))
      : list;
    return base.slice(0, 60);
  }, [list, q]);

  useEffect(() => { if (open) { setQ(""); setHi(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (x) => { onChange?.(x.token); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
  };
  const aiCount = list.filter((x) => x.aiOn).length;

  return (
    <div className={`cp ${open ? "open" : ""}`} ref={wrap}>
      <button type="button" className="cp-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {cur ? (<>
          <Logo src={cur.meta?.image} />
          <span className="cp-cur"><b>${cur.symbol}</b><span className="cp-name">{cur.name}</span></span>
          <AiChip x={cur} t={t} />
        </>) : (
          <span className="cp-cur"><b>{t("Выберите монету")}</b></span>
        )}
        <span className="cp-chev"><Icon name="chevron" size={14} style={{ margin: 0 }} /></span>
      </button>

      {open && (
        <div className="cp-pop" role="listbox">
          <div className="cp-search">
            <Icon name="search" size={14} style={{ margin: 0 }} />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                   placeholder={t("Тикер, название или адрес…")} spellCheck={false} />
            <span className="cp-count">{list.length} · {aiCount} {t("с ИИ")}</span>
          </div>
          <div className="cp-list">
            {shown.length === 0 && <div className="cp-empty">{t("Ничего не найдено")}</div>}
            {shown.map((x, i) => (
              <button type="button" key={x.token}
                      className={`cp-row ${cur && cur.token === x.token ? "sel" : ""} ${i === hi ? "hi" : ""}`}
                      onMouseEnter={() => setHi(i)} onClick={() => pick(x)}>
                <Logo src={x.meta?.image} size={34} />
                <span className="cp-cur"><b>${x.symbol}</b><span className="cp-name">{x.name}</span></span>
                <AiChip x={x} t={t} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
