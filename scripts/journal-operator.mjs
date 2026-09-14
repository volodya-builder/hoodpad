// Оператор журнала: победитель раунда → запись в журнале агента.
//
// Раз в неделю закрывается раунд голосования. Его победитель — задание,
// которое агент берёт в работу. Этот скрипт замыкает связку: находит
// закрытые раунды, у которых ещё нет записи в журнале, и заводит её со
// статусом «строит». Дальше запись правится по мере работы (done/failed).
//
// ЗАПУСК
//   node scripts/journal-operator.mjs            — сухой прогон, ничего не пишет
//   node scripts/journal-operator.mjs --write    — записать в базу
//   node scripts/journal-operator.mjs --newkey   — сгенерировать ключ оператора
//
// По умолчанию скрипт НИЧЕГО не пишет и только показывает, что бы сделал.
// Это не перестраховка: в этом проекте уже был бот, который автоматически
// делал «полезную» работу и сжёг около $70 живых денег (см. CLAUDE.md).
// Автоматика включается флагом, осознанно, после того как глазами посмотрел
// на список.
//
// КЛЮЧ ОПЕРАТОРА
// Берётся из переменной окружения JOURNAL_OPERATOR_KEY. Это ОТДЕЛЬНЫЙ ключ,
// не кошелёк команды. Он не держит денег и умеет ровно одно — подписывать
// записи журнала. Если он утечёт, злоумышленник сможет написать фальшивую
// запись в журнал и ничего больше; лечится сменой адреса в VITE_AGENT_OPERATOR.
// Класть сюда командный ключ нельзя: тогда одна утечка стоит всех денег.
//
// Создать ключ: node scripts/journal-operator.mjs --newkey
// Он напечатает приватный ключ и адрес. Ключ — в переменную окружения на
// своей машине, адрес — в web/.env как VITE_AGENT_OPERATOR.

import { createPublicClient, http, parseAbi, verifyMessage } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x08a887196fc31b89305ae03aa991917f6b1d23ec";
const DB = "https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app";

const WEEK = 7 * 24 * 3600 * 1000;
const roundId = (ts = Date.now()) => Math.floor(ts / WEEK);

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256 offset, uint256 limit) view returns (address[])",
]);
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

const client = createPublicClient({
  chain: { id: 4663, name: "Robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
           rpcUrls: { default: { http: [RPC] } } },
  transport: http(RPC),
});

// Формат сообщений обязан совпадать с web/src/lib/{workshop,journal}.js —
// иначе подписи, сделанные сайтом, здесь не сойдутся, и наоборот.
const voteMessage = (token, id, pid) =>
  `hood workshop vote\ntoken: ${token.toLowerCase()}\nround: ${id}\nproposal: ${pid}`;

const entryMessage = (token, round, e) => [
  "hood journal entry",
  `token: ${String(token).toLowerCase()}`,
  `round: ${round}`,
  `status: ${e.status || ""}`,
  `task: ${e.task || ""}`,
  `url: ${e.url || ""}`,
  `spent: ${e.spent ?? ""}`,
].join("\n");

const get = (path) => fetch(`${DB}/${path}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function tokens() {
  const count = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" });
  if (count === 0n) return [];
  const PAGE = 200n;
  const offset = count > PAGE ? count - PAGE : 0n;
  const addrs = await client.readContract({
    address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [offset, PAGE],
  });
  const out = [];
  for (const token of addrs) {
    let symbol = "?";
    try { symbol = await client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }); } catch {}
    out.push({ token, symbol });
  }
  return out.reverse();
}

/** Победитель раунда. Считается так же, как на сайте: подпись, потом баланс. */
async function winnerOf(token, id) {
  const key = `${token.toLowerCase()}/${id}`;
  const [props, votes] = await Promise.all([
    get(`workshop/proposals/${key}`),
    get(`workshop/votes/${key}`),
  ]);
  const proposals = Object.entries(props || {}).map(([pid, x]) => ({ pid, ...x }));
  if (!proposals.length) return null;

  const byProp = {};
  for (const [addr, v] of Object.entries(votes || {})) {
    if (!v?.sig || !v?.pid) continue;
    let real = false;
    try {
      real = await verifyMessage({ address: addr, message: voteMessage(token, id, v.pid), signature: v.sig });
    } catch { real = false; }
    if (!real) continue;                       // подделка — молча мимо
    let bal = 0n;
    try {
      bal = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [addr] });
    } catch {}
    if (bal <= 0n) continue;                   // нулевой баланс — голоса нет
    byProp[v.pid] = (byProp[v.pid] || 0n) + bal;
  }

  let win = null, best = 0n;
  for (const p of proposals) {
    const w = byProp[p.pid] ?? 0n;
    if (w > best) { best = w; win = p; }
  }
  return win && best > 0n ? { ...win, weight: best } : null;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--newkey")) {
    const pk = generatePrivateKey();
    const acc = privateKeyToAccount(pk);
    console.log("\nКлюч оператора журнала — денег на нём быть не должно.\n");
    console.log("  JOURNAL_OPERATOR_KEY =", pk);
    console.log("  VITE_AGENT_OPERATOR  =", acc.address);
    console.log("\nПервое — в переменные окружения этой машины. Второе — в web/.env.");
    console.log("Приватный ключ никуда больше не копируем и в git не кладём.\n");
    return;
  }

  const write = args.includes("--write");
  const back = Number(args.find((a) => a.startsWith("--weeks="))?.split("=")[1] || 6);

  let account = null;
  if (write) {
    const pk = process.env.JOURNAL_OPERATOR_KEY;
    if (!pk) {
      console.error("Нет JOURNAL_OPERATOR_KEY. Создать: node scripts/journal-operator.mjs --newkey");
      process.exit(1);
    }
    account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
    console.log("Оператор:", account.address);
  } else {
    console.log("Сухой прогон. Чтобы записать — добавь --write.\n");
  }

  const cur = roundId();
  const list = await tokens();
  console.log(`Монет: ${list.length}, смотрю последние ${back} закрытых раундов.\n`);

  let planned = 0, skipped = 0;

  for (const { token, symbol } of list) {
    const journal = (await get(`workshop/journal/${token.toLowerCase()}`)) || {};
    for (let i = 1; i <= back; i++) {
      const id = cur - i;
      if (journal[id]) { skipped += 1; continue; }   // запись уже есть — не трогаем
      const win = await winnerOf(token, id);
      if (!win) continue;

      const entry = { status: "build", task: win.text, plan: "", url: "", why: "", spent: "", opens: 0 };
      planned += 1;
      console.log(`$${symbol} раунд ${id}: ${win.text}`);

      if (!write) continue;
      const signature = await account.signMessage({ message: entryMessage(token, id, entry) });
      const r = await fetch(`${DB}/workshop/journal/${token.toLowerCase()}/${id}.json`, {
        method: "PUT",
        body: JSON.stringify({ ...entry, at: Date.now(), sig: signature }),
      });
      console.log(r.ok ? "  → записано" : `  → ОШИБКА ${r.status}`);
    }
  }

  console.log(`\nИтого: ${planned} новых, ${skipped} уже были.`);
  if (planned && !write) console.log("Ничего не записано — это сухой прогон.");
}

main().catch((e) => { console.error(e); process.exit(1); });
