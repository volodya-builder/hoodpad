import React, { useEffect, useRef, useState } from "react";
import { parseEther, formatEther, parseUnits, decodeEventLog } from "viem";
import { publicClient } from "../lib/web3.js";
import { factoryAbi, quoteFactoryAbi, quotePoolAbi, erc20Abi, zapAbi, feeSplitterAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, QUOTE_LIVE, ZAP_ADDRESS, ZAP_LIVE, FEATURES, FEE_SPLITTER_ADDRESS, SPLITTER_LIVE, CREATOR_FEE_PCT } from "../lib/config.js";
import { useSplit, injectNewToken } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { useEthUsd, useQuoteUsd, moneyEth } from "../lib/price.js";
import { RWA_TOKENS, RWA_POPULAR, stockLogo, CHAIN_LOGOS } from "../lib/rwa.js";
import { loadCryptoQuotes, loadAllowedQuotes, loadZapQuotes, lookupQuote, matchQuote, featuredQuotes, short as shortAddr } from "../lib/quotes.js";
import { loadModels, featured, matchModel, modelLogo, costLabel, AI_AUTO } from "../lib/models.mjs";
import { fileToDataUrl } from "../lib/image.js";

// Логотип с фолбэком: если CDN не знает тикер — просто прячем картинку
const Logo = ({ src, cls }) => (
  <img className={cls} src={src} alt="" loading="lazy"
       onError={(e) => { e.currentTarget.style.display = "none"; }} />
);

// Векторная иконка «график вверх» — вместо эмодзи, чтобы рендерилось
// одинаково на всех платформах
const TrendIcon = () => (
  <svg className="rwa-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M1.5 12.5 L6 8 L9 10.5 L14.5 5" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11 5 H14.5 V8.5" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Искра для чипа «решит агент» — тот же приём, что TrendIcon: свой вектор,
// а не эмодзи, чтобы выглядело одинаково на всех платформах
const SparkIcon = () => (
  <svg className="rwa-ico q-logo-slot" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M8 1.5 L9.5 6.5 L14.5 8 L9.5 9.5 L8 14.5 L6.5 9.5 L1.5 8 L6.5 6.5 Z"
          fill="currentColor" />
  </svg>
);

// Max developer buy: 5% of supply bought at launch.
// gross ETH = (VIRT * s / (TOTAL - s)) / (1 - fee), s = 50M, VIRT = 1.625
const MAX_DEV_BUY_ETH = 1.625 * 0.05e9 / 0.95e9 / 0.99; // ≈ 0.0864

/** Downscale an image file to a square data URL (kept small enough to live
 *  on-chain inside the token's metadata URI).
 *  512px WebP with a stepped (2x-per-pass) downscale — sharp on retina cards,
 *  no JPEG mush on flat meme graphics. Falls back to smaller sizes if the
 *  result would bloat the tx calldata too much. */
const IMG_SIZE = 512;
const IMG_BUDGET = 120_000; // max data-URL chars (~90KB binary) per image


export default function Create({ wallet, onConnect }) {
  const split = useSplit();
  const { t } = useLang();
  const [form, setForm] = useState({
    name: "", symbol: "", description: "", x: "", telegram: "", initialBuy: "",
    creatorWallet: "", website: "", github: "", youtube: "",
  });
  // Тип токена: standard (работает сейчас) | tax (β — конфиг сохраняется черновиком
  // до деплоя tax-контрактов v3; UI полный, чтобы собирать спрос и параметры)
  const [ttype, setTtype] = useState("standard");
  // Валюта курвы: ETH (работает сейчас) | RWA — токенизированная акция Robinhood
  // (канонический реестр в lib/rwa.js; запуск откроется с ERC20-quote пулом)
  const [quoteTab, setQuoteTab] = useState("crypto");
  const [quote, setQuote] = useState("ETH"); // "ETH" | символ валюты
  // Адрес и знаки выбранной валюты (для ETH пусто). Нужны запуску через
  // quote-фабрику и первой покупке создателя: у USDG 6 знаков, у CBBTC 8.
  const [quoteAddr, setQuoteAddr] = useState("");
  const [quoteDec, setQuoteDec] = useState(18);
  const [rwaSearch, setRwaSearch] = useState("");
  const [rwaAll, setRwaAll] = useState(false); // показать все акции, а не первые 20
  const [cryptoSearch, setCryptoSearch] = useState("");
  // Крипто-валюты сети — живой список от обозревателя. null — читаем.
  const [crypto, setCrypto] = useState(null);
  // Белый список фабрики: за что запуск реально пройдёт. Пуст, пока
  // quote-фабрика не задеплоена, — и форма говорит об этом прямо.
  const [allowed, setAllowed] = useState(new Set());
  const [customAddr, setCustomAddr] = useState("");
  const [custom, setCustom] = useState(null); // валюта по своему адресу
  const [customBusy, setCustomBusy] = useState(false);
  // Налог в пользу холдеров, bps: 0 / 100 / 200 / 300. Берётся с каждой
  // сделки на кривой в валюте монеты и раздаётся по балансам. Только для
  // монет за ERC20-валюту: у ETH-фабрики такого механизма нет.
  const [divBps, setDivBps] = useState(0);
  useEffect(() => {
    let on = true;
    loadCryptoQuotes(60, (part) => on && setCrypto(part)).then((x) => on && setCrypto(x));
    loadAllowedQuotes().then(async (x) => {
      // Показываем только то, что можно купить за ETH: у покупателя на
      // кошельке ETH, а не TAO. Валюта без маршрута — мёртвая монета.
      const zapOk = await loadZapQuotes(x);
      if (on) setAllowed(zapOk);
    });
    return () => { on = false; };
  }, []);
  const pickQuote = (q) => { setQuote(q.sym); setQuoteAddr(q.addr); setQuoteDec(q.dec); };
  // Порог градации и кап создателя для выбранной валюты — из самой фабрики
  // (quoteConfig), а не из текста: цифры на превью должны быть теми, что
  // проверит контракт. virtualQuote × 4 = сколько соберёт кривая.
  const [qcfg, setQcfg] = useState(null); // { threshold, cap } в единицах валюты
  useEffect(() => {
    if (!QUOTE_LIVE || !quoteAddr) { setQcfg(null); return; }
    let on = true;
    publicClient.readContract({ address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "quoteConfig", args: [quoteAddr] })
      .then(([allowedQ, virt, cap]) => {
        if (!on) return;
        if (!allowedQ) { setQcfg(null); return; }
        const d = 10 ** quoteDec;
        setQcfg({ threshold: Number(virt * 4n) / d, cap: Number(cap) / d });
      })
      .catch(() => on && setQcfg(null));
    return () => { on = false; };
  }, [quoteAddr, quoteDec]);
  const fmtQ = (n) => (n >= 100 ? Math.round(n).toLocaleString("ru") : String(+n.toFixed(4)));
  // Порог и кап на превью — в ETH и долларах, как все деньги на сайте
  // (решение владельца 15.09.2026); в акции их не переводим.
  const ethUsd = useEthUsd();
  const quoteUsd = useQuoteUsd(quoteAddr);
  const moneyQ = (n) => moneyEth(n, quoteUsd, ethUsd);
  const pickEth = () => { setQuote("ETH"); setQuoteAddr(""); setQuoteDec(18); };
  const quoteAllowed = quote === "ETH" || (QUOTE_LIVE && allowed.has(quoteAddr));
  const quoteIcon = quoteTab === "rwa"
    ? stockLogo(quote)
    : ((crypto || []).find((q) => q.addr === quoteAddr)?.icon || custom?.icon || "");

  // Свой адрес: ищем валюту у обозревателя, а нет — спрашиваем контракт.
  useEffect(() => {
    const a = customAddr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setCustom(null); return; }
    let on = true;
    setCustomBusy(true);
    lookupQuote(a).then((q) => { if (!on) return; setCustom(q); if (q) pickQuote(q); })
      .finally(() => on && setCustomBusy(false));
    return () => { on = false; };
  }, [customAddr]);
  // Модель ИИ монеты. Пусто = «решит агент». Уезжает в метадату токена полем
  // ai — то есть в контракт, навсегда, как и картинка.
  const [ai, setAi] = useState(AI_AUTO);
  const [aiSearch, setAiSearch] = useState("");
  // Список живой: берём каталог OpenRouter при открытии формы. null — ещё
  // читаем, пустой — не достали, и тогда выбор не показываем вовсе.
  const [models, setModels] = useState(null);
  useEffect(() => { if (!FEATURES.ai) return undefined; let on = true; loadModels().then((x) => on && setModels(x)); return () => { on = false; }; }, []);
  const aiPick = (models || []).find((m) => m.id === ai) || null;
  // Доля создателя зависит от фабрики (ETH / за валюту) и от выбора ИИ:
  // с ИИ 10% комиссии идёт в бюджет агента монеты, без ИИ — создателю.
  // Строго ниже useState(ai) и useState(quote) — иначе TDZ-падение.
  const sp = quote === "ETH" ? split : (split.q || split);
  const creatorPct = sp.live && !ai ? sp.creatorNoAi : sp.creator;
  const [tax, setTax] = useState({ buy: 3, sell: 3, mkt: 40, burn: 20, div: 30, lp: 10, minShare: 0, divToken: "self" });
  const taxTotal = tax.mkt + tax.burn + tax.div + tax.lp;
  const ALLOC_KEYS = ["mkt", "burn", "div", "lp"];
  // Ползунки аллокации упираются в остаток до 100% — перебор невозможен
  const setTaxK = (k) => (e) => {
    let v = Math.max(0, +e.target.value || 0);
    if (ALLOC_KEYS.includes(k)) {
      const others = ALLOC_KEYS.filter((x) => x !== k).reduce((s, x) => s + tax[x], 0);
      v = Math.min(v, Math.max(0, 100 - others));
    }
    setTax({ ...tax, [k]: v });
  };
  const [consent, setConsent] = useState(false);
  const [image, setImage] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Что после запуска: вторая подпись «включить ИИ» (сплиттер), её итог.
  const [aiStep, setAiStep] = useState(""); // "" | "sign" | "skipped"
  const fileRef = useRef(null);

  const ZERO = "0x0000000000000000000000000000000000000000";

  const set = (k) => (e) =>
    setForm({ ...form, [k]: k === "symbol" ? e.target.value.toUpperCase() : e.target.value });

  const buyValue = parseFloat(form.initialBuy) || 0;
  const symbolOk = /^[A-Z0-9]*$/.test(form.symbol);
  const buyOk = buyValue <= MAX_DEV_BUY_ETH;
  const walletOk =
    form.creatorWallet.trim() === "" || /^0x[0-9a-fA-F]{40}$/.test(form.creatorWallet.trim());

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setImage(await fileToDataUrl(f, { size: IMG_SIZE, budget: IMG_BUDGET }));
    } catch {
      setError(t("Не удалось прочитать изображение"));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (quote !== "ETH" && !quoteAllowed) {
      // Валюта выбрана, но запустить за неё пока нельзя: либо quote-фабрика
      // ещё не задеплоена, либо валюты нет в её белом списке. Черновик
      // сохраняем — это и есть спрос, по которому список пополняется.
      try { localStorage.setItem("hood_quote_draft", JSON.stringify({ form, ai, quote, quoteAddr, quoteDec, divBps, savedAt: Date.now() })); } catch (e) { /* ignore */ }
      return setError(!QUOTE_LIVE
        ? t("Запуск за {sym} откроется с деплоем ERC20-пула курвы. Черновик сохранён.").replace("{sym}", quote)
        : t("{sym} пока не в белом списке фабрики. Черновик сохранён — валюту проверим и добавим.").replace("{sym}", quote));
    }
    if (ttype === "tax") {
      if (taxTotal !== 100) return setError(t("Аллокация налога должна давать ровно 100%."));
      try { localStorage.setItem("hood_tax_draft", JSON.stringify({ form, ai, tax, savedAt: Date.now() })); } catch (e) { /* ignore */ }
      return setError(t("Tax-токены (v3) на подходе: контракты в разработке. Черновик с твоими параметрами сохранён — запуск откроется в один клик."));
    }
    if (!wallet) return onConnect();
    if (!image) return setError(t("Добавьте картинку токена."));
    if (!form.name.trim() || !form.symbol.trim()) return setError(t("Нужны название и тикер."));
    // контракт считает байты (64 / 12), а поле — символы: эмодзи и кириллица весят 2–4 байта
    const bytes = (x) => new TextEncoder().encode(x).length;
    if (bytes(form.name.trim()) > 64) return setError(t("Название слишком длинное для контракта — укоротите (эмодзи и кириллица считаются за несколько знаков)."));
    if (bytes(form.symbol.trim()) > 12) return setError(t("Тикер слишком длинный для контракта — укоротите."));
    if (!symbolOk) return setError(t("Тикер: только буквы и цифры."));
    if (quote === "ETH" && !buyOk) return setError(t("Покупка создателя ограничена {max} ETH (5% сапплая).").replace("{max}", MAX_DEV_BUY_ETH.toFixed(4)));
    if (!walletOk) return setError(t("Кошелёк создателя: неверный адрес (нужен 0x… из 42 символов)."));

    setBusy(true);
    try {
      const metadata = {
        description: form.description.trim(),
        image, // self-contained data URL — no external hosting
        x: form.x.trim(),
        telegram: form.telegram.trim(),
        website: form.website.trim(),
        github: form.github.trim(),
        youtube: form.youtube.trim(),
        // Модель ИИ монеты. Пишем только когда выбрали: пустое поле — лишние
        // байты в calldata, за которые платит создатель. Имя кладём рядом,
        // чтобы страница монеты показывала его, не ходя в каталог.
        ...(ai ? { ai, aiName: aiPick?.name || ai } : {}),
      };
      const uri =
        "data:application/json;base64," +
        btoa(unescape(encodeURIComponent(JSON.stringify(metadata))));

      const byQuote = quote !== "ETH";
      let hash;
      if (byQuote) {
        // ERC20-валюта не может прийти вместе с деплоем, как ETH: сначала
        // запуск, потом (если просили) approve + первая покупка отдельно.
        hash = await wallet.walletClient.writeContract({
          address: QUOTE_FACTORY_ADDRESS,
          abi: quoteFactoryAbi,
          functionName: "createToken",
          args: [form.name.trim(), form.symbol.trim(), uri, quoteAddr, form.creatorWallet.trim() || ZERO, divBps],
        });
      } else {
        const value = buyValue > 0 ? parseEther(form.initialBuy) : 0n;
        hash = await wallet.walletClient.writeContract({
          address: FACTORY_ADDRESS,
          abi: factoryAbi,
          functionName: "createToken",
          args: [form.name.trim(), form.symbol.trim(), uri, form.creatorWallet.trim() || ZERO],
          value,
        });
      }
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      const evAbi = byQuote ? quoteFactoryAbi : factoryAbi;
      const created = rcpt.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: evAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((ev) => ev && ev.eventName === "TokenCreated");

      if (byQuote && buyValue > 0 && ZAP_LIVE) {
        // Первая покупка создателя — за ETH через zap: он сам меняет ETH на
        // валюту и покупает на кривой. Кап создателя проверяет пул.
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
        // minOut из симуляции того же вызова (−5% на чужие сделки и обмен):
        // с нулём первую покупку создателя можно было зажать сэндвичем
        let minOut = 0n;
        try {
          const { result } = await publicClient.simulateContract({
            account: wallet.account, address: ZAP_ADDRESS, abi: zapAbi, functionName: "buyWithEth",
            args: [created.args.token, 0n, deadline], value: parseEther(form.initialBuy),
          });
          minOut = (BigInt(result) * 95n) / 100n;
        } catch { /* оценка не удалась — идём без минимума, как раньше */ }
        const b = await wallet.walletClient.writeContract({
          address: ZAP_ADDRESS, abi: zapAbi, functionName: "buyWithEth",
          args: [created.args.token, minOut, deadline], value: parseEther(form.initialBuy),
        });
        await publicClient.waitForTransactionReceipt({ hash: b });
      } else if (byQuote && buyValue > 0) {
        // Без zap — в самой валюте: approve на пул, затем buy.
        const amount = parseUnits(form.initialBuy, quoteDec);
        const pool = created.args.pool;
        const a = await wallet.walletClient.writeContract({
          address: quoteAddr, abi: erc20Abi, functionName: "approve", args: [pool, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: a });
        let minOut = 0n;
        try {
          const out = await publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "quoteBuy", args: [amount] });
          minOut = (BigInt(out) * 97n) / 100n;
        } catch { /* без минимума */ }
        const b = await wallet.walletClient.writeContract({
          address: pool, abi: quotePoolAbi, functionName: "buy", args: [amount, minOut, wallet.account],
        });
        await publicClient.waitForTransactionReceipt({ hash: b });
      }
      // Выбрали модель — включаем ИИ монете в сплиттере (навсегда). Это
      // подпись создателя: только его кошелёк может это сделать. Отказ —
      // не ошибка: монета живёт без ИИ, включить можно со страницы монеты.
      if (ai && SPLITTER_LIVE) {
        const creatorW = (form.creatorWallet.trim() || wallet.account).toLowerCase();
        if (creatorW === wallet.account.toLowerCase()) {
          setAiStep("sign");
          try {
            const e = await wallet.walletClient.writeContract({
              address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "enableAi", args: [created.args.token],
            });
            await publicClient.waitForTransactionReceipt({ hash: e });
            setAiStep("");
          } catch (e2) { setAiStep("skipped"); }
        } else {
          setAiStep("skipped");
        }
      }
      // мгновенно кладём токен в кэш — карточка видна сразу, без ожидания индексатора
      injectNewToken({
        token: created.args.token,
        pool: created.args.pool,
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        uri,
        creator: wallet.account,
        ...(byQuote ? { quote: quoteAddr, quoteSym: quote, quoteDec } : {}),
      });
      window.location.hash = `#/token/${created.args.token}`;
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  const ctaLabel = busy
    ? (aiStep === "sign" ? t("Включаю ИИ — подпишите в кошельке…") : t("Запускаем…"))
    : ttype === "tax"
    ? t("Сохранить черновик tax-токена")
    : !wallet
    ? t("Подключите кошелёк")
    : !image
    ? t("Добавьте картинку токена")
    : !form.name.trim() || !form.symbol.trim()
    ? t("Укажите название и тикер")
    : buyValue > 0
    ? t("Запустить токен и купить на {eth} {q}").replace("{eth}", form.initialBuy).replace("{q}", ZAP_LIVE ? "ETH" : quote)
    : t("Запустить токен");

  return (
    <div className="create-layout">
      <form className="panel" onSubmit={submit}>
        <h2>{t("Запустить токен")}</h2>

        {/* Выбор типа токена скрыт, пока tax-токен не построен (FEATURES.taxToken):
            без второго варианта одна карточка «Обычный токен» — лишний шум. */}
        {FEATURES.taxToken && (
        <div className="ttype-row">
          <div className={`ttype-card ${ttype === "standard" ? "on" : ""}`} onClick={() => setTtype("standard")}>
            <b>{t("Обычный токен")}</b>
            <span>{t("фиксированный сапплай, без налога — работает сейчас")}</span>
          </div>
          <div className={`ttype-card ${ttype === "tax" ? "on" : ""}`} onClick={() => setTtype("tax")}>
            <b>{t("Tax-токен")} <em className="ttype-beta">β</em></b>
            <span>{t("налог с трейдов: кошелёк, сжигание, награды, ликвидность")}</span>
          </div>
        </div>
        )}

        {FEATURES.quoteLaunch && (<>
        <label>{t("Валюта курвы")}</label>
        <div className="quote-tabs">
          <button type="button" className={`quote-tab ${quoteTab === "crypto" ? "on" : ""}`}
                  onClick={() => { setQuoteTab("crypto"); pickEth(); }}>{t("Крипта")}</button>
          <button type="button" className={`quote-tab ${quoteTab === "rwa" ? "on" : ""}`}
                  onClick={() => setQuoteTab("rwa")}><TrendIcon /> {t("Акции (RWA)")} <em className="ttype-beta">β</em></button>
        </div>
        {quoteTab === "crypto" ? (
          <>
            <input className="quote-search" value={cryptoSearch} onChange={(e) => setCryptoSearch(e.target.value)}
                   placeholder={t("Поиск: USDG, WETH, LINK…")} />
            <div className="quote-grid">
              <button type="button" className={`quote-chip ${quote === "ETH" ? "on" : ""}`} onClick={pickEth}>
                <Logo cls="q-logo" src={CHAIN_LOGOS.ethereum} />ETH
              </button>
              {(cryptoSearch
                ? (crypto || []).filter((q) => (!QUOTE_LIVE || allowed.has(q.addr)) && matchQuote(q, cryptoSearch)).slice(0, 18)
                : featuredQuotes(crypto, allowed)
              ).map((q) => {
                  const ok = !QUOTE_LIVE || allowed.has(q.addr);
                  return (
                    <button type="button" key={q.addr}
                            className={`quote-chip ${quote === q.sym && quoteAddr === q.addr ? "on" : ""} ${ok ? "" : "q-off"}`}
                            onClick={() => pickQuote(q)}
                            title={`${q.name} · ${shortAddr(q.addr)}${ok ? "" : " · " + t("пока не в белом списке")}`}>
                      <Logo cls="q-logo" src={q.icon} />{q.sym}
                    </button>
                  );
                })}
              {crypto === null && <span className="dim" style={{ padding: "8px 4px", fontSize: 13 }}>{t("Читаю валюты сети…")}</span>}
            </div>

            {/* Свой адрес — как на flap: любой ERC20 сети. Но решает белый
                список фабрики, и это сказано рядом, а не спрятано. */}
            {FEATURES.customQuote && (
            <div className="quote-custom">
              <input className="quote-search" value={customAddr} onChange={(e) => setCustomAddr(e.target.value.trim())}
                     placeholder={t("Свой контракт: 0x…")} spellCheck={false} />
              {customBusy && <span className="dim">{t("смотрю…")}</span>}
              {custom && (
                <span className="quote-custom-found">
                  <Logo cls="q-logo" src={custom.icon} />
                  <b>{custom.sym}</b> {custom.name} · {t("знаков")}: {custom.dec}
                  {custom.stock && <> · {t("это акция")}</>}
                </span>
              )}
              {!custom && !customBusy && /^0x[0-9a-fA-F]{40}$/.test(customAddr) && (
                <span className="dim">{t("По этому адресу нет ERC20-токена.")}</span>
              )}
            </div>
            )}

            {quote !== "ETH" && <div className="hint">
              {!QUOTE_LIVE
                  ? t("Запуск за {sym} откроется с деплоем ERC20-пула курвы — контракты готовы и проверены. Выбор сохранится в черновике.").replace("{sym}", quote)
                  : quoteAllowed
                    ? t("Покупают и продают за ETH — одной транзакцией. Дивиденды холдерам начисляются с каждой сделки.")
                    : t("{sym} пока не в белом списке фабрики. Валюты с комиссией на перевод или ребейзом ломают кривую, поэтому каждую проверяем перед добавлением. Выбор сохранится в черновике.").replace("{sym}", quote)}
            </div>}
          </>
        ) : (
          <>
            <input className="quote-search" value={rwaSearch} onChange={(e) => setRwaSearch(e.target.value.toUpperCase())}
                   placeholder={t("Поиск тикера: NVDA, AAPL, TSLA…")} />
            <div className="quote-grid">
              {(() => {
                // Только акции из белого списка фабрики: за остальные запуск
                // невозможен, и показывать их — обещать то, чего нет.
                const listed = QUOTE_LIVE
                  ? RWA_TOKENS.filter((x) => allowed.has(x.addr.toLowerCase()))
                  : RWA_TOKENS.filter((x) => RWA_POPULAR.includes(x.sym));
                // Популярные — первыми, остальные по алфавиту: разрешённых
                // бумаг семь десятков, глазами ищут по знакомым тикерам.
                const rank = (x) => { const i = RWA_POPULAR.indexOf(x.sym); return i < 0 ? 99 : i; };
                listed.sort((a, b) => rank(a) - rank(b) || a.sym.localeCompare(b.sym));
                const q = rwaSearch.trim();
                if (q) return listed.filter((x) => x.sym.includes(q) || (x.name || "").toUpperCase().includes(q)).slice(0, 24);
                // Семь десятков чипов — простыня, особенно на телефоне: первые
                // 20 (популярные), остальное по кнопке «ещё» или поиском.
                const LIMIT = 20;
                if (rwaAll || listed.length <= LIMIT) return listed;
                return [...listed.slice(0, LIMIT), { sym: `+${listed.length - LIMIT}`, more: true }];
              })().map((x) => x.more ? (
                <button type="button" key="more" className="quote-chip q-more" onClick={() => setRwaAll(true)}
                        title={t("Показать все")}>
                  {x.sym} {t("ещё")}
                </button>
              ) : (
                <button type="button" key={x.sym}
                        className={`quote-chip ${quote === x.sym ? "on" : ""}`}
                        onClick={() => pickQuote({ sym: x.sym, addr: x.addr.toLowerCase(), dec: 18 })}
                        title={x.name ? `${x.name} · ${x.addr}` : x.addr}>
                  <Logo cls="q-logo" src={stockLogo(x.sym)} />{x.sym}
                </button>
              ))}
            </div>
            <div className="hint">
              {!QUOTE_LIVE
                ? t("Токен будет торговаться за акцию Robinhood (канонические Stock Tokens, {n} шт.). Запуск с RWA-валютой откроется с деплоем ERC20-пула курвы — выбор сохранится в черновике.").replace("{n}", String(RWA_TOKENS.length))
                : quoteAllowed && quote !== "ETH"
                  ? t("Покупают и продают за ETH — одной транзакцией. Дивиденды холдерам начисляются с каждой сделки.")
                  : t("Акции Robinhood, за которые можно запустить монету. Нужна другая — напишите нам, добавим.")}
            </div>
          </>
        )}
        </>)}

        {FEATURES.ai && models !== null && models.length > 0 && (
          <>
            <label>{t("Модель ИИ монеты")}</label>
            <input className="quote-search" value={aiSearch} onChange={(e) => setAiSearch(e.target.value)}
                   placeholder={t("Поиск: Claude, GPT, Gemini…")} />
            <div className="quote-grid">
              <button type="button" className={`quote-chip ${ai === AI_AUTO ? "on" : ""}`}
                      onClick={() => setAi(AI_AUTO)}>
✕ {t("Без агента")}
              </button>
              {(aiSearch
                ? models.filter((m) => matchModel(m, aiSearch)).slice(0, 18)
                : featured(models)
              ).map((m) => (
                <button type="button" key={m.id} className={`quote-chip ${ai === m.id ? "on" : ""}`}
                        onClick={() => setAi(m.id)} title={`${m.id} · ${costLabel(m.cost)} ${t("за страницу")}`}>
                  <Logo cls="q-logo" src={modelLogo(m.id)} />{m.name}
                </button>
              ))}
            </div>
            <div className="hint">
              {aiPick
                ? t("ИИ монеты будет работать на {m} — это модель {by}, одна страница на ней обходится примерно в {c}. Выбор записывается в саму монету и виден всем. Если её снимут с обслуживания, агент возьмёт другую и честно напишет об этом в журнале.")
                    .replace("{m}", aiPick.name).replace("{by}", aiPick.by).replace("{c}", costLabel(aiPick.cost))
                : t("Без агента — обычная монета без ИИ. Выберите модель — у монеты появится свой агент: холдеры голосуют, что строить, он строит и выкатывает. Список живой: модели отсортированы по тому, насколько хорошо они делают веб-страницы.")}
              {sp.live && (
                <> {ai
                  ? t("Агент живёт на комиссиях монеты: {agent}% комиссии идут в его бюджет, вам — {c}% вместо {n}%. После запуска будет вторая подпись — «включить ИИ», это навсегда.")
                      .replace("{agent}", String(sp.agent)).replace("{c}", String(sp.creator)).replace("{n}", String(sp.creatorNoAi))
                  : t("Без агента вам достаётся {n}% комиссии; с агентом — {c}%, разница идёт в его бюджет.")
                      .replace("{n}", String(sp.creatorNoAi)).replace("{c}", String(sp.creator))}</>
              )}
            </div>
          </>
        )}

        {FEATURES.quoteLaunch && (
          <>
            <label>{t("Дивиденды холдерам")}</label>
            {quote === "ETH" ? (
              // Монета за «голый» ETH живёт на первой фабрике — дивидендов там
              // нет. Блок не прячем, чтобы было видно, где это включается:
              // выбрать WETH (те же покупки за ETH, одной транзакцией) или
              // любую другую валюту.
              <>
                <div className="quote-grid">
                  {[0, 100, 200, 300].map((b) => (
                    <button type="button" key={b} className={`quote-chip ${b === 0 ? "on" : ""} q-off`} disabled>
                      {b === 0 ? t("без дивидендов") : `${b / 100}%`}
                    </button>
                  ))}
                </div>
                <div className="hint">
                  {t("У монеты за ETH дивидендов нет — их платит только монета за валюту. Хотите дивиденды в эфире — выберите WETH: покупатели так же платят ETH, одной транзакцией.")}
                </div>
              </>
            ) : (
              <>
                <div className="quote-grid">
                  {[0, 100, 200, 300].map((b) => (
                    <button type="button" key={b} className={`quote-chip ${divBps === b ? "on" : ""}`}
                            onClick={() => setDivBps(b)}>
                      {b === 0 ? t("без дивидендов") : `${b / 100}%`}
                    </button>
                  ))}
                </div>
                <div className="hint">
                  {divBps === 0
                    ? t("Можно включить налог 1–3% с каждой сделки: он берётся в {q} и раздаётся холдерам по балансу. Держишь — капает, продал — перестало.").replace("{q}", quote)
                    : t("С каждой покупки и продажи {p}% уходит холдерам — в {q}, а не в самой монете. Это сверх комиссии площадки; трейдер видит полную ставку до сделки. Ставка записывается в контракт и не меняется.").replace("{p}", String(divBps / 100)).replace("{q}", quote)}
                </div>
              </>
            )}
          </>
        )}

        <div className="field-row">
          <div>
            <label>{t("Название")}</label>
            <input value={form.name} onChange={set("name")} placeholder={t("Название токена")} maxLength={32} />
            <div className="hint">{t("Буквы, цифры и пробелы. Максимум 32 символа.")}</div>
          </div>
          <div>
            <label>{t("Тикер")}</label>
            <input value={form.symbol} onChange={set("symbol")} placeholder={t("СИМВОЛ")} maxLength={10} />
            <div className={`hint ${symbolOk ? "" : "bad"}`}>
              {symbolOk ? t("Буквы и цифры. Максимум 10 символов.") : t("Только буквы и цифры!")}
            </div>
          </div>
        </div>

        <label>{t("Описание")}</label>
        <textarea rows={3} value={form.description} onChange={set("description")} placeholder={t("Короткое описание токена")} />

        <label>{t("Картинка токена")}</label>
        <label className="check-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            {t("Я понимаю, что изображение будет опубликовано в блокчейне и станет частью неизменяемых метаданных токена.")}
          </span>
        </label>
        <div
          className={`upload-box ${image ? "ready" : ""} ${consent ? "" : "disabled"}`}
          onClick={() => consent && fileRef.current?.click()}
        >
          <div className="upload-thumb">{image ? <img src={image} alt="" /> : <svg className="img-ph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="9" cy="9.5" r="1.6" fill="currentColor"/><path d="M4.5 17.5l4.6-4.6a1.2 1.2 0 0 1 1.7 0l2.4 2.4 2.1-2.1a1.2 1.2 0 0 1 1.7 0l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>
          <span>
            {image
              ? t("Картинка загружена — нажмите, чтобы заменить")
              : consent
              ? t("Выбрать картинку токена")
              : t("Сначала подтвердите публикацию")}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />

        <div className="field-row">
          <div>
            <label>{t("Профиль X")}</label>
            <div className="prefix-input">
              <span>x.com/</span>
              <input value={form.x} onChange={set("x")} placeholder="handle" />
            </div>
          </div>
          <div>
            <label>Telegram</label>
            <div className="prefix-input">
              <span>t.me/</span>
              <input value={form.telegram} onChange={set("telegram")} placeholder="community" />
            </div>
          </div>
        </div>

        <div className="field-row">
          <div>
            <label>GitHub</label>
            <div className="prefix-input">
              <span>github.com/</span>
              <input value={form.github} onChange={set("github")} placeholder="repo" />
            </div>
          </div>
          <div>
            <label>YouTube</label>
            <div className="prefix-input">
              <span>youtube.com/</span>
              <input value={form.youtube} onChange={set("youtube")} placeholder="@channel" />
            </div>
          </div>
        </div>

        {ttype === "tax" && (
          <div className="tax-panel">
            <div className="tax-head">{t("Настройки налога")} <span className="rev-demo-tag">β</span></div>

            <div className="field-row">
              <div>
                <label>{t("Налог на покупку")}: <b>{tax.buy}%</b></label>
                <input type="range" min="0" max="10" step="1" value={tax.buy} onChange={setTaxK("buy")} />
              </div>
              <div>
                <label>{t("Налог на продажу")}: <b>{tax.sell}%</b></label>
                <input type="range" min="0" max="10" step="1" value={tax.sell} onChange={setTaxK("sell")} />
              </div>
            </div>

            <div className="tax-head2">{t("Куда идёт налог")} <b className={taxTotal === 100 ? "ok" : "bad"}>{taxTotal}%</b></div>
            <div className="tax-alloc-wrap">
              <div className="tax-donut-col">
                <div className="tax-donut" style={{ background: (() => {
                  const base = Math.max(taxTotal, 100);
                  const p = (v) => (v / base) * 100;
                  let a = 0;
                  const seg = (v, c) => { const s = `${c} ${a}% ${a + p(v)}%`; a += p(v); return s; };
                  const parts = [seg(tax.mkt, "var(--gold)"), seg(tax.burn, "#8b5cf6"), seg(tax.div, "#e06a4a"), seg(tax.lp, "#2bd4c8")];
                  if (taxTotal < 100) parts.push(`#ffffff12 ${a}% 100%`);
                  return `conic-gradient(${parts.join(", ")})`;
                })() }}>
                  <div className="tax-donut-hole">
                    <b className={taxTotal === 100 ? "ok" : "bad"}>{taxTotal}%</b>
                    <span>{taxTotal === 100 ? t("готово") : t("аллокация")}</span>
                  </div>
                </div>
                <div className="tax-legend">
                  <span><i style={{ background: "var(--gold)" }} />{t("Кошелёк создателя")} <b>{tax.mkt}%</b></span>
                  <span><i style={{ background: "#8b5cf6" }} />{t("Сжигание")} <b>{tax.burn}%</b></span>
                  <span><i style={{ background: "#e06a4a" }} />{t("Награды")} <b>{tax.div}%</b></span>
                  <span><i style={{ background: "#2bd4c8" }} />{t("Ликвидность")} <b>{tax.lp}%</b></span>
                  {taxTotal < 100 && <span><i style={{ background: "#ffffff26" }} />{t("Не распределено")} <b className="bad">{100 - taxTotal}%</b></span>}
                </div>
              </div>
              <div className="tax-alloc">
                <label>{t("Кошелёк создателя (дев, маркетинг)")}: <b>{tax.mkt}%</b>
                  <input type="range" min="0" max="100" step="5" value={tax.mkt} onChange={setTaxK("mkt")} /></label>
                <label>{t("Сжигание (дефляция)")}: <b>{tax.burn}%</b>
                  <input type="range" min="0" max="100" step="5" value={tax.burn} onChange={setTaxK("burn")} /></label>
                <label>{t("Награды холдерам")}: <b>{tax.div}%</b>
                  <input type="range" min="0" max="100" step="5" value={tax.div} onChange={setTaxK("div")} /></label>
                <label>{t("В ликвидность")}: <b>{tax.lp}%</b>
                  <input type="range" min="0" max="100" step="5" value={tax.lp} onChange={setTaxK("lp")} /></label>
              </div>
            </div>
            {taxTotal !== 100 && <div className="hint bad">{t("Сумма аллокации должна быть ровно 100% (сейчас {n}%).").replace("{n}", String(taxTotal))}</div>}

            <div className="field-row">
              <div>
                <label>{t("Мин. баланс для наград (токенов)")}</label>
                <input type="number" min="0" value={tax.minShare} onChange={setTaxK("minShare")} />
              </div>
              <div>
                <label>{t("Награды выплачиваются в")}</label>
                <div className="quote-tabs" style={{ margin: "6px 0 0" }}>
                  <button type="button" className={`quote-tab qt-sm ${tax.divToken === "self" ? "on" : ""}`}
                          onClick={() => setTax({ ...tax, divToken: "self" })}>{t("самом токене")}</button>
                  <button type="button" className={`quote-tab qt-sm ${tax.divToken === "eth" ? "on" : ""}`}
                          onClick={() => setTax({ ...tax, divToken: "eth" })}>ETH</button>
                </div>
              </div>
            </div>

            <div className="hint">{t("Tax-контракты v3 в разработке (аналог flap tax token: асимметричный налог, авто-раздача). Сейчас конфиг сохраняется черновиком — запуск откроется в один клик, черновик подставится сам.")}</div>
          </div>
        )}

        <label>{t("Покупка создателя")}</label>
        <div className="suffix-input">
          <input value={form.initialBuy} onChange={set("initialBuy")} placeholder="0.00" inputMode="decimal" />
          <b>{ZAP_LIVE ? "ETH" : quote}</b>
        </div>
        <div className={`hint ${quote === "ETH" && !buyOk ? "bad" : ""}`}>
          {quote !== "ETH"
            ? (qcfg
                ? t("Кап создателя — {cap} за всё время кривой (10% порога). {how} Перебор откатит контракт.")
                    .replace("{cap}", moneyQ(qcfg.cap))
                    .replace("{how}", ZAP_LIVE ? t("Платите ETH, одной транзакцией.") : t("Нужен {q} на кошельке и разрешение пулу.").replace("{q}", quote))
                : t("Кап создателя задаёт фабрика для каждой валюты. Перебор откатит контракт."))
            : (buyOk
                ? t("Макс {max} ETH · 5% сапплая. Исполняется в той же транзакции — защита от снайперов.")
                : t("Больше лимита: максимум {max} ETH (5% сапплая).")
              ).replace("{max}", MAX_DEV_BUY_ETH.toFixed(4))}
        </div>

        <div
          className={`adv-toggle ${advOpen ? "open" : ""}`}
          onClick={() => setAdvOpen(!advOpen)}
        >
          <span>{t("Дополнительно")}</span>
          <span className="chev">▾</span>
        </div>
        {advOpen && (
          <div className="adv-body open">
            <label>{t("Кошелёк создателя")}</label>
            <input
              value={form.creatorWallet}
              onChange={set("creatorWallet")}
              placeholder={wallet ? wallet.account : "0x…"}
              spellCheck={false}
            />
            <div className={`hint ${walletOk ? "" : "bad"}`}>
              {walletOk
                ? t("Получает долю создателя в комиссиях ({pct}%) и покупку создателя. Оставьте пустым, чтобы использовать подключённый кошелёк.").replace("{pct}", split.creator)
                : t("Неверный адрес: нужен формат 0x… (42 символа).")}
            </div>

            <label>{t("Сайт")}</label>
            <input
              value={form.website}
              onChange={set("website")}
              placeholder="https://example.com"
              inputMode="url"
            />
          </div>
        )}

        <div className="due-row">
          <span>{t("Uniswap V3 после градации · ликвидность запирается навсегда")}</span>
          <span><b style={{ color: "var(--accent)" }}>{t("Комиссия запуска")}: 0 ETH</b></span>
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>{ctaLabel}</button>
        {error && <div className="error">{error}</div>}
      </form>

      <aside className="preview-card">
        <div className="preview-img">{image ? <img src={image} alt="" /> : <svg className="img-ph" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="9" cy="9.5" r="1.6" fill="currentColor"/><path d="M4.5 17.5l4.6-4.6a1.2 1.2 0 0 1 1.7 0l2.4 2.4 2.1-2.1a1.2 1.2 0 0 1 1.7 0l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>
        <div className="preview-name">{form.name.trim() || t("Ваш токен")}</div>
        <div className="preview-ticker">{form.symbol ? `$${form.symbol}` : t("тикер")}</div>
        <div className="preview-stats">
          <div className="row"><span className="k">{t("Комиссия запуска")}</span><span className="v green">0 ETH</span></div>
          {/* Комиссия — простыми словами: одна строка «сколько берётся» и
              кому уходит, без bps и долей от долей. Цифры — с цепи. */}
          <div className="row"><span className="k">{t("Комиссия с каждой сделки")}</span><span className="v">1%</span></div>
          {/* Только доля создателя — остальных получателей не показываем (решение владельца 15.09.2026). */}
          <div className="row sub"><span className="k">↳ {t("вам, создателю монеты")}</span><span className="v green">{CREATOR_FEE_PCT}%</span></div>
          {FEATURES.ai && <div className="row"><span className="k">{t("ИИ-агент монеты")}</span><span className="v">{aiPick ? aiPick.name : t("нет")}</span></div>}
          <div className="row"><span className="k">{t("Валюта курвы")}</span><span className="v">
            {quote === "ETH" ? "ETH" : <><Logo cls="pv-qlogo" src={quoteIcon} />{quote}</>}
          </span></div>
          <div className="row"><span className="k">{t("Градация")}</span><span className="v">
            {quote === "ETH" ? "6.5 ETH" : qcfg ? moneyQ(qcfg.threshold) : "…"}
          </span></div>
          {quote !== "ETH" && qcfg && (
            <div className="row"><span className="k">{t("Кап создателя")}</span><span className="v">{moneyQ(qcfg.cap)}</span></div>
          )}
          {quote !== "ETH" && divBps > 0 && (
            <div className="row"><span className="k">{t("Дивиденды холдерам")}</span><span className="v">{divBps / 100}%</span></div>
          )}
          <div className="row"><span className="k">{t("Ликвидность")}</span><span className="v">{t("Заперта навсегда")}</span></div>
          {buyValue > 0 && (
            <div className="row"><span className="k">{t("Ваша покупка")}</span><span className="v">{form.initialBuy} {ZAP_LIVE ? "ETH" : quote}</span></div>
          )}
        </div>
      </aside>
    </div>
  );
}
