import React from "react";
import { useProfile, nameOf } from "../lib/profiles.js";
import { short } from "../lib/web3.js";

// Кто это: аватар и имя из профиля или короткий адрес — ссылкой на страницу
// трейдера. Ставится везде, где раньше был short(addr).
export default function Who({ addr, size = 18, link = true, title, style, className = "" }) {
  const p = useProfile(addr);
  const name = nameOf(addr, p);
  const named = Boolean(p && p.name);
  const inner = (
    <>
      {p && p.avatar && <img className="who-ava" src={p.avatar} alt="" style={{ width: size, height: size }} loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
      <span className={named ? "who-name" : "mono"}>{name}</span>
    </>
  );
  const cls = `who ${className}`;
  if (!link) return <span className={cls} style={style} title={title || addr}>{inner}</span>;
  return <a className={cls} href={`#/trader/${addr}`} style={style} title={title || (named ? short(addr) : undefined)}>{inner}</a>;
}
