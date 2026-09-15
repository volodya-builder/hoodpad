import React, { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { publicClient } from "../lib/web3.js";
import { dividendTokenAbi } from "../lib/abi.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Дивиденды холдерам — витрина того, ради чего монета за валюту.
 *
 * Только у монет с налогом в пользу холдеров: у ETH-монет такого механизма
 * нет, у quote-монет с нулевой ставкой показывать нечего. Суммы — в валюте
 * монеты (USDG, NVDA…), знаки берём из q.
 *
 * Данные живут в хуке useDividends: страница монеты вызывает его и
 * раскладывает цифры по карточке «О токене» — чип со ставкой, «роздано»,
 * кнопка «Забрать». Большой отдельный блок (компонент ниже) с верха
 * вкладки «Активность» убран 15.09.2026 по просьбе владельца: он
 * отодвигал ленту сделок и объяснял словами то, что видно по цифрам.
 * Компонент оставлен на случай, если где-то понадобится целиком.
 */
export function useDividends(token, wallet, q) {
  const [st, setSt] = useState(null); // { divBps, total, pot, mine, accum }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!token || !q) { setSt(null); return; }
    try {
      const [divBps, total, pot] = await Promise.all([
        publicClient.readContract({ address: token, abi: dividendTokenAbi, functionName: "divBps" }),
        publicClient.readContract({ address: token, abi: dividendTokenAbi, functionName: "totalDistributed" }),
        publicClient.readContract({ address: token, abi: dividendTokenAbi, functionName: "pot" }),
      ]);
      let mine = 0n, accum = 0n;
      if (wallet?.account) {
        [mine, accum] = await Promise.all([
          publicClient.readContract({ address: token, abi: dividendTokenAbi, functionName: "withdrawableDividendOf", args: [wallet.account] }),
          publicClient.readContract({ address: token, abi: dividendTokenAbi, functionName: "accumulativeDividendOf", args: [wallet.account] }),
        ]);
      }
      setSt({ divBps: Number(divBps), total, pot, mine, accum });
    } catch { setSt(null); } // не DividendToken — молчим
  }, [token, wallet?.account, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!q) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load, q]);

  /** Сумма в валюте монеты числом — страница переводит её в ETH и доллары. */
  const num = (v) => (q ? Number(formatUnits(v ?? 0n, q.dec)) : 0);

  /** Сумма в валюте монеты: мелочь не прячем за нулями. */
  const f = (v) => {
    if (!q) return "0";
    const n = Number(formatUnits(v, q.dec));
    if (n === 0) return "0";
    if (n < 0.01) return String(+n.toPrecision(2)); // 0.00014, а не «0.0000»
    return n.toLocaleString("ru", { maximumFractionDigits: 2 });
  };

  /** Забрать вручную (раз в час бот и так выплатит). Без кошелька — подключить. */
  const claim = async (onConnect) => {
    setErr("");
    if (!wallet) return onConnect?.();
    setBusy(true);
    try {
      const hash = await wallet.walletClient.writeContract({
        address: token, abi: dividendTokenAbi, functionName: "claim", args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (e) { setErr(String(e.shortMessage || e.message)); }
    finally { setBusy(false); }
  };

  const on = Boolean(q && st && st.divBps > 0);
  return { on, st, q, f, num, claim, busy, err, reload: load };
}

/** Полный блок — нигде не показывается с 15.09.2026, см. useDividends. */
export default function Dividends({ token, wallet, q, onConnect }) {
  const { t } = useLang();
  const d = useDividends(token, wallet, q);
  if (!d.on) return null;
  const { st, f } = d;

  return (
    <div className="dv">
      <div className="dv-head">
        <b>{t("Дивиденды холдерам")}</b>
        <span className="dv-rate">{st.divBps / 100}% {t("с каждой сделки")} · {q.sym}</span>
      </div>
      <div className="dv-grid">
        <div><span>{t("Роздано всего")}</span><b>{f(st.total)} {q.sym}</b></div>
        {wallet ? (
          <>
            <div><span>{t("Вам начислено")}</span><b>{f(st.accum)} {q.sym}</b></div>
            <div><span>{t("Ждёт вас")}</span><b className={st.mine > 0n ? "ok" : ""}>{f(st.mine)} {q.sym}</b></div>
          </>
        ) : (
          <div><span>{t("Ваша доля")}</span><b className="dim">{t("подключите кошелёк")}</b></div>
        )}
      </div>
      {st.pot > 0n && (
        <div className="dv-pot">
          {t("В копилке")} <b>{f(st.pot)} {q.sym}</b> — {t("раздастся холдерам со следующей сделкой")}
        </div>
      )}
      {wallet && (
        <button className="btn btn-primary dv-btn" disabled={d.busy || st.mine === 0n} onClick={() => d.claim(onConnect)}>
          {d.busy ? t("Забираю…") : st.mine > 0n ? `${t("Забрать")} ${f(st.mine)} ${q.sym}` : t("Пока нечего забирать")}
        </button>
      )}
      {d.err && <div className="error" style={{ marginTop: 8 }}>{d.err}</div>}
    </div>
  );
}
