import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Received, Buyback, Burned, Converted } from "../generated/ArenaTreasury/ArenaTreasuryV2";
import { TreasuryOp } from "../generated/schema";
import { loadProtocol } from "./factory";

// Обе казны V2 (арена и выкуп hood) — один ABI, одни обработчики; какая
// именно казна — в поле treasury (адрес контракта, породившего событие).

const ZERO = Address.zero();

function opId(tx: string, logIndex: string): string { return tx + "-" + logIndex; }

export function handleReceived(e: Received): void {
  let op = new TreasuryOp(opId(e.transaction.hash.toHexString(), e.logIndex.toString()));
  op.kind = "received";
  op.treasury = e.address;
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
  let op = new TreasuryOp(opId(e.transaction.hash.toHexString(), e.logIndex.toString()));
  op.kind = "buyback";
  op.treasury = e.address;
  op.token = e.params.token;
  op.asset = e.params.asset;
  let payedEth = e.params.asset.equals(ZERO);
  op.ethAmount = payedEth ? e.params.amountIn : BigInt.zero();
  op.assetAmount = payedEth ? BigInt.zero() : e.params.amountIn;
  op.tokenAmount = e.params.tokensOut;
  op.note = e.params.note;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();

  if (payedEth) {
    let p = loadProtocol();
    p.treasurySpent = p.treasurySpent.plus(e.params.amountIn);
    p.save();
  }
}

export function handleBurned(e: Burned): void {
  let op = new TreasuryOp(opId(e.transaction.hash.toHexString(), e.logIndex.toString()));
  op.kind = "burned";
  op.treasury = e.address;
  op.token = e.params.token;
  op.tokenAmount = e.params.amount;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();
}

export function handleConverted(e: Converted): void {
  let op = new TreasuryOp(opId(e.transaction.hash.toHexString(), e.logIndex.toString()));
  op.kind = "converted";
  op.treasury = e.address;
  op.asset = e.params.asset;
  op.assetAmount = e.params.amountIn;
  op.ethAmount = e.params.ethOut;
  op.timestamp = e.block.timestamp;
  op.tx = e.transaction.hash;
  op.save();
}
