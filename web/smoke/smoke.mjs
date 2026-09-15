// Дымовая проверка собранного сайта (Playwright, безголовый Chromium).
//
//   node web/smoke/smoke.mjs <dist> [base]        например: node web/smoke/smoke.mjs hp/web/dist /staging/
//
// Открывает все живые страницы, вкладки страницы монеты, и телефон (375 px):
// ловит ошибки JS (pageerror), «Страница упала», горизонтальный скролл на
// телефоне. Сеть до RPC из песочницы Claude закрыта — данные не грузятся,
// но падения рендера видны; список монет может прийти из сабграфа.
// Выход 1, если что-то упало. Нужен пакет playwright с Chromium.
import { chromium, devices } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";

const DIST = process.argv[2] || "web/dist";
const BASE = process.argv[3] || "/";
const PORT = 4190 + Math.floor(Math.random() * 100);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (BASE !== "/" && p.startsWith(BASE)) p = "/" + p.slice(BASE.length);
  let f = join(DIST, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
  res.setHeader("content-type", mime[extname(f)] || "application/octet-stream");
  res.end(readFileSync(f));
}).listen(PORT);

const DOGE = "0xab38465f3210e18cdb88607405c3458cf41999c6";
const PAGES = [
  ["главная", "#/"], ["монета DOGE", `#/token/${DOGE}`], ["создать", "#/create"], ["арена", "#/arena"],
  ["аналитика", "#/analytics"], ["лидеры", "#/leaderboard"], ["профиль", "#/profile"],
  ["трейдер", "#/trader/0xD3d14c10020ad9C582404669a2Fa11AfF2386255"], ["политика", "#/privacy"], ["условия", "#/terms"],
];
const url = (hash) => `http://127.0.0.1:${PORT}${BASE}?v=${Date.now()}${hash}`;
const crashed = (txt) => /Страница упала|Ошибка на странице|Something went wrong/.test(txt);

let fails = 0;
const browser = await chromium.launch();

async function run(ctx, label, hash, after) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message.split("\n")[0]));
  page.on("console", (m) => { if (m.type() === "error" && !/net::|Failed to fetch|ERR_|403|401|CORS|status of (5\d\d|404)/.test(m.text())) errs.push("console: " + m.text().slice(0, 140)); });
  await page.goto(url(hash), { waitUntil: "load" });
  await page.waitForTimeout(5000);
  if (after) { try { await after(page); } catch (e) { errs.push("after: " + e.message.split("\n")[0]); } }
  const info = await page.evaluate(() => ({
    crashed: document.body.innerText, w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  const bad = crashed(info.crashed) || errs.length > 0 || info.w > info.cw + 1;
  if (bad) fails++;
  console.log(`${bad ? "✗" : "✓"} ${label}: упала=${crashed(info.crashed)} ошибок=${errs.length} ширина=${info.w}/${info.cw}${errs.length ? "\n   " + errs.slice(0, 4).join("\n   ") : ""}`);
  await page.close();
}

const clickTab = (sel, text) => async (page) => {
  const t = page.locator(sel, { hasText: text }).first();
  if (await t.count()) { await t.click(); await page.waitForTimeout(2000); }
};

console.log("== десктоп");
const desk = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "ru-RU" }); // locale: без неё Chromium в песочнице берёт «en-US@posix» и toLocaleString() падает
for (const [label, hash] of PAGES) await run(desk, label, hash);
await run(desk, "арена · правила", "#/arena", clickTab(".ttab", "Правила"));
await run(desk, "арена · история", "#/arena", clickTab(".ttab", "История побед"));
await run(desk, "монета · чат", `#/token/${DOGE}`, clickTab(".side-tabs .bt-tab", "Чат"));
await run(desk, "монета · продать", `#/token/${DOGE}`, clickTab(".tabs .tab", "Продать"));
await run(desk, "создать · акции", "#/create", clickTab("button", "Акции"));
await desk.close();

console.log("== телефон 375px");
const mob = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
for (const [label, hash] of PAGES) await run(mob, label, hash);
await run(mob, "монета · мои позиции (таблица)", `#/token/${DOGE}`, clickTab(".bt-tabs:not(.side-tabs) .bt-tab", "Мои позиции"));
await run(mob, "монета · история сделок", `#/token/${DOGE}`, clickTab(".bt-tabs:not(.side-tabs) .bt-tab", "История сделок"));
await run(mob, "арена · правила", "#/arena", clickTab(".ttab", "Правила"));
await mob.close();

await browser.close();
srv.close();
console.log(fails ? `\nПРОБЛЕМ: ${fails}` : "\nВСЁ ЖИВО");
process.exit(fails ? 1 : 0);
