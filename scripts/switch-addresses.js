#!/usr/bin/env node
/**
 * Переключить сайт, ботов и сабграф на новый комплект контрактов после
 * перезапуска (scripts/relaunch-v3-output.json) — одним запуском, чтобы не
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
const out = JSON.parse(fs.readFileSync(path.join(__dirname, "relaunch-v3-output.json"), "utf8"));
const low = (a) => String(a).toLowerCase();

// Прежний комплект (16.09.2026) — что заменяем
const OLD = {
  factory: "0xbe3e7ca55b6c4fc9e759bc8b43734b57a582da01",
  quoteFactory: "0x4b55954a2910cfbb04f49e90e727fb1540b3a940",
  zap: "0x939f933ab01277e7fde73c0d4d7dec885242d44c",
  splitter: "0x82a083e8a99b0f434c03b5c513c8b8c071bcf6e7",
  arena: "0x3cecc31c6db73ea1b31a5e1726c3e5e595b59a0a",
  hoodTreasury: "0x64bb9fd0b86489eb037f496a37528a37a6c5187b",
  migrator: "0x01f1ca21fc5e64c8dc9c90bc2891e2b9776f1b66",
  migratorQ: "0x76fe74640daca66c861856ea3a6295f4b2d47801",
  adminOld: "0xD3d14c10020ad9C582404669a2Fa11AfF2386255",   // TEAM_ADDRESS на сайте = владелец/админ
  teamOld: "0x79182232155dd09fBC53dd2Bb0380479F96EB11c",    // кошелёк команды в Docs
  hoodOld: "0x70550b0b6fb3d6bc813c7f29f989074bcdb5b51d",    // монета hood в Docs
};
const NEW = { ...out, adminOld: out.owner, teamOld: out.team, hoodOld: hoodArg };
for (const k of ["factory", "quoteFactory", "zap", "splitter", "arena", "hoodTreasury", "migrator", "migratorQ", "owner", "team"]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(out[k] || ""))) { console.error(`в relaunch-v3-output.json нет ${k}`); process.exit(1); }
}

const FILES = [
  "web/src/lib/config.js", "web/src/pages/Docs.jsx", "web/src/lib/legacy.js",
  "bot/arena/arena.mjs", "bot/buyback/buyback.mjs", "bot/dividends/dividends.mjs", "bot/activity/activity.mjs", "bot/config.json",
  "scripts/allow-stocks.js", "subgraph/subgraph.yaml", "subgraph/src/pool.ts",
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
    ins("export const ETH_FACTORIES = [\n  FACTORY_ADDRESS,", `  "${OLD.factory}", // 16–17.09.2026`);
    ins("export const QUOTE_FACTORIES = [\n  QUOTE_FACTORY_ADDRESS,", `  "${OLD.quoteFactory}", // 16–17.09.2026`);
  }
  // арена: старой казны-легаси больше нет
  if (rel.endsWith("arena.mjs")) {
    const { res, n } = replaceAll(text, `process.env.ARENA_TREASURY_LEGACY ?? "${low(NEW.arena)}"`, `process.env.ARENA_TREASURY_LEGACY ?? ""`);
    if (n) { text = res; changes.push(`${rel}: казна-легаси → пусто`); }
  }
  // сабграф: адреса казн V2 и стартовый блок
  if (rel.endsWith("subgraph.yaml")) {
    const startBlock = Number(out.startBlock || 0);
    if (!startBlock) { console.error("в relaunch-v3-output.json нет startBlock (блок деплоя) — добавь: \"startBlock\": <номер>"); process.exit(1); }
    const zero = '"0x0000000000000000000000000000000000000000"';
    let i = 0;
    text = text.replace(new RegExp(`address: ${zero}`, "g"), () => `address: "${low(i++ === 0 ? NEW.arena : NEW.hoodTreasury)}"`);
    if (i) changes.push(`${rel}: казны V2 ×${i}`);
    const { res, n } = replaceAll(text, "startBlock: 64580000", `startBlock: ${startBlock}`);
    const r2 = replaceAll(res, "startBlock: 0\n", `startBlock: ${startBlock}\n`);
    text = r2.res; if (n + r2.n) changes.push(`${rel}: startBlock ×${n + r2.n} → ${startBlock}`);
  }
  if (text !== before && write) fs.writeFileSync(p, text);
}
console.log((write ? "Применено:" : "План (без --write ничего не меняется):"));
for (const c of changes) console.log("  " + c);
if (!hoodArg) console.log("  (монета hood в Docs — позже: --hood <адрес>)");
const left = [];
for (const rel of FILES) {
  const p = path.join(ROOT, rel); if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, "utf8").toLowerCase();
  for (const [k, a] of Object.entries(OLD)) if (k !== "hoodOld" && t.includes(a.toLowerCase())) left.push(`${rel}: ${k}`);
}
if (write && left.length) { console.log("\nОстались старые адреса (проверь руками):"); for (const l of left) console.log("  " + l); }
if (!write) console.log("\nПрименить: node scripts/switch-addresses.js --write [--hood 0x…]");
