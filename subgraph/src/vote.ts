import { Vote } from "../generated/BuybackVote/BuybackVote";
import { VoteCast } from "../generated/schema";

export function handleVote(e: Vote): void {
  let v = new VoteCast(e.transaction.hash.toHexString() + "-" + e.logIndex.toString());
  v.token = e.params.token;
  v.voter = e.params.voter;
  v.epoch = e.params.epoch;
  v.timestamp = e.block.timestamp;
  v.save();
}
