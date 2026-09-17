#!/usr/bin/env node
/**
 * Верификация исходников в обозревателе (Blockscout) — чтобы любой мог
 * читать код контрактов hood и звать их прямо со страницы обозревателя.
 *
 * Что делает:
 *   1. берёт адреса из scripts/relaunch-v3-output.json (после перезапуска)
 *      и, если у фабрик уже есть монеты, — по одному экземпляру токена и
 *      пула каждого вида (остальные экземпляры Blockscout подхватывает сам
 *      по одинаковому байткоду);
 *   2. для каждого контракта собирает МИНИМАЛЬНЫЙ standard-json (только
 *      его файл и импорты, те же настройки, что у scripts/compile.js:
 *      solc 0.8.28, optimizer 200, evm paris) — хэш метаданных в байткоде
 *      зависит только от этих файлов, поэтому совпадение полное;
 *   3. шлёт в API обозревателя, ждёт результат, при сбое пробует ещё
 *      (до 4 раз с паузой) — Cloudflare и очередь верификатора капризны;
 *   4. в конце — таблица: что верифицировано, что нет и почему.
 *
 * Запуск:  node scripts/verify-v3.js            # всё из relaunch-v3-output.json
 *          node scripts/verify-v3.js --only zap # только один
 *          EXTRA="Name=0x…,Name2=0x…" node scripts/verify-v3.js   # добавить адреса
 * Ключи не нужны. Из GitHub Actions: workflow «verify» (Run workflow).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const EXPLORER = process.env.EXPLORER_API || "https://robinhoodchain.blockscout.com/api/v2";
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const COMPILER = process.env.COMPILER_VERSION || "v0.8.28+commit.7893614a";
const LICENSE = "mit";
const OUT_FILE = path.join(__dirname, "relaunch-v3-output.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));

// ---------------------------------------------------------------- исходники
const IMP = /import\s+(?:{[^}]*}\s+from\s+)?"([^"]+)";/g;
function readSource(key) {
  const p = key.startsWith("@") ? path.join(ROOT, "node_modules", key) : path.join(CONTRACTS, key);
  if (!fs.existsSync(p)) throw new Error(`нет файла ${key} (${p}) — для @openzeppelin нужен npm install`);
  return fs.readFileSync(p, "utf8");
}
/** Файл + все его импорты (ключи как у compile.js: путь относительно contracts/). */
function closure(file) {
  const sources = {};
  const queue = [file];
  while (queue.length) {
    const key = queue.pop();
    if (sources[key]) continue;
    const content = readSource(key);
    sources[key] = { content };
    for (const m of content.matchAll(IMP)) {
      const imp = m[1];
      const k = imp.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(key), imp)) : imp;
      if (!sources[k]) queue.push(k);
    }
  }
  return sources;
}
function standardInput(file) {
  return {
    language: "Solidity",
    sources: closure(file),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
}
/** Найти файл, где объявлен контракт (contract Name is/…{). */
function fileOf(name) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".sol") ? [path.join(d, e.name)] : []);
  const re = new RegExp(`\\bcontract\\s+${name}\\b`);
  for (const f of walk(CONTRACTS)) if (re.test(fs.readFileSync(f, "utf8"))) return path.relative(CONTRACTS, f).split(path.sep).join("/");
  throw new Error(`не нашёл файл контракта ${name}`);
}

// ---------------------------------------------------------------- обозреватель
async function api(url, init = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
      if (r.status === 429 || r.status === 403 || r.status >= 500) { last = new Error(`HTTP ${r.status}${/Just a moment/.test(text) ? " (Cloudflare)" : ""}`); await sleep(5000 * (i + 1)); continue; }
      return { status: r.status, json, text };
    } catch (e) { last = e; await sleep(5000 * (i + 1)); }
  }
  throw last;
}
async function status(address) {
  const { status: st, json } = await api(`${EXPLORER}/smart-contracts/${address}`);
  if (st === 404) return { verified: false, name: null };
  return { verified: !!json?.is_verified, name: json?.name || null, partial: !!json?.is_partially_verified, viaSimilar: !!json?.is_verified_via_eth_bytecode_db };
}
async function submit(address, name, file) {
  const input = standardInput(file);
  const form = new FormData();
  form.append("compiler_version", COMPILER);
  form.append("license_type", LICENSE);
  form.append("contract_name", `${file}:${name}`);
  form.append("autodetect_constructor_args", "true");
  form.append("files[0]", new Blob([JSON.stringify(input)], { type: "application/json" }), `${name}.json`);
  const { status: st, json, text } = await api(`${EXPLORER}/smart-contracts/${address}/verification/via/standard-input`, { method: "POST", body: form });
  if (st >= 400) throw new Error(`отправка: HTTP ${st} ${(json && (json.message || JSON.stringify(json.errors || json))) || text.slice(0, 120)}`);
  return json?.message || "started";
}
async function verifyOne(address, name, file, log) {
  const before = await status(address);
  if (before.verified) { log(`  уже верифицирован (${before.name})`); return "ok"; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const msg = await submit(address, name, file);
      log(`  отправлено (${msg}), жду результат…`);
    } catch (e) {
      log(`  попытка ${attempt}: ${e.message}`);
      await sleep(10000 * attempt);
      continue;
    }
    // ждём до ~2 минут
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const s = await status(address).catch(() => ({ verified: false }));
      if (s.verified) { log(`  ✓ верифицирован как ${s.name}`); return "ok"; }
    }
    log(`  попытка ${attempt}: обозреватель не подтвердил за 2 минуты`);
  }
  return "fail";
}

// ---------------------------------------------------------------- цели
async function targets() {
  const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
  const list = [];
  let out = null;
  try { out = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); } catch (e) { /* нет — только EXTRA */ }
  if (out) {
    const map = { migrator: "UniswapV3Migrator", factory: "LaunchpadFactoryV2", migratorQ: "UniswapV3MigratorQuote", quoteFactory: "LaunchpadFactoryQuote", zap: "CurveZap", arena: "ArenaTreasuryV2", hoodTreasury: "ArenaTreasuryV2", splitter: "FeeSplitterV6" };
    for (const [k, name] of Object.entries(map)) if (isAddr(out[k])) list.push({ key: k, name, address: out[k] });
    // по одному экземпляру токена и пула каждого вида — если монеты уже есть
    try {
      const { createPublicClient, http, parseAbi } = require("viem");
      const pub = createPublicClient({ transport: http(RPC_URL, { retryCount: 2, timeout: 20000 }) });
      const abi = parseAbi(["function allTokens(uint256) view returns (address)", "function poolOf(address) view returns (address)"]);
      for (const [fk, tokName, poolName] of [["factory", "LaunchToken", "BondingCurvePoolV2"], ["quoteFactory", "DividendToken", "BondingCurvePoolQuote"]]) {
        if (!isAddr(out[fk])) continue;
        const token = await pub.readContract({ address: out[fk], abi, functionName: "allTokens", args: [0n] }).catch(() => null);
        if (!token) { console.log(`  (${fk}: монет ещё нет — токен и пул верифицирую позже, когда появится первая)`); continue; }
        const pool = await pub.readContract({ address: out[fk], abi, functionName: "poolOf", args: [token] });
        list.push({ key: `${fk}:token`, name: tokName, address: token }, { key: `${fk}:pool`, name: poolName, address: pool });
      }
    } catch (e) { console.log("  (не смог прочитать первые монеты: " + (e.shortMessage || e.message) + ")"); }
  }
  for (const pair of String(process.env.EXTRA || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, address] = pair.split("=");
    if (name && isAddr(address)) list.push({ key: name, name, address });
  }
  return only ? list.filter((t) => t.key === only || t.name === only) : list;
}

async function main() {
  const list = await targets();
  if (!list.length) { console.error(`Нечего верифицировать: нет ${OUT_FILE} и EXTRA пуст.`); process.exit(1); }
  // --dump: не слать в API (его закрывает Cloudflare), а сложить standard-json
  // для ручной загрузки через сайт обозревателя: scripts/verify-out/<N>-<Имя>.json
  if (process.argv.includes("--dump")) {
    const dir = path.join(__dirname, "verify-out");
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    list.forEach((t, i) => {
      const file = fileOf(t.name);
      const name = `${String(i + 1).padStart(2, "0")}-${t.name}${t.key.includes(":") ? "-" + t.key.replace(":", "_") : ""}.json`;
      fs.writeFileSync(path.join(dir, name), JSON.stringify(standardInput(file), null, 1));
      lines.push(`${name}\n  адрес: ${t.address}\n  страница: https://robinhoodchain.blockscout.com/address/${t.address}/contract-verification\n  contract name: ${t.name}   компилятор: ${COMPILER}   лицензия: MIT\n`);
    });
    fs.writeFileSync(path.join(dir, "00-README.txt"), `Ручная верификация в Blockscout (standard-json).\n\n${lines.join("\n")}`);
    console.log(`Сложил ${list.length} файлов в ${dir} — см. 00-README.txt`);
    return;
  }
  console.log(`Обозреватель: ${EXPLORER} · компилятор ${COMPILER} · контрактов: ${list.length}\n`);
  const res = [];
  for (const t of list) {
    console.log(`${t.key} → ${t.name} @ ${t.address}`);
    let r;
    try { r = await verifyOne(t.address, t.name, fileOf(t.name), (m) => console.log(m)); }
    catch (e) { console.log(`  ✗ ${e.message}`); r = "fail"; }
    res.push({ ...t, r });
  }
  console.log("\nИтог:");
  for (const x of res) console.log(`  ${x.r === "ok" ? "✓" : "✗"} ${x.name.padEnd(24)} ${x.address}`);
  const bad = res.filter((x) => x.r !== "ok");
  if (bad.length) { console.log(`\nНе верифицированы: ${bad.length}. Повтори позже: node scripts/verify-v3.js --only <имя>`); process.exit(1); }
  console.log("\nВсе контракты открыты для чтения в обозревателе.");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
