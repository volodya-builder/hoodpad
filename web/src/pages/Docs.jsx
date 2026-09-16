import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import {
  FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ZAP_ADDRESS, FEE_SPLITTER_ADDRESS,
  ARENA_TREASURY_ADDRESS, BUYBACK_TREASURY_ADDRESS, WETH_ADDRESS, EXPLORER, CHAIN,
} from "../lib/config.js";

// Документация hood — одна страница с боковым оглавлением (как у Flap/GitBook,
// но в стиле сайта). Тексты RU и EN лежат рядом в одной структуре, чтобы не
// расходиться; китайский показывает английский. Адреса берутся из config.js —
// после передеплоя менять нечего.
//
// Что описываем: кривая, монеты за акции, комиссии 70/10/10/10, арена,
// монета hood, контракты, боты, безопасность. Цифры — те, что зашиты в
// контрактах (LaunchpadFactoryV2: 1B / 800M / 1.625 ETH → 6.5 ETH).

const MIGRATOR_ETH = "0x01f1ca21fc5e64c8dc9c90bc2891e2b9776f1b66";
const MIGRATOR_QUOTE = "0x76fe74640daca66c861856ea3a6295f4b2d47801";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const HOOD_TOKEN = "0x70550b0b6fb3d6bc813c7f29f989074bcdb5b51d";
const TEAM_WALLET = "0x79182232155dd09fBC53dd2Bb0380479F96EB11c";
const SUBGRAPH = "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/4.0.2/gn";
const REPO = "https://github.com/volodya-builder/hoodpad";
const RPC = "https://rpc.mainnet.chain.robinhood.com";

const T = (ru, en) => ({ ru, en });

/** Разделы. Каждый: id, заголовок, абзацы (строка — абзац; массив — список;
 *  {k,v} — таблица «параметр — значение»). */
const SECTIONS = [
  {
    id: "overview", title: T("Что такое hood", "What is hood"),
    body: [
      T("hood — лаунчпад на Robinhood Chain. Любой запускает монету в одну транзакцию: 1 миллиард штук, цена растёт по бондинг-кривой, при пороге — переезд на Uniswap V3 с навсегда запертой ликвидностью.",
        "hood is a launchpad on Robinhood Chain. Anyone launches a coin in one transaction: 1 billion supply, price follows a bonding curve, and at the threshold the coin graduates to Uniswap V3 with liquidity locked forever."),
      T("Особенность площадки — монеты за акции и крипту: валютой кривой может быть токенизированная акция (NVDA, AAPL, GME…) или USDG, WETH, cbBTC. Покупают и продают за ETH одной транзакцией, а держатели такой монеты получают дивиденды в этой акции.",
        "What makes it different: coins priced in stocks and crypto. The curve currency can be a tokenized stock (NVDA, AAPL, GME…) or USDG, WETH, cbBTC. Buying and selling still happens in ETH in one transaction, and holders of such a coin earn dividends in that stock."),
      T("Кошелёк подписывает каждую транзакцию сам. hood не хранит активы, не имеет доступа к деньгам пользователей и не может изменить ни одну запущенную монету.",
        "Your wallet signs every transaction. hood holds no assets, has no access to user funds, and cannot alter any launched coin."),
    ],
  },
  {
    id: "curve", title: T("Бондинг-кривая", "Bonding curve"),
    body: [
      T("Все монеты одинаковые по механике: фиксированный сапплай, без минта, без налогов кроме комиссии площадки, без прав у создателя.",
        "Every coin shares the same mechanics: fixed supply, no minting, no taxes except the platform fee, no creator privileges."),
      { type: "stats", items: [
        { n: "1B", l: T("сапплай", "supply") },
        { n: "80%", l: T("на кривой", "on the curve") },
        { n: "6.5 ETH", l: T("порог градации", "graduation") },
        { n: "20%", l: T("в ликвидность навсегда", "locked liquidity") },
      ] },
      [
        { k: T("Формула", "Formula"), v: "x · y = k · virtual 1.625 ETH" },
        { k: T("Порог градации (ETH-монеты)", "Graduation threshold (ETH coins)"), v: "6.5 ETH" },
        { k: T("Порог (монеты за валюту)", "Threshold (quote coins)"), v: T("виртуальный резерв × 4, ≈ $16k в валюте на момент добавления", "virtual reserve × 4, ≈ $16k in the asset when it was listed") },
        { k: T("Покупка создателя при запуске", "Creator buy at launch"), v: T("до 5% сапплая, в той же транзакции", "up to 5% of supply, same transaction") },
      ],
      T("При градации пул отправляет резерв и 20% сапплая в мигратор, тот создаёт full-range позицию Uniswap V3 (комиссия 0.3%) и запирает NFT позиции навсегда — ликвидность нельзя вывести никому, включая команду.",
        "At graduation the pool sends its reserve and 20% of supply to the migrator, which creates a full-range Uniswap V3 position (0.3% fee tier) and locks the position NFT forever — nobody, including the team, can withdraw that liquidity."),
    ],
  },
  {
    id: "stocks", title: T("Монеты за акции и крипту", "Stock & crypto coins"),
    body: [
      T("Вторая фабрика запускает монеты, у которых валюта кривой — не ETH, а ERC-20: токенизированная акция или крипта из белого списка (70+ активов). Цена монеты, резерв и порог градации считаются в этой валюте.",
        "A second factory launches coins whose curve currency is an ERC-20 instead of ETH: a tokenized stock or a crypto asset from the whitelist (70+ assets). Price, reserve and graduation threshold are denominated in that asset."),
      T("Пользователь платит ETH: зап (CurveZap) меняет ETH на валюту через Uniswap V3 и покупает на кривой в одной транзакции; продажа — в обратную сторону. Проскальзывание и минимальный выход задаются на сайте.",
        "Users pay in ETH: the zap (CurveZap) swaps ETH into the asset on Uniswap V3 and buys on the curve in a single transaction; selling works in reverse. Slippage and minimum output are set on the site."),
      T("Дивиденды: создатель включает налог 1–3% с каждой сделки. Он берётся в валюте кривой и распределяется по балансам держателей. Бот площадки выплачивает накопленное автоматически (см. «Автоматизация»); забрать вручную можно в любой момент.",
        "Dividends: the creator can enable a 1–3% tax on every trade. It is collected in the curve asset and distributed pro-rata to holders. The platform bot pays out accrued dividends automatically (see “Automation”); manual claim is available any time."),
    ],
  },
  {
    id: "fees", title: T("Комиссии и экономика", "Fees & economics"),
    body: [
      T("Площадка берёт 1% с каждой сделки на кривой. Комиссия делится контрактами, а не людьми: доли зашиты при деплое и не меняются.",
        "The platform charges 1% on every curve trade. The split is enforced by contracts, not people: shares are fixed at deployment and cannot change."),
      { type: "split", title: T("Комиссия 1% с каждой сделки", "1% fee on every trade"), parts: [
        { l: T("Создателю монеты", "Coin creator"), pct: 70, c: "var(--gold)" },
        { l: T("Арена — выкуп подиума", "Arena — podium buyback"), pct: 10, c: "#8fd3f4" },
        { l: T("Выкуп монеты hood", "hood buyback"), pct: 10, c: "#e6e6e3" },
        { l: T("Команда", "Team"), pct: 10, c: "#7c7c79" },
      ] },
      [
        { k: T("Комиссия запуска", "Launch fee"), v: T("0 — площадка ничего не берёт; ≈ 0.0005 ETH — газ сети", "0 — the platform takes nothing; ≈ 0.0005 ETH is network gas") },
        { k: T("Кто делит", "Who splits"), v: T("FeeSplitterV6 — доли зашиты, изменить нельзя", "FeeSplitterV6 — shares are immutable") },
      ],
      T("Доля создателя копится в пуле и забирается кнопкой на странице монеты. Остальные 30% раз в минуту собирает бот в сплиттер (FeeSplitterV6), который в той же транзакции раскладывает их по трём адресам. У монет за валюту всё это происходит в валюте кривой.",
        "The creator share accrues in the pool and is claimed with a button on the coin page. The remaining 30% is collected by a bot into the splitter (FeeSplitterV6), which forwards it to the three addresses in the same transaction. For quote coins all of this happens in the curve asset."),
    ],
  },
  {
    id: "arena", title: T("Арена", "Arena"),
    body: [
      T("Арена — ежедневный бой монет по честному объёму. Каждые сутки (UTC) все неградуировавшие монеты сражаются; на чекпоинтах внутри дня выбывает слабейшая, последняя выжившая — чемпион дня. Выбывание — витрина, торговля не останавливается.",
        "The Arena is a daily battle of coins by fair volume. Each UTC day every non-graduated coin competes; at checkpoints during the day the weakest drops out, and the last one standing is the Champion of the Day. Elimination is for show — trading never stops."),
      T("Очки боя = честный объём × (1 + прирост цены за день). Честный объём считается по кошелькам как |покупки − продажи|: накрутка туда-сюда не даёт очков, сделки создателя не считаются, вклад одного кошелька ограничен 25%.",
        "Battle score = fair volume × (1 + price growth for the day). Fair volume is |buys − sells| per wallet: wash trading earns nothing, creator trades don’t count, and one wallet contributes at most 25%."),
      { type: "split", title: T("Призовой фонд дня — вся казна арены", "Daily prize — the whole arena treasury"), parts: [
        { l: T("1 место", "1st place"), pct: 70, c: "var(--gold)" },
        { l: T("2 место", "2nd place"), pct: 20, c: "#e6e6e3" },
        { l: T("3 место", "3rd place"), pct: 10, c: "#7c7c79" },
      ] },
      T("Утром (00:25 UTC) бот тратит всё, что лежит в казне арены, на вчерашний подиум: 70% первому месту, 20% второму, 10% третьему — выкуп монеты с рынка и сжигание в той же транзакции. Монеты за валюту выкупаются из той же валюты в казне. Одна корона на монету: выигравшая однажды больше не участвует.",
        "In the morning (00:25 UTC) the bot spends everything in the arena treasury on yesterday’s podium: 70% to 1st, 20% to 2nd, 10% to 3rd — buying the coin off the market and burning it in the same transaction. Quote coins are bought from the matching asset held by the treasury. One crown per coin: a past winner never competes again."),
      { type: "note", text: T("Из казны арены нельзя вывести ни копейки — контракт умеет только покупать монеты площадки и сжигать их.", "Nothing can be withdrawn from the arena treasury — the contract can only buy platform coins and burn them.") },
    ],
  },
  {
    id: "hood", title: T("Монета hood", "The hood coin"),
    body: [
      T("hood — первая монета площадки, запущена командой на общих условиях (ETH-кривая, 1% комиссия, те же контракты). Никаких особых прав у неё нет.",
        "hood is the platform’s first coin, launched by the team under the same rules as everyone (ETH curve, 1% fee, same contracts). It has no special privileges."),
      T("10% каждой комиссии площадки приходят в казну выкупа hood. Раз в сутки бот покупает на всё накопленное монету hood и сжигает её. Из казны нельзя вывести ничего — только выкуп и сжигание.",
        "10% of every platform fee goes to the hood buyback treasury. Once a day the bot spends everything accumulated to buy hood and burn it. Nothing can be withdrawn from the treasury — only buyback and burn."),
      [{ k: T("Адрес монеты", "Token address"), v: HOOD_TOKEN, addr: true }],
    ],
  },
  {
    id: "contracts", title: T("Контракты", "Deployed contracts"),
    body: [
      T("Все контракты задеплоены 16.09.2026 на Robinhood Chain. Исходники — в репозитории на GitHub (папка contracts/).",
        "All contracts were deployed on 16 Sep 2026 on Robinhood Chain. Source code is in the GitHub repository (contracts/ folder)."),
      [
        { k: T("Сеть", "Network"), v: "Robinhood Chain · chainId 4663" },
        { k: "RPC", v: RPC },
        { k: T("Обозреватель", "Explorer"), v: EXPLORER },
      ],
      [
        { k: "LaunchpadFactoryV2 — " + "ETH", v: FACTORY_ADDRESS, addr: true },
        { k: "LaunchpadFactoryQuote — " + T("акции и крипта", "stocks & crypto"), v: QUOTE_FACTORY_ADDRESS, addr: true },
        { k: "CurveZap — " + T("ETH ↔ валюта в одной транзакции", "ETH ↔ asset in one transaction"), v: ZAP_ADDRESS, addr: true },
        { k: "FeeSplitterV6 — " + T("делёж комиссий", "fee split"), v: FEE_SPLITTER_ADDRESS, addr: true },
        { k: "ArenaTreasury — " + T("казна арены", "arena treasury"), v: ARENA_TREASURY_ADDRESS, addr: true },
        { k: "ArenaTreasury — " + T("казна выкупа hood", "hood buyback treasury"), v: BUYBACK_TREASURY_ADDRESS, addr: true },
        { k: "UniswapV3Migrator — " + T("градация ETH-монет", "ETH coin graduation"), v: MIGRATOR_ETH, addr: true },
        { k: "UniswapV3MigratorQuote — " + T("градация монет за валюту", "quote coin graduation"), v: MIGRATOR_QUOTE, addr: true },
        { k: T("Кошелёк команды", "Team wallet"), v: TEAM_WALLET, addr: true },
        { k: "WETH", v: WETH_ADDRESS, addr: true },
        { k: "USDG", v: USDG_ADDRESS, addr: true },
      ],
      T("Каждая монета — это два контракта: токен (ERC-20, фиксированный сапплай) и её пул (кривая). Адреса обоих показаны на странице монеты.",
        "Each coin is two contracts: the token (ERC-20, fixed supply) and its pool (the curve). Both addresses are shown on the coin page."),
    ],
  },
  {
    id: "data", title: T("Данные и API", "Data & API"),
    body: [
      T("Все сделки, монеты и события индексирует публичный сабграф на Goldsky (GraphQL). Им же пользуется сайт — можно строить свои дашборды и ботов.",
        "All trades, coins and events are indexed by a public Goldsky subgraph (GraphQL). The site itself uses it — you can build your own dashboards and bots on top."),
      [{ k: "GraphQL", v: SUBGRAPH, addr: false, link: SUBGRAPH }],
      T("Пример: { tokens(first: 10, orderBy: createdBlock, orderDirection: desc) { id symbol pool createdAt } trades(first: 5) { trader ethAmount tokenAmount isBuy timestamp } }",
        "Example: { tokens(first: 10, orderBy: createdBlock, orderDirection: desc) { id symbol pool createdAt } trades(first: 5) { trader ethAmount tokenAmount isBuy timestamp } }"),
    ],
  },
  {
    id: "bots", title: T("Автоматизация", "Automation"),
    body: [
      T("Всё, что происходит по расписанию, делают открытые боты из репозитория (папка bot/). У них нет прав менять контракты — только вызывать публичные функции и тратить казны по правилам, зашитым в код казны.",
        "Everything on a schedule is done by open-source bots from the repository (bot/ folder). They cannot change contracts — they only call public functions and spend treasuries by rules hard-coded in the treasury."),
      [
        { k: T("Дивиденды и сбор комиссий", "Dividends & fee collection"), v: T("каждый час (в тесте — каждую минуту): выплата держателям от $1, сбор доли площадки в сплиттер", "hourly (every minute during testing): payouts to holders from $1, platform share into the splitter") },
        { k: T("Арена", "Arena"), v: T("ежедневно 00:25 UTC — выкуп и сжигание вчерашнего подиума", "daily 00:25 UTC — buyback & burn of yesterday’s podium") },
        { k: T("Выкуп hood", "hood buyback"), v: T("ежедневно 00:45 UTC — вся казна выкупа → покупка hood и сжигание", "daily 00:45 UTC — whole buyback treasury → buy hood and burn") },
      ],
    ],
  },
  {
    id: "security", title: T("Безопасность и риски", "Security & risks"),
    body: [
      T("Монеты, пулы, мигратор, сплиттер и казны не имеют функций вывода, паузы или изменения правил. У фабрик есть владелец, который может менять только параметры будущих запусков (казна, мигратор, комиссия ≤ 5%) — через заявку с задержкой 48 часов, видимую всем в блокчейне. Уже запущенные монеты это не затрагивает.",
        "Coins, pools, the migrator, the splitter and treasuries have no withdraw, pause or rule-change functions. The factories have an owner who can only change parameters for future launches (treasury, migrator, fee ≤ 5%) through a proposal with a 48-hour delay visible on-chain. Already launched coins are unaffected."),
      { type: "note", text: T("Ни один контракт площадки не имеет функций паузы, вывода средств или изменения правил уже запущенных монет.", "No platform contract has pause, withdraw, or rule-change functions for already launched coins.") },
      T("Риски: токены волатильны и могут обесцениться полностью; сделки необратимы; курс акций-токенов зависит от ликвидности пулов Uniswap в сети; hood — независимый проект, не аффилированный с Robinhood Markets, Inc.",
        "Risks: tokens are volatile and can go to zero; transactions are irreversible; stock-token prices depend on Uniswap pool liquidity on the chain; hood is an independent project not affiliated with Robinhood Markets, Inc."),
    ],
  },
  {
    id: "links", title: T("Ссылки", "Links"),
    body: [
      [
        { k: T("Сайт", "Site"), v: "https://hoodandarrow.com", link: "https://hoodandarrow.com" },
        { k: "GitHub", v: REPO, link: REPO },
        { k: "X", v: "https://x.com/hoodandarrow", link: "https://x.com/hoodandarrow" },
        { k: T("Обозреватель", "Explorer"), v: EXPLORER, link: EXPLORER },
      ],
    ],
  },
];

/** Полоса долей: доли «выезжают» при появлении на экране; наведение на
 *  сегмент или подпись подсвечивает его, остальные приглушаются, внутри
 *  сегмента проступает процент. */
function Split({ b, L }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`docs-split ${seen ? "in" : ""} ${hi !== null ? "has-hi" : ""}`} ref={ref} onMouseLeave={() => setHi(null)}>
      <div className="docs-split-title">{L(b.title)}{hi !== null && <span className="docs-split-cur">{L(b.parts[hi].l)} · <b>{b.parts[hi].pct}%</b></span>}</div>
      <div className="docs-split-bar">
        {b.parts.map((p, j) => (
          <span key={j} className={`seg ${hi === j ? "hi" : ""}`} style={{ "--w": `${p.pct}%`, "--c": p.c, transitionDelay: seen ? `${j * 90}ms` : "0ms" }}
                onMouseEnter={() => setHi(j)}>
            <em>{p.pct}%</em>
          </span>
        ))}
      </div>
      <div className="docs-split-legend">
        {b.parts.map((p, j) => (
          <span key={j} className={hi === j ? "hi" : ""} onMouseEnter={() => setHi(j)}><i style={{ background: p.c }} />{L(p.l)} <b>{p.pct}%</b></span>
        ))}
      </div>
    </div>
  );
}

function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById("doc-" + id)).filter(Boolean);
    if (!els.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis.length) setActive(vis[0].target.id.replace("doc-", ""));
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids.join(",")]);
  return active;
}

export default function Docs() {
  const { lang, t } = useLang();
  const L = (x) => (x && typeof x === "object" && "ru" in x ? (lang === "ru" ? x.ru : x.en) : x);
  const ids = useMemo(() => SECTIONS.map((s) => s.id), []);
  const active = useScrollSpy(ids);
  const [copied, setCopied] = useState("");
  const copy = (v) => { try { navigator.clipboard.writeText(v); } catch (e) { /* ignore */ } setCopied(v); setTimeout(() => setCopied(""), 1200); };
  const go = (id) => (e) => { e.preventDefault(); document.getElementById("doc-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="docs">
      <aside className="docs-nav">
        <div className="docs-nav-title">{t("Документация")}</div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/docs`} className={`docs-nav-item ${active === s.id ? "on" : ""}`} onClick={go(s.id)}><i>{String(SECTIONS.indexOf(s) + 1).padStart(2, "0")}</i>{L(s.title)}</a>
        ))}
        <a className="docs-nav-item docs-nav-ext" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
      </aside>
      <div className="docs-body">
        <div className="docs-hero">
          <div className="docs-eyebrow">hood · docs · Robinhood Chain</div>
          <h1>{t("Документация")}</h1>
          <div className="docs-lead">{t("Как устроен hood: кривая, комиссии, арена, контракты. Обновлено 16.09.2026.")}</div>
          <div className="docs-hero-chips">
            <a href="#/docs" onClick={go("contracts")}>{t("Контракты")} →</a>
            <a href="#/docs" onClick={go("fees")}>{t("Комиссии и экономика")} →</a>
            <a href="#/docs" onClick={go("data")}>{t("Данные и API")} →</a>
          </div>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.id} id={"doc-" + s.id} className="docs-sec">
            <div className="docs-num">{String(SECTIONS.indexOf(s) + 1).padStart(2, "0")}</div>
            <h2>{L(s.title)}</h2>
            {s.body.map((b, i) => b && b.type === "stats" ? (
              <div className="docs-stats" key={i}>
                {b.items.map((it, j) => <div className="docs-stat" key={j}><div className="n">{it.n}</div><div className="l">{L(it.l)}</div></div>)}
              </div>
            ) : b && b.type === "split" ? (
              <Split key={i} b={b} L={L} />
            ) : b && b.type === "note" ? (
              <div className="docs-note" key={i}>{L(b.text)}</div>
            ) : Array.isArray(b) ? (
              <div className="docs-table" key={i}>
                {b.map((row, j) => (
                  <div className="docs-row" key={j}>
                    <span className="docs-k">{L(row.k)}</span>
                    <span className={`docs-v ${row.addr || row.link ? "mono" : ""}`}>
                      {row.link ? <a href={row.link} target="_blank" rel="noreferrer">{L(row.v)}</a>
                        : row.addr ? <>
                            <a href={`${EXPLORER}/address/${row.v}`} target="_blank" rel="noreferrer">{row.v}</a>
                            <button type="button" className="docs-copy" onClick={() => copy(row.v)} title={t("Скопировать адрес")}>{copied === row.v ? "✓" : "⧉"}</button>
                          </>
                        : L(row.v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p key={i}>{L(b)}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
