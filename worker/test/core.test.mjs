// Проверка ядра в node: подпись → ecrecover через RPC сети, сессия, промпт.
// Запуск: node test/core.test.mjs (нужен доступ к RPC Robinhood Chain).
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { loginMessage, verifySignature, recoverViaRpc, makeSession, checkSession, sessionSecret, buildMessages, parseMeta, cleanText, coinInfo } from "../src/core.js";

const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const env = { RPC_URL: RPC, OPENROUTER_KEY: "sk-or-test-not-a-real-key", FEE_SPLITTER: "0x4b4ca78517a48876a4341cbbfbd96e15c9d99491" };

const acct = privateKeyToAccount(generatePrivateKey());
const ts = Date.now();
const msg = loginMessage(acct.address, ts);
const sig = await acct.signMessage({ message: msg });

const rec = await recoverViaRpc(RPC, msg, sig);
assert.equal(rec.toLowerCase(), acct.address.toLowerCase(), "ecrecover через прекомпайл вернул не тот адрес");
assert.equal(await verifySignature(RPC, acct.address, msg, sig), true, "verifySignature должна принять свою подпись");
assert.equal(await verifySignature(RPC, "0x000000000000000000000000000000000000dEaD", msg, sig), false, "чужой адрес — отказ");
assert.equal(await verifySignature(RPC, acct.address, loginMessage(acct.address, ts + 1), sig), false, "другой текст — отказ");
console.log("✓ подпись: ecrecover через RPC, чужой адрес и другой текст отвергаются");

const secret = await sessionSecret(env);
const s = await makeSession(secret, acct.address);
assert.equal(await checkSession(secret, s.session), acct.address.toLowerCase());
assert.equal(await checkSession(secret, s.session.slice(0, -2) + "zz"), null, "битый MAC — отказ");
assert.equal(await checkSession("другой секрет", s.session), null, "другой секрет — отказ");
assert.equal(await checkSession(secret, s.session, Date.now() + 8 * 86400 * 1000), null, "истекла — отказ");
console.log("✓ сессия: HMAC, подделка, чужой секрет, срок");

const meta = parseMeta("data:application/json;base64," + Buffer.from(JSON.stringify({ description: "мем про яблоко", ai: "anthropic/claude-fable-5.1", aiName: "Claude Fable 5.1" })).toString("base64"));
assert.equal(meta.ai, "anthropic/claude-fable-5.1");
const info = { name: "doge", symbol: "DOGE", description: meta.description, x: "", telegram: "", website: "", model: meta.ai, modelName: meta.aiName, aiOn: true };
const msgs = buildMessages(info, [{ who: "0xabc", role: "user", text: "привет" }, { who: "ai", role: "ai", text: "гав" }], ["таймер"], [], acct.address, "что построим?");
assert.equal(msgs.length, 4); assert.equal(msgs[0].role, "system"); assert.match(msgs[0].content, /\$DOGE/); assert.match(msgs[0].content, /таймер/);
assert.equal(msgs[2].role, "assistant"); assert.match(msgs[3].content, /что построим/);
assert.equal(cleanText("  a" + String.fromCharCode(0) + "b  "), "ab");
console.log("✓ промпт и очистка текста");

// Реальная монета в сети: DOGE (за AAPL) — читаем имя/тикер/модель/aiOf.
const doge = await coinInfo(env, "0xab38465f3210e18cdb88607405c3458cf41999c6");
assert.ok(doge && doge.symbol, "coinInfo не прочитал монету");
console.log("✓ монета из цепи:", doge.symbol, "модель:", doge.model || "(нет)", "aiOn:", doge.aiOn);
console.log("");
console.log("ВСЁ ЯДРО В ПОРЯДКЕ");
