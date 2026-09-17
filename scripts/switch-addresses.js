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

// Прежний комплект (17.09.2026, V2) — что заменяем
const OLD = {
  factory: "0xe16ccf7c12ce0256473fff60a1c3f18def64f861",
  quoteFactory: "0x655b7ce112336ad29dacdce7cf434b03930407a3",
  zap: "0x81345f67f3cb7c68ad17a4b63f9f6f1392c013ce",
  splitter: "0xad10637462a0e8abaabacc1cceb16ffabe56e529",
  arena: "0x0f82981d3630595b38943f4349f41ac1f2045eca",
  hoodTreasury: "0x7800ef8dbef42ffbce7573291d6e1fe4828b5936",
  migrator: "0x2dec3594dd49e499e37c86c3ab82d99f1a927c1a",
  migratorQ: "0xeb20f87ee1c8359ee8d0a5f770b052e849f1b84c",
  adminOld: "0xd2E49356804b8a82E5DED94a4D3E1a14d80A6F33",   // TEAM_ADDRESS на сайте = владелец/админ
  teamOld: "0x34fB2ff2cbD322C7F744E2818A15eC8b726BE4a6",    // кошелёк команды в Docs
  arenaBotOld: "0x574e7F68F79b9d7C7f7bB77691E3EE5048C6C39a", // оператор казн в Docs
  hoodOld: "0x9eFD74eDA2640de53982097539Cd435318FC3d62",    // монета hood в Docs
  startBlockOld: "65270286",                                 // FACTORY_START_BLOCK на сайте, startBlock сабграфа, FACTORY_FROM_BLOCK ботов
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
    ins("export const ETH_FACTORIES = [\n  FACTORY_ADDRESS,", `  "${OLD.factory}", // 17.09.2026 (V2)`);
    ins("export const QUOTE_FACTORIES = [\n  QUOTE_FACTORY_ADDRESS,", `  "${OLD.quoteFactory}", // 17.09.2026 (V2)`);
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
