// Арена hood — обёртка для сайта: реактивный хук поверх чистого ядра.
// ВСЯ логика правил живёт в arena-core.js (общая с ИИ-казначеем).
import { useEffect, useState } from "react";
import { allTrades, loadTokens } from "./data.js";
import { arenaState, buildChain, setSystemAddresses } from "./arena-core.js";
import { TREASURY_ADDRESS, FACTORY_ADDRESS } from "./config.js";

setSystemAddresses([TREASURY_ADDRESS, FACTORY_ADDRESS]);

export {
  DAY, dayStart, arenaState, podium, buildChain, grandArena, hallOfFame,
} from "./arena-core.js";

/** Реактивный хук: текущая арена (с защитой трона), тикает каждые 30с. */
/** enabled=false — арена выключена (FEATURES.arena): ни одного запроса в сеть.
 *  Раньше главная каждые 30 с тянула ВСЕ сделки платформы ради скрытой вкладки. */
export function useArena(enabled = true) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const pull = async () => {
      try {
        const [tokens, trades] = await Promise.all([loadTokens(), allTrades()]);
        if (!alive) return;
        const { chain, today } = buildChain(tokens, trades, 31);
        const todaySt = chain.get(today) ?? arenaState(tokens, trades, today);
        setSt({ ...todaySt, tokens, trades });
      } catch (e) { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);
  return st;
}
