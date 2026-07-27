// Арена hood — обёртка для сайта: реактивный хук поверх чистого ядра.
// ВСЯ логика правил живёт в arena-core.js (общая с ИИ-казначеем).
import { useEffect, useState } from "react";
import { allTrades, loadTokens } from "./data.js";
import { arenaState, buildChain } from "./arena-core.js";

export {
  DAY, dayStart, arenaState, podium, buildChain, grandArena, hallOfFame,
} from "./arena-core.js";

/** Реактивный хук: текущая арена (с защитой трона), тикает каждые 30с. */
export function useArena() {
  const [st, setSt] = useState(null);
  useEffect(() => {
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
  }, []);
  return st;
}
