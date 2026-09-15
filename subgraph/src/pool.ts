import { dataSource, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Buy, Sell, Graduated } from "../generated/templates/BondingCurvePool/BondingCurvePool";
import { Token, Trade } from "../generated/schema";
import { loadProtocol } from "./factory";

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
  tr.trader = e.params.buyer;
  tr.isBuy = true;
  tr.quote = quoteOf();
  tr.ethAmount = e.params.ethIn;
  tr.tokenAmount = e.params.tokensOut;
  tr.fee = e.params.fee;
  tr.timestamp = e.block.timestamp;
  tr.block = e.block.number;
  tr.tx = e.transaction.hash;
  tr.save();

  t.ethReserve = t.ethReserve.plus(e.params.ethIn);
  t.tokensSold = t.tokensSold.plus(e.params.tokensOut);
  t.tradesCount += 1;
  t.volumeEth = t.volumeEth.plus(e.params.ethIn).plus(e.params.fee);
  t.feesEth = t.feesEth.plus(e.params.fee);
  t.lastTradeAt = e.block.timestamp;
  t.save();

  let p = loadProtocol();
  p.tradesCount += 1;
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
  tr.trader = e.params.seller;
  tr.isBuy = false;
  tr.quote = quoteOf();
  tr.ethAmount = e.params.ethOut;
  tr.tokenAmount = e.params.tokensIn;
  tr.fee = e.params.fee;
  tr.timestamp = e.block.timestamp;
  tr.block = e.block.number;
  tr.tx = e.transaction.hash;
  tr.save();

  t.ethReserve = t.ethReserve.minus(e.params.ethOut).minus(e.params.fee);
  t.tokensSold = t.tokensSold.minus(e.params.tokensIn);
  t.tradesCount += 1;
  t.volumeEth = t.volumeEth.plus(e.params.ethOut).plus(e.params.fee);
  t.feesEth = t.feesEth.plus(e.params.fee);
  t.lastTradeAt = e.block.timestamp;
  t.save();

  let p = loadProtocol();
  p.tradesCount += 1;
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
