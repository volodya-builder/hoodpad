// ============================================================================
//  pons-mirror — зеркало запусков Pons на лаунчпад hood (hoodandarrow.com)
//
//  Как работает:
//   1. По адресу любого токена Pons сам находит их фабрику (через эксплорер).
//   2. Каждые POLL_SEC секунд смотрит новые транзакции к фабрике Pons.
//   3. Для каждого нового токена читает имя/тикер/метаданные, скачивает
//      картинку, сжимает её в 512px WebP и запускает копию на фабрике hood.
//   4. Все обработанные токены запоминает в state.json — дублей не будет.
//
//  Запуск:  node mirror.js          (см. README.txt)
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- настройки
const CFG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CFG_PATH)) {
  console.error("Нет config.json — создайте его по образцу config.example.json");
  process.exit(1);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));

const POLL_SEC       = CFG.pollSec       ?? 20;   // как часто опрашивать
const MAX_PER_HOUR   = CFG.maxPerHour    ?? 6;    // предохранитель от спама
const INITIAL_BUY    = CFG.initialBuyEth ?? 0;    // покупка при запуске, ETH
const IMG_BUDGET     = 120_000;                    // лимит data-url картинки

// Сеть, где живёт Pons (мейннет или тестнет Robinhood — скрипт определит сам)
const CHAINS = {
  testnet: {
    chain: defineChain({
      id: 46630, name: "Robinhood Chain Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
    }),
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  mainnet: {
    chain: defineChain({
      id: 4663, name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
    }),
    explorer: "https://robinhoodchain.blockscout.com",
  },
};

// Сеть Pons можно задать вручную в config.json:
//   "ponsExplorer": "https://их-эксплорер.xyz",  (Blockscout)
//   "ponsRpc": "https://их-rpc.xyz",
//   "ponsChainId": 12345
if (CFG.ponsExplorer && CFG.ponsRpc) {
  CHAINS.custom = {
    chain: defineChain({
      id: CFG.ponsChainId ?? 1, name: "Pons chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [CFG.ponsRpc] } },
    }),
    explorer: CFG.ponsExplorer.replace(/\/$/, ""),
  };
}

// Наша сторона — hood, всегда тестнет
const HOOD = CHAINS.testnet;
const HOOD_FACTORY = CFG.hoodFactory ?? "0x22079e9f1c5acd14a1d3f1c41fd9798b33775518";

const factoryAbi = parseAbi([
  "function createToken(string name, string symbol, string metadataURI, address creatorWallet) payable returns (address token, address pool)",
]);
const erc20MetaAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function metadataURI() view returns (string)",
  "function tokenURI() view returns (string)",
  "function uri() view returns (string)",
  "function imageURI() view returns (string)",
  // формат PonsLauncherToken:
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string, string, string, string, string)",
]);

// ---------------------------------------------------------------- состояние
const STATE_PATH = path.join(__dirname, "state.json");
const state = fs.existsSync(STATE_PATH)
  ? JSON.parse(fs.readFileSync(STATE_PATH, "utf8"))
  : { ponsFactory: null, ponsSide: null, seenTx: {}, mirrored: {}, launchTimes: [] };
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) pons-mirror/1.1", "Accept": "application/json" };

async function jget(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1)); // подождать и повторить
    }
  }
  throw new Error(`${lastErr.message} — ${url.slice(0, 80)}`);
}

function ipfsToHttp(u) {
  if (!u) return u;
  if (u.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + u.slice(7);
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})/.test(u)) return "https://ipfs.io/ipfs/" + u; // голый CID
  return u;
}

// ---------------------------------------------------------------- discovery
// По примеру токена Pons находим их фабрику и сеть.
async function discoverPonsFactory() {
  if (state.ponsFactory) return;
  // фабрику можно задать вручную: "ponsFactory": "0x...", тогда поиск не нужен
  if (CFG.ponsFactory) {
    state.ponsFactory = CFG.ponsFactory.toLowerCase();
    state.ponsSide = CHAINS.custom ? "custom" : (CFG.ponsSide ?? "testnet");
    saveState();
    console.log(`✔ Фабрика Pons задана вручную: ${state.ponsFactory} (${state.ponsSide})`);
    return;
  }
  const sample = CFG.ponsSampleToken;
  if (!sample) throw new Error("В config.json нужен ponsSampleToken — адрес любого токена Pons");
  console.log(`Ищу фабрику Pons по токену ${sample}…`);
  for (const [side, net] of Object.entries(CHAINS)) {
    try {
      const a = await jget(`${net.explorer}/api/v2/addresses/${sample}`);
      if (!a.is_contract) { console.log(`  ${side}: адрес есть, но это не контракт в этой сети`); continue; }
      const txh = a.creation_tx_hash || a.creation_transaction_hash;
      if (!txh) { console.log(`  ${side}: контракт найден, но эксплорер не отдал транзакцию создания`); continue; }
      const tx = await jget(`${net.explorer}/api/v2/transactions/${txh}`);
      const factory = tx.to?.hash || tx.to;
      if (!factory) { console.log(`  ${side}: у транзакции создания нет адресата`); continue; }
      state.ponsFactory = factory.toLowerCase();
      state.ponsSide = side;
      saveState();
      console.log(`✔ Фабрика Pons найдена: ${state.ponsFactory} (${side})`);
      return;
    } catch (e) {
      console.log(`  ${side}: ${e.message}`);
    }
  }
  throw new Error(
    "Не удалось найти фабрику Pons по этому токену ни в одной сети.\n" +
    "  Проверьте ponsSampleToken (возьмите адрес свежего токена с сайта Pons)\n" +
    "  или задайте сеть вручную: ponsExplorer + ponsRpc + ponsChainId (см. README)."
  );
}

// ---------------------------------------------------------------- pons side
function ponsClient() {
  return createPublicClient({
    chain: CHAINS[state.ponsSide].chain,
    transport: http(undefined, { batch: true, timeout: 30_000, retryCount: 3 }),
  });
}

// Событие запуска токена на фабрике Pons (PonsLauncher.TokenLaunched):
// topic1 = адрес токена. Читаем напрямую из RPC — эксплорер не нужен.
const PONS_LAUNCH_TOPICS = [
  "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a", // TokenLaunched
  "0x1461370115e1c2be79cb529f8cfcbd11316e789d9c6099fc83417b0b4c48c62a", // TokenDeployed (запасной)
];
const MAX_LOOKBACK = 20_000n; // не смотрим глубже ~20k блоков при долгом простое

async function fetchNewPonsTokens() {
  const pc = ponsClient();
  const latest = await pc.getBlockNumber();
  if (!state.lastBlock) {
    state.lastBlock = latest.toString();
    saveState();
    console.log(`Стартовая точка: блок ${latest} (${state.ponsSide}) — зеркалю только новые запуски.`);
    return [];
  }
  let from = BigInt(state.lastBlock) + 1n;
  if (latest - from > MAX_LOOKBACK) from = latest - MAX_LOOKBACK; // после долгого простоя
  if (from > latest) return [];
  const logs = await pc.getLogs({
    address: state.ponsFactory,
    fromBlock: from,
    toBlock: latest,
  });
  const fresh = [];
  const seen = new Set();
  for (const l of logs) {
    if (!PONS_LAUNCH_TOPICS.includes(l.topics?.[0])) continue;
    const t = l.topics?.[1];
    if (!t || t.length !== 66) continue;
    const addr = "0x" + t.slice(26);
    if (seen.has(addr)) continue;
    seen.add(addr);
    fresh.push({ addr, tx: l.transactionHash });
  }
  state.lastBlock = latest.toString();
  saveState();
  return fresh;
}

// Метаданные токена Pons: пробуем стандартные геттеры, потом эксплорер
async function readPonsToken(addr) {
  const pc = ponsClient();
  let name, symbol;
  try {
    [name, symbol] = await Promise.all([
      pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: "name" }),
      pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: "symbol" }),
    ]);
  } catch (e) { return null; } // не ERC-20 (например, это пул) — пропускаем
  let meta = {};
  // 1) формат Pons: logo() + description() + socials()
  try {
    const logo = await pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: "logo" });
    meta.image = logo || "";
    try {
      meta.description = await pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: "description" });
    } catch (e) { /* без описания */ }
    try {
      const [tw, tg, , web] = await pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: "socials" });
      meta.x = tw || ""; meta.telegram = tg || ""; meta.website = web || "";
    } catch (e) { /* без соцсетей */ }
    return { name, symbol, meta };
  } catch (e) { /* не Pons-токен — пробуем стандартные геттеры */ }
  // 2) стандартные геттеры метаданных
  for (const fn of ["metadataURI", "tokenURI", "uri", "imageURI"]) {
    try {
      const u = await pc.readContract({ address: addr, abi: erc20MetaAbi, functionName: fn });
      if (!u) continue;
      if (u.startsWith("data:application/json")) {
        const b64 = u.split(",")[1];
        meta = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      } else if (u.startsWith("{")) {
        meta = JSON.parse(u);
      } else if (fn === "imageURI") {
        meta.image = u;
      } else {
        meta = await jget(ipfsToHttp(u));
      }
      break;
    } catch (e) { /* пробуем следующий геттер */ }
  }
  return { name, symbol, meta };
}

// ---------------------------------------------------------------- картинка
async function imageToDataUrl(imgUrl) {
  if (!imgUrl) return "";
  if (imgUrl.startsWith("data:image/")) {
    if (imgUrl.length <= IMG_BUDGET) return imgUrl;      // уже data-url, влезает
    imgUrl = null; // слишком большой data-url — пересожмём ниже
  }
  try {
    let buf;
    if (imgUrl) {
      // несколько IPFS-шлюзов на случай, если какой-то недоступен
      const urls = /^(ipfs:\/\/|Qm|baf)/.test(imgUrl)
        ? ["https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/", "https://dweb.link/ipfs/"]
            .map((g) => g + imgUrl.replace(/^ipfs:\/\//, ""))
        : [imgUrl];
      let lastErr;
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: { "User-Agent": UA["User-Agent"] }, signal: AbortSignal.timeout(25000) });
          if (!r.ok) throw new Error("img " + r.status);
          buf = Buffer.from(await r.arrayBuffer());
          break;
        } catch (e) { lastErr = e; }
      }
      if (!buf) throw lastErr ?? new Error("no image");
    } else {
      return "";
    }
    for (const [size, q] of [[512, 88], [512, 75], [256, 82], [128, 80]]) {
      const out = await sharp(buf).resize(size, size, { fit: "cover" }).webp({ quality: q }).toBuffer();
      const dataUrl = "data:image/webp;base64," + out.toString("base64");
      if (dataUrl.length <= IMG_BUDGET) return dataUrl;
    }
  } catch (e) {
    console.warn("  картинка не скачалась:", e.message);
  }
  return "";
}

// ---------------------------------------------------------------- hood side
const account = privateKeyToAccount(CFG.privateKey);
const hoodPub = createPublicClient({ chain: HOOD.chain, transport: http(undefined, { batch: true, timeout: 30_000, retryCount: 3 }) });
const hoodWallet = createWalletClient({ account, chain: HOOD.chain, transport: http(undefined, { timeout: 30_000, retryCount: 2 }) });

async function launchOnHood({ name, symbol, meta }) {
  const image = await imageToDataUrl(meta.image);
  const metadata = {
    description: meta.description ?? "",
    image,
    x: meta.x ?? meta.twitter ?? "",
    telegram: meta.telegram ?? "",
    website: meta.website ?? "",
  };
  const uri = "data:application/json;base64," +
    Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");
  const value = INITIAL_BUY > 0 ? parseEther(String(INITIAL_BUY)) : 0n;
  const hash = await hoodWallet.writeContract({
    address: HOOD_FACTORY, abi: factoryAbi, functionName: "createToken",
    args: [name, symbol, uri, "0x0000000000000000000000000000000000000000"],
    value,
  });
  await hoodPub.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------- main loop
function underRateLimit() {
  const hourAgo = Date.now() - 3600_000;
  state.launchTimes = state.launchTimes.filter((t) => t > hourAgo);
  return state.launchTimes.length < MAX_PER_HOUR;
}

async function tick() {
  const fresh = await fetchNewPonsTokens();
  for (const f of fresh) {
    const key = f.addr.toLowerCase();
    if (state.mirrored[key]) continue;
    const tok = await readPonsToken(f.addr);
    if (!tok) { state.mirrored[key] = "not-erc20"; saveState(); continue; }
    // не зеркалим дубликаты по имя+тикер
    const dupKey = `${tok.name}|${tok.symbol}`.toLowerCase();
    if (state.mirrored[dupKey]) { state.mirrored[key] = "dup"; saveState(); continue; }
    if (!underRateLimit()) {
      console.log(`⏸ лимит ${MAX_PER_HOUR}/час — ${tok.symbol} отложен до следующего часа`);
      return;
    }
    console.log(`🚀 Зеркалю: ${tok.name} ($${tok.symbol})…`);
    try {
      const hash = await launchOnHood(tok);
      state.mirrored[key] = hash;
      state.mirrored[dupKey] = hash;
      state.launchTimes.push(Date.now());
      saveState();
      console.log(`   ✔ запущен на hood: ${hash}`);
    } catch (e) {
      console.error(`   ✘ не удалось запустить ${tok.symbol}:`, e.shortMessage || e.message);
    }
  }
}

(async () => {
  console.log("pons-mirror запускается…");
  console.log("Кошелёк бота:", account.address);
  await discoverPonsFactory();
  const bal = await hoodPub.getBalance({ address: account.address });
  console.log(`Баланс бота: ${Number(bal) / 1e18} ETH (тестнет hood)`);
  if (bal === 0n) console.warn("⚠ Баланс 0 — пополните кошелёк бота тестовым ETH, иначе запуски не пройдут.");

  for (;;) {
    try { await tick(); } catch (e) { console.error("tick error:", e.message); }
    await sleep(POLL_SEC * 1000);
  }
})();
