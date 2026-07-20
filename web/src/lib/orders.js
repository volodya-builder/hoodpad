// Условные заявки (лимит-покупка / стоп-лосс / тейк-профит) — клиентские.
// Контракты кривой не умеют лимитных ордеров, поэтому заявка живёт в браузере:
// вкладка следит за ценой и при срабатывании открывает кошелёк на подпись.
const LS = "hood_orders_v1";

export function loadOrders() {
  try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; }
}

function save(list) {
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

export function addOrder(o) {
  const list = loadOrders();
  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    status: "active", // active | firing | done | failed
    created: Date.now(),
    ...o, // { token, type: "buy"|"stop"|"take", priceEth: number, amountEth?: number }
  });
  save(list);
  return list;
}

export function updateOrder(id, patch) {
  const list = loadOrders().map((o) => (o.id === id ? { ...o, ...patch } : o));
  save(list);
  return list;
}

export function removeOrder(id) {
  const list = loadOrders().filter((o) => o.id !== id);
  save(list);
  return list;
}

export function ordersFor(token) {
  const t = token.toLowerCase();
  return loadOrders().filter((o) => o.token === t);
}

/** Просим разрешение на браузерные уведомления (один раз, тихо). */
export function askNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

export function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (e) { /* ignore */ }
}
