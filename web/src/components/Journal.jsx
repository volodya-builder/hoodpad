import React, { useEffect, useMemo, useState } from "react";
import { loadTokens } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { isTeam } from "../lib/config.js";
import { roundId, roundStart, roundEnd } from "../lib/workshop.js";
import {
  loadJournal, loadTokenJournal, saveEntry, entryMessage,
  loadBuilds, mergeBuilds,
  summarize, money, STATUS, STATUS_LABEL,
} from "../lib/journal.js";

const d = (ms) => {
  const x = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}`;
};

/**
 * Журнал агента — витрина всей затеи.
 *
 * Сознательно показывает провалы: строка «не вышло» с причиной стоит в
 * ленте наравне с удачами. Лента, где одни успехи, читается как реклама,
 * и ей перестают верить ровно в тот день, когда кто-то пересчитает
 * задания и результаты.
 *
 * Пока агента нет, записи заполняет владелец из формы внизу (она видна
 * только его кошельку). Формат тот же, которым потом будет писать агент.
 */
export default function Journal({ wallet, token: fixed }) {
  const { t } = useLang();
  const [rows, setRows] = useState(null);
  const [rejected, setRejected] = useState(0);
  const [tokens, setTokens] = useState([]);

  const admin = isTeam(wallet?.account);

  const refresh = React.useCallback(async () => {
    try {
      const builds = await loadBuilds();
      if (fixed) {
        const r = await loadTokenJournal(fixed);
        const mine = builds.filter((b) => String(b.token).toLowerCase() === String(fixed).toLowerCase());
        setRows(mergeBuilds(r.rows, mine)); setRejected(r.rejected);
      } else {
        const list = await loadTokens();
        setTokens(list || []);
        const r = await loadJournal(list);
        const withTk = mergeBuilds(r.rows, builds).map((x) =>
          x.tk ? x : { ...x, tk: (list || []).find((t) => t.token.toLowerCase() === String(x.token).toLowerCase()) || null });
        setRows(withTk); setRejected(r.rejected);
      }
    } catch { setRows([]); }
  }, [fixed]);

  useEffect(() => { refresh(); }, [refresh]);

  const sum = useMemo(() => summarize(rows), [rows]);

  if (rows === null) return <div className="ai-empty">{t("Читаю журнал…")}</div>;

  return (
    <div className="jr">
      {rows.length > 0 && (
        <div className="jr-sum">
          <div><b>{sum.tasks}</b><span>{t("заданий")}</span></div>
          <div><b className="ok">{sum.done}</b><span>{t("выкачено")}</span></div>
          <div><b className={sum.failed ? "no" : ""}>{sum.failed}</b><span>{t("не вышло")}</span></div>
          <div><b>{money(sum.spent)}</b><span>{t("потрачено на модели")}</span></div>
        </div>
      )}

      {!rows.length && (
        <div className="ai-empty">
          {t("Пусто. Первая запись появится, когда агент возьмёт первое задание из очереди. Здесь будет видно всё: задание, план, ссылка на результат и сколько это стоило.")}
        </div>
      )}

      <div className="jr-list">
        {rows.map((r) => (
          <div className={`jr-item ${r.status}`} key={`${r.token}-${r.round}`}>
            <div className="jr-top">
              {r.tk && (
                <a className="q-tk" href={`#/token/${r.tk.token}`}>
                  {r.tk.meta?.image && <img src={r.tk.meta.image} alt="" />}
                  <span>${r.tk.symbol}</span>
                </a>
              )}
              <span className="q-when">{d(roundStart(r.round))} — {d(roundEnd(r.round))}</span>
              <span className={`jr-st ${r.status}`}>{t(STATUS_LABEL[r.status] || r.status)}</span>
            </div>

            <div className="jr-task">{r.task}</div>
            {r.plan && <div className="jr-plan">{r.plan}</div>}
            {r.status === "failed" && r.why && (
              <div className="jr-why"><b>{t("Почему не вышло")}:</b> {r.why}</div>
            )}

            <div className="jr-meta">
              {r.url
                ? <a className="jr-link" href={r.url} target="_blank" rel="noreferrer noopener">{t("Открыть результат")} →</a>
                : <span className="dim">{t("результата пока нет")}</span>}
              <span className="dim">
                {r.model && <>{r.model} · </>}
                {Number(r.opens) > 0 && <>{Number(r.opens).toLocaleString("ru")} {t("открытий")} · </>}
                {t("потрачено")} {money(r.spent)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {rejected > 0 && (
        <div className="wsh-note">
          {t("Отброшено записей без подписи оператора")}: {rejected}. {t("База открыта на запись, поэтому подписи проверяются при чтении.")}
        </div>
      )}

      {admin && <Composer wallet={wallet} tokens={tokens} fixed={fixed} onSaved={refresh} />}
    </div>
  );
}

/** Форма владельца. Видна только кошельку команды; чужим её просто нет. */
function Composer({ wallet, tokens, fixed, onSaved }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    token: fixed || "", round: roundId() - 1, status: "build",
    task: "", plan: "", url: "", spent: "", opens: "", why: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setErr("");
    if (!f.token) { setErr(t("Выберите монету.")); return; }
    if (f.task.trim().length < 8) { setErr(t("Опишите задание подробнее.")); return; }
    setBusy(true);
    try {
      const entry = {
        status: f.status,
        task: f.task.trim(),
        plan: f.plan.trim(),
        url: f.url.trim(),
        why: f.why.trim(),
        spent: f.spent === "" ? "" : Number(f.spent),
        opens: f.opens === "" ? 0 : Number(f.opens),
      };
      const signature = await wallet.walletClient.signMessage({
        account: wallet.account,
        message: entryMessage(f.token, f.round, entry),
      });
      await saveEntry({ token: f.token, round: f.round, entry, signature });
      setF((x) => ({ ...x, task: "", plan: "", url: "", spent: "", opens: "", why: "" }));
      setOpen(false);
      await onSaved();
    } catch (e) { setErr(String(e.shortMessage || e.message)); }
    finally { setBusy(false); }
  };

  if (!open) {
    return <button className="jr-add" onClick={() => setOpen(true)}>+ {t("Запись в журнал")}</button>;
  }

  return (
    <div className="jr-form">
      <div className="jr-form-row">
        {!fixed && (
          <select className="wsh-sel" value={f.token} onChange={set("token")}>
            <option value="">{t("монета")}</option>
            {(tokens || []).map((x) => <option key={x.token} value={x.token}>${x.symbol}</option>)}
          </select>
        )}
        <input className="jr-in num" type="number" value={f.round} onChange={set("round")} title={t("раунд")} />
        <select className="wsh-sel" value={f.status} onChange={set("status")}>
          {STATUS.map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
        </select>
      </div>

      <textarea className="jr-in" rows={2} placeholder={t("Задание — то, за что проголосовали")} value={f.task} onChange={set("task")} />
      <textarea className="jr-in" rows={2} placeholder={t("План или что сделано (необязательно)")} value={f.plan} onChange={set("plan")} />

      <div className="jr-form-row">
        <input className="jr-in" placeholder="https://…" value={f.url} onChange={set("url")} />
        <input className="jr-in num" placeholder={t("$ на модели")} value={f.spent} onChange={set("spent")} />
        <input className="jr-in num" placeholder={t("открытий")} value={f.opens} onChange={set("opens")} />
      </div>

      {f.status === "failed" && (
        <textarea className="jr-in" rows={2} placeholder={t("Почему не вышло — пишем честно")} value={f.why} onChange={set("why")} />
      )}

      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

      <div className="jr-form-row end">
        <button className="btn" onClick={() => setOpen(false)}>{t("Отмена")}</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? t("Подпишите в кошельке…") : t("Подписать и сохранить")}
        </button>
      </div>
    </div>
  );
}
