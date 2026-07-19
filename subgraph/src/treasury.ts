import { Received, Buyback, Burned } from "../generated/BuybackTreasury/BuybackTreasury";
import { TreasuryOp } from "../generated/schema";
import { loadProtocol } from "./factory";

export function handleReceived(e: Received): void {
  let op = new TreasuryOp(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  op.kind = "received";
  op.from = e.params.from;
  op.ethAmount = e.params.amount;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();

  let p = loadProtocol();
  p.treasuryReceived = p.treasuryReceived.plus(e.params.amount);
  p.save();
}

export function handleBuyback(e: Buyback): void {
  let op = new TreasuryOp(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  op.kind = "buyback";
  op.token = e.params.token;
  op.ethAmount = e.params.ethIn;
  op.tokenAmount = e.params.tokensOut;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();

  let p = loadProtocol();
  p.treasurySpent = p.treasurySpent.plus(e.params.ethIn);
  p.save();
}

export function handleBurned(e: Burned): void {
  let op = new TreasuryOp(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  op.kind = "burned";
  op.token = e.params.token;
  op.tokenAmount = e.params.amount;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();
}
