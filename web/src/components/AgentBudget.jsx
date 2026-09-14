import React, { useEffect, useState } from "react";
import { formatEther, parseAbi } from "viem";
import { useLang } from "../lib/i18n.jsx";
import { publicClient } from "../lib/web3.js";
import { AGENT_TREASURY_ADDRESS, EXPLORER, NATIVE_SYMBOL } from "../lib/config.js";
import { useEthUsd, usd as fmtUsd } from "../lib/price.js";

/** Бюджет агента монеты: собрано, потрачено, осталось.
 *
 *  Читается прямо из AgentTreasury, а не из нашей базы. В этом весь смысл:
 *  утверждение «агент окупает себя» должно проверяться чужими глазами по
 *  блокчейну, а не приниматься на веру с нашей страницы.
 *
 *  Пока контракт не развёрнут (адрес пуст) — блок не показывается вовсе.
 *  Пустой счётчик с нулями выглядит как работающая система, которой нет.
 */

const agentTreasuryAbi = parseAbi([
  "function budget(address) view returns (uint256)",
  "function funded(address) view returns (uint256)",
  "function spent(address) view returns (uint256)",
  "function disabled(address) view returns (bool)",
]);

const eth = (v) => {
  const n = Number(formatEther(v ?? 0n));
  if (n === 0) return "0";
  return n < 0.001 ? "<0.001" : n.toFixed(n < 1 ? 4 : 3);
};

export default function AgentBudget({ token }) {
  const { t } = useLang();
  const ethUsdRate = useEthUsd();
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!AGENT_TREASURY_ADDRESS || !token) return;
    let alive = true;
    (async () => {
      try {
        const call = (fn) => publicClient.readContract({
          address: AGENT_TREASURY_ADDRESS, abi: agentTreasuryAbi, functionName: fn, args: [token],
        });
        const [budget, funded, spent, disabled] = await Promise.all([
          call("budget"), call("funded"), call("spent"), call("disabled"),
        ]);
        if (alive) setD({ budget, funded, spent, disabled });
      } catch { if (alive) setD(null); }
    })();
    return () => { alive = false; };
  }, [token]);

  if (!AGENT_TREASURY_ADDRESS || !d) return null;

  // Счета за модели приходят в долларах, поэтому остаток полезнее видеть
  // в них же. Курс может не прийти — тогда строки просто не будет.
  const usdLeft = ethUsdRate ? Number(formatEther(d.budget)) * ethUsdRate : null;

  return (
    <div className="abg">
      <div className="abg-head">
        <span className="abg-t">{t("Бюджет агента")}</span>
        {d.disabled && <span className="abg-off">{t("выключен")}</span>}
      </div>

      <div className="abg-row">
        <div>
          <b>{eth(d.budget)}</b>
          <span>{t("осталось")}{NATIVE_SYMBOL ? `, ${NATIVE_SYMBOL}` : ""}</span>
        </div>
        <div>
          <b>{eth(d.funded)}</b>
          <span>{t("собрано всего")}</span>
        </div>
        <div>
          <b>{eth(d.spent)}</b>
          <span>{t("потрачено")}</span>
        </div>
      </div>

      {usdLeft !== null && usdLeft > 0 && (
        <div className="abg-usd">≈ {fmtUsd(usdLeft)}</div>
      )}

      <div className="abg-note">
        {t("Пополняется из комиссий этой монеты. Тратится на вызовы моделей. Обе стороны — в блокчейне.")}
        {EXPLORER && (
          <>{" "}<a href={`${EXPLORER}/address/${AGENT_TREASURY_ADDRESS}`} target="_blank" rel="noreferrer noopener">
            {t("проверить")} →
          </a></>
        )}
      </div>
    </div>
  );
}
