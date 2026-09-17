// ============================================================================
//  Курс в долларах на момент сделки (16.09.2026).
//
//  Раньше сайт умножал объём в ETH на ТЕКУЩИЙ курс — и цифры «дышали» без
//  единой сделки. Теперь индексатор при каждой сделке читает курс из
//  Uniswap V3 (самый глубокий пул валюты против USDG или WETH) и записывает
//  доллары прямо в сделку. Записанное не меняется никогда.
//
//  Пул для валюты ищется один раз и запоминается (PriceSource); раз в сутки
//  проверяется заново — вдруг появился более глубокий.
// ============================================================================
import { Address, BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { UniswapV3Factory } from "../generated/templates/BondingCurvePool/UniswapV3Factory";
import { UniswapV3Pool } from "../generated/templates/BondingCurvePool/UniswapV3Pool";
import { ERC20 } from "../generated/templates/BondingCurvePool/ERC20";
import { PriceSource } from "../generated/schema";

const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const ZERO = "0x0000000000000000000000000000000000000000";
const RECHECK = BigInt.fromI32(86400);
const Q96 = BigDecimal.fromString("79228162514264337593543950336"); // 2^96

function pow10(n: i32): BigDecimal {
  let r = BigDecimal.fromString("1");
  let ten = BigDecimal.fromString("10");
  for (let i = 0; i < n; i++) r = r.times(ten);
  return r;
}

function decimalsOf(addr: Address): i32 {
  let r = ERC20.bind(addr).try_decimals();
  return r.reverted ? 18 : r.value;
}

/** Самый глубокий пул quote/base по балансу base в пуле; ZERO — нет пула. */
function bestPool(quote: Address, base: Address): Address {
  let fees = [100, 500, 3000, 10000];
  let f = UniswapV3Factory.bind(Address.fromString(V3_FACTORY));
  let best = Address.fromString(ZERO);
  let bestBal = BigInt.zero();
  let erc = ERC20.bind(base);
  for (let i = 0; i < fees.length; i++) {
    let r = f.try_getPool(quote, base, fees[i]);
    if (r.reverted || r.value.toHexString() == ZERO) continue;
    let b = erc.try_balanceOf(r.value);
    let bal = b.reverted ? BigInt.zero() : b.value;
    if (bal.gt(bestBal)) { bestBal = bal; best = r.value; }
  }
  return best;
}

/** Источник курса для валюты: найти/обновить. */
function source(quote: Address, now: BigInt): PriceSource {
  let id = quote.toHexString();
  let s = PriceSource.load(id);
  if (s != null && now.minus(s.checkedAt).lt(RECHECK)) return s as PriceSource;
  if (s == null) s = new PriceSource(id);
  s.checkedAt = now;
  s.quoteDec = decimalsOf(quote);
  // сравниваем глубину в долларах: USDG-пул — по USDG, WETH-пул — по WETH × курс ETH
  let pu = bestPool(quote, Address.fromString(USDG));
  let pw = bestPool(quote, Address.fromString(WETH));
  let du = BigDecimal.zero(), dw = BigDecimal.zero();
  if (pu.toHexString() != ZERO) {
    let b = ERC20.bind(Address.fromString(USDG)).try_balanceOf(pu);
    if (!b.reverted) du = b.value.toBigDecimal().div(pow10(6));
  }
  if (pw.toHexString() != ZERO) {
    let b = ERC20.bind(Address.fromString(WETH)).try_balanceOf(pw);
    if (!b.reverted) dw = b.value.toBigDecimal().div(pow10(18)).times(ethUsd(now));
  }
  if (du.equals(BigDecimal.zero()) && dw.equals(BigDecimal.zero())) {
    s.pool = Bytes.fromHexString(ZERO); s.base = "";
    s.quoteIsToken0 = false; s.baseDec = 18;
  } else if (dw.gt(du)) {
    s.pool = pw; s.base = "weth"; s.baseDec = 18;
    let t0 = UniswapV3Pool.bind(pw).try_token0();
    s.quoteIsToken0 = !t0.reverted && t0.value.equals(quote);
  } else {
    s.pool = pu; s.base = "usdg"; s.baseDec = 6;
    let t0 = UniswapV3Pool.bind(pu).try_token0();
    s.quoteIsToken0 = !t0.reverted && t0.value.equals(quote);
  }
  s.save();
  return s as PriceSource;
}

/** Цена quote в единицах base по slot0 пула (уже с поправкой на знаки). */
function poolPrice(pool: Address, quoteIsToken0: boolean, quoteDec: i32, baseDec: i32): BigDecimal {
  let r = UniswapV3Pool.bind(pool).try_slot0();
  if (r.reverted) return BigDecimal.zero();
  let sq = r.value.value0.toBigDecimal().div(Q96);
  let p = sq.times(sq); // token1 за token0 (в сырых единицах)
  if (p.equals(BigDecimal.zero())) return BigDecimal.zero();
  let one = BigDecimal.fromString("1");
  let raw = quoteIsToken0 ? p : one.div(p);
  // сырые единицы → человеческие: base_per_quote = raw × 10^(quoteDec − baseDec)
  let d = quoteDec - baseDec;
  return d >= 0 ? raw.times(pow10(d)) : raw.div(pow10(-d));
}

let _ethUsdBlock: BigInt = BigInt.fromI32(-1);
let _ethUsd: BigDecimal = BigDecimal.zero();

/** Курс ETH в долларах (WETH/USDG). Кэш на блок. */
export function ethUsd(now: BigInt): BigDecimal {
  if (_ethUsdBlock.equals(now)) return _ethUsd;
  let weth = Address.fromString(WETH);
  let pool = bestPool(weth, Address.fromString(USDG));
  let v = BigDecimal.zero();
  if (pool.toHexString() != ZERO) {
    let t0 = UniswapV3Pool.bind(pool).try_token0();
    let isT0 = !t0.reverted && t0.value.equals(weth);
    v = poolPrice(pool, isT0, 18, 6);
  }
  _ethUsdBlock = now; _ethUsd = v;
  return v;
}

/** Курс валюты курвы в долларах; для ETH (quote == null) — курс ETH. 0 — не знаем. */
export function quoteUsd(quote: Bytes | null, now: BigInt): BigDecimal {
  if (quote === null) return ethUsd(now);
  let q = Address.fromBytes(quote as Bytes);
  if (q.toHexString() == USDG) return BigDecimal.fromString("1");
  if (q.toHexString() == WETH) return ethUsd(now);
  let s = source(q, now);
  if (s.base == "") return BigDecimal.zero();
  let p = poolPrice(Address.fromBytes(s.pool), s.quoteIsToken0, s.quoteDec, s.baseDec);
  return s.base == "weth" ? p.times(ethUsd(now)) : p;
}

/** Сумма в сырых единицах валюты → доллары. */
export function toUsd(amountRaw: BigInt, quoteDec: i32, rate: BigDecimal): BigDecimal {
  if (rate.equals(BigDecimal.zero())) return BigDecimal.zero();
  return amountRaw.toBigDecimal().div(pow10(quoteDec)).times(rate);
}

export function quoteDecimals(quote: Bytes | null): i32 {
  if (quote === null) return 18;
  let q = Address.fromBytes(quote as Bytes);
  if (q.toHexString() == USDG) return 6;
  if (q.toHexString() == WETH) return 18;
  let s = PriceSource.load(q.toHexString());
  if (s != null) return s.quoteDec;
  return decimalsOf(q);
}
