import React, { useEffect, useState } from "react";
import { formatEther, formatUnits, parseAbi } from "viem";
import { useLang } from "../lib/i18n.jsx";
import { publicClient } from "../lib/web3.js";
import { AGENT_TREASURY_ADDRESS, EXPLORER, NATIVE_SYMBOL } from "../lib/config.js";
import { useEthUsd, useQuoteUsd, moneyEth } from "../lib/price.js";

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
  "function budgetErc20(address, address) view returns (uint256)",
  "function fundedErc20(address, address) view returns (uint256)",
  "function spentErc20(address, address) view returns (uint256)",
]);

/** quote — валюта кривой у монет за валюту ({ addr, sym, dec }): их агент
 *  получает бюджет в ней, а не в ETH. Для ETH-монет — null. */
export default function AgentBudget({ token, quote = null }) {
  const { t } = useLang();
  const ethUsdRate = useEthUsd();
  const quoteRate = useQuoteUsd(quote?.addr);
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!AGENT_TREASURY_ADDRESS || !token) return;
    let alive = true;
    (async () => {
      try {
        const call = (fn, args) => publicClient.readContract({
          address: AGENT_TREASURY_ADDRESS, abi: agentTreasuryAbi, functionName: fn, args,
        });
        const [budget, funded, spent, disabled] = quote
          ? await Promise.all([
              call("budgetErc20", [token, quote.addr]), call("fundedErc20", [token, quote.addr]),
              call("spentErc20", [token, quote.addr]), call("disabled", [token]),
            ])
          : await Promise.all([
              call("budget", [token]), call("funded", [token]), call("spent", [token]), call("disabled", [token]),
            ]);
        if (alive) setD({ budget, funded, spent, disabled });
      } catch { if (alive) setD(null); }
    })();
    return () => { alive = false; };
  }, [token, quote?.addr]);

  if (!AGENT_TREASURY_ADDRESS || !d) return null;

  // Бюджет копится в валюте монеты (ETH или USDG/AAPL), а показываем его в
  // ETH и долларах — как все деньги на сайте (решение владельца 15.09.2026).
  const num = (v) => Number(quote ? formatUnits(v ?? 0n, quote.dec) : formatEther(v ?? 0n));
  const show = (v) => moneyEth(num(v), quote ? quoteRate : ethUsdRate, ethUsdRate);
  const SYM = "";

  return (
    <div className="abg">
      <div className="abg-head">
        <span className="abg-t">{t("Бюджет агента")}</span>
        {d.disabled && <span className="abg-off">{t("выключен")}</span>}
      </div>

      <div className="abg-row">
        <div>
          <b>{show(d.budget)}</b>
          <span>{t("осталось")}{SYM ? `, ${SYM}` : ""}</span>
        </div>
        <div>
          <b>{show(d.funded)}</b>
          <span>{t("собрано всего")}</span>
        </div>
        <div>
          <b>{show(d.spent)}</b>
          <span>{t("потрачено")}</span>
        </div>
      </div>


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
