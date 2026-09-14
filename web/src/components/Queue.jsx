import React, { useEffect, useState } from "react";
import { loadTokens } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { short } from "../lib/web3.js";
import { loadHistory, roundStart, roundEnd } from "../lib/workshop.js";

const d = (ms) => {
  const x = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}`;
};

/** Победители завершённых раундов по всем монетам — очередь работ агента. */
export default function Queue() {
  const { t } = useLang();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tokens = await loadTokens();
        const out = [];
        // Последовательно и понемногу: каждая монета — это чтение базы
        // и пересчёт голосов, параллелить их незачем.
        for (const tk of (tokens || []).slice(0, 30)) {
          const hist = await loadHistory(tk.token, 4);
          for (const h of hist) out.push({ ...h, tk });
        }
        out.sort((a, b) => b.id - a.id);
        if (alive) setRows(out);
      } catch { if (alive) setRows([]); }
    })();
    return () => { alive = false; };
  }, []);

  if (rows === null) return <div className="ai-empty">{t("Считаю итоги раундов…")}</div>;
  if (!rows.length) {
    return (
      <div className="ai-empty">
        {t("Очередь пуста: ни один раунд ещё не завершился победителем. Первый появится здесь, как только неделя закроется с голосами.")}
      </div>
    );
  }

  return (
    <div className="q-list">
      {rows.map((r) => (
        <div className="q-item" key={`${r.tk.token}-${r.id}`}>
          <div className="q-top">
            <a className="q-tk" href={`#/token/${r.tk.token}`}>
              {r.tk.meta && r.tk.meta.image && <img src={r.tk.meta.image} alt="" />}
              <span>${r.tk.symbol}</span>
            </a>
            <span className="q-when">{d(roundStart(r.id))} — {d(roundEnd(r.id))}</span>
            <span className="q-wait">{t("ждёт агента")}</span>
          </div>
          <div className="q-text">{r.winner.text}</div>
          <div className="q-meta">
            <span>{r.pct.toFixed(1)}% {t("голосов")}</span>
            <span className="dim">{r.voters} {t("участников")} · {t("предложил")} {short(r.winner.by)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
