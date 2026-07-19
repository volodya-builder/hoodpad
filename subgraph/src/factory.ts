import { DataSourceContext } from "@graphprotocol/graph-ts";
import { TokenCreated } from "../generated/LaunchpadFactory/LaunchpadFactory";
import { Token, Protocol } from "../generated/schema";
import { BondingCurvePool } from "../generated/templates";
import { BigInt } from "@graphprotocol/graph-ts";

export function loadProtocol(): Protocol {
  let p = Protocol.load("1");
  if (p == null) {
    p = new Protocol("1");
    p.tokensCount = 0;
    p.graduatedCount = 0;
    p.tradesCount = 0;
    p.volumeEth = BigInt.zero();
    p.feesEth = BigInt.zero();
    p.treasuryReceived = BigInt.zero();
    p.treasurySpent = BigInt.zero();
  }
  return p as Protocol;
}

export function handleTokenCreated(e: TokenCreated): void {
  let t = new Token(e.params.token.toHexString());
  t.name = e.params.name;
  t.symbol = e.params.symbol;
  t.metadataURI = e.params.metadataURI;
  t.creator = e.params.creator;
  t.pool = e.params.pool;
  t.createdAt = e.block.timestamp;
  t.createdBlock = e.block.number;
  t.graduated = false;
  t.ethReserve = BigInt.zero();
  t.tokensSold = BigInt.zero();
  t.tradesCount = 0;
  t.volumeEth = BigInt.zero();
  t.feesEth = BigInt.zero();
  t.lastTradeAt = BigInt.zero();
  t.save();

  let p = loadProtocol();
  p.tokensCount += 1;
  p.save();

  let ctx = new DataSourceContext();
  ctx.setString("token", e.params.token.toHexString());
  BondingCurvePool.createWithContext(e.params.pool, ctx);
}
