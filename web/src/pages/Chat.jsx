import React, { useEffect, useState, useCallback } from "react";
import { parseAbi, parseAbiItem } from "viem";
import { publicClient, short } from "../lib/web3.js";
import { CHAT_ADDRESS } from "../lib/config.js";

const chatAbi = parseAbi(["function post(address token, string text)"]);
const messageEvent = parseAbiItem(
  "event Message(address indexed token, address indexed sender, string text, uint256 timestamp)"
);

function ago(tsSec) {
  const s = Math.max(1, Date.now() / 1000 - Number(tsSec));
  if (s < 60) return `${Math.floor(s)}с`;
  if (s < 3600) return `${Math.floor(s / 60)}м`;
  if (s < 86400) return `${Math.floor(s / 3600)}ч`;
  return `${Math.floor(s / 86400)}д`;
}

export default function Chat({ tokenAddress, wallet, onConnect }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const enabled = CHAT_ADDRESS !== "0x0000000000000000000000000000000000000000";

  const load = useCallback(async () => {
    if (!enabled) return;
    const logs = await publicClient.getLogs({
      address: CHAT_ADDRESS,
      event: messageEvent,
      args: { token: tokenAddress },
      fromBlock: 0n,
      toBlock: "latest",
    });
    setMsgs(logs.map((l) => ({
      sender: l.args.sender, text: l.args.text, ts: l.args.timestamp,
    })));
  }, [tokenAddress, enabled]);

  useEffect(() => {
    load().catch(() => setMsgs([]));
    const id = setInterval(() => load().catch(() => {}), 12000);
    return () => clearInterval(id);
  }, [load]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    if (!wallet) {
      setError("Кошелёк не подключён — подключите его и нажмите отправить ещё раз.");
      onConnect();
      return;
    }
    setError(""); setBusy(true);
    setStatus("Подтвердите транзакцию в MetaMask. Если окно не всплыло — откройте иконку MetaMask: запрос может ждать в очереди расширения.");
    try {
      const hash = await wallet.walletClient.writeContract({
        address: CHAT_ADDRESS, abi: chatAbi, functionName: "post",
        args: [tokenAddress, t],
      });
      setStatus("Транзакция отправлена, жду подтверждения сети…");
      await publicClient.waitForTransactionReceipt({ hash });
      setText("");
      await load();
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setBusy(false); setStatus(""); }
  }

  if (!enabled) {
    return (
      <div className="chat-panel" style={{ marginTop: 18 }}>
        <div className="chat-head"><h3>Чат</h3></div>
        <div className="chat-sub">Скоро: чат появится после деплоя контракта.</div>
      </div>
    );
  }

  return (
    <div className="chat-panel" style={{ marginTop: 18 }}>
      <div className="chat-head">
        <h3>Чат</h3>
        <span className="chat-count">{msgs?.length ?? "…"}</span>
      </div>
      <div className="chat-sub">
        Сообщения живут в блокчейне — писать может любой кошелёк, автор доказуем подписью.
      </div>
      <div className="chat-list">
        {msgs === null && <div className="dim">Читаю блокчейн…</div>}
        {msgs?.length === 0 && <div className="dim">Пока тихо — напишите первым.</div>}
        {msgs?.map((m, i) => (
          <div className="chat-msg" key={i}>
            <div className="chat-ava">
              {wallet && m.sender.toLowerCase() === wallet.account.toLowerCase() ? "🏹" : "👤"}
            </div>
            <div>
              <span className="who mono">{short(m.sender)}</span>
              <span className="when">{ago(m.ts)}</span>
              <div className="txt">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Сообщение… (транзакция в сети)"
          maxLength={280}
          onKeyDown={(e) => e.key === "Enter" && !busy && send()}
        />
        <button className="btn btn-primary chat-send" onClick={send} disabled={busy}>
          {busy ? "…" : "➤"}
        </button>
      </div>
      {status && <div className="dim" style={{ marginTop: 8 }}>{status}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
