import React, { useState } from "react";
import { stockLogo } from "../lib/rwa.js";

// Значок валюты курвы (в чём дивиденды): логотип акции по тикеру, а если
// логотипа нет — кружок с первыми буквами тикера. Ставится рядом с монетой
// в списках, чтобы «за что торгуется / в чём платит» читалось без текста.
export default function QuoteLogo({ q, size = 18, withSym = false, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (!q || !q.sym) return null;
  const sym = String(q.sym).toUpperCase();
  return (
    <span className={`qlogo ${className}`} title={sym} style={{ "--qs": `${size}px` }}>
      {!broken
        ? <img src={stockLogo(sym)} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span className="qlogo-ph">{sym.slice(0, 2)}</span>}
      {withSym && <span className="qlogo-sym">{sym}</span>}
    </span>
  );
}
