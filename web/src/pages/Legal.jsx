import React from "react";
import { useLang } from "../lib/i18n.jsx";

function Doc({ title, updated, sections }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", paddingBottom: 70 }}>
      <div className="page-title">{title}</div>
      <div className="page-sub">{updated}</div>
      {sections.map(([h, body], i) => (
        <div key={i} style={{ marginTop: 26 }}>
          <h3 style={{ fontSize: 17, margin: "0 0 8px" }}>{h}</h3>
          <p className="dim" style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{body}</p>
        </div>
      ))}
    </div>
  );
}

export function Privacy() {
  const { lang } = useLang();
  if (lang === "en") {
    return (
      <Doc
        title="Privacy Policy"
        updated="Effective date: July 18, 2026 · applies to the hood web interface"
        sections={[
          ["1. About this Policy",
           "This Policy describes how the operator of the hood platform (\"hood\", \"we\") handles information in connection with the hood web interface and related community features. hood is a non-custodial interface to smart contracts on Robinhood Chain: we never hold your assets or keys, and the site works without accounts or registration. By using the interface you acknowledge this Policy."],
          ["2. Information We Collect",
           "We do not ask for and do not collect names, postal addresses, phone numbers, emails or identity documents. The information that may be processed is limited to: public wallet addresses you interact with; content you voluntarily submit (token names, descriptions, images, chat messages); on-chain records of your transactions; and standard technical data (such as IP address and browser type) that any web request unavoidably exposes to infrastructure providers."],
          ["3. Sources of Information",
           "Information comes from three sources only: directly from you (content you type or upload); automatically from your browser when it requests pages and APIs; and from public blockchains, where your transactions are recorded by the network itself and are readable by anyone."],
          ["4. How We Use Information",
           "Information is used solely to operate the interface: displaying tokens and trades, verifying wallet interactions, showing chat and voting, maintaining security and stability of the service, moderating obviously unlawful content, and complying with legal obligations. We do not build behavioral profiles and do not use your data for advertising."],
          ["5. Legal Bases",
           "Where data-protection law requires a legal basis, we rely on: performance of the service you request (showing the interface and your on-chain data), our legitimate interest in keeping the platform secure and functional, your consent where you voluntarily submit content, and compliance with legal obligations."],
          ["6. Blockchain Information",
           "Robinhood Chain is a public network. Every transaction — launching a token, trading, voting, claiming fees — is permanently recorded on-chain together with your wallet address and is visible to anyone through any explorer. hood does not control the network and cannot edit, hide or delete on-chain records. Consider this carefully before transacting: blockchain publicity is irreversible by design."],
          ["7. How We Disclose Information",
           "We do not sell personal information and do not share it for advertising. Information may be disclosed only to infrastructure providers that make the service work (hosting, RPC nodes, database, explorer APIs), where required by applicable law or a valid legal request, or to protect the rights, security and integrity of the platform and its users."],
          ["8. Third-Party Services",
           "The interface interacts with independent services: your wallet software, Robinhood Chain RPC nodes, the Blockscout explorer API, a public exchange-rate API (ETH/USD), GitHub Pages hosting, and Google Firebase for chat storage. Each operates under its own privacy policy and sees your IP address as with any web request. We are not responsible for their practices — review their policies separately."],
          ["9. Cookies and Browser Storage",
           "hood does not use tracking cookies. Your browser's localStorage keeps interface preferences (language, theme), a random guest name for the chat and small performance caches (for example, token creation dates). This data never leaves your device and is deleted when you clear browser data. Blocking storage may limit some features."],
          ["10. Retention",
           "Off-chain content (chat messages) is kept as long as it is needed for the community feature to function and may be removed at the platform's discretion. Local settings live in your browser until you clear them. On-chain records are permanent and outside anyone's control — including ours."],
          ["11. Security",
           "We apply reasonable safeguards appropriate for a static, non-custodial interface, and the most important one is architectural: hood never receives your private keys, seed phrases or funds, so they cannot leak from us. Never share your seed phrase or private key with anyone — no one acting on behalf of hood will ever ask for them. No internet service can guarantee absolute security."],
          ["12. International Processing",
           "The interface is served globally and infrastructure providers may process technical data in different jurisdictions with different data-protection laws (for example, the chat database is hosted in the EU). Where required, appropriate safeguards apply. Public blockchain data is replicated worldwide by the nature of the network."],
          ["13. Your Rights and Choices",
           "Depending on your jurisdiction, you may have rights to access, correct or delete personal information, object to or restrict processing, and withdraw consent. For off-chain data (such as chat messages) contact us and we will respond within a reasonable time. Note: on-chain data cannot be altered or erased by anyone — this technical limitation applies to all blockchain platforms."],
          ["14. Jurisdiction-Specific Disclosures",
           "We do not sell or \"share\" personal information as defined by applicable privacy laws, do not use it for cross-context behavioral advertising and do not process it for automated decision-making with legal effects. Residents of jurisdictions with specific privacy statutes may exercise their statutory rights through the contact below without discrimination."],
          ["15. Children",
           "The interface is not directed at children and is not intended for persons under 18 years of age (or the age of majority in your jurisdiction). We do not knowingly collect information from minors. If you believe a minor has used the interface, contact us."],
          ["16. Policy Changes",
           "We may update this Policy as the product evolves. The current version with its effective date is always available on this page; material changes may additionally be announced in the interface. Continued use after changes take effect constitutes acceptance."],
          ["17. Contact",
           "Questions, privacy requests and complaints regarding this Policy can be sent to the platform operator: volodyacryptodeg@gmail.com. We will make reasonable efforts to respond promptly."],
        ]}
      />
    );
  }
  return (
    <Doc
      title="Политика конфиденциальности"
      updated="Действует с: 18 июля 2026 · относится к веб-интерфейсу hood"
      sections={[
        ["1. Об этой политике",
         "Эта Политика описывает, как оператор платформы hood («hood», «мы») обращается с информацией при работе веб-интерфейса hood и комьюнити-функций. hood — некастодиальный интерфейс к смарт-контрактам в сети Robinhood Chain: мы никогда не храним ваши активы и ключи, а сайт работает без аккаунтов и регистрации. Используя интерфейс, вы принимаете эту Политику."],
        ["2. Какую информацию мы собираем",
         "Мы не запрашиваем и не собираем имена, адреса, телефоны, почту и документы. Обрабатываемая информация ограничена: публичными адресами кошельков, с которыми вы работаете; контентом, который вы добровольно публикуете (названия и описания токенов, картинки, сообщения чата); ончейн-записями ваших транзакций; и стандартными техническими данными (IP-адрес, тип браузера), которые любой веб-запрос неизбежно открывает инфраструктурным провайдерам."],
        ["3. Источники информации",
         "Информация поступает только из трёх источников: напрямую от вас (то, что вы вводите или загружаете); автоматически от вашего браузера при запросах к страницам и API; и из публичных блокчейнов, где ваши транзакции записывает сама сеть — читать их может кто угодно."],
        ["4. Как мы используем информацию",
         "Информация используется исключительно для работы интерфейса: отображение токенов и сделок, проверка взаимодействий кошелька, показ чата и голосования, поддержание безопасности и стабильности сервиса, модерация явно противоправного контента и соблюдение требований закона. Мы не строим поведенческие профили и не используем данные для рекламы."],
        ["5. Правовые основания",
         "Там, где закон о защите данных требует правового основания, мы опираемся на: исполнение запрошенного вами сервиса (отображение интерфейса и ваших ончейн-данных), законный интерес в безопасности и работоспособности платформы, ваше согласие при добровольной публикации контента и соблюдение юридических обязательств."],
        ["6. Данные в блокчейне",
         "Robinhood Chain — публичная сеть. Каждая транзакция — запуск токена, сделка, голос, клейм комиссий — навсегда записывается в блокчейн вместе с адресом вашего кошелька и видна любому через эксплорер. hood не управляет сетью и не может изменить, скрыть или удалить ончейн-записи. Учитывайте это до отправки транзакции: публичность блокчейна необратима по построению."],
        ["7. Как мы раскрываем информацию",
         "Мы не продаём персональную информацию и не передаём её для рекламы. Раскрытие возможно только инфраструктурным провайдерам, обеспечивающим работу сервиса (хостинг, RPC-узлы, база данных, API эксплорера), по требованию применимого закона или законного запроса органов, а также для защиты прав, безопасности и целостности платформы и её пользователей."],
        ["8. Сторонние сервисы",
         "Интерфейс взаимодействует с независимыми сервисами: вашим кошельком, RPC-узлами Robinhood Chain, API эксплорера Blockscout, публичным API курса ETH/USD, хостингом GitHub Pages и Google Firebase для хранения чата. Каждый работает по собственной политике конфиденциальности и видит ваш IP-адрес, как при любом веб-запросе. Мы не отвечаем за их практики — ознакомьтесь с их политиками отдельно."],
        ["9. Cookies и хранилище браузера",
         "hood не использует трекинговые cookies. В localStorage вашего браузера хранятся настройки интерфейса (язык, тема), случайное гостевое имя для чата и небольшие кэши производительности (например, даты создания токенов). Эти данные не покидают ваше устройство и удаляются при очистке данных браузера. Блокировка хранилища может ограничить часть функций."],
        ["10. Сроки хранения",
         "Офчейн-контент (сообщения чата) хранится, пока это нужно для работы комьюнити-функции, и может удаляться по усмотрению платформы. Локальные настройки живут в вашем браузере, пока вы их не очистите. Ончейн-записи постоянны и не подконтрольны никому — включая нас."],
        ["11. Безопасность",
         "Мы применяем разумные меры защиты, соответствующие статическому некастодиальному интерфейсу, и главная из них — архитектурная: hood никогда не получает ваши приватные ключи, сид-фразы и средства, поэтому они не могут утечь от нас. Никогда и никому не сообщайте сид-фразу или приватный ключ — никто от имени hood их не попросит. Ни один интернет-сервис не может гарантировать абсолютную безопасность."],
        ["12. Международная обработка",
         "Интерфейс доступен глобально, и инфраструктурные провайдеры могут обрабатывать технические данные в разных юрисдикциях с разными законами о защите данных (например, база чата размещена в ЕС). Где это требуется, применяются соответствующие гарантии. Данные публичного блокчейна реплицируются по всему миру по самой природе сети."],
        ["13. Ваши права и выбор",
         "В зависимости от юрисдикции у вас могут быть права на доступ к персональной информации, её исправление и удаление, возражение против обработки и её ограничение, а также отзыв согласия. По офчейн-данным (например, сообщениям чата) свяжитесь с нами — мы ответим в разумный срок. Важно: ончейн-данные не может изменить или стереть никто — это техническое ограничение относится ко всем блокчейн-платформам."],
        ["14. Раскрытия для отдельных юрисдикций",
         "Мы не продаём и не «передаём» персональную информацию в значении применимых законов о приватности, не используем её для кросс-контекстной поведенческой рекламы и не принимаем на её основе автоматизированных решений с юридическими последствиями. Жители юрисдикций со специальными законами о приватности могут реализовать свои права через контакт ниже без какой-либо дискриминации."],
        ["15. Дети",
         "Интерфейс не адресован детям и не предназначен для лиц младше 18 лет (или возраста совершеннолетия в вашей юрисдикции). Мы сознательно не собираем информацию о несовершеннолетних. Если вы считаете, что интерфейсом воспользовался несовершеннолетний, свяжитесь с нами."],
        ["16. Изменения политики",
         "Мы можем обновлять эту Политику по мере развития продукта. Актуальная версия с датой вступления в силу всегда доступна на этой странице; о существенных изменениях мы можем дополнительно сообщить в интерфейсе. Продолжение использования после вступления изменений в силу означает согласие с ними."],
        ["17. Контакты",
         "Вопросы, запросы по приватности и жалобы по этой Политике направляйте оператору платформы: volodyacryptodeg@gmail.com. Мы приложим разумные усилия, чтобы ответить оперативно."],
      ]}
    />
  );
}

export function Terms() {
  const { lang } = useLang();
  if (lang === "en") {
    return (
      <Doc
        title="Terms of Use"
        updated="Last updated: July 2026 · hood on Robinhood Chain Testnet"
        sections={[
          ["Acceptance",
           "By using the hood interface you agree to these terms. If you do not agree, do not use the interface."],
          ["Test network",
           "The platform currently runs on Robinhood Chain Testnet. Test tokens and test ETH have no monetary value. Contracts have not been audited; the service is provided «as is», interruptions and errors are possible."],
          ["Non-custodial service",
           "hood never holds your assets or keys. Every transaction is composed in your browser and signed by your wallet. Blockchain transactions are irreversible: verify addresses and amounts before confirming. You are solely responsible for the security of your wallet."],
          ["Not financial advice",
           "Nothing in the interface is investment, legal or tax advice. Tokens launched on the platform are highly volatile and can lose all value. Do your own research and never risk funds you cannot afford to lose."],
          ["Protocol fees",
           "Trading fees and their distribution between the token creator, the team and the buyback treasury are set in smart contracts and displayed in the interface. Rules of a specific token's pool are fixed at its launch and do not change retroactively."],
          ["Community features",
           "Chat and voting are public. You are responsible for the content you post. Illegal content, fraud, impersonation and spam are prohibited; such content may be removed and access restricted."],
          ["Prohibited use",
           "The interface may not be used to violate applicable laws, launder funds or finance illegal activity."],
          ["Limitation of liability",
           "To the maximum extent permitted by law, hood and its contributors are not liable for any losses arising from use of the interface, contracts, network or third-party services."],
          ["Changes",
           "We may update these terms; the current version is always available on this page. Continued use after changes means acceptance."],
        ]}
      />
    );
  }
  return (
    <Doc
      title="Условия использования"
      updated="Обновлено: июль 2026 · hood в тестовой сети Robinhood Chain"
      sections={[
        ["Принятие условий",
         "Используя интерфейс hood, вы соглашаетесь с этими условиями. Если вы не согласны — не используйте интерфейс."],
        ["Тестовая сеть",
         "Платформа сейчас работает в тестовой сети Robinhood Chain. Тестовые токены и тестовый ETH не имеют денежной ценности. Контракты не проходили аудит; сервис предоставляется «как есть», возможны сбои и ошибки."],
        ["Некастодиальный сервис",
         "hood никогда не хранит ваши активы и ключи. Каждая транзакция формируется в вашем браузере и подписывается вашим кошельком. Транзакции в блокчейне необратимы: проверяйте адреса и суммы перед подтверждением. Вы самостоятельно отвечаете за сохранность кошелька."],
        ["Не финансовый совет",
         "Ничто в интерфейсе не является инвестиционным, юридическим или налоговым советом. Токены, запускаемые на платформе, крайне волатильны и могут полностью обесцениться. Принимайте решения самостоятельно и не рискуйте средствами, потерю которых не можете себе позволить."],
        ["Комиссии протокола",
         "Торговые комиссии и их распределение между создателем токена, командой и казной выкупа заданы в смарт-контрактах и отображаются в интерфейсе. Правила пула конкретного токена фиксируются в момент его запуска и не меняются задним числом."],
        ["Комьюнити-функции",
         "Чат и голосование публичны. Вы отвечаете за публикуемый вами контент. Запрещены незаконный контент, мошенничество, выдача себя за других и спам; такой контент может удаляться, а доступ — ограничиваться."],
        ["Недопустимое использование",
         "Интерфейс нельзя использовать для нарушения законов, отмывания средств или финансирования незаконной деятельности."],
        ["Ограничение ответственности",
         "В максимальной степени, допустимой законом, hood и участники разработки не несут ответственности за убытки, возникшие из-за использования интерфейса, контрактов, сети или сторонних сервисов."],
        ["Изменения",
         "Мы можем обновлять эти условия; актуальная версия всегда доступна на этой странице. Продолжение использования после изменений означает согласие."],
      ]}
    />
  );
}
