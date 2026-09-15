import React from "react";
import { useProfile, socialUrl } from "../lib/profiles.js";
import Icon from "./Icon.jsx";

// Шапка человека: большой аватар, имя, соцсети. Используется в профиле и
// на странице трейдера; без профиля — иконка и заголовок по умолчанию.
export function BigAvatar({ addr, size = 64, radius = 18 }) {
  const p = useProfile(addr);
  const cls = "pf-ava";
  if (p && p.avatar) return <img className={cls} src={p.avatar} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: "cover" }} />;
  return (
    <div className={cls} aria-hidden="true" style={{ width: size, height: size, borderRadius: radius }}>
      <Icon name="user" size={Math.round(size * 0.45)} style={{ margin: 0 }} />
    </div>
  );
}

export function SocialLinks({ addr }) {
  const p = useProfile(addr);
  if (!p || !(p.x || p.telegram || p.website)) return null;
  return (
    <span className="soc-row" style={{ margin: 0, display: "inline-flex" }}>
      {p.x && <a className="soc-btn" href={socialUrl("x", p.x)} target="_blank" rel="noreferrer" title="X (Twitter)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 5.9-7zm-1.3 19.4h2L6.6 3.3H4.4l13.2 17.3z"/></svg>
      </a>}
      {p.telegram && <a className="soc-btn" href={socialUrl("telegram", p.telegram)} target="_blank" rel="noreferrer" title="Telegram">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M21.9 3.4 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18.1 6.5c.4-.4-.1-.6-.6-.2L6 13.5l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.4 2c.9-.3 1.7.2 1.5 1.4z"/></svg>
      </a>}
      {p.website && <a className="soc-btn" href={socialUrl("website", p.website)} target="_blank" rel="noreferrer" title={p.website}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.7 8.2 12s1.3 6.4 3.8 9"/></svg>
      </a>}
    </span>
  );
}
