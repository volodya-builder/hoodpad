import { parseAbi } from "viem";
import { useEffect, useState } from "react";
import { publicClient } from "./web3.js";
import { factoryAbi, poolAbi, tokenAbi } from "./abi.js";
import { FACTORY_ADDRESS } from "./config.js";

export function parseMeta(uri) {
  try {
    if (uri?.startsWith("data:application/json;base64,")) {
      return JSON.parse(decodeURIComponent(escape(atob(uri.split(",")[1]))));
    }
  } catch (e) { /* ignore malformed metadata */ }
  return {};
}

const PAGE = 96n;

export async function loadTokens() {
  const count = await publicClient.readContract({
    address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "tokenCount",
  });
  if (count === 0n) return [];
  const offset = count > PAGE ? count - PAGE : 0n;
  const addrs = await publicClient.readContract({
    address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "tokens", args: [offset, PAGE],
  });
  const items = await Promise.all(
    addrs.map(async (token) => {
      const pool = await publicClient.readContract({
        address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "poolOf", args: [token],
      });
      const [name, symbol, uri, price, sold, cap, reserve, graduated] = await Promise.all([
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "metadataURI" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "spotPrice" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "tokensSold" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "saleCap" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }),
      ]);
      return { token, pool, name, symbol, price, sold, cap, reserve, graduated, meta: parseMeta(uri) };
    })
  );
  return items.reverse();
}

// ---------------------------------------------------------------- events
export const tradeEvents = parseAbi([
  "event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee)",
  "event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee)",
]);

/** All trades of a pool, oldest first, replayed into price points. */
export async function poolTrades(pool) {
  const logs = await publicClient.getLogs({
    address: pool, events: tradeEvents, fromBlock: 0n, toBlock: "latest",
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber
    ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber)));

  const VIRT = 1.625, TOTAL = 1e9;
  let eth = 0, sold = 0;
  const trades = [];
  const points = [{ i: 0, mcap: (VIRT / TOTAL) * TOTAL }];
  for (const l of logs) {
    const isBuy = l.eventName === "Buy";
    const ethAmt = Number(isBuy ? l.args.ethIn : l.args.ethOut) / 1e18;
    const tokAmt = Number(isBuy ? l.args.tokensOut : l.args.tokensIn) / 1e18;
    const fee = Number(l.args.fee) / 1e18;
    if (isBuy) { eth += ethAmt; sold += tokAmt; }
    else { eth -= ethAmt + fee; sold -= tokAmt; }
    const price = (VIRT + eth) / (TOTAL - sold);
    trades.push({
      side: isBuy ? "buy" : "sell",
      addr: isBuy ? l.args.buyer : l.args.seller,
      eth: ethAmt, tokens: tokAmt, fee,
      block: l.blockNumber, tx: l.transactionHash,
    });
    points.push({ i: trades.length, mcap: price * TOTAL });
  }
  return { trades: trades.reverse(), points };
}


// ---------------------------------------------------------------- fee split
import { splitterAbi } from "./abi.js";

let splitCache = null;
export async function loadSplit() {
  if (splitCache) return splitCache;
  try {
    const [shareBps, treasury] = await Promise.all([
      publicClient.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "creatorFeeShareBps" }),
      publicClient.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "treasury" }),
    ]);
    const creator = Number(shareBps) / 100;
    let team = 0;
    try {
      const teamBps = await publicClient.readContract({
        address: treasury, abi: splitterAbi, functionName: "teamBps",
      });
      team = ((100 - creator) * Number(teamBps)) / 10000;
    } catch (e) { /* treasury is not a splitter -> everything goes to buyback */ }
    const buyback = 100 - creator - team;
    splitCache = {
      creator: Math.round(creator), team: Math.round(team), buyback: Math.round(buyback),
    };
  } catch (e) {
    splitCache = { creator: 50, team: 20, buyback: 30 };
  }
  return splitCache;
}

export function useSplit() {
  const [split, setSplit] = useState({ creator: 50, team: 20, buyback: 30 });
  useEffect(() => { loadSplit().then(setSplit).catch(() => {}); }, []);
  return split;
}
