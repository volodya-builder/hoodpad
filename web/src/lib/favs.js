// Избранные токены: один общий список для всего сайта (localStorage)
// + мгновенная синхронизация между всеми компонентами через событие.
import { useEffect, useState } from "react";

const LS = "hood_favs";
const EVT = "hood-favs-changed";

export function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(LS) || "[]")); }
  catch (e) { return new Set(); }
}

export function toggleFav(addr) {
  const next = loadFavs();
  if (next.has(addr)) next.delete(addr); else next.add(addr);
  try { localStorage.setItem(LS, JSON.stringify([...next])); } catch (e) { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch (e) { /* ignore */ }
  return next;
}

/** Реактивный список избранного: обновляется в любой вкладке и в любом блоке. */
export function useFavs() {
  const [favs, setFavs] = useState(loadFavs);
  useEffect(() => {
    const sync = () => setFavs(loadFavs());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync); // изменения из другой вкладки
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return favs;
}
