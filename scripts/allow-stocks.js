#!/usr/bin/env node
/**
 * Открыть запуск монет за акции Robinhood — все, у которых есть живой пул
 * Uniswap V3 в сети (к USDG или WETH), как у Pons.
 *
 * Что делает:
 *   1. Для каждой акции из списка ниже находит самый глубокий пул (USDG или
 *      WETH) и берёт из него цену — без внешних API, только сеть.
 *   2. Фабрика за валюту: setQuote(акция, true, virtualQuote, кап создателя).
 *      Порог градации — TARGET_USD в акциях по текущей цене (как у USDG:
 *      $16 000), кап создателя — десятая часть. Уже разрешённые не трогает.
 *   3. Зап: setRoute — маршрут обмена ETH ↔ акция. Прямой WETH→акция, если
 *      самый глубокий пул к WETH, иначе два хопа WETH→USDG→акция. Маршруты,
 *      которые уже есть, не трогает.
 *
 * Список — реестр Robinhood (docs.robinhood.com/chain/contracts) минус акции
 * без ликвидности (зонд 15.09.2026: пул глубже $2 000). Пул проверяется
 * заново при каждом запуске: тонкий или пропавший пул — акция пропускается.
 *
 * Запуск (с машины владельца, ключ из scripts/deploy-config.json):
 *   node scripts/allow-stocks.js          # сухой прогон: план, без транзакций
 *   node scripts/allow-stocks.js --send   # отправить транзакции
 */
const fs = require("fs");
const path = require("path");

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const V3 = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
// После перезапуска — новые адреса через QUOTE_FACTORY=… ZAP=… (см. scripts/relaunch.js)
const QUOTE_FACTORY = process.env.QUOTE_FACTORY || "0x094ae4f59d855165a326bbb4773f674ef795751f";
const ZAP = process.env.ZAP || "0x645a33ccc81b9cd8a0304c4d91064da6c6c4df57";
const FEES = [100, 500, 3000, 10000];
const TARGET_USD = Number(process.env.TARGET_USD || 16000); // порог градации, как у USDG
const MIN_DEPTH_USD = Number(process.env.MIN_DEPTH_USD || 2000); // тоньше — не открываем
const ZERO = "0x0000000000000000000000000000000000000000";

// Акции Robinhood с живым пулом (реестр 15.09.2026). Все — 18 знаков.
const STOCKS = [
  { sym: "AAPL", name: "Apple", addr: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { sym: "AMC", name: "AMC Entertainment", addr: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B" },
  { sym: "AMD", name: "AMD", addr: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { sym: "AMZN", name: "Amazon", addr: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { sym: "ASML", name: "ASML Holding NV", addr: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA" },
  { sym: "AVGO", name: "Broadcom", addr: "0x156E175DD063a8cE274C50654eF40e0032b3fbcF" },
  { sym: "BA", name: "Boeing", addr: "0x4D21483a44Bf67a86b77E3dA301411880797D452" },
  { sym: "BABA", name: "Alibaba", addr: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4" },
  { sym: "BB", name: "Blackberry", addr: "0x48E39E56aCdbA37b09020C0b734A613C9a2f100A" },
  { sym: "BE", name: "Bloom Energy", addr: "0x822CC93fFD030293E9842c30BBD678F530701867" },
  { sym: "CCL", name: "Carnival Corporation", addr: "0x9651342CeA770aE9a2969Ba2A52611523146aef9" },
  { sym: "CEG", name: "Constellation Energy", addr: "0xaE517A2903E68bd929Dfd15be875F8369D53e94a" },
  { sym: "COIN", name: "Coinbase", addr: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  { sym: "COST", name: "Costco", addr: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2" },
  { sym: "CRCL", name: "Circle Internet Group", addr: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5" },
  { sym: "DELL", name: "Dell", addr: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd" },
  { sym: "DJT", name: "Trump Media & Technology Group", addr: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516" },
  { sym: "F", name: "Ford Motor", addr: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C" },
  { sym: "FIG", name: "Figma", addr: "0x41F4267525a8AFf329540eF24fD83d9044758B33" },
  { sym: "GLD", name: "SPDR Gold Trust", addr: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e" },
  { sym: "GLXY", name: "Galaxy Digital Inc.", addr: "0x2D427692E928fa156ec22acfaBaFA0447C5805B7" },
  { sym: "GME", name: "GameStop", addr: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E" },
  { sym: "GOOGL", name: "Alphabet Class A", addr: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { sym: "HIMS", name: "Hims & Hers Health", addr: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09" },
  { sym: "HPE", name: "HP Enterprise", addr: "0x59dd09d4900C2E4B5F75b7c0d4E6796fcc234Cb1" },
  { sym: "IBM", name: "IBM", addr: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619" },
  { sym: "INDA", name: "iShares MSCI India ETF", addr: "0xACEF2e09adb47aD6aBeBAD9fF06689E60615C2B6" },
  { sym: "INTC", name: "Intel", addr: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" },
  { sym: "JNJ", name: "Johnson & Johnson", addr: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80" },
  { sym: "LLY", name: "Eli Lilly", addr: "0x8005d266423c7ea827372c9c864491e5786600ea" },
  { sym: "LMT", name: "Lockheed", addr: "0x329fcACEb9AD6F9580DD5F643fed0646900D043c" },
  { sym: "LULU", name: "Lululemon", addr: "0x4e62068525Ab11FE768e29dfD00ef909B9803016" },
  { sym: "META", name: "Meta Platforms", addr: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { sym: "MRNA", name: "Moderna", addr: "0x43B07D15cE533bEc5476d70C22a78a1B2B662155" },
  { sym: "MRVL", name: "Marvell Technology", addr: "0x62fd0668e10D8B72339BE2DCF7643001688ff13B" },
  { sym: "MSFT", name: "Microsoft", addr: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { sym: "MSTR", name: "Strategy Inc.", addr: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
  { sym: "MU", name: "Micron Technology", addr: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" },
  { sym: "NET", name: "Cloudflare, Inc. Class A common stock", addr: "0x116F00968269B7bfbaD4109cE591d6E74c0601d4" },
  { sym: "NFLX", name: "Netflix", addr: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8" },
  { sym: "NU", name: "Nu", addr: "0x408c14038a04f7bD235329E26d2bf569ee20e250" },
  { sym: "NVDA", name: "NVIDIA", addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { sym: "ON", name: "ON Semiconductor", addr: "0xbBD09F72b025360FeE5C928053Dca6248d35be54" },
  { sym: "PENG", name: "Penguin Solutions", addr: "0x9b23573b156B52565012F5cE02CDF60AFBaa70Be" },
  { sym: "PFE", name: "Pfizer", addr: "0x7066A64c24e4206CD62E83bf198c1E7EB361F51e" },
  { sym: "PLTR", name: "Palantir Technologies", addr: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
  { sym: "QQQ", name: "Invesco QQQ", addr: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
  { sym: "QUBT", name: "Quantum Computing", addr: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4" },
  { sym: "RBLX", name: "Roblox", addr: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8" },
  { sym: "RCAT", name: "Red Cat", addr: "0xFDE6b5d9BB419B10C23268c74e369AbFF39C0460" },
  { sym: "RDDT", name: "Reddit", addr: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C" },
  { sym: "RIVN", name: "Rivian Automotive", addr: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B" },
  { sym: "SGOV", name: "iShares 0-3 Month Treasury Bond", addr: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5" },
  { sym: "SHOP", name: "Shopify", addr: "0xF53F66751B1Eff985311b693531E3290F600c410" },
  { sym: "SKHY", name: "SK hynix Inc. American Depositary Shares", addr: "0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8" },
  { sym: "SLV", name: "iShares Silver Trust", addr: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f" },
  { sym: "SNAP", name: "Snap", addr: "0xF6589F11Bc40b669e584073F428B05562F568733" },
  { sym: "SNDK", name: "Sandisk Corporation", addr: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" },
  { sym: "SNOW", name: "Snowflake", addr: "0xBa0CAB75495255d0cB58E22B648bFED4ECD1F47E" },
  { sym: "SOXX", name: "iShares Semiconductor ETF", addr: "0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38" },
  { sym: "SPCX", name: "Space Exploration Technologies Corp. Class A Common Stock", addr: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
  { sym: "SPY", name: "SPDR S&P 500 ETF Trust", addr: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { sym: "TSLA", name: "Tesla", addr: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { sym: "TSM", name: "Taiwan Semiconductor Manufacturing", addr: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA" },
  { sym: "TTWO", name: "Take-Two Interactive Software", addr: "0x5e81213613b6B86EaB4c6c50d718d34359459786" },
  { sym: "UPS", name: "UPS", addr: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2" },
  { sym: "USAR", name: "USA Rare Earth", addr: "0xd917B029C761D264c6A312BBbcDA868658eF86a6" },
  { sym: "USO", name: "United States Oil Fund", addr: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344" },
  { sym: "VTI", name: "Vanguard Morningstar Total Stock Market ETF", addr: "0x0594134DF3f171a354D9C85eBD65b7A6148F6D09" },
  { sym: "WULF", name: "TeraWulf", addr: "0x348Be1A8663f15edDe5CDf8A96BB69078f7aB6Fd" },
  { sym: "WYFI", name: "WhiteFiber, Inc.", addr: "0x9e7ABD3C9139D14E4c86DcE0e455AAB7A0C2FB3E" },
  // Крипта из белого списка (порог тоже к $16k; знаки читаем с контракта —
  // у cbBTC их 8). WETH/USDG/USDe не трогаем: там порог задан руками и верен.
  { sym: "cbBTC", name: "Coinbase Wrapped BTC", addr: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4" },
  { sym: "LINK", name: "Chainlink", addr: "0x492641F648a4986844848E0beFE66D14817bCE34" },
  { sym: "TAO", name: "Bittensor", addr: "0xf3081494B87e8D5fb7960f066E931D1D0e6E3d67" },
  { sym: "PENDLE", name: "Pendle", addr: "0x5E49E1f85813F2B65858860A3FA231b4186f2e0E" },
  { sym: "VIRTUAL", name: "Virtuals Protocol", addr: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31" },
];
// Уже разрешённая валюта пересчитывается (--fix), если её порог в долларах
// ушёл от цели больше чем на FIX_TOL: первые валюты были заведены руками
// круглыми числами (COIN 20 шт ≈ $3.5k вместо $16k).
const FIX_TOL = Number(process.env.FIX_TOL || 0.2);

function loadCfg(needKey) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) { /* нет файла */ }
  const rpc = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  let pk = process.env.PRIVATE_KEY || cfg.privateKey;
  if (!pk && !needKey) pk = "0x" + "1".repeat(64);
  if (!pk) { console.error("Нужен ключ: scripts/deploy-config.json → privateKey."); process.exit(1); }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("Ключ не похож на приватный."); process.exit(1); }
  return { rpc, pk };
}

async function main() {
  const send = process.argv.includes("--send");
  const fix = process.argv.includes("--fix");
  const { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits, parseUnits } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { rpc, pk } = loadCfg(send);
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 3, timeout: 20000 }) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
  const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"]);
  const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
  const qfAbi = parseAbi([
    "function owner() view returns (address)",
    "function quoteConfig(address) view returns (bool allowed, uint256 virtualQuote, uint256 creatorBuyCap)",
    "function allowedQuotesCount() view returns (uint256)",
    "function setQuote(address quote, bool allowed, uint256 virtualQuote_, uint256 creatorBuyCap_)",
  ]);
  const zapAbi = parseAbi([
    "function owner() view returns (address)",
    "function hasRoute(address) view returns (bool)",
    "function setRoute(address quote, address mid, uint24 fee1, uint24 fee2, bool enabled)",
  ]);
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

  // Самый глубокий пул пары: по балансу «денежной» стороны (WETH/USDG) в пуле.
  async function bestPool(a, b, bDec) {
    const found = [];
    for (const fee of FEES) {
      const p = await read(V3, v3Abi, "getPool", [a, b, fee]).catch(() => ZERO);
      if (p && p !== ZERO) found.push({ fee, p });
    }
    for (const x of found) x.bal = Number(formatUnits(await read(b, erc20, "balanceOf", [x.p]).catch(() => 0n), bDec));
    found.sort((x, y) => y.bal - x.bal);
    return found[0] || null;
  }
  // Цена token1 за token0 из slot0, с поправкой на знаки: сколько b за один a.
  async function priceOf(pool, a, aDec, bDec) {
    const [s0, t0] = await Promise.all([read(pool, poolAbi, "slot0"), read(pool, poolAbi, "token0")]);
    const sqrt = Number(s0[0]) / 2 ** 96; const p = sqrt * sqrt;
    return t0.toLowerCase() === a.toLowerCase() ? p * 10 ** (aDec - bDec) : (1 / p) * 10 ** (aDec - bDec);
  }

  const [fOwner, zOwner, count] = await Promise.all([read(QUOTE_FACTORY, qfAbi, "owner"), read(ZAP, zapAbi, "owner"), read(QUOTE_FACTORY, qfAbi, "allowedQuotesCount")]);
  console.log(`${send ? "БОЕВОЙ запуск" : "Сухой прогон"} · кошелёк ${account.address}`);
  console.log(`фабрика за валюту ${QUOTE_FACTORY} · владелец ${fOwner} · в белом списке сейчас ${count}`);
  console.log(`зап ${ZAP} · владелец ${zOwner}`);
  if (send && (fOwner.toLowerCase() !== account.address.toLowerCase() || zOwner.toLowerCase() !== account.address.toLowerCase())) {
    console.error("Ключ не владелец фабрики/запа — транзакции отклонятся."); process.exit(1);
  }

  const ethPool = await bestPool(WETH, USDG, 6);
  const ethUsd = ethPool ? await priceOf(ethPool.p, WETH, 18, 6) : 0;
  const ethFee = ethPool ? ethPool.fee : 500;
  console.log(`ETH ≈ $${ethUsd.toFixed(0)} (пул WETH/USDG, fee ${ethFee}) · порог градации $${TARGET_USD} · минимальная глубина пула $${MIN_DEPTH_USD}\n`);

  // --only=COIN,MSFT — проверить/поправить только эти тикеры (быстро)
  const onlyArg = process.argv.find((x) => x.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) : null;
  const plan = [];
  for (const s of STOCKS) {
    if (only && !only.has(s.sym.toUpperCase())) continue;
    const dec = Number(await read(s.addr, erc20, "decimals").catch(() => 18));
    const [u, w, cfg, route] = await Promise.all([
      bestPool(s.addr, USDG, 6), bestPool(s.addr, WETH, 18),
      read(QUOTE_FACTORY, qfAbi, "quoteConfig", [s.addr]), read(ZAP, zapAbi, "hasRoute", [s.addr]),
    ]);
    const uDepth = u ? u.bal : 0, wDepth = w ? w.bal * ethUsd : 0;
    const viaWeth = wDepth > uDepth;
    const depth = Math.max(uDepth, wDepth);
    let price = 0;
    if (viaWeth) price = (await priceOf(w.p, s.addr, dec, 18)) * ethUsd;
    else if (u) price = await priceOf(u.p, s.addr, dec, 6);
    const skip = depth < MIN_DEPTH_USD ? `пул тонкий ($${depth.toFixed(0)})` : !(price > 0) ? "нет цены" : "";
    const shares = price > 0 ? TARGET_USD / price : 0;
    const fd = Math.min(6, dec);
    const virtual = shares > 0 ? parseUnits((shares / 4).toFixed(fd), dec) : 0n;
    const cap = shares > 0 ? parseUnits((shares / 10).toFixed(fd), dec) : 0n;
    const routeArgs = viaWeth ? [s.addr, ZERO, w.fee, 0, true] : (u ? [s.addr, USDG, ethFee, u.fee, true] : null);
    // текущий порог в долларах — для --fix
    const curUsd = cfg[0] ? Number(formatUnits(cfg[1] * 4n, dec)) * price : 0;
    const off = cfg[0] && price > 0 && Math.abs(curUsd - TARGET_USD) / TARGET_USD > FIX_TOL;
    const allowed = cfg[0] && !(fix && off);
    const row = { ...s, dec, depth, price, shares, virtual, cap, allowed, hasRoute: route, routeArgs, viaWeth, skip };
    plan.push(row);
    const what = skip ? `— пропуск: ${skip}` :
      `$${price.toFixed(2)} · порог ${shares.toFixed(2)} шт · ${viaWeth ? `WETH/${w.fee}` : `WETH→USDG→${u.fee}`} · ${cfg[0] ? (off ? `сейчас $${curUsd.toFixed(0)}${fix ? " → setQuote" : " (--fix поправит)"}` : "уже верно") : "setQuote"} · ${route ? "маршрут есть" : "setRoute"}`;
    console.log(`${s.sym.padEnd(6)} глубина $${String(Math.round(depth)).padStart(8)}  ${what}`);
  }

  const todoQuote = plan.filter((r) => !r.skip && !r.allowed);
  const todoRoute = plan.filter((r) => !r.skip && !r.hasRoute && r.routeArgs);
  console.log(`\nИтого: setQuote — ${todoQuote.length}, setRoute — ${todoRoute.length}, пропущено — ${plan.filter((r) => r.skip).length}`);
  if (!send) { console.log("Сухой прогон — ничего не отправлено. Отправить: node scripts/allow-stocks.js --send [--fix]"); return; }

  let n = 0;
  for (const r of todoQuote) {
    const hash = await wallet.writeContract({ address: QUOTE_FACTORY, abi: qfAbi, functionName: "setQuote", args: [r.addr, true, r.virtual, r.cap] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${rc.status === "success" ? "✓" : "✗"} setQuote ${r.sym} · ${hash}`); n++;
  }
  for (const r of todoRoute) {
    const hash = await wallet.writeContract({ address: ZAP, abi: zapAbi, functionName: "setRoute", args: r.routeArgs });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${rc.status === "success" ? "✓" : "✗"} setRoute ${r.sym} · ${hash}`); n++;
  }
  const after = await read(QUOTE_FACTORY, qfAbi, "allowedQuotesCount");
  console.log(`\nГотово: транзакций ${n}, в белом списке теперь ${after}.`);
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
