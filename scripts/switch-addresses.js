#!/usr/bin/env node
/**
 * Переключить сайт, ботов и сабграф на новый комплект контрактов после
 * перезапуска V3 (scripts/relaunch-v4-output.json) — одним запуском, чтобы не
 * забыть ни один зашитый адрес.
 *
 * Что меняет (старый адрес → новый, без учёта регистра):
 *   web/src/lib/config.js      фабрики, зап, сплиттер, казны, TEAM_ADDRESS (= владелец)
 *   web/src/pages/Docs.jsx     миграторы, кошелёк команды (монета hood — отдельно, --hood)
 *   web/src/lib/legacy.js      старые фабрики → в списки «прошлых версий»
 *   bot/*.mjs, bot/config.json зашитые адреса по умолчанию; казна-легаси арены — пусто
 *   subgraph/subgraph.yaml     адреса фабрик и казн + startBlock = блок деплоя
 *
 * Запуск:  node scripts/switch-addresses.js            # показать план
 *          node scripts/switch-addresses.js --write    # применить
 *          node scripts/switch-addresses.js --write --hood 0x…   # ещё и монета hood в Docs
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const write = process.argv.includes("--write");
const hoodArg = (() => { const i = process.argv.indexOf("--hood"); return i > 0 ? process.argv[i + 1] : ""; })();
const out = JSON.parse(fs.readFileSync(path.join(__dirname, "relaunch-v4-output.json"), "utf8"));
const low = (a) => String(a).toLowerCase();

// Прежний комплект (18.09.2026 утро, V3 с градацией 6.5 ETH) — что заменяем
const OLD = {
  factory: "0x0a7233ae853dd4c2315dcc53ce7b8939aeb01107",
  quoteFactory: "0x094ae4f59d855165a326bbb4773f674ef795751f",
  zap: "0x645a33ccc81b9cd8a0304c4d91064da6c6c4df57",
  splitter: "0x5a8ce0ebf1496189a8313e71a091b9a48db2edef",
  arena: "0x26f83c7537346a925c311817ca5554db0f393609",
  hoodTreasury: "0xd55e3f8405a3af1d219eea0e5d69b56d3a0118ad",
  migrator: "0xe11727b682e86ced24ed0da2aa6c113ae30672f4",
  migratorQ: "0xac360e752e9e12952e27f202d5814fa8c6220878",
  adminOld: "0x53eB687F618A491B037818292Bc3427bD654F736",   // утренние кошельки 18.09 — меняются на новые
  teamOld: "0x0462C1Efe9CA880E901807d5386EBcc6705087b3",
  arenaBotOld: "0x4fC073049012c52c6B291E08D69D13b3a33d8B63",
  hoodOld: "0x67b7a5342a85d623436f049f87517cd1fd73a239",    // монета hood в Docs
  startBlockOld: "66023560",                                 // FACTORY_START_BLOCK на сайте, startBlock сабграфа, FACTORY_FROM_BLOCK ботов
};
const NEW = { ...out, adminOld: out.owner, teamOld: out.team, arenaBotOld: out.operator, hoodOld: hoodArg, startBlockOld: String(out.startBlock || "") };
for (const k of ["factory", "quoteFactory", "zap", "splitter", "arena", "hoodTreasury", "migrator", "migratorQ", "owner", "team"]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(out[k] || ""))) { console.error(`в relaunch-v4-output.json нет ${k}`); process.exit(1); }
}

const FILES = [
  "web/src/lib/config.js", "web/src/pages/Docs.jsx", "web/src/lib/legacy.js",
  "bot/arena/arena.mjs", "bot/buyback/buyback.mjs", "bot/dividends/dividends.mjs", "bot/dividends/migrate.mjs", "bot/activity/activity.mjs", "bot/config.json",
  "scripts/allow-stocks.js", "scripts/verify-v4.js", "subgraph/subgraph.yaml", "subgraph/src/pool.ts",
];
const changes = [];
function replaceAll(text, from, to) {
  let n = 0;
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const res = text.replace(re, () => { n++; return to; });
  return { res, n };
}
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log(`  (нет файла ${rel})`); continue; }
  let text = fs.readFileSync(p, "utf8");
  const before = text;
  for (const [k, from] of Object.entries(OLD)) {
    const to = NEW[k];
    if (!to) continue;
    const { res, n } = replaceAll(text, from, low(from) === from ? low(to) : to);
    if (n) { changes.push(`${rel}: ${k} ×${n}`); text = res; }
  }
  // legacy.js — старые фабрики в списки прошлых версий
  if (rel.endsWith("legacy.js")) {
    const ins = (anchor, line) => { if (!text.includes(line) && text.includes(anchor)) { text = text.replace(anchor, anchor + "\n" + line); changes.push(`${rel}: +${line.trim()}`); } };
    ins("export const ETH_FACTORIES = [\n  FACTORY_ADDRESS,", `  "${OLD.factory}", // 18.09.2026 утро (V3, градация 6.5)`);
    ins("export const QUOTE_FACTORIES = [\n  QUOTE_FACTORY_ADDRESS,", `  "${OLD.quoteFactory}", // 18.09.2026 утро (V3, градация 6.5)`);
  }
  // арена: старой казны-легаси больше нет
  if (rel.endsWith("arena.mjs")) {
    const { res, n } = replaceAll(text, `process.env.ARENA_TREASURY_LEGACY ?? "${low(NEW.arena)}"`, `process.env.ARENA_TREASURY_LEGACY ?? ""`);
    if (n) { text = res; changes.push(`${rel}: казна-легаси → пусто`); }
  }
  // сабграф: адреса казн V2 и стартовый блок
  if (rel.endsWith("subgraph.yaml")) {
    const startBlock = Number(out.startBlock || 0);
    if (!startBlock) { console.error("в relaunch-v4-output.json нет startBlock (блок деплоя) — добавь: \"startBlock\": <номер>"); process.exit(1); }
    const zero = '"0x0000000000000000000000000000000000000000"';
    let i = 0;
    text = text.replace(new RegExp(`address: ${zero}`, "g"), () => `address: "${low(i++ === 0 ? NEW.arena : NEW.hoodTreasury)}"`);
    if (i) changes.push(`${rel}: казны V2 ×${i}`);
    const { res, n } = replaceAll(text, "startBlock: 65270286", `startBlock: ${startBlock}`);
    const r2 = replaceAll(res, "startBlock: 0\n", `startBlock: ${startBlock}\n`);
    text = r2.res; if (n + r2.n) changes.push(`${rel}: startBlock ×${n + r2.n} → ${startBlock}`);
  }
  if (text !== before && write) fs.writeFileSync(p, text);
}
console.log((write ? "Применено:" : "План (без --write ничего не меняется):"));
for (const c of changes) console.log("  " + c);
if (!hoodArg) console.log("  (монета hood в Docs — позже: --hood <адрес>)");
// подсказки по полям, которые не адреса
if (write) {
  const cfg = fs.readFileSync(path.join(ROOT, "web/src/lib/config.js"), "utf8");
  if (!cfg.includes(`FACTORY_START_BLOCK = ${out.startBlock}n`)) console.log(`  ⚠ web/src/lib/config.js: FACTORY_START_BLOCK должен стать ${out.startBlock}n`);
}
const left = [];
for (const rel of FILES) {
  const p = path.join(ROOT, rel); if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, "utf8").toLowerCase();
  for (const [k, a] of Object.entries(OLD)) if (k !== "hoodOld" && t.includes(a.toLowerCase())) left.push(`${rel}: ${k}`);
}
if (write && left.length) { console.log("\nОстались старые адреса (проверь руками):"); for (const l of left) console.log("  " + l); }
if (!write) console.log("\nПрименить: node scripts/switch-addresses.js --write [--hood 0x…]");
