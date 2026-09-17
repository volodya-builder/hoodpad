import { dataSource, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Buy, Sell, Graduated } from "../generated/templates/BondingCurvePool/BondingCurvePool";
import { Token, Trade } from "../generated/schema";
import { loadProtocol } from "./factory";
import { quoteUsd, quoteDecimals, toUsd } from "./price";

// CurveZap (перезапуск 16.09.2026): покупка/продажа монеты за валюту за ETH
// идёт через зап, и в событии пула стороной сделки стоит сам зап. Настоящий
// трейдер — тот, кто отправил транзакцию. Без этого PnL и «честный объём»
// считали продажи через зап чужими (профиль показывал −100%).
const ZAP = "0x939f933ab01277e7fde73c0d4d7dec885242d44c";
function realTrader(party: Bytes, from: Bytes): Bytes {
  return party.toHexString().toLowerCase() == ZAP ? from : party;
}

function tokenId(): string {
  return dataSource.context().getString("token");
}
// Валюта пула: "" — ETH (старые пулы без ключа тоже ETH)
function quoteOf(): Bytes | null {
  let ctx = dataSource.context();
  if (!ctx.isSet("quote")) return null;
  let q = ctx.getString("quote");
  return q.length > 0 ? Bytes.fromHexString(q) : null;
}

export function handleBuy(e: Buy): void {
  let t = Token.load(tokenId());
  if (t == null) return;

  let tr = new Trade(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  tr.token = t.id;
  tr.pool = e.address;
  tr.trader = realTrader(e.params.buyer, e.transaction.from);
  tr.isBuy = true;
  tr.quote = quoteOf();
  tr.ethAmount = e.params.ethIn;
  tr.tokenAmount = e.params.tokensOut;
  tr.fee = e.params.fee;
  let q = quoteOf();
  let rate = quoteUsd(q, e.block.timestamp);
  let qd = quoteDecimals(q);
  tr.rateUsd = rate;
  tr.usd = toUsd(tr.ethAmount.plus(e.params.fee), qd, rate);
  tr.feeUsd = toUsd(e.params.fee, qd, rate);
  tr.timestamp = e.block.timestamp;
  tr.block = e.block.number;
  tr.tx = e.transaction.hash;
  tr.save();

  t.ethReserve = t.ethReserve.plus(e.params.ethIn);
  t.tokensSold = t.tokensSold.plus(e.params.tokensOut);
  t.tradesCount += 1;
  t.volumeEth = t.volumeEth.plus(e.params.ethIn).plus(e.params.fee);
  t.feesEth = t.feesEth.plus(e.params.fee);
  t.volumeUsd = t.volumeUsd.plus(tr.usd);
  t.feesUsd = t.feesUsd.plus(tr.feeUsd);
  t.lastTradeAt = e.block.timestamp;
  t.save();

  let p = loadProtocol();
  p.tradesCount += 1;
  p.volumeUsd = p.volumeUsd.plus(tr.usd);
  p.feesUsd = p.feesUsd.plus(tr.feeUsd);
  if (quoteOf() === null) {
    p.volumeEth = p.volumeEth.plus(e.params.ethIn).plus(e.params.fee);
    p.feesEth = p.feesEth.plus(e.params.fee);
  }
  p.save();
}

export function handleSell(e: Sell): void {
  let t = Token.load(tokenId());
  if (t == null) return;

  let tr = new Trade(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  tr.token = t.id;
  tr.pool = e.address;
  tr.trader = realTrader(e.params.seller, e.transaction.from);
  tr.isBuy = false;
  tr.quote = quoteOf();
  tr.ethAmount = e.params.ethOut;
  tr.tokenAmount = e.params.tokensIn;
  tr.fee = e.params.fee;
  let q = quoteOf();
  let rate = quoteUsd(q, e.block.timestamp);
  let qd = quoteDecimals(q);
  tr.rateUsd = rate;
  tr.usd = toUsd(tr.ethAmount.plus(e.params.fee), qd, rate);
  tr.feeUsd = toUsd(e.params.fee, qd, rate);
  tr.timestamp = e.block.timestamp;
  tr.block = e.block.number;
  tr.tx = e.transaction.hash;
  tr.save();

  t.ethReserve = t.ethReserve.minus(e.params.ethOut).minus(e.params.fee);
  t.tokensSold = t.tokensSold.minus(e.params.tokensIn);
  t.tradesCount += 1;
  t.volumeEth = t.volumeEth.plus(e.params.ethOut).plus(e.params.fee);
  t.feesEth = t.feesEth.plus(e.params.fee);
  t.volumeUsd = t.volumeUsd.plus(tr.usd);
  t.feesUsd = t.feesUsd.plus(tr.feeUsd);
  t.lastTradeAt = e.block.timestamp;
  t.save();

  let p = loadProtocol();
  p.tradesCount += 1;
  p.volumeUsd = p.volumeUsd.plus(tr.usd);
  p.feesUsd = p.feesUsd.plus(tr.feeUsd);
  if (quoteOf() === null) {
    p.volumeEth = p.volumeEth.plus(e.params.ethOut).plus(e.params.fee);
    p.feesEth = p.feesEth.plus(e.params.fee);
  }
  p.save();
}

export function handleGraduated(e: Graduated): void {
  let t = Token.load(tokenId());
  if (t == null) return;
  t.graduated = true;
  t.save();

  let p = loadProtocol();
  p.graduatedCount += 1;
  p.save();
}
