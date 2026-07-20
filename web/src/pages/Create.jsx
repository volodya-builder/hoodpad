import React, { useRef, useState } from "react";
import { parseEther, formatEther, decodeEventLog } from "viem";
import { publicClient } from "../lib/web3.js";
import { factoryAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS } from "../lib/config.js";
import { useSplit, injectNewToken } from "../lib/data.js";

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
  const [form, setForm] = useState({
    name: "", symbol: "", description: "", x: "", telegram: "", initialBuy: "",
    creatorWallet: "", website: "",
  });
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
      setError("Не удалось прочитать изображение");
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!wallet) return onConnect();
    if (!image) return setError("Добавьте картинку токена.");
    if (!form.name.trim() || !form.symbol.trim()) return setError("Нужны название и тикер.");
    if (!symbolOk) return setError("Тикер: только буквы и цифры.");
    if (!buyOk) return setError(`Покупка создателя ограничена ${MAX_DEV_BUY_ETH.toFixed(4)} ETH (5% сапплая).`);
    if (!walletOk) return setError("Кошелёк создателя: неверный адрес (нужен 0x… из 42 символов).");

    setBusy(true);
    try {
      const metadata = {
        description: form.description.trim(),
        image, // self-contained data URL — no external hosting
        x: form.x.trim(),
        telegram: form.telegram.trim(),
        website: form.website.trim(),
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
    ? "Запускаем…"
    : !wallet
    ? "Подключите кошелёк"
    : !image
    ? "Добавьте картинку токена"
    : !form.name.trim() || !form.symbol.trim()
    ? "Укажите название и тикер"
    : buyValue > 0
    ? `Запустить токен и купить на ${form.initialBuy} ETH`
    : "Запустить токен";

  return (
    <div className="create-layout">
      <form className="panel" onSubmit={submit}>
        <h2>Запустить токен</h2>

        <div className="field-row">
          <div>
            <label>Название</label>
            <input value={form.name} onChange={set("name")} placeholder="Название токена" maxLength={32} />
            <div className="hint">Буквы, цифры и пробелы. Максимум 32 символа.</div>
          </div>
          <div>
            <label>Тикер</label>
            <input value={form.symbol} onChange={set("symbol")} placeholder="СИМВОЛ" maxLength={10} />
            <div className={`hint ${symbolOk ? "" : "bad"}`}>
              {symbolOk ? "Буквы и цифры. Максимум 10 символов." : "Только буквы и цифры!"}
            </div>
          </div>
        </div>

        <label>Описание</label>
        <textarea rows={3} value={form.description} onChange={set("description")} placeholder="Короткое описание токена" />

        <label>Картинка токена</label>
        <label className="check-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Я понимаю, что изображение будет опубликовано в блокчейне и станет
            частью неизменяемых метаданных токена.
          </span>
        </label>
        <div
          className={`upload-box ${image ? "ready" : ""} ${consent ? "" : "disabled"}`}
          onClick={() => consent && fileRef.current?.click()}
        >
          <div className="upload-thumb">{image ? <img src={image} alt="" /> : "🖼️"}</div>
          <span>
            {image
              ? "Картинка загружена — нажмите, чтобы заменить"
              : consent
              ? "Выбрать картинку токена"
              : "Сначала подтвердите публикацию"}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />

        <div className="field-row">
          <div>
            <label>Профиль X</label>
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

        <label>Покупка создателя</label>
        <div className="suffix-input">
          <input value={form.initialBuy} onChange={set("initialBuy")} placeholder="0.00" inputMode="decimal" />
          <b>ETH</b>
        </div>
        <div className={`hint ${buyOk ? "" : "bad"}`}>
          {buyOk
            ? `Макс ${MAX_DEV_BUY_ETH.toFixed(4)} ETH · 5% сапплая. Исполняется в той же транзакции — защита от снайперов.`
            : `Больше лимита: максимум ${MAX_DEV_BUY_ETH.toFixed(4)} ETH (5% сапплая).`}
        </div>

        <div
          className={`adv-toggle ${advOpen ? "open" : ""}`}
          onClick={() => setAdvOpen(!advOpen)}
        >
          <span>Дополнительно</span>
          <span className="chev">▾</span>
        </div>
        {advOpen && (
          <div className="adv-body open">
            <label>Кошелёк создателя</label>
            <input
              value={form.creatorWallet}
              onChange={set("creatorWallet")}
              placeholder={wallet ? wallet.account : "0x…"}
              spellCheck={false}
            />
            <div className={`hint ${walletOk ? "" : "bad"}`}>
              {walletOk
                ? `Получает долю создателя в комиссиях (${split.creator}%) и покупку создателя. Оставьте пустым, чтобы использовать подключённый кошелёк.`
                : "Неверный адрес: нужен формат 0x… (42 символа)."}
            </div>

            <label>Сайт</label>
            <input
              value={form.website}
              onChange={set("website")}
              placeholder="https://example.com"
              inputMode="url"
            />
          </div>
        )}

        <div className="due-row">
          <span>Uniswap V3 после градации · ликвидность запирается навсегда</span>
          <span><b style={{ color: "var(--accent)" }}>Комиссия запуска: 0 ETH</b></span>
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>{ctaLabel}</button>
        {error && <div className="error">{error}</div>}
      </form>

      <aside className="preview-card">
        <div className="preview-img">{image ? <img src={image} alt="" /> : "🖼️"}</div>
        <div className="preview-name">{form.name.trim() || "Ваш токен"}</div>
        <div className="preview-ticker">{form.symbol ? `$${form.symbol}` : "тикер"}</div>
        <div className="preview-stats">
          <div className="row"><span className="k">Комиссия запуска</span><span className="v green">0 ETH</span></div>
          <div className="row"><span className="k">Вам с каждого трейда</span><span className="v green">{split.creator}% комиссии</span></div>
          <div className="row"><span className="k">Казна выкупа / команда</span><span className="v">{split.buyback}% / {split.team}%</span></div>
          <div className="row"><span className="k">Градация</span><span className="v">6.5 ETH</span></div>
          <div className="row"><span className="k">Ликвидность</span><span className="v">Заперта навсегда</span></div>
          {buyValue > 0 && (
            <div className="row"><span className="k">Ваша покупка</span><span className="v">{form.initialBuy} ETH</span></div>
          )}
        </div>
      </aside>
    </div>
  );
}
