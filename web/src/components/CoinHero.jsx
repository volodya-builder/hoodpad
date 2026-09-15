import React, { useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { short } from "../lib/web3.js";
import { modelLogo, makerOf } from "../lib/models.mjs";
import { useFavs, toggleFav } from "../lib/favs.js";
import Socials from "./Socials.jsx";
import Icon from "./Icon.jsx";

/** Шапка выбранной монеты во вкладке «ИИ»: большой логотип, имя, тикер,
 *  модель ИИ, соцсети, адрес с копированием и звёздочка избранного —
 *  как на странице монеты (просьба владельца 15.09.2026). Справа — кнопка
 *  смены монеты (picker). x — элемент списка монет с главной. */
export default function CoinHero({ x, aiOn, picker }) {
  const { t } = useLang();
  const favs = useFavs();
  const [copied, setCopied] = useState(false);
  const [badImg, setBadImg] = useState(false);
  if (!x) return <div className="coin-hero">{picker}</div>;
  const addr = x.token;
  const meta = x.meta || {};
  const aiId = String(meta.ai || "").trim();
  const aiMaker = makerOf(aiId);
  const fav = favs.has(addr);
  const copy = async () => {
    try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* буфер недоступен */ }
  };
  return (
    <div className="coin-hero">
      <span className={`tok-star ${fav ? "on" : ""}`} onClick={() => toggleFav(addr)} title={t(fav ? "Убрать из избранного" : "В избранное")}>
        {fav ? "★" : "☆"}
      </span>
      <a className="coin-hero-logo" href={`#/token/${addr}`} title={t("Страница монеты")}>
        {meta.image && !badImg
          ? <img src={meta.image} alt="" onError={() => setBadImg(true)} />
          : <span className="coin-hero-ph"><Icon name="image" size={34} style={{ margin: 0 }} /></span>}
      </a>
      <div className="coin-hero-body">
        <div className="coin-hero-row">
          <a className="coin-hero-name" href={`#/token/${addr}`}>{x.name}</a>
          <span className="ticker">${x.symbol}</span>
          {aiMaker && (
            <span className={`badge tk-ai ${aiOn === false ? "off" : ""}`}
                  title={aiOn === false ? t("ИИ не включён: создатель не подписал включение. Агент на монету не работает.") : `${t("ИИ этой монеты работает на этой модели")}: ${aiId.slice(0, 80)}`}>
              <img className="q-logo" src={modelLogo(aiId)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              {String(meta.aiName || aiId.split("/")[1] || aiId).slice(0, 28)}
              {aiOn === false && <span className="dim">{" · "}{t("не включён")}</span>}
            </span>
          )}
          <Socials meta={meta} />
        </div>
        <div className="coin-hero-sub">
          <span className="mono th-addr" style={{ marginTop: 0 }} onClick={copy} title={t("Скопировать адрес")}>{short(addr)} {copied ? "✓" : "⧉"}</span>
          <a className="coin-hero-link" href={`#/token/${addr}`}>{t("Страница монеты")} →</a>
        </div>
      </div>
      <div className="coin-hero-pick">{picker}</div>
    </div>
  );
}
