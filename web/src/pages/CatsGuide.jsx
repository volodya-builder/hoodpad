import React, { useState } from "react";
import * as CL from "../lib/clicker.js";

/** Подробная инструкция по игре «Коты-брокеры».
 *  Текст двуязычный: пары (ru, en) вместо словаря — так длинные абзацы
 *  проще держать в согласии друг с другом.
 *  Таблицы улучшений и редкостей строятся из тех же данных, что и игра,
 *  поэтому инструкция не может разойтись с механикой. */

const SECTIONS = [
  { id: "start", ru: "С чего начать", en: "Getting started" },
  { id: "clicker", ru: "Кликер", en: "The clicker" },
  { id: "upgrades", ru: "Прокачка", en: "Upgrades" },
  { id: "raffle", ru: "Розыгрыш котов", en: "Cat raffle" },
  { id: "boxes", ru: "Кейсы", en: "Cases" },
  { id: "rarity", ru: "Редкость и награды", en: "Rarity and dividends" },
  { id: "market", ru: "Биржа", en: "Marketplace" },
  { id: "strategy", ru: "Стратегия новичка", en: "Beginner strategy" },
  { id: "faq", ru: "Частые вопросы", en: "FAQ" },
  { id: "status", ru: "Статус и риски", en: "Status and risks" },
];

export default function CatsGuide({ lang, rarities, onTab, t: tr }) {
  const [open, setOpen] = useState(null);
  const T = (ru, en) => (lang === "en" ? en : ru);
  const go = (id) => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const faq = [
    [T("Нужно ли что-то платить, чтобы играть?", "Do I have to pay to play?"),
     T("Нет. Кликер бесплатный, очки в нём ничего не стоят и ничего не стоят обратно. Платными будут только кейсы после деплоя — но кота можно получить и даром, выиграв в получасовом розыгрыше.",
       "No. The clicker is free, points cost nothing and are worth nothing on their own. Only cases will cost money after deploy — but you can also get a cat for free by winning the half-hour raffle.")],
    [T("Влияет ли игра на размер наград?", "Does the game affect my dividends?"),
     T("Нет, и это принципиально. Сколько ты натапал, на выплаты не влияет никак: доля кота считается только по его редкости. Кликер нужен ровно для одного — раздавать NFT-котов и приводить людей на платформу.",
       "No, and that is deliberate. How much you tap does not affect payouts at all: a cat's share depends only on its rarity. The clicker exists for exactly one purpose — to give cats away and bring people in.")],
    [T("Что будет с наградами, если я продам кота?", "What happens to dividends if I sell a cat?"),
     T("Невыплаченные награды копятся на самом коте и уезжают вместе с ним к покупателю. Поэтому кот с большой накопленной суммой стоит дороже — это видно в карточке лота строкой «наград внутри».",
       "Unclaimed dividends accrue on the cat itself and travel with it to the buyer. That is why a cat with a large accrued balance is worth more — the listing card shows it as “dividends inside”.")],
    [T("Откуда берутся деньги на выплаты?", "Where does the payout money come from?"),
     T("Из комиссий платформы: часть реальных сборов hood с торгов конвертируется в токенизированные акции и раздаётся котам. Нет торгов — нет выплат. Контракт ничего не обещает, не печатает и не гарантирует доходность.",
       "From platform fees: part of the real trading fees hood collects is converted into tokenized stocks and distributed to cats. No trading, no payouts. The contract promises nothing, prints nothing and guarantees no yield.")],
    [T("Можно ли накрутить очки?", "Can points be cheated?"),
     T("Сейчас — да, прогресс лежит в браузере, это бета. До запуска раздачи очки раунда переедут на сервер и в контракт, иначе боты выметут всех котов. Пока розыгрыш работает как демонстрация механики.",
       "Right now — yes, progress lives in your browser, this is a beta. Before the giveaway goes live, round points move to the server and on-chain, otherwise bots would sweep every cat. For now the raffle demonstrates the mechanic.")],
    [T("Сколько всего будет котов?", "How many cats will there be?"),
     T("Ровно 10 500 и ни одним больше: 10 000 приходят из кейсов и 500 отведено на бесплатную раздачу первым пользователям. Оба лимита зашиты в контракт константами — поднять их не может даже владелец. Когда кейсы закончатся, новых котов не будет: только вторичный рынок.",
       "Exactly 10,500 and not one more: 10,000 come from cases and 500 are reserved for the free giveaway to early users. Both limits are hardcoded constants in the contract — not even the owner can raise them. Once the cases run out there will be no new cats: secondary market only.")],
  ];

  return (
    <div className="guide">
      {/* оглавление */}
      <nav className="guide-toc">
        <b>{T("Содержание", "Contents")}</b>
        {SECTIONS.map((s, i) => (
          <button key={s.id} onClick={() => go(s.id)}>
            <i>{i + 1}</i>{T(s.ru, s.en)}
          </button>
        ))}
      </nav>

      <div className="guide-body">
        {/* ——— с чего начать */}
        <section id="g-start">
          <h2 className="rev-h2">{T("С чего начать", "Getting started")}</h2>
          <p className="guide-lead">
            {T("Коты-брокеры — это игра внутри hood. Ты тапаешь кота и копишь очки, очки дают билеты в розыгрыш NFT-котов, а кот приносит награды в токенизированных акциях из казны платформы. Ниже — как устроен каждый шаг.",
               "Broker Cats is a game inside hood. You tap a cat and collect points, points buy tickets into the NFT cat raffle, and a cat earns dividends in tokenized stocks from the platform treasury. Below is how each step works.")}
          </p>
          <div className="guide-steps">
            {[
              ["1", T("Тапай кота", "Tap the cat"), T("Открой вкладку «Кликер» и жми по коту. Каждый тап приносит очки — это твои билеты.", "Open the Clicker tab and tap the cat. Every tap gives points — those are your tickets.")],
              ["2", T("Качай улучшения", "Buy upgrades"), T("Очки тратятся на улучшения слева. Они ускоряют добычу — и билетов становится больше.", "Points are spent on upgrades on the left. They speed up mining — so you hold more tickets.")],
              ["3", T("Жди розыгрыш", "Wait for the draw"), T("Каждые 30 минут один NFT-кот уходит случайному игроку. Чем больше очков за раунд, тем выше шанс.", "Every 30 minutes one NFT cat goes to a random player. The more round points, the better your odds.")],
              ["4", T("Получай награды", "Collect dividends"), T("Кот на руках получает долю выплат казны в акциях. Чем реже кот, тем больше доля.", "A cat you hold receives a share of treasury payouts in stocks. The rarer the cat, the bigger the share.")],
            ].map(([n, h, p]) => (
              <div className="guide-step" key={n}>
                <span className="guide-num">{n}</span>
                <b>{h}</b>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ——— кликер */}
        <section id="g-clicker">
          <h2 className="rev-h2">{T("Кликер: как он работает", "The clicker in detail")}</h2>
          <div className="guide-cards">
            <div className="guide-card">
              <b>🖐 {T("Сила клика", "Click power")}</b>
              <p>{T("Базовый тап даёт 1 очко. Улучшения ветки «Клик» добавляют очки напрямую: каждый уровень «Когтей» — плюс одно очко к каждому тапу.",
                    "A base tap gives 1 point. Click-branch upgrades add points directly: each level of Claws adds one point to every tap.")}</p>
            </div>
            <div className="guide-card">
              <b>🔥 {T("Комбо", "Combo")}</b>
              <p>{T(`Тапай без пауз — за каждые ${CL.COMBO_STEP} тапов подряд множитель растёт на единицу, до ×${CL.COMBO_MAX}. Пауза дольше ${(CL.COMBO_WINDOW_MS / 1000).toFixed(1)} секунды сбрасывает серию. Ветка «Ритм» расширяет окно паузы, снижает число тапов на ступень и поднимает потолок до ×10.`,
                    `Tap without pauses — every ${CL.COMBO_STEP} taps in a row raise the multiplier by one, up to x${CL.COMBO_MAX}. A pause longer than ${(CL.COMBO_WINDOW_MS / 1000).toFixed(1)}s resets the streak. The Rhythm branch widens the window, lowers taps per step and raises the cap to x10.`)}</p>
            </div>
            <div className="guide-card">
              <b>⚡ {T("Криты", "Crits")}</b>
              <p>{T("С небольшим шансом тап срабатывает как критический и даёт в 10 раз больше. «Чутьё рынка» повышает шанс, «Плечо» — сам множитель, вплоть до ×30.",
                    "With a small chance a tap crits and pays 10x. Market sense raises the chance, Leverage raises the multiplier itself, up to x30.")}</p>
            </div>
            <div className="guide-card">
              <b>🐱‍👤 {T("Золотой кот", "Golden cat")}</b>
              <p>{T("Иногда на арене выскакивает золотой кот и висит 4 секунды. Успел поймать — джекпот очков и буст ×2 на 20 секунд. «Кошачья удача» повышает шанс его появления, «Валерьянка» продлевает буст до 84 секунд.",
                    "Sometimes a golden cat pops up in the arena for 4 seconds. Catch it and you get a points jackpot plus a x2 boost for 20 seconds. Lucky cat raises its spawn chance, Catnip extends the boost up to 84 seconds.")}</p>
            </div>
            <div className="guide-card">
              <b>⚙️ {T("Автодобыча", "Idle income")}</b>
              <p>{T("Улучшения ветки «Доход» капают очки сами, пока страница открыта. «Ночная смена» добавляет офлайн-доход: пока тебя нет, начисляется до 75% автодобычи, максимум за 8 часов.",
                    "Income-branch upgrades earn points on their own while the page is open. Night shift adds offline income: while you are away you earn up to 75% of idle rate, capped at 8 hours.")}</p>
            </div>
            <div className="guide-card">
              <b>📈 {T("Уровень", "Level")}</b>
              <p>{T("Уровень растёт от суммарно заработанных очков и ничего не сбрасывает. Он нужен, чтобы открывать улучшения: часть из них становится доступной только с определённого уровня.",
                    "Your level grows from lifetime points and never resets. It gates upgrades: some of them unlock only at a certain level.")}</p>
            </div>
          </div>
        </section>

        {/* ——— прокачка: таблица прямо из данных игры */}
        <section id="g-upgrades">
          <h2 className="rev-h2">{T("Прокачка: все улучшения", "Upgrades: the full list")}</h2>
          <p className="guide-lead">
            {T("Улучшения разложены по четырём веткам. Цена каждого следующего уровня растёт, поэтому выгоднее качать вширь, а не вкладывать всё в одно. Точка на вкладке в игре означает, что там есть что купить прямо сейчас.",
               "Upgrades are split across four branches. Each next level costs more, so it pays to grow wide rather than dump everything into one line. A dot on a tab in-game means something there is affordable right now.")}
          </p>
          {CL.UPGRADE_CATS.map((c) => (
            <div className="guide-branch" key={c.id}>
              <div className="guide-branch-h"><span>{c.icon}</span>{T(c.ru, c.en)}</div>
              <div className="guide-table">
                <div className="guide-tr guide-th">
                  <span>{T("Улучшение", "Upgrade")}</span>
                  <span>{T("Эффект", "Effect")}</span>
                  <span>{T("С уровня", "From level")}</span>
                  <span>{T("Цена", "Price")}</span>
                  <span>{T("Потолок", "Cap")}</span>
                </div>
                {CL.UPGRADES.filter((u) => u.cat === c.id).map((u) => (
                  <div className="guide-tr" key={u.id}>
                    <span><i className="guide-ico">{u.icon}</i>{tr(u.ru)}</span>
                    <span className="dim">{tr(u.desc)}</span>
                    <span>{u.req}</span>
                    <span>{u.base.toLocaleString("ru-RU")}</span>
                    <span>{u.max || "∞"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="hint">
            {T("Кнопки ×1 / ×10 / макс над списком покупают сразу несколько уровней: «макс» берёт столько, на сколько хватает очков.",
               "The x1 / x10 / max buttons above the list buy several levels at once: “max” takes as many as your points allow.")}
          </div>
        </section>

        {/* ——— розыгрыш */}
        <section id="g-raffle">
          <h2 className="rev-h2">{T("Розыгрыш котов каждые 30 минут", "A cat raffle every 30 minutes")}</h2>
          <div className="guide-two">
            <div>
              <p>{T(`Сутки разбиты на ${CL.ROUNDS_PER_DAY} раундов по ${CL.ROUND_MIN} минут. Границы раундов общие для всех игроков и привязаны к часам, а не к моменту, когда ты зашёл: никто не может «начать свой раунд» пораньше.`,
                    `The day is split into ${CL.ROUNDS_PER_DAY} rounds of ${CL.ROUND_MIN} minutes. Round boundaries are the same for everyone and tied to the clock, not to when you showed up: nobody can start their own round early.`)}</p>
              <p>{T("В конце раунда разыгрывается ровно один NFT-кот. Билеты — это очки, набранные именно в этом раунде. Шанс считается просто: твои очки, делённые на сумму очков всех игроков раунда. Набрал 20% от общей массы — вероятность выиграть 20%.",
                    "At the end of a round exactly one NFT cat is drawn. Tickets are the points you earned in that round. The odds are simple: your points divided by all players' points. Score 20% of the total and your chance is 20%.")}</p>
              <p>{T("После розыгрыша счётчик раунда обнуляется у всех. Это важно: новичок не соревнуется с чужим накопленным за месяц прогрессом, каждые полчаса все стартуют заново.",
                    "After the draw everyone's round counter resets. That matters: a newcomer does not compete against someone's month-long stockpile — every half hour everybody starts over.")}</p>
              <p>{T("Таймер обратного отсчёта, твой текущий шанс, таблица игроков раунда и список победителей прошлых раундов — всё в правой колонке кликера. Раунд закрывается сам, даже если вкладка закрыта.",
                    "The countdown, your current odds, the round player table and the list of past winners all live in the right column of the clicker. Rounds close by themselves even if the tab is closed.")}</p>
            </div>
            <div className="guide-facts">
              <div><b>{CL.ROUND_MIN} {T("минут", "min")}</b><span>{T("длительность раунда", "round length")}</span></div>
              <div><b>1</b><span>{T("кот за раунд", "cat per round")}</span></div>
              <div><b>{CL.ROUNDS_PER_DAY}</b><span>{T("котов в сутки", "cats per day")}</span></div>
              <div><b>0 ₽</b><span>{T("стоимость участия", "cost to enter")}</span></div>
            </div>
          </div>
        </section>

        {/* ——— кейсы */}
        <section id="g-boxes">
          <h2 className="rev-h2">{T("Кейсы: 10 000 и больше никогда", "Cases: 10,000 and never again")}</h2>
          <p>{T("Кейс — второй способ получить кота, платный. Внутри случайный кот одной из пяти редкостей. Кейсов ровно 10 000 на всю жизнь игры: когда закончатся, новых не выпустят, и коты останутся только на вторичном рынке.",
                "A case is the second way to get a cat, the paid one. Inside is a random cat of one of five rarities. There are exactly 10,000 cases for the lifetime of the game: once they run out, no more will be minted and cats will only exist on the secondary market.")}</p>
          <div className="guide-odds">
            {rarities.map((r, i) => (
              <div key={r.key} style={{ borderColor: r.color + "66" }}>
                <b style={{ color: r.color }}>{T(r.ru, r.key)}</b>
                <span>{r.chance}%</span>
                <i>{T("вес выплат", "payout weight")} ×{r.mult}</i>
              </div>
            ))}
          </div>
          <p>{T("Случайность в контракте построена на commit-reveal: при покупке фиксируется номер будущего блока, а результат считается из его хеша. Ни игрок, ни валидатор, ни владелец платформы не могут подкрутить исход задним числом. Если окно в 200 блоков пропущено, бокс можно перекоммитить — он не сгорает.",
                "Randomness in the contract uses commit-reveal: buying pins a future block number and the result is derived from its hash. Neither the player, nor a validator, nor the platform owner can bend the outcome after the fact. If the 200-block window is missed, the box can be re-committed — it is never lost.")}</p>
        </section>

        {/* ——— редкость */}
        <section id="g-rarity">
          <h2 className="rev-h2">{T("Редкость и награды", "Rarity and dividends")}</h2>
          <p>{T("Казна периодически покупает токенизированные акции и раздаёт их котам. Делёж идёт по весу редкости: сумма делится на общий вес всех котов, и каждый получает свою долю.",
                "The treasury periodically buys tokenized stocks and distributes them to cats. The split follows rarity weight: the amount is divided by the total weight of all cats and each one takes its share.")}</p>
          <div className="guide-example">
            <b>{T("Пример", "Example")}</b>
            <p>{T("Пусть в игре 100 котов: 60 Обычных (вес 1), 24 Редких (2), 10 Эпических (3), 5 Мифических (5), 1 Легендарный (8). Общий вес = 60 + 48 + 30 + 25 + 8 = 171. Казна раздаёт $1710 — доля одного веса $10. Обычный кот получит $10, Легендарный — $80, то есть в восемь раз больше.",
                  "Say there are 100 cats: 60 Common (weight 1), 24 Rare (2), 10 Epic (3), 5 Mythic (5), 1 Legendary (8). Total weight = 60 + 48 + 30 + 25 + 8 = 171. The treasury hands out $1710 — one weight unit is worth $10. A Common cat gets $10, a Legendary one $80, eight times more.")}</p>
          </div>
          <p>{T("Начисленное лежит на коте, пока ты не заберёшь его во вкладке «Мои коты». Забирать можно когда угодно — накопленное не сгорает и переезжает вместе с котом при продаже.",
                "Accrued value sits on the cat until you claim it in the My cats tab. Claim whenever you like — it never expires and it moves with the cat when sold.")}</p>
        </section>

        {/* ——— биржа */}
        <section id="g-market">
          <h2 className="rev-h2">{T("Биржа котов", "The cat marketplace")}</h2>
          <div className="guide-steps">
            {[
              ["1", T("Выставить", "List"), T("В блоке «Мои коты» жми «Выставить» и назначь цену. Кот уезжает в эскроу контракта — продавец не может его подменить или увести из-под сделки.", "In the My cats block press List and set a price. The cat goes into contract escrow — the seller cannot swap it or pull it out from under a deal.")],
              ["2", T("Продажа", "Sale"), T("Покупатель платит цену лота одной транзакцией. 98% уходит продавцу, 2% — в казну платформы. Кот и все накопленные на нём награды переходят покупателю.", "The buyer pays the listing price in one transaction. 98% goes to the seller, 2% to the platform treasury. The cat and all dividends accrued on it go to the buyer.")],
              ["3", T("Снять", "Cancel"), T("Пока лот не купили, его можно снять в любой момент — кот вернётся в коллекцию.", "As long as nobody bought it, a listing can be cancelled at any time — the cat returns to your collection.")],
            ].map(([n, h, p]) => (
              <div className="guide-step" key={n}>
                <span className="guide-num">{n}</span><b>{h}</b><span>{p}</span>
              </div>
            ))}
          </div>
          <p>{T("График цены и объём на бирже строятся из реальных сделок по каждой редкости, а стакан — из активных лотов. Пока сделок не было, там честно написано, что данных нет: выдуманные цифры мы не рисуем.",
                "The price chart and volume are built from real trades per rarity, and the order book from active listings. Until trades happen it plainly says there is no data: we do not draw made-up numbers.")}</p>
        </section>

        {/* ——— стратегия */}
        <section id="g-strategy">
          <h2 className="rev-h2">{T("Стратегия новичка", "Beginner strategy")}</h2>
          <ol className="guide-ol">
            <li>{T("Первым делом возьми несколько уровней «Когтей» — это самое дешёвое, что усиливает каждый тап.", "Start with a few levels of Claws — the cheapest thing that boosts every tap.")}</li>
            <li>{T("Как только появится «Терминал», вложись в него: автодобыча работает, пока ты читаешь эту инструкцию.", "As soon as Terminal is available, invest in it: idle income works while you read this guide.")}</li>
            <li>{T("На 4 уровне бери «Чувство ритма» — оно даёт удерживать комбо без идеального темпа тапов.", "At level 4 take Sense of rhythm — it lets you hold a combo without perfect tapping tempo.")}</li>
            <li>{T("На 7 уровне обязательно «Ночная смена»: очки капают, пока ты спишь, и утром ты входишь в раунд не с нуля.", "At level 7 take Night shift for sure: points accrue while you sleep, so you enter the round with a head start.")}</li>
            <li>{T("Не распыляйся на «Плечо» и «Кошачий раж» слишком рано — они дороже и окупаются, когда база уже сильная.", "Do not rush Leverage and Frenzy — they are expensive and only pay off once your base is strong.")}</li>
            <li>{T("Заходи под конец раунда: таймер видно всегда, и последние минуты — самые дешёвые для рывка, пока остальные уже отыграли.", "Come back near the end of a round: the timer is always visible, and the last minutes are the cheapest moment for a push while others have finished.")}</li>
          </ol>
        </section>

        {/* ——— FAQ */}
        <section id="g-faq">
          <h2 className="rev-h2">{T("Частые вопросы", "FAQ")}</h2>
          <div className="guide-faq">
            {faq.map(([q, a], i) => (
              <div className={`guide-q ${open === i ? "on" : ""}`} key={i}>
                <button onClick={() => setOpen(open === i ? null : i)}>
                  <span>{q}</span><i>{open === i ? "−" : "+"}</i>
                </button>
                {open === i && <p>{a}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* ——— статус */}
        <section id="g-status">
          <h2 className="rev-h2">{T("Статус и риски", "Status and risks")}</h2>
          <div className="guide-warn">
            <p>{T("Контракты котов написаны и покрыты тестами, но в мейннете их пока нет. Всё, что ты видишь сейчас, — рабочая демонстрация механики: прогресс кликера и тестовые сделки живут в твоём браузере.",
                  "The cat contracts are written and covered by tests, but they are not on mainnet yet. Everything you see now is a working demonstration of the mechanics: clicker progress and test trades live in your browser.")}</p>
            <p>{T("Выплаты держателям NFT во многих юрисдикциях могут считаться доходом от ценной бумаги. Раздел запустится только после юридической проверки, и никакой доходности мы не обещаем: нет комиссий на платформе — нет и выплат.",
                  "Payouts to NFT holders may qualify as securities income in many jurisdictions. This section will launch only after a legal review, and we promise no yield whatsoever: no platform fees, no payouts.")}</p>
            <p>{T("Игровые очки не являются валютой, не продаются, не покупаются и не подлежат обмену. Они существуют только чтобы распределять бесплатные NFT между активными игроками.",
                  "Game points are not a currency, cannot be bought, sold or exchanged. They exist only to distribute free NFTs among active players.")}</p>
          </div>
          <div className="rev-cta" style={{ justifyContent: "flex-start", marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => onTab("clicker")}>{T("Играть в кликер", "Play the clicker")}</button>
            <button className="btn" onClick={() => onTab("boxes")}>{T("Открыть кейс", "Open a case")}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
