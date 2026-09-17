import { DataSourceContext } from "@graphprotocol/graph-ts";
import { TokenCreated } from "../generated/LaunchpadFactory/LaunchpadFactory";
import { TokenCreated as QuoteTokenCreated } from "../generated/LaunchpadFactoryQuote/LaunchpadFactoryQuote";
import { DividendToken } from "../generated/LaunchpadFactoryQuote/DividendToken";
import { Token, Protocol } from "../generated/schema";
import { BondingCurvePool } from "../generated/templates";
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";

export function loadProtocol(): Protocol {
  let p = Protocol.load("1");
  if (p == null) {
    p = new Protocol("1");
    p.tokensCount = 0;
    p.graduatedCount = 0;
    p.tradesCount = 0;
    p.volumeEth = BigInt.zero();
    p.feesEth = BigInt.zero();
    p.volumeUsd = BigDecimal.zero();
    p.feesUsd = BigDecimal.zero();
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
  t.divBps = 0;
  t.ethReserve = BigInt.zero();
  t.tokensSold = BigInt.zero();
  t.tradesCount = 0;
  t.volumeEth = BigInt.zero();
  t.feesEth = BigInt.zero();
  t.volumeUsd = BigDecimal.zero();
  t.feesUsd = BigDecimal.zero();
  t.lastTradeAt = BigInt.zero();
  t.save();

  let p = loadProtocol();
  p.tokensCount += 1;
  p.save();

  let ctx = new DataSourceContext();
  ctx.setString("token", e.params.token.toHexString());
  ctx.setString("quote", "");
  BondingCurvePool.createWithContext(e.params.pool, ctx);
}

// Квот-фабрика не кладёт имя/тикер в событие — читаем с токена.
export function handleQuoteTokenCreated(e: QuoteTokenCreated): void {
  let tok = DividendToken.bind(e.params.token);
  let name = tok.try_name();
  let symbol = tok.try_symbol();
  let uri = tok.try_metadataURI();

  let t = new Token(e.params.token.toHexString());
  t.name = name.reverted ? "" : name.value;
  t.symbol = symbol.reverted ? "" : symbol.value;
  t.metadataURI = uri.reverted ? "" : uri.value;
  t.creator = e.params.creator;
  t.pool = e.params.pool;
  t.createdAt = e.block.timestamp;
  t.createdBlock = e.block.number;
  t.graduated = false;
  t.quote = e.params.quote;
  t.divBps = e.params.divBps;
  t.ethReserve = BigInt.zero();
  t.tokensSold = BigInt.zero();
  t.tradesCount = 0;
  t.volumeEth = BigInt.zero();
  t.feesEth = BigInt.zero();
  t.volumeUsd = BigDecimal.zero();
  t.feesUsd = BigDecimal.zero();
  t.lastTradeAt = BigInt.zero();
  t.save();

  let p = loadProtocol();
  p.tokensCount += 1;
  p.save();

  let ctx = new DataSourceContext();
  ctx.setString("token", e.params.token.toHexString());
  ctx.setString("quote", e.params.quote.toHexString());
  BondingCurvePool.createWithContext(e.params.pool, ctx);
}
