import React, { useRef, useState } from "react";
import { parseEther, formatEther, decodeEventLog } from "viem";
import { publicClient } from "../lib/web3.js";
import { factoryAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS } from "../lib/config.js";
import { useSplit, injectNewToken } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 1) crop to centered square
      const s = Math.min(img.width, img.height);
      let cur = document.createElement("canvas");
      cur.width = cur.height = s;
      let cx = cur.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, s, s);
      // 2) stepped downscale (halve until близко к цели) — без «лесенки»
      let size = s;
      while (size / 2 >= IMG_SIZE) {
        size = Math.floor(size / 2);
        const next = document.createElement("canvas");
        next.width = next.height = size;
        const nx = next.getContext("2d");
        nx.imageSmoothingQuality = "high";
        nx.drawImage(cur, 0, 0, size, size);
        cur = next;
      }
      // 3) финальный размер + подбор формата/качества под бюджет
      const attempts = [
        [IMG_SIZE, "image/webp", 0.90],
        [IMG_SIZE, "image/webp", 0.80],
        [IMG_SIZE, "image/jpeg", 0.85], // Safari без WebP-энкодера вернёт png → пропустит
        [256, "image/webp", 0.85],
        [256, "image/jpeg", 0.85],
        [128, "image/jpeg", 0.85],
      ];
      let fallback = "";
      for (const [dim, mime, q] of attempts) {
        const c = document.createElement("canvas");
        c.width = c.height = dim;
        const dx = c.getContext("2d");
        dx.imageSmoothingQuality = "high";
        dx.drawImage(cur, 0, 0, dim, dim);
        const out = c.toDataURL(mime, q);
        if (!out.startsWith(`data:${mime}`)) continue; // формат не поддержан
        if (!fallback) fallback = out;
        if (out.length <= IMG_BUDGET) return resolve(out);
      }
      resolve(fallback || cur.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = url;
  });
}

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
  const [tax, setTax] = useState({ buy: 3, sell: 3, mkt: 40, burn: 20, div: 30, lp: 10, minShare: 0, divToken: "self" });
  const taxTotal = tax.mkt + tax.burn + tax.div + tax.lp;
  const setTaxK = (k) => (e) => setTax({ ...tax, [k]: Math.max(0, +e.target.value || 0) });
  const [consent, setConsent] = useState(false);
  const [image, setImage] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      setImage(await fileToDataUrl(f));
    } catch {
      setError(t("Не удалось прочитать изображение"));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (ttype === "tax") {
      if (taxTotal !== 100) return setError(t("Аллокация налога должна давать ровно 100%."));
      try { localStorage.setItem("hood_tax_draft", JSON.stringify({ form, tax, savedAt: Date.now() })); } catch (e) { /* ignore */ }
      return setError(t("Tax-токены (v3) на подходе: контракты в разработке. Черновик с твоими параметрами сохранён — запуск откроется в один клик."));
    }
    if (!wallet) return onConnect();
    if (!image) return setError(t("Добавьте картинку токена."));
    if (!form.name.trim() || !form.symbol.trim()) return setError(t("Нужны название и тикер."));
    if (!symbolOk) return setError(t("Тикер: только буквы и цифры."));
    if (!buyOk) return setError(t("Покупка создателя ограничена {max} ETH (5% сапплая).").replace("{max}", MAX_DEV_BUY_ETH.toFixed(4)));
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
      };
      const uri =
        "data:application/json;base64," +
        btoa(unescape(encodeURIComponent(JSON.stringify(metadata))));

      const value = buyValue > 0 ? parseEther(form.initialBuy) : 0n;
      const hash = await wallet.walletClient.writeContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createToken",
        args: [form.name.trim(), form.symbol.trim(), uri, form.creatorWallet.trim() || ZERO],
        value,
      });
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      const created = rcpt.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((ev) => ev && ev.eventName === "TokenCreated");
      // мгновенно кладём токен в кэш — карточка видна сразу, без ожидания индексатора
      injectNewToken({
        token: created.args.token,
        pool: created.args.pool,
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        uri,
        creator: wallet.account,
      });
      window.location.hash = `#/token/${created.args.token}`;
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  const ctaLabel = busy
    ? t("Запускаем…")
    : ttype === "tax"
    ? t("Сохранить черновик tax-токена")
    : !wallet
    ? t("Подключите кошелёк")
    : !image
    ? t("Добавьте картинку токена")
    : !form.name.trim() || !form.symbol.trim()
    ? t("Укажите название и тикер")
    : buyValue > 0
    ? t("Запустить токен и купить на {eth} ETH").replace("{eth}", form.initialBuy)
    : t("Запустить токен");

  return (
    <div className="create-layout">
      <form className="panel" onSubmit={submit}>
        <h2>{t("Запустить токен")}</h2>

        <div className="ttype-row">
          <div className={`ttype-card ${ttype === "standard" ? "on" : ""}`} onClick={() => setTtype("standard")}>
            <b>{t("Обычный токен")}</b>
            <span>{t("фиксированный сапплай, без налога — работает сейчас")}</span>
          </div>
          <div className={`ttype-card ${ttype === "tax" ? "on" : ""}`} onClick={() => setTtype("tax")}>
            <b>{t("Tax-токен")} <em className="ttype-beta">β</em></b>
            <span>{t("налог с трейдов: кошелёк, сжигание, дивиденды, ликвидность")}</span>
          </div>
        </div>

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
          <div className="upload-thumb">{image ? <img src={image} alt="" /> : "🖼️"}</div>
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
            <div className="tax-alloc">
              <label>{t("Кошелёк создателя (дев, маркетинг)")}: <b>{tax.mkt}%</b>
                <input type="range" min="0" max="100" step="5" value={tax.mkt} onChange={setTaxK("mkt")} /></label>
              <label>{t("Сжигание (дефляция)")}: <b>{tax.burn}%</b>
                <input type="range" min="0" max="100" step="5" value={tax.burn} onChange={setTaxK("burn")} /></label>
              <label>{t("Дивиденды холдерам")}: <b>{tax.div}%</b>
                <input type="range" min="0" max="100" step="5" value={tax.div} onChange={setTaxK("div")} /></label>
              <label>{t("В ликвидность")}: <b>{tax.lp}%</b>
                <input type="range" min="0" max="100" step="5" value={tax.lp} onChange={setTaxK("lp")} /></label>
            </div>
            <div className="tax-bar">
              <div style={{ flex: Math.max(tax.mkt, 0.01) }} className="tb-mkt" />
              <div style={{ flex: Math.max(tax.burn, 0.01) }} className="tb-burn" />
              <div style={{ flex: Math.max(tax.div, 0.01) }} className="tb-div" />
              <div style={{ flex: Math.max(tax.lp, 0.01) }} className="tb-lp" />
              {taxTotal < 100 && <div style={{ flex: 100 - taxTotal }} className="tb-un" />}
            </div>
            {taxTotal !== 100 && <div className="hint bad">{t("Сумма аллокации должна быть ровно 100% (сейчас {n}%).").replace("{n}", String(taxTotal))}</div>}

            <div className="field-row">
              <div>
                <label>{t("Мин. баланс для дивидендов (токенов)")}</label>
                <input type="number" min="0" value={tax.minShare} onChange={setTaxK("minShare")} />
              </div>
              <div>
                <label>{t("Дивиденды выплачиваются в")}</label>
                <select value={tax.divToken} onChange={(e) => setTax({ ...tax, divToken: e.target.value })}>
                  <option value="self">{t("самом токене")}</option>
                  <option value="eth">ETH</option>
                </select>
              </div>
            </div>

            <div className="hint">{t("Tax-контракты v3 в разработке (аналог flap tax token: асимметричный налог, авто-раздача). Сейчас конфиг сохраняется черновиком — запуск откроется в один клик, черновик подставится сам.")}</div>
          </div>
        )}

        <label>{t("Покупка создателя")}</label>
        <div className="suffix-input">
          <input value={form.initialBuy} onChange={set("initialBuy")} placeholder="0.00" inputMode="decimal" />
          <b>ETH</b>
        </div>
        <div className={`hint ${buyOk ? "" : "bad"}`}>
          {(buyOk
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
        <div className="preview-img">{image ? <img src={image} alt="" /> : "🖼️"}</div>
        <div className="preview-name">{form.name.trim() || t("Ваш токен")}</div>
        <div className="preview-ticker">{form.symbol ? `$${form.symbol}` : t("тикер")}</div>
        <div className="preview-stats">
          <div className="row"><span className="k">{t("Комиссия запуска")}</span><span className="v green">0 ETH</span></div>
          <div className="row"><span className="k">{t("Вам с каждого трейда")}</span><span className="v green">{t("{pct}% комиссии").replace("{pct}", split.creator)}</span></div>
          <div className="row"><span className="k">{t("Градация")}</span><span className="v">6.5 ETH</span></div>
          <div className="row"><span className="k">{t("Ликвидность")}</span><span className="v">{t("Заперта навсегда")}</span></div>
          {buyValue > 0 && (
            <div className="row"><span className="k">{t("Ваша покупка")}</span><span className="v">{form.initialBuy} ETH</span></div>
          )}
        </div>
      </aside>
    </div>
  );
}
