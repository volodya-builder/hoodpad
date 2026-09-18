import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import {
  FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ZAP_ADDRESS, FEE_SPLITTER_ADDRESS,
  ARENA_TREASURY_ADDRESS, BUYBACK_TREASURY_ADDRESS, WETH_ADDRESS, EXPLORER, CHAIN, TEAM_ADDRESS,
} from "../lib/config.js";

// Документация hood — одна страница с боковым оглавлением (как у Flap/GitBook,
// но в стиле сайта). Тексты RU и EN лежат рядом в одной структуре, чтобы не
// расходиться; китайский показывает английский. Адреса берутся из config.js —
// после передеплоя менять нечего.
//
// Что описываем: кривая, монеты за акции, комиссии 70/10/10/10, арена,
// монета hood, контракты, боты, безопасность. Цифры — те, что зашиты в
// контрактах (LaunchpadFactoryV3: 1B / 800M / 1.625 ETH → 6.5 ETH).

const MIGRATOR_ETH = "0xe11727b682e86ced24ed0da2aa6c113ae30672f4";
const MIGRATOR_QUOTE = "0xac360e752e9e12952e27f202d5814fa8c6220878";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const HOOD_TOKEN = "0x9eFD74eDA2640de53982097539Cd435318FC3d62"; // монета hood, запущена 17.09.2026 с кошелька команды (ETH-фабрика)
const TEAM_WALLET = "0x0462C1Efe9CA880E901807d5386EBcc6705087b3"; // командная доля комиссий (10%)
const ARENA_BOT = "0x4fC073049012c52c6B291E08D69D13b3a33d8B63";   // оператор обеих казн: только обмен в ETH и выкуп-сжигание
const SUBGRAPH = "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/5.0.0/gn";
const REPO = "https://github.com/volodya-builder/hoodpad";
const RPC = "https://rpc.mainnet.chain.robinhood.com";

const T = (ru, en, zh) => ({ ru, en, zh });

/** Разделы. Каждый: id, заголовок, абзацы (строка — абзац; массив — список;
 *  {k,v} — таблица «параметр — значение»). */
const SECTIONS = [
  {
    id: "overview", title: T("Что такое hood", "What is hood", "什么是 hood"),
    body: [
      T("hood — лаунчпад на Robinhood Chain. Любой запускает монету в одну транзакцию: 1 миллиард штук, цена растёт по бондинг-кривой, при пороге — переезд на Uniswap V3 с навсегда запертой ликвидностью.", "hood is a launchpad on Robinhood Chain. Anyone launches a coin in one transaction: 1 billion supply, price follows a bonding curve, and at the threshold the coin graduates to Uniswap V3 with liquidity locked forever.", "hood 是 Robinhood Chain 上的发行平台。任何人都可以一笔交易发行代币：总量 10 亿，价格沿联合曲线上涨，达到阈值后毕业至 Uniswap V3，流动性永久锁定。"),
      T("Особенность площадки — монеты за акции и крипту: валютой кривой может быть токенизированная акция (NVDA, AAPL, GME…) или USDG, WETH, cbBTC. Покупают и продают за ETH одной транзакцией, а держатели такой монеты получают дивиденды в этой акции.", "What makes it different: coins priced in stocks and crypto. The curve currency can be a tokenized stock (NVDA, AAPL, GME…) or USDG, WETH, cbBTC. Buying and selling still happens in ETH in one transaction, and holders of such a coin earn dividends in that stock.", "平台的特色是以股票和加密资产计价的代币：曲线计价货币可以是代币化股票（NVDA、AAPL、GME……）或 USDG、WETH、cbBTC。买卖仍以 ETH 一笔交易完成，而此类代币的持有者以该股票获得分红。"),
      T("Кошелёк подписывает каждую транзакцию сам. hood не хранит активы, не имеет доступа к деньгам пользователей и не может изменить ни одну запущенную монету.", "Your wallet signs every transaction. hood holds no assets, has no access to user funds, and cannot alter any launched coin.", "每笔交易都由您的钱包自行签名。hood 不托管资产，无法接触用户资金，也无法更改任何已发行的代币。"),
    ],
  },
  {
    id: "curve", title: T("Бондинг-кривая", "Bonding curve", "联合曲线"),
    body: [
      T("Все монеты одинаковые по механике: фиксированный сапплай, без минта, без налогов кроме комиссии площадки, без прав у создателя.", "Every coin shares the same mechanics: fixed supply, no minting, no taxes except the platform fee, no creator privileges.", "所有代币机制相同：固定总量、不可增发、除平台手续费外无任何税、创建者没有特权。"),
      { type: "stats", items: [
        { n: "1B", l: T("сапплай", "supply", "总量") },
        { n: "80%", l: T("на кривой", "on the curve", "在曲线上") },
        { n: "6.5 ETH", l: T("порог градации", "graduation", "毕业阈值") },
        { n: "20%", l: T("в ликвидность навсегда", "locked liquidity", "永久锁定的流动性") },
      ] },
      [
        { k: T("Формула", "Formula", "公式"), v: "x · y = k · virtual 1.625 ETH" },
        { k: T("Порог градации (ETH-монеты)", "Graduation threshold (ETH coins)", "毕业阈值（ETH 代币）"), v: "6.5 ETH" },
        { k: T("Порог (монеты за валюту)", "Threshold (quote coins)", "阈值（计价货币代币）"), v: T("виртуальный резерв × 4, ≈ $16k в валюте на момент добавления", "virtual reserve × 4, ≈ $16k in the asset when it was listed", "虚拟储备 × 4，上架时约合 $16k（以该资产计）") },
        { k: T("Покупка создателя при запуске", "Creator buy at launch", "发行时创建者买入"), v: T("до 5% сапплая, в той же транзакции", "up to 5% of supply, same transaction", "最多 5% 总量，同一笔交易") },
      ],
      T("При градации пул отправляет резерв и 20% сапплая в мигратор, тот создаёт full-range позицию Uniswap V3 (комиссия 0.3%) и запирает NFT позиции навсегда — ликвидность нельзя вывести никому, включая команду. Перенос происходит в той же покупке, которая заполнила кривую, — без паузы: монета торгуется на DEX уже в следующем блоке. Если перенос сорвался (цена в пуле Uniswap сбита сильнее допуска), покупка всё равно проходит, а migrate() у пула через полминуты вызывает бот площадки — или любой другой.", "At graduation the pool sends its reserve and 20% of supply to the migrator, which creates a full-range Uniswap V3 position (0.3% fee tier) and locks the position NFT forever — nobody, including the team, can withdraw that liquidity. The migration happens inside the very purchase that fills the curve — no pause: the coin trades on the DEX in the next block. If the migration fails (the Uniswap pool price was pushed beyond the migrator's tolerance), the purchase still goes through and the platform bot calls the pool's migrate() within half a minute — anyone else can too.", "毕业时，池子将储备金和 20% 总量交给迁移合约，后者创建 Uniswap V3 全区间头寸（0.3% 费率）并永久锁定头寸 NFT——包括团队在内，没有人能提取这部分流动性。迁移在填满曲线的那笔购买中直接完成，没有停顿：下一个区块代币即可在 DEX 交易。若迁移失败（Uniswap 池价格被推离超出迁移合约的容差），购买仍会成功，平台机器人会在半分钟内调用池子的 migrate()，任何人也都可以调用。"),
    ],
  },
  {
    id: "stocks", title: T("Монеты за акции и крипту", "Stock & crypto coins", "股票与加密代币"),
    body: [
      T("Вторая фабрика запускает монеты, у которых валюта кривой — не ETH, а ERC-20: токенизированная акция или крипта из белого списка (70+ активов). Цена монеты, резерв и порог градации считаются в этой валюте.", "A second factory launches coins whose curve currency is an ERC-20 instead of ETH: a tokenized stock or a crypto asset from the whitelist (70+ assets). Price, reserve and graduation threshold are denominated in that asset.", "第二个工厂发行的代币，其曲线计价货币不是 ETH，而是 ERC-20：白名单中的代币化股票或加密资产（70+ 种）。代币价格、储备和毕业阈值均以该资产计。"),
      T("Пользователь платит ETH: зап (CurveZap) меняет ETH на валюту через Uniswap V3 и покупает на кривой в одной транзакции; продажа — в обратную сторону. Проскальзывание и минимальный выход задаются на сайте.", "Users pay in ETH: the zap (CurveZap) swaps ETH into the asset on Uniswap V3 and buys on the curve in a single transaction; selling works in reverse. Slippage and minimum output are set on the site.", "用户用 ETH 支付：zap（CurveZap）在 Uniswap V3 上把 ETH 换成该资产并在曲线上买入，一笔交易完成；卖出反向进行。滑点和最小成交量在网站上设置。"),
      T("Дивиденды: создатель включает налог 1–3% с каждой сделки. Он берётся в валюте кривой и распределяется по балансам держателей. Бот площадки выплачивает накопленное автоматически (см. «Автоматизация»); забрать вручную можно в любой момент.", "Dividends: the creator can enable a 1–3% tax on every trade. It is collected in the curve asset and distributed pro-rata to holders. The platform bot pays out accrued dividends automatically (see “Automation”); manual claim is available any time.", "分红：创建者可开启每笔交易 1–3% 的税。税以曲线资产收取，并按持仓比例分配给持有者。平台机器人自动发放累积的分红（见“自动化”）；也可随时手动领取。"),
    ],
  },
  {
    id: "fees", title: T("Комиссии и экономика", "Fees & economics", "手续费与经济模型"),
    body: [
      T("Площадка берёт 1% с каждой сделки на кривой. Комиссия делится контрактами, а не людьми: доли зашиты при деплое и не меняются.", "The platform charges 1% on every curve trade. The split is enforced by contracts, not people: shares are fixed at deployment and cannot change.", "平台对曲线上的每笔交易收取 1%。分配由合约而非人来执行：比例在部署时固定，无法更改。"),
      { type: "split", title: T("Комиссия 1% с каждой сделки", "1% fee on every trade", "每笔交易 1% 手续费"), parts: [
        { l: T("Создателю монеты", "Coin creator", "代币创建者"), pct: 70, c: "var(--gold)" },
        { l: T("Арена — выкуп подиума", "Arena — podium buyback", "竞技场——领奖台回购"), pct: 10, c: "#8fd3f4" },
        { l: T("Выкуп монеты hood", "hood buyback", "hood 回购"), pct: 10, c: "#e8c65a" },
        { l: T("Команда", "Team", "团队"), pct: 10, c: "#7c7c79" },
      ] },
      [
        { k: T("Комиссия запуска", "Launch fee", "发行费用"), v: T("0 — площадка ничего не берёт; ≈ 0.0005 ETH — газ сети", "0 — the platform takes nothing; ≈ 0.0005 ETH is network gas", "0——平台不收取任何费用；≈ 0.0005 ETH 为网络 gas") },
        { k: T("Кто делит", "Who splits", "由谁分配"), v: T("FeeSplitterV6 — доли зашиты, изменить нельзя", "FeeSplitterV6 — shares are immutable", "FeeSplitterV6——比例固化，无法更改") },
      ],
      T("Доля создателя копится в пуле и забирается кнопкой на странице монеты. У ETH-монет остальные 30% пул сам отправляет в сплиттер (FeeSplitterV6) при каждой сделке; у монет за валюту они копятся в пуле, и каждые 5 минут бот забирает их в сплиттер, когда накопилось от $1 — сплиттер в той же транзакции раскладывает всё по трём адресам. У монет за валюту всё это происходит в валюте кривой.", "The creator share accrues in the pool and is claimed with a button on the coin page. For ETH coins the pool itself pushes the remaining 30% to the splitter (FeeSplitterV6) on every trade; for quote coins it accrues in the pool and every 5 minutes a bot collects it into the splitter when at least $1 has built up — the splitter forwards it to the three addresses in the same transaction. For quote coins all of this happens in the curve asset.", "创建者份额在池中累积，在代币页面一键领取。ETH 代币的池子会在每笔交易时自动把其余 30% 推送到分配合约（FeeSplitterV6）；计价货币代币的这部分先在池中累积，累积到 $1 后由机器人每 5 分钟收集到分配合约，后者在同一笔交易中转给三个地址。计价货币代币的这一切都以曲线资产进行。"),
    ],
  },
  {
    id: "antisnipe", title: T("Защита от снайперов", "Anti-snipe protection", "防狙击保护"),
    body: [
      T("Первые пять секунд после запуска монеты покупка облагается стартовым налогом, который начинается с 99% и падает до нуля: в секунду запуска — 99%, через секунду — 25%, через две — 3%, через три — 0,4%, через четыре — 0,05%, с пятой секунды — ноль. Секунды считаются по времени блока. Продажи не облагаются никогда.", "For the first five seconds after a coin launches, buys carry an opening tax that starts at 99% and decays to zero: 99% in the launch second, 25% one second later, 3% after two, 0.4% after three, 0.05% after four, zero from the fifth second on. Seconds are counted by block time. Sells are never taxed.", "代币发行后的前五秒内，买入需缴纳开盘税，从 99% 递减至零：发行当秒 99%，一秒后 25%，两秒后 3%，三秒后 0.4%，四秒后 0.05%，第五秒起为零。秒数按区块时间计算。卖出永远不征税。"),
      T("Смысл: снайпер-бот, который бьёт в первый блок после запуска, отдаёт почти всё в комиссию, а человек, открывший страницу через минуту, налога не видит. Создатель монеты освобождён всегда — его покупка в той же транзакции, что и запуск, идёт без налога; при запуске он может освободить ещё до 32 адресов (команда, партнёры). Освобождение проверяется по получателю монет, поэтому покупка через зап или другой контракт от имени освобождённого адреса тоже без налога.", "The point: a sniper bot that hits the first block after launch hands almost everything to fees, while a person who opens the page a minute later sees no tax at all. The creator is always exempt — the buy in the same transaction as the launch carries no tax — and can exempt up to 32 more addresses at launch (team, partners). Exemption is checked by the recipient of the coins, so a buy through the zap or another contract on behalf of an exempt address is untaxed too.", "目的：在发行后第一个区块抢跑的狙击机器人几乎把全部资金交给手续费，而一分钟后打开页面的人完全看不到税。创建者始终豁免——与发行同一笔交易中的买入不征税——并可在发行时再豁免最多 32 个地址（团队、合作伙伴）。豁免按代币接收者判断，因此通过 zap 或其他合约代表豁免地址买入同样免税。"),
      T("Налог не сжигается и не уходит команде отдельно: он попадает в общий котёл комиссий и делится так же, как обычная комиссия сделки — 70% создателю, 10% арене, 10% выкупу hood, 10% команде. Ставка и шкала зашиты в контракт пула и не меняются ни владельцем, ни создателем.", "The tax is not burned and does not go to the team separately: it joins the common fee pot and is split exactly like a regular trade fee — 70% creator, 10% arena, 10% hood buyback, 10% team. The rate and schedule are hard-coded in the pool contract and cannot be changed by the owner or the creator.", "税款不会销毁，也不会单独归团队：它进入公共手续费池，按普通交易手续费的方式分配——70% 创建者、10% 竞技场、10% hood 回购、10% 团队。税率和时间表写死在池子合约中，所有者和创建者都无法更改。"),
    ],
  },
  {
    id: "arena", title: T("Арена", "Arena", "竞技场"),
    body: [
      T("Арена — ежедневный бой монет по честному объёму. Каждые сутки (UTC) все неградуировавшие монеты сражаются; на чекпоинтах внутри дня выбывает слабейшая, последняя выжившая — чемпион дня. Выбывание — витрина, торговля не останавливается.", "The Arena is a daily battle of coins by fair volume. Each UTC day every non-graduated coin competes; at checkpoints during the day the weakest drops out, and the last one standing is the Champion of the Day. Elimination is for show — trading never stops.", "竞技场是每日按真实交易量进行的代币对战。每个 UTC 日，所有未毕业的代币参战；日内检查点淘汰最弱者，最后幸存者即日冠军。淘汰只是展示——交易不会停止。"),
      T("Очки боя = честный объём × (1 + прирост цены за день). Честный объём считается по кошелькам как |покупки − продажи|: накрутка туда-сюда не даёт очков, сделки создателя не считаются, вклад одного кошелька ограничен 25%.", "Battle score = fair volume × (1 + price growth for the day). Fair volume is |buys − sells| per wallet: wash trading earns nothing, creator trades don’t count, and one wallet contributes at most 25%.", "战斗积分 = 真实交易量 ×（1 + 当日价格涨幅）。真实交易量按钱包计算 |买入 − 卖出|：刷量不得分，创建者交易不计入，单个钱包贡献最多 25%。"),
      { type: "split", title: T("Призовой фонд дня — вся казна арены", "Daily prize — the whole arena treasury", "每日奖金——整个竞技场金库"), parts: [
        { l: T("1 место", "1st place", "第 1 名"), pct: 70, c: "var(--gold)" },
        { l: T("2 место", "2nd place", "第 2 名"), pct: 20, c: "#c3cbd4" },
        { l: T("3 место", "3rd place", "第 3 名"), pct: 10, c: "#c98a55" },
      ] },
      T("Утром (00:25 UTC) бот тратит всё, что лежит в казне арены, на вчерашний подиум: 70% первому месту, 20% второму, 10% третьему — выкуп монеты с рынка и сжигание в той же транзакции. Казна копит в ETH: доля от монет за акции и крипту приходит в их валюте (GME, USDG…), и перед выплатой казна сама меняет её на ETH через Uniswap V3 — по тем же маршрутам, что использует зап, и только если пул достаточно глубокий. Подиум оплачивается из ETH: монета на кривой выкупается у кривой (ETH-монета напрямую, монета за валюту — через зап), градуировавшая — на Uniswap V3; из выкупов монета не выпадает никогда. Одна корона на монету: выигравшая однажды больше не участвует.", "In the morning (00:25 UTC) the bot spends everything in the arena treasury on yesterday’s podium: 70% to 1st, 20% to 2nd, 10% to 3rd — buying the coin off the market and burning it in the same transaction. The treasury accumulates in ETH: the share from stock and crypto coins arrives in their asset (GME, USDG…), and before paying out the treasury swaps it to ETH itself via Uniswap V3 — over the same routes the zap uses, and only when the pool is deep enough. The podium is paid in ETH: a coin still on its curve is bought from the curve (ETH coins directly, quote coins through the zap), a graduated coin — on Uniswap V3; a coin never drops out of buybacks. One crown per coin: a past winner never competes again.", "早晨（00:25 UTC）机器人将竞技场金库中的全部资金用于昨日领奖台：70% 给第 1 名，20% 给第 2 名，10% 给第 3 名——从市场买入代币并在同一笔交易中销毁。金库以 ETH 累积：来自股票和加密资产代币的份额以其计价货币（GME、USDG…）到账，付款前金库会通过 Uniswap V3 自行换成 ETH——走与 zap 相同的路径，且仅在池子足够深时。领奖台以 ETH 支付：仍在曲线上的代币从曲线买入（ETH 代币直接买入，计价货币代币通过 zap 买入），已毕业的代币在 Uniswap V3 上买入；代币永远不会退出回购。一枚代币只能夺冠一次：曾经的赢家不再参赛。"),
      { type: "note", text: T("Из казны арены нельзя вывести ни копейки — контракт умеет только менять валюту на ETH (ETH остаётся в казне), покупать монеты площадки и сжигать их. Кошелёк бота — оператор с правом только на эти действия.", "Nothing can be withdrawn from the arena treasury — the contract can only swap assets to ETH (which stays in the treasury), buy platform coins and burn them. The bot wallet is an operator limited to exactly these actions.", "竞技场金库中的资金无法提取——合约只能把资产换成 ETH（留在金库内）、买入平台代币并销毁。机器人钱包是仅限这些操作的操作员。") },
    ],
  },
  {
    id: "hood", title: T("Монета hood", "The hood coin", "hood 代币"),
    body: [
      T("hood — первая монета площадки, запущена командой на общих условиях (ETH-кривая, 1% комиссия, те же контракты). Никаких особых прав у неё нет.", "hood is the platform’s first coin, launched by the team under the same rules as everyone (ETH curve, 1% fee, same contracts). It has no special privileges.", "hood 是平台的第一枚代币，由团队按与所有人相同的规则发行（ETH 曲线、1% 手续费、相同合约）。它没有任何特权。"),
      T("10% каждой комиссии площадки приходят в казну выкупа hood. Казна копит в ETH (валюту от монет за акции она сама меняет на ETH), и раз в час бот покупает на всё накопленное монету hood и сжигает её: пока монета на кривой — у кривой, после градации — на Uniswap V3. Из казны нельзя вывести ничего — только обмен в ETH внутри казны, выкуп и сжигание.", "10% of every platform fee goes to the hood buyback treasury. It accumulates in ETH (assets from stock coins are swapped to ETH by the treasury itself), and every hour the bot spends everything accumulated to buy hood and burn it: from the curve while the coin is on it, on Uniswap V3 after graduation. Nothing can be withdrawn — only in-treasury swaps to ETH, buyback and burn.", "平台每笔手续费的 10% 进入 hood 回购金库。金库以 ETH 累积（来自股票代币的资产由金库自行换成 ETH），机器人每小时用累积的全部资金买入 hood 并销毁：代币在曲线上时从曲线买入，毕业后在 Uniswap V3 上买入。资金无法提取——只能在金库内换成 ETH、回购和销毁。"),
      HOOD_TOKEN
        ? [{ k: T("Адрес монеты", "Token address", "代币地址"), v: HOOD_TOKEN, addr: true }]
        : T("Площадка перезапущена 17.09.2026 на новых контрактах; монета hood запускается заново — адрес появится здесь.", "The platform was relaunched on 17 Sep 2026 on a new contract set; the hood coin is being launched again — its address will appear here.", "平台于 2026 年 9 月 17 日在新合约上重新启动；hood 代币将重新发行——地址将显示在此处。"),
    ],
  },
  {
    id: "contracts", title: T("Контракты", "Deployed contracts", "已部署合约"),
    body: [
      T("Все контракты задеплоены 17.09.2026 на Robinhood Chain — полный перезапуск с новых кошельков. Исходники — в репозитории на GitHub (папка contracts/); собраны solc 0.8.28, optimizer 200, evm paris — любой может пересобрать и сверить байткод.", "All contracts were deployed on 17 Sep 2026 on Robinhood Chain — a full relaunch from fresh wallets. Source code is in the GitHub repository (contracts/ folder); built with solc 0.8.28, optimizer 200, evm paris — anyone can rebuild and compare the bytecode.", "所有合约于 2026 年 9 月 17 日部署在 Robinhood Chain 上——使用全新钱包的完整重启。源代码在 GitHub 仓库（contracts/ 目录）；使用 solc 0.8.28、optimizer 200、evm paris 编译——任何人都可以重新编译并比对字节码。"),
      T("Исходники всех десяти контрактов верифицированы в обозревателе Blockscout: на странице каждого адреса виден код, совпадающий с байткодом в сети, и его можно читать прямо там.", "The source code of all ten contracts is verified on the Blockscout explorer: each address page shows the code matching the on-chain bytecode, readable right there.", "全部十个合约的源代码已在 Blockscout 浏览器上完成验证：每个地址页面都显示与链上字节码一致的代码，可直接在那里阅读。"),
      [
        { k: T("Сеть", "Network", "网络"), v: "Robinhood Chain · chainId 4663" },
        { k: "RPC", v: RPC },
        { k: T("Обозреватель", "Explorer", "区块浏览器"), v: EXPLORER },
      ],
      [
        { k: "LaunchpadFactoryV3 — " + "ETH", v: FACTORY_ADDRESS, addr: true },
        { k: "LaunchpadFactoryQuoteV3 — " + T("акции и крипта", "stocks & crypto", "股票与加密资产"), v: QUOTE_FACTORY_ADDRESS, addr: true },
        { k: "CurveZap — " + T("ETH ↔ валюта в одной транзакции", "ETH ↔ asset in one transaction", "ETH ↔ 资产，一笔交易"), v: ZAP_ADDRESS, addr: true },
        { k: "FeeSplitterV6 — " + T("делёж комиссий", "fee split", "手续费分配"), v: FEE_SPLITTER_ADDRESS, addr: true },
        { k: "ArenaTreasuryV3 — " + T("казна арены (копит в ETH)", "arena treasury (accumulates in ETH)", "竞技场金库（以 ETH 累积）"), v: ARENA_TREASURY_ADDRESS, addr: true },
        { k: "ArenaTreasuryV3 — " + T("казна выкупа hood (копит в ETH)", "hood buyback treasury (accumulates in ETH)", "hood 回购金库（以 ETH 累积）"), v: BUYBACK_TREASURY_ADDRESS, addr: true },
        { k: "UniswapV3Migrator — " + T("градация ETH-монет", "ETH coin graduation", "ETH 代币毕业"), v: MIGRATOR_ETH, addr: true },
        { k: "UniswapV3MigratorQuote — " + T("градация монет за валюту", "quote coin graduation", "计价货币代币毕业"), v: MIGRATOR_QUOTE, addr: true },
        { k: T("Владелец контрактов", "Contract owner", "合约所有者"), v: TEAM_ADDRESS, addr: true },
        { k: T("Кошелёк команды (10% комиссий)", "Team wallet (10% of fees)", "团队钱包（10% 手续费）"), v: TEAM_WALLET, addr: true },
        { k: T("Оператор казн (бот)", "Treasury operator (bot)", "金库操作员（机器人）"), v: ARENA_BOT, addr: true },
        { k: "WETH", v: WETH_ADDRESS, addr: true },
        { k: "USDG", v: USDG_ADDRESS, addr: true },
      ],
      T("Каждая монета — это два контракта: токен (ERC-20, фиксированный сапплай) и её пул (кривая). Адреса обоих показаны на странице монеты.", "Each coin is two contracts: the token (ERC-20, fixed supply) and its pool (the curve). Both addresses are shown on the coin page.", "每枚代币由两个合约组成：代币本身（ERC-20，固定总量）和它的池子（曲线）。两个地址都显示在代币页面。"),
    ],
  },
  {
    id: "data", title: T("Данные и API", "Data & API", "数据与 API"),
    body: [
      T("Все сделки, монеты и события индексирует публичный сабграф на Goldsky (GraphQL). Им же пользуется сайт — можно строить свои дашборды и ботов.", "All trades, coins and events are indexed by a public Goldsky subgraph (GraphQL). The site itself uses it — you can build your own dashboards and bots on top.", "所有交易、代币和事件由公开的 Goldsky 子图（GraphQL）索引。网站本身也使用它——您可以在此之上构建自己的看板和机器人。"),
      [{ k: "GraphQL", v: SUBGRAPH, addr: false, link: SUBGRAPH }],
      T("Пример: { tokens(first: 10, orderBy: createdBlock, orderDirection: desc) { id symbol pool createdAt } trades(first: 5) { trader ethAmount tokenAmount isBuy timestamp } }", "Example: { tokens(first: 10, orderBy: createdBlock, orderDirection: desc) { id symbol pool createdAt } trades(first: 5) { trader ethAmount tokenAmount isBuy timestamp } }", "示例：{ tokens(first: 10, orderBy: createdBlock, orderDirection: desc) { id symbol pool createdAt } trades(first: 5) { trader ethAmount tokenAmount isBuy timestamp } }"),
    ],
  },
  {
    id: "bots", title: T("Автоматизация", "Automation", "自动化"),
    body: [
      T("Всё, что происходит по расписанию, делают открытые боты из репозитория (папка bot/). У них нет прав менять контракты: в казнах кошелёк бота — оператор, которому доступны только обмен валюты на ETH внутри казны и выкуп-сжигание; владелец контрактов может лишь сменить оператора.", "Everything on a schedule is done by open-source bots from the repository (bot/ folder). They cannot change contracts: in the treasuries the bot wallet is an operator limited to in-treasury swaps to ETH and buyback-and-burn; the contract owner can only replace the operator.", "所有定时任务由仓库中的开源机器人（bot/ 目录）执行。它们无法更改合约：在金库中，机器人钱包是操作员，仅能在金库内把资产换成 ETH 以及回购销毁；合约所有者只能更换操作员。"),
      [
        { k: T("Дивиденды и сбор комиссий", "Dividends & fee collection", "分红与手续费收集"), v: T("каждые 5 минут: выплата держателям от $1, сбор доли площадки в сплиттер от $1 (порог — чтобы газ не съедал выплату; меньшие суммы копятся и не пропадают)", "every 5 minutes: payouts to holders from $1, platform share into the splitter from $1 (the threshold keeps gas below the payout; smaller amounts keep accruing)", "每 5 分钟：向持有者发放 $1 起的分红，平台份额累积到 $1 后进入分配合约（阈值确保 gas 低于发放额；较小金额继续累积，不会丢失）") },
        { k: T("Перенос на DEX", "DEX migration", "迁移至 DEX"), v: T("страховка: если перенос на DEX внутри покупки-градации сорвался, бот каждые 30 секунд вызывает migrate() пула — ликвидность уезжает в Uniswap V3 и запирается; бот лишь платит газ, деньги идут по коду пула", "backstop: if the in-purchase DEX migration failed, the bot calls the pool's migrate() every 30 seconds — liquidity moves to Uniswap V3 and is locked; the bot only pays gas, funds move by the pool's code", "兜底：若购买中的 DEX 迁移失败，机器人每 30 秒调用池子的 migrate()——流动性转入 Uniswap V3 并锁定；机器人只支付 gas，资金按池子代码流转") },
        { k: T("Арена", "Arena", "竞技场"), v: T("ежедневно 00:25 UTC — валюта казны → ETH, затем выкуп и сжигание вчерашнего подиума (у кривой или на Uniswap, если монета градуировала)", "daily 00:25 UTC — treasury assets → ETH, then buyback & burn of yesterday’s podium (from the curve, or on Uniswap once the coin graduated)", "每日 00:25 UTC——金库资产 → ETH，然后回购并销毁昨日领奖台（从曲线买入，代币毕业后在 Uniswap 上买入）") },
        { k: T("Выкуп hood", "hood buyback", "hood 回购"), v: T("раз в час — вся казна выкупа → покупка hood (у кривой или на Uniswap после градации) и сжигание", "every hour — whole buyback treasury → buy hood (from the curve, or on Uniswap after graduation) and burn", "每小时——整个回购金库 → 买入 hood（从曲线，毕业后在 Uniswap 上）并销毁") },
      ],
    ],
  },
  {
    id: "security", title: T("Безопасность и риски", "Security & risks", "安全与风险"),
    body: [
      T("Монеты, пулы, мигратор, сплиттер и казны не имеют функций вывода, паузы или изменения правил. У фабрик есть владелец, который может менять только параметры будущих запусков (казна, мигратор, комиссия ≤ 5%) — через заявку с задержкой 48 часов, видимую всем в блокчейне. Уже запущенные монеты это не затрагивает.", "Coins, pools, the migrator, the splitter and treasuries have no withdraw, pause or rule-change functions. The factories have an owner who can only change parameters for future launches (treasury, migrator, fee ≤ 5%) through a proposal with a 48-hour delay visible on-chain. Already launched coins are unaffected.", "代币、池子、迁移合约、分配合约和金库都没有提取、暂停或更改规则的函数。工厂有一个所有者，只能通过链上可见、延迟 48 小时的提案更改未来发行的参数（金库、迁移合约、手续费 ≤ 5%）。已发行的代币不受影响。"),
      T("Казны (арена и выкуп hood) — ArenaTreasuryV3: два права, оба у оператора-бота и владельца — обменять валюту казны на ETH (ETH остаётся в казне) и выкупить монету площадки с сжиганием (у кривой или на Uniswap V3 после градации). Функции перевода средств на любой адрес нет в принципе. Владелец контрактов — один кошелёк, передача владения в два шага (новый владелец должен принять).", "The treasuries (arena and hood buyback) are ArenaTreasuryV3: two rights, held by the operator bot and the owner — swap treasury assets to ETH (ETH stays inside) and buy a platform coin with burn (from the curve, or on Uniswap V3 after graduation). There is no function to send funds to any address at all. Contracts have a single owner wallet; ownership transfers in two steps (the new owner must accept).", "金库（竞技场和 hood 回购）为 ArenaTreasuryV3：两项权限，由操作员机器人和所有者持有——把金库资产换成 ETH（ETH 留在金库内）以及买入平台代币并销毁（从曲线买入，或毕业后在 Uniswap V3 上买入）。根本不存在向任何地址转账的函数。合约只有一个所有者钱包；所有权分两步转移（新所有者必须接受）。"),
      { type: "note", text: T("Ни один контракт площадки не имеет функций паузы, вывода средств или изменения правил уже запущенных монет.", "No platform contract has pause, withdraw, or rule-change functions for already launched coins.", "没有任何平台合约对已发行的代币具有暂停、提取或更改规则的函数。") },
      T("Риски: токены волатильны и могут обесцениться полностью; сделки необратимы; курс акций-токенов зависит от ликвидности пулов Uniswap в сети; hood — независимый проект, не аффилированный с Robinhood Markets, Inc.", "Risks: tokens are volatile and can go to zero; transactions are irreversible; stock-token prices depend on Uniswap pool liquidity on the chain; hood is an independent project not affiliated with Robinhood Markets, Inc.", "风险：代币波动剧烈，可能归零；交易不可撤销；股票代币的价格取决于链上 Uniswap 池的流动性；hood 是独立项目，与 Robinhood Markets, Inc. 无关。"),
    ],
  },
  {
    id: "links", title: T("Ссылки", "Links", "链接"),
    body: [
      [
        { k: T("Сайт", "Site", "网站"), v: "https://hoodandarrow.com", link: "https://hoodandarrow.com" },
        { k: "GitHub", v: REPO, link: REPO },
        { k: "X", v: "https://x.com/hoodandarrow", link: "https://x.com/hoodandarrow" },
        { k: T("Обозреватель", "Explorer", "区块浏览器"), v: EXPLORER, link: EXPLORER },
      ],
    ],
  },
];

/** Полоса долей: доли «выезжают» при появлении на экране; наведение на
 *  сегмент или подпись подсвечивает его, остальные приглушаются, внутри
 *  сегмента проступает процент. */
function Split({ b, L }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`docs-split ${seen ? "in" : ""} ${hi !== null ? "has-hi" : ""}`} ref={ref} onMouseLeave={() => setHi(null)}>
      <div className="docs-split-title">{L(b.title)}{hi !== null && <span className="docs-split-cur">{L(b.parts[hi].l)} · <b>{b.parts[hi].pct}%</b></span>}</div>
      <div className="docs-split-bar">
        {b.parts.map((p, j) => (
          <span key={j} className={`seg ${hi === j ? "hi" : ""}`} style={{ "--w": `${p.pct}%`, "--c": p.c, transitionDelay: seen ? `${j * 90}ms` : "0ms" }}
                onMouseEnter={() => setHi(j)}>
            <em>{p.pct}%</em>
          </span>
        ))}
      </div>
      <div className="docs-split-legend">
        {b.parts.map((p, j) => (
          <span key={j} className={hi === j ? "hi" : ""} onMouseEnter={() => setHi(j)}><i style={{ background: p.c }} />{L(p.l)} <b>{p.pct}%</b></span>
        ))}
      </div>
    </div>
  );
}

function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById("doc-" + id)).filter(Boolean);
    if (!els.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis.length) setActive(vis[0].target.id.replace("doc-", ""));
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids.join(",")]);
  return active;
}

export default function Docs() {
  const { lang, t } = useLang();
  const L = (x) => (x && typeof x === "object" && "ru" in x ? (lang === "ru" ? x.ru : lang === "zh" ? (x.zh || x.en) : x.en) : x);
  const ids = useMemo(() => SECTIONS.map((s) => s.id), []);
  const active = useScrollSpy(ids);
  const [copied, setCopied] = useState("");
  const copy = (v) => { try { navigator.clipboard.writeText(v); } catch (e) { /* ignore */ } setCopied(v); setTimeout(() => setCopied(""), 1200); };
  const go = (id) => (e) => { e.preventDefault(); document.getElementById("doc-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="docs">
      <aside className="docs-nav">
        <div className="docs-nav-title">{t("Документация")}</div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/docs`} className={`docs-nav-item ${active === s.id ? "on" : ""}`} onClick={go(s.id)}><i>{String(SECTIONS.indexOf(s) + 1).padStart(2, "0")}</i>{L(s.title)}</a>
        ))}
        <a className="docs-nav-item docs-nav-ext" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
      </aside>
      <div className="docs-body">
        <div className="docs-hero">
          <div className="docs-eyebrow">hood · docs · Robinhood Chain</div>
          <h1>{t("Документация")}</h1>
          <div className="docs-lead">{t("Как устроен hood: кривая, комиссии, арена, контракты. Обновлено 17.09.2026.")}</div>
          <div className="docs-hero-chips">
            {["contracts", "fees", "data"].map((id) => <a key={id} href="#/docs" onClick={go(id)}>{L(SECTIONS.find((s) => s.id === id).title)} →</a>)}
          </div>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.id} id={"doc-" + s.id} className="docs-sec">
            <div className="docs-num">{String(SECTIONS.indexOf(s) + 1).padStart(2, "0")}</div>
            <h2>{L(s.title)}</h2>
            {s.body.map((b, i) => b && b.type === "stats" ? (
              <div className="docs-stats" key={i}>
                {b.items.map((it, j) => <div className="docs-stat" key={j}><div className="n">{it.n}</div><div className="l">{L(it.l)}</div></div>)}
              </div>
            ) : b && b.type === "split" ? (
              <Split key={i} b={b} L={L} />
            ) : b && b.type === "note" ? (
              <div className="docs-note" key={i}>{L(b.text)}</div>
            ) : Array.isArray(b) ? (
              <div className="docs-table" key={i}>
                {b.map((row, j) => (
                  <div className="docs-row" key={j}>
                    <span className="docs-k">{L(row.k)}</span>
                    <span className={`docs-v ${row.addr || row.link ? "mono" : ""}`}>
                      {row.link ? <a href={row.link} target="_blank" rel="noreferrer">{L(row.v)}</a>
                        : row.addr ? <>
                            <a href={`${EXPLORER}/address/${row.v}`} target="_blank" rel="noreferrer">{row.v}</a>
                            <button type="button" className="docs-copy" onClick={() => copy(row.v)} title={t("Скопировать адрес")}>{copied === row.v ? "✓" : "⧉"}</button>
                          </>
                        : L(row.v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p key={i}>{L(b)}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
