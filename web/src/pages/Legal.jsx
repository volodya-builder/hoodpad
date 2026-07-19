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
        updated="Effective date: July 19, 2026 · applies to the hood web interface"
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
           "Questions, privacy requests and complaints regarding this Policy can be sent to the platform operator: contact@hoodandarrow.com. We will make reasonable efforts to respond promptly."],
        ]}
      />
    );
  }
  return (
    <Doc
      title="Политика конфиденциальности"
      updated="Действует с: 19 июля 2026 · относится к веб-интерфейсу hood"
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
         "Вопросы, запросы по приватности и жалобы по этой Политике направляйте оператору платформы: contact@hoodandarrow.com. Мы приложим разумные усилия, чтобы ответить оперативно."],
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
        updated="Effective date: July 19, 2026 · hood on Robinhood Chain mainnet"
        sections={[
          ["1. Agreement",
           "These Terms are a binding agreement between you and the operator of the hood platform (\"hood\", \"we\") governing your use of the hood web interface and related community features. By accessing or using the interface you accept these Terms and the Privacy Policy. If you do not agree, do not use the interface. These Terms contain a binding individual-arbitration provision and a class-action waiver (section 30) and important limitations of our liability (section 25) — please read them carefully."],
          ["2. About hood",
           "hood is a software interface that lets you interact with autonomous smart contracts on Robinhood Chain: launch tokens with fixed supply, trade on bonding curves, vote and view analytics. hood is not a broker, dealer, exchange, custodian, money transmitter, financial institution or investment adviser, and provides no such services. The platform operates on Robinhood Chain mainnet, where tokens are traded using ETH that has real monetary value; transactions are real and irreversible. The smart contracts have NOT undergone a formal independent third-party security audit. Software may contain bugs, and you use the platform at your own risk with funds you can afford to lose entirely."],
          ["3. Eligibility",
           "You may use the interface only if you are at least 18 years old (or the age of majority in your jurisdiction), have full legal capacity, and access it from, and are a resident of, a jurisdiction where such use is lawful. You represent that you are not subject to sanctions administered or enforced by any relevant authority (including OFAC, UN, EU or UK designations) and are not on any prohibited-parties list. You are responsible for ensuring that using the interface is legal for you."],
          ["4. Prohibited Jurisdictions",
           "The interface is not offered to, and may not be used by, any person who is a citizen, resident of, or located in the United States of America or any U.S. territory, or in any country or region subject to comprehensive sanctions (including, without limitation, Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk and Luhansk regions), or any other jurisdiction where accessing the interface or trading these tokens is prohibited or would require registration or licensing we do not hold (\"Prohibited Jurisdictions\"). You must not use a VPN, proxy or any other means to disguise your location in order to access the interface from a Prohibited Jurisdiction. We may block access from any jurisdiction at our discretion."],
          ["5. No Investment Advice; Not an Offering",
           "Nothing on the platform is investment, financial, legal, tax or accounting advice, a recommendation, solicitation, or an offer to buy or sell any asset, and nothing constitutes a prospectus, offering document or registered offering of securities. Tokens launched through hood are created by users, not by hood, and are not endorsed, vetted, guaranteed or backed by hood. Rankings, analytics, \"trending\" placement and any interface prominence are informational only and are not endorsements. You alone are responsible for evaluating the merits and risks of any transaction and should consult your own qualified advisers."],
          ["6. Speculative Assets — No Intrinsic Value",
           "Tokens launched and traded through hood are highly speculative digital collectibles with no intrinsic value, no expectation of profit derived from the efforts of others, and no rights to any dividends, revenue, ownership, equity or claim against hood or any person. Most such tokens lose all or nearly all of their value, often rapidly. Their price can go to zero at any time. Do not purchase any token unless you are financially able and willing to lose the entire amount. You accept full responsibility for your trading decisions and outcomes."],
          ["7. Non-Custodial Interface",
           "hood never holds, controls or has access to your assets, private keys or wallets. All operations are executed by smart contracts on the blockchain and initiated by you through your own wallet. We cannot execute, reverse, block or expedite transactions on your behalf. You are not our customer and no fiduciary, agency, advisory or trust relationship arises between you and hood."],
          ["8. Wallets and Security",
           "You are solely responsible for the security of your wallet, private keys and seed phrase. hood never asks for them — anyone who does is a scammer. Any action signed by your wallet is deemed your action; we are not liable for losses caused by compromised wallet access, phishing, malware or your own error."],
          ["9. Transactions",
           "Review every transaction — addresses, amounts, network — before signing. Prices and quotes in the interface are estimates: the final result is determined by the smart contract at execution time and may differ (including due to other users' transactions, slippage or front-running). Blockchain transactions are irreversible once confirmed and cannot be cancelled or refunded by anyone, including hood."],
          ["10. Token Launches and Content",
           "When you launch a token you are solely responsible for its name, ticker, description, image and links, and you confirm that you hold the necessary rights to them and that they do not infringe any third party's rights, impersonate any person or brand, or violate any law. Token metadata is written to the public blockchain permanently and cannot be edited or deleted by anyone, including hood. We may moderate off-chain content (such as chat) and hide interface listings that violate these Terms, but we cannot alter on-chain records."],
          ["11. Bonding Curve Trading and Graduation",
           "Tokens trade on an automated bonding curve until they reach the graduation threshold, after which liquidity migrates to a decentralized exchange and is locked. Tokens may have little or no liquidity, may be extremely volatile and may become worthless. hood does not guarantee graduation, liquidity, market depth, tradability or any price level of any token."],
          ["12. Risk Disclosures",
           "By using the interface you accept the risks of blockchain technology, including: total loss of assets; defects or vulnerabilities in smart contracts (which have not undergone a formal independent audit); failures, congestion, forks or reorganizations of networks, wallets and infrastructure; inaccurate or delayed market data; scams, rug-pulls and abusive conduct by other users or token creators; regulatory uncertainty and future legal changes; and tax consequences of your operations. Use the interface only if you understand and accept these risks."],
          ["13. Fees, Taxes and No Refunds",
           "Trades on the curve pay a protocol fee, which the smart contract automatically splits between the token creator, the team and the buyback treasury; the current split is displayed in the interface and in analytics. We may change interface-level fee parameters going forward where the contracts permit; the split in force at the time of your transaction applies to it. You also pay network gas fees. All fees are final and non-refundable. You are solely responsible for determining, reporting and paying any taxes arising from your operations."],
          ["14. Acceptable Use",
           "You must not use the interface to: violate any applicable law; commit fraud or mislead users; infringe intellectual property or impersonate others; interfere with, attack, overload or reverse-engineer the interface or contracts; manipulate markets (including wash trading, spoofing and coordinated pumping or \"rug pulls\"); launder money or finance illegal or terrorist activity; or launch or trade tokens that constitute securities, derivatives or other regulated instruments in relevant jurisdictions. You must not use bots or automated means to abuse the interface."],
          ["15. Compliance and Anti-Money-Laundering",
           "hood does not facilitate money laundering, sanctions evasion or terrorist financing and does not knowingly deal with sanctioned persons. You represent that the funds you use are lawfully obtained and that your use complies with all anti-money-laundering, counter-terrorist-financing and sanctions laws that apply to you. We may use screening tools and may restrict or decline to serve wallet addresses associated with sanctioned parties, illicit activity or elevated risk, and may report activity to authorities where required by law."],
          ["16. Platform Interests and Conflicts",
           "The team receives a share of protocol fees set in the smart contracts. The buyback treasury is spent on buying back platform tokens at the platform's sole discretion; community voting is advisory and does not create any obligation to buy back any particular token. hood and its team members may hold, buy or sell tokens launched on the platform and may feature certain tokens in the interface. hood owes you no fiduciary duty. You waive any claim arising from these disclosed conflicts of interest."],
          ["17. Activity Limits",
           "We may introduce limits on transaction size or frequency, or restrict certain interface features, for security, risk-management or legal-compliance reasons. On-chain limits (such as the creator's maximum initial buy) are enforced by the contracts themselves."],
          ["18. Third-Party Services",
           "The interface relies on independent services: wallets, RPC nodes, the block explorer, price APIs, hosting and the chat database. Their availability, accuracy and terms are outside our control; integration does not mean endorsement. Your use of third-party services is governed by their own terms, and we are not responsible for their acts or omissions."],
          ["19. Intellectual Property and Complaints",
           "The interface, its design, texts and code are protected by law. You are granted a limited, non-exclusive, non-transferable, revocable licence to access and use the interface for lawful purposes only; all other rights are reserved. If you believe content displayed through the interface infringes your intellectual-property rights or impersonates you, send a notice to the contact in section 31 identifying the content, your rights and your contact details, and we will review and, where appropriate, remove the off-chain listing (on-chain data cannot be altered). We may remove content and disable access for repeat infringers."],
          ["20. Submitted Content",
           "You retain your rights to content you submit (token metadata, chat messages). By submitting it you grant hood a worldwide, royalty-free, sublicensable licence to host, reproduce and display that content for the operation and promotion of the platform. You are solely responsible for your content. Content written to the blockchain is public and permanent by nature."],
          ["21. Feedback",
           "If you send us ideas, suggestions or bug reports, we may use them without restriction or compensation to improve the platform."],
          ["22. Service Availability",
           "We may change, suspend or discontinue any part of the interface at any time without notice or liability. We do not guarantee continuous, uninterrupted or error-free operation. Smart contracts remain on the blockchain regardless of the interface's availability."],
          ["23. No Warranties",
           "The interface is provided \"as is\" and \"as available\", with all faults. To the maximum extent permitted by law we disclaim all warranties, express, implied or statutory, including merchantability, fitness for a particular purpose, title, non-infringement, accuracy of data and uninterrupted or secure operation. We do not warrant that any token has value, liquidity or a market."],
          ["24. Assumption of Risk",
           "You knowingly and voluntarily assume all risks arising from your use of the interface, the smart contracts, the blockchain network and any token, and you agree that hood is not responsible for any loss you suffer as a result. This assumption of risk survives termination of these Terms."],
          ["25. Limitation of Liability",
           "To the maximum extent permitted by law, hood and its contributors are not liable for indirect, incidental, special, punitive or consequential damages, or loss of profits, data, goodwill or assets, arising from or related to use of the interface, contracts, network, tokens or third-party services, even if advised of the possibility. Our aggregate liability for all claims is limited to the greater of the protocol fees you paid to the team over the preceding 12 months or 100 USD. Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you."],
          ["26. Indemnification",
           "You agree to indemnify and hold harmless hood and its contributors against claims, losses, liabilities and expenses (including reasonable legal fees) arising from your use of the interface, your content, your tokens, your violation of these Terms or of applicable law, or your infringement of any third-party right. Disputes between users, or between you and a token creator, are resolved between those parties; you release hood from claims related to such disputes."],
          ["27. Force Majeure",
           "hood is not liable for any failure or delay caused by events beyond our reasonable control, including acts of God, natural disasters, war, terrorism, civil unrest, labour disputes, changes in law, governmental or regulatory action, network or blockchain failures, forks, congestion, exploits, outages of internet, hosting, RPC or third-party services, and power failures."],
          ["28. Termination and Restriction of Access",
           "We may restrict or terminate your access to the interface at any time without notice in case of fraud, market manipulation, sanctions or legal risk, violation of these Terms or a security threat. Restricting interface access does not affect your on-chain assets, which remain under the control of your wallet. Sections that by their nature should survive (including risk disclosures, disclaimers, limitations of liability, indemnification and dispute resolution) survive termination."],
          ["29. Governing Law",
           "These Terms and any dispute arising from them or from your use of the interface are governed by the law applicable at the operator's location, without regard to conflict-of-law rules, unless mandatory consumer-protection rules of your jurisdiction provide otherwise."],
          ["30. Dispute Resolution; Arbitration and Class-Action Waiver",
           "Before bringing any formal claim you agree to first attempt good-faith resolution by contacting us (section 31) and allowing 60 days. Any dispute not resolved that way shall, to the maximum extent permitted by law, be settled by final and binding individual arbitration rather than in court, except that either party may seek relief in a small-claims court or seek injunctive relief for intellectual-property or unauthorized-access matters. YOU AND HOOD AGREE THAT CLAIMS MAY BE BROUGHT ONLY IN AN INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY CLASS, COLLECTIVE OR REPRESENTATIVE PROCEEDING, AND THAT NO ARBITRATION OR CLAIM SHALL BE CONSOLIDATED WITH ANY OTHER. Any claim must be brought within one year after it arises, or it is permanently barred, to the extent allowed by law."],
          ["31. General Terms",
           "If any provision of these Terms is held unenforceable, it shall be limited or severed to the minimum extent necessary and the remainder stays in full effect. Our failure to enforce any right is not a waiver. You may not assign your rights under these Terms without our consent; we may assign ours in connection with operating or transferring the platform. Headings are for convenience only. These Terms and the Privacy Policy are the entire agreement between you and hood regarding the interface."],
          ["32. Changes to these Terms",
           "We may update these Terms as the product evolves. The current version with its effective date is always available on this page; material changes may additionally be announced in the interface. Continued use after the effective date constitutes acceptance."],
          ["33. Contact",
           "Questions about these Terms, and intellectual-property or compliance notices: contact@hoodandarrow.com."],
        ]}
      />
    );
  }
  return (
    <Doc
      title="Условия использования"
      updated="Действуют с: 19 июля 2026 · hood в основной сети Robinhood Chain"
      sections={[
        ["1. Соглашение",
         "Эти Условия — обязывающее соглашение между вами и оператором платформы hood («hood», «мы»), регулирующее использование веб-интерфейса hood и комьюнити-функций. Получая доступ к интерфейсу, вы принимаете эти Условия и Политику конфиденциальности. Если вы не согласны — не используйте интерфейс. Эти Условия содержат оговорку об обязательном индивидуальном арбитраже и отказ от коллективных исков (раздел 30), а также важные ограничения нашей ответственности (раздел 25) — внимательно с ними ознакомьтесь."],
        ["2. О hood",
         "hood — программный интерфейс для взаимодействия с автономными смарт-контрактами в сети Robinhood Chain: запуск токенов с фиксированным сапплаем, торговля на бондинг-кривых, голосование и аналитика. hood не является брокером, дилером, биржей, кастодианом, оператором денежных переводов, финансовой организацией или инвестиционным советником и не оказывает таких услуг. Платформа работает в основной сети (mainnet) Robinhood Chain: токены торгуются за ETH, имеющий реальную денежную ценность; транзакции реальны и необратимы. Смарт-контракты НЕ проходили формальный независимый аудит безопасности. В программном обеспечении возможны ошибки; вы используете платформу на собственный риск и только на средства, которые готовы полностью потерять."],
        ["3. Право на использование",
         "Использовать интерфейс можно, только если вам исполнилось 18 лет (или вы достигли совершеннолетия в своей юрисдикции), вы полностью дееспособны и получаете доступ из юрисдикции — и являетесь её резидентом, — где такое использование законно. Вы заявляете, что не находитесь под санкциями каких-либо соответствующих органов (включая списки OFAC, ООН, ЕС и Великобритании) и не включены в списки запрещённых лиц. Вы сами отвечаете за законность использования интерфейса для вас."],
        ["4. Запрещённые юрисдикции",
         "Интерфейс не предлагается и не может использоваться лицами, которые являются гражданами, резидентами или находятся на территории Соединённых Штатов Америки или их территорий, либо в любой стране или регионе под всеобъемлющими санкциями (включая, среди прочего, Кубу, Иран, Северную Корею, Сирию, а также Крым, Донецкую и Луганскую области), либо в любой иной юрисдикции, где доступ к интерфейсу или торговля этими токенами запрещены или требуют регистрации/лицензии, которой у нас нет («Запрещённые юрисдикции»). Запрещено использовать VPN, прокси или иные средства сокрытия местоположения для доступа из Запрещённой юрисдикции. Мы можем блокировать доступ из любой юрисдикции по своему усмотрению."],
        ["5. Не инвестиционный совет; не предложение",
         "Ничто на платформе не является инвестиционной, финансовой, юридической, налоговой или бухгалтерской консультацией, рекомендацией, побуждением или предложением купить либо продать какой-либо актив и не является проспектом, документом о размещении или зарегистрированным предложением ценных бумаг. Токены, запускаемые через hood, создаются пользователями, а не hood, и не одобряются, не проверяются, не гарантируются и не обеспечиваются hood. Рейтинги, аналитика, раздел «в тренде» и любое выделение в интерфейсе носят исключительно информационный характер и не являются одобрением. Оценка выгод и рисков любой операции — исключительно ваша ответственность; консультируйтесь с собственными квалифицированными специалистами."],
        ["6. Спекулятивные активы — без внутренней ценности",
         "Токены, запускаемые и торгуемые через hood, — крайне спекулятивные цифровые предметы без внутренней ценности, без ожидания прибыли от усилий других лиц и без каких-либо прав на дивиденды, выручку, владение, долю или требования к hood либо любому лицу. Большинство таких токенов теряют всю или почти всю стоимость, зачастую стремительно. Их цена может обнулиться в любой момент. Не покупайте токен, если вы финансово не способны и не готовы потерять всю сумму. Вы полностью отвечаете за свои торговые решения и их последствия."],
        ["7. Некастодиальный интерфейс",
         "hood никогда не хранит и не контролирует ваши активы, приватные ключи и кошельки и не имеет к ним доступа. Все операции исполняются смарт-контрактами в блокчейне и инициируются вами через ваш собственный кошелёк. Мы не можем провести, отменить, заблокировать или ускорить транзакцию за вас. Вы не являетесь нашим клиентом, и между вами и hood не возникает фидуциарных, агентских, советнических или доверительных отношений."],
        ["8. Кошельки и безопасность",
         "Вы единолично отвечаете за сохранность кошелька, приватных ключей и сид-фразы. hood никогда их не запрашивает — любой, кто просит, мошенник. Любое действие, подписанное вашим кошельком, считается вашим действием; мы не отвечаем за убытки из-за компрометации доступа к кошельку, фишинга, вредоносного ПО или ваших собственных ошибок."],
        ["9. Транзакции",
         "Проверяйте каждую транзакцию — адреса, суммы, сеть — до подписания. Цены и котировки в интерфейсе являются оценками: итоговый результат определяет смарт-контракт в момент исполнения, и он может отличаться (в том числе из-за транзакций других пользователей, проскальзывания или фронт-раннинга). Подтверждённые транзакции в блокчейне необратимы и не могут быть отменены или возвращены никем, включая hood."],
        ["10. Запуск токенов и контент",
         "Запуская токен, вы единолично отвечаете за его название, тикер, описание, картинку и ссылки и подтверждаете, что обладаете необходимыми правами на них, что они не нарушают прав третьих лиц, не выдают себя за какое-либо лицо или бренд и не нарушают закон. Метаданные токена записываются в публичный блокчейн навсегда — их не может изменить или удалить никто, включая hood. Мы можем модерировать офчейн-контент (например, чат) и скрывать из интерфейса листинги, нарушающие эти Условия, но не можем менять ончейн-записи."],
        ["11. Торговля на кривой и градация",
         "Токены торгуются на автоматической бондинг-кривой до порога градации, после чего ликвидность мигрирует на децентрализованную биржу и запирается. Токены могут иметь низкую ликвидность или не иметь её, быть крайне волатильными и полностью обесцениться. hood не гарантирует градацию, ликвидность, глубину рынка, возможность продажи или какой-либо уровень цены любого токена."],
        ["12. Раскрытие рисков",
         "Используя интерфейс, вы принимаете риски блокчейн-технологий, включая: полную потерю активов; дефекты и уязвимости смарт-контрактов (которые не проходили формального независимого аудита); сбои, перегрузки, форки и реорганизации сетей, кошельков и инфраструктуры; неточность или задержку рыночных данных; мошенничество, «rug-pull» и злоупотребления со стороны других пользователей и создателей токенов; регуляторную неопределённость и будущие изменения закона; налоговые последствия ваших операций. Используйте интерфейс, только если понимаете и принимаете эти риски."],
        ["13. Комиссии, налоги и отсутствие возвратов",
         "Сделки на кривой платят комиссию протокола, которую смарт-контракт автоматически делит между создателем токена, командой и казной выкупа; актуальное распределение отображается в интерфейсе и аналитике. Мы можем в дальнейшем менять параметры комиссий на уровне интерфейса там, где это позволяют контракты; к вашей транзакции применяется распределение, действующее на момент её совершения. Вы также оплачиваете сетевой газ. Все комиссии окончательны и не подлежат возврату. Вы единолично отвечаете за определение, декларирование и уплату налогов, возникающих из ваших операций."],
        ["14. Допустимое использование",
         "Запрещено использовать интерфейс для: нарушения применимого закона; мошенничества и введения пользователей в заблуждение; нарушения интеллектуальных прав или выдачи себя за других; вмешательства в работу, атак, перегрузки или обратной разработки интерфейса и контрактов; манипулирования рынком (включая wash-трейдинг, спуфинг, скоординированные пампы и «rug-pull»); отмывания средств и финансирования незаконной или террористической деятельности; запуска или торговли токенами, являющимися ценными бумагами, деривативами или иными регулируемыми инструментами в соответствующих юрисдикциях. Запрещено использовать ботов и автоматические средства для злоупотребления интерфейсом."],
        ["15. Комплаенс и противодействие отмыванию",
         "hood не содействует отмыванию денег, обходу санкций или финансированию терроризма и сознательно не работает с подсанкционными лицами. Вы заявляете, что используемые вами средства получены законно и что ваше использование соответствует всем применимым к вам законам о противодействии отмыванию, финансированию терроризма и санкционному законодательству. Мы можем применять инструменты скрининга, ограничивать или отказывать в обслуживании адресам кошельков, связанным с подсанкционными лицами, незаконной деятельностью или повышенным риском, и сообщать о деятельности органам, если этого требует закон."],
        ["16. Интересы платформы и конфликты",
         "Команда получает долю комиссий протокола, заданную в смарт-контрактах. Казна выкупа тратится на выкуп токенов платформы по единоличному усмотрению платформы; голосование комьюнити носит совещательный характер и не создаёт обязанности выкупать какой-либо токен. hood и члены команды могут держать, покупать и продавать токены, запущенные на платформе, и выделять отдельные токены в интерфейсе. hood не несёт перед вами фидуциарных обязанностей. Вы отказываетесь от претензий, возникающих из этих раскрытых конфликтов интересов."],
        ["17. Лимиты активности",
         "Мы можем вводить лимиты на размер или частоту операций либо ограничивать отдельные функции интерфейса из соображений безопасности, управления рисками или соблюдения закона. Ончейн-лимиты (например, максимальная стартовая покупка создателя) обеспечиваются самими контрактами."],
        ["18. Сторонние сервисы",
         "Интерфейс опирается на независимые сервисы: кошельки, RPC-узлы, эксплорер, API цен, хостинг и базу чата. Их доступность, точность и условия вне нашего контроля; интеграция не означает одобрения. Использование сторонних сервисов регулируется их собственными условиями, и мы не отвечаем за их действия или бездействие."],
        ["19. Интеллектуальная собственность и жалобы",
         "Интерфейс, его дизайн, тексты и код защищены законом. Вам предоставляется ограниченная, неисключительная, непередаваемая, отзывная лицензия на доступ к интерфейсу и его использование только в законных целях; все прочие права сохраняются за нами. Если вы считаете, что отображаемый через интерфейс контент нарушает ваши интеллектуальные права или выдаёт себя за вас, направьте уведомление на контакт из раздела 33 с указанием контента, ваших прав и контактных данных — мы рассмотрим его и при необходимости удалим офчейн-листинг (ончейн-данные изменить нельзя). Мы можем удалять контент и отключать доступ для повторных нарушителей."],
        ["20. Пользовательский контент",
         "Права на контент, который вы публикуете (метаданные токенов, сообщения чата), остаются за вами. Публикуя его, вы предоставляете hood всемирную безвозмездную сублицензируемую лицензию на хранение, воспроизведение и показ этого контента для работы и продвижения платформы. Вы единолично отвечаете за свой контент. Контент, записанный в блокчейн, публичен и постоянен по своей природе."],
        ["21. Обратная связь",
         "Если вы присылаете нам идеи, предложения или сообщения об ошибках, мы можем использовать их для улучшения платформы без ограничений и без вознаграждения."],
        ["22. Доступность сервиса",
         "Мы можем изменять, приостанавливать или прекращать работу любой части интерфейса в любой момент без уведомления и без ответственности. Мы не гарантируем непрерывную и безошибочную работу. Смарт-контракты остаются в блокчейне независимо от доступности интерфейса."],
        ["23. Отказ от гарантий",
         "Интерфейс предоставляется «как есть» и «как доступно», со всеми недостатками. В максимальной степени, допустимой законом, мы отказываемся от любых гарантий — явных, подразумеваемых или установленных законом, — включая товарную пригодность, соответствие определённой цели, право собственности, ненарушение прав, точность данных и бесперебойную или безопасную работу. Мы не гарантируем, что какой-либо токен имеет ценность, ликвидность или рынок."],
        ["24. Принятие риска",
         "Вы осознанно и добровольно принимаете все риски, связанные с использованием интерфейса, смарт-контрактов, блокчейн-сети и любого токена, и соглашаетесь, что hood не отвечает за любые убытки, которые вы понесёте в результате. Это принятие риска сохраняет силу после прекращения действия этих Условий."],
        ["25. Ограничение ответственности",
         "В максимальной степени, допустимой законом, hood и участники разработки не отвечают за косвенные, случайные, специальные, штрафные и последующие убытки, упущенную выгоду, потерю данных, деловой репутации или активов, возникшие из использования интерфейса, контрактов, сети, токенов или сторонних сервисов или связанные с ними, даже если о возможности таких убытков было известно. Совокупная ответственность по всем требованиям ограничена большей из сумм: комиссии протокола, уплаченные вами команде за предыдущие 12 месяцев, или 100 долларов США. В некоторых юрисдикциях отдельные ограничения не допускаются, поэтому часть этого раздела может к вам не применяться."],
        ["26. Возмещение убытков",
         "Вы обязуетесь оградить и освободить от ответственности hood и участников разработки от претензий, убытков, обязательств и расходов (включая разумные юридические издержки), возникших из вашего использования интерфейса, вашего контента, ваших токенов, нарушения вами этих Условий или закона либо нарушения вами прав третьих лиц. Споры между пользователями, а также между вами и создателем токена, решаются между этими сторонами; вы освобождаете hood от претензий, связанных с такими спорами."],
        ["27. Форс-мажор",
         "hood не отвечает за неисполнение или задержку, вызванные обстоятельствами вне нашего разумного контроля, включая стихийные бедствия, войну, терроризм, гражданские беспорядки, трудовые споры, изменения закона, действия государственных или регуляторных органов, сбои сети или блокчейна, форки, перегрузки, эксплойты, перебои в работе интернета, хостинга, RPC или сторонних сервисов, а также перебои электропитания."],
        ["28. Прекращение и ограничение доступа",
         "Мы можем ограничить или прекратить ваш доступ к интерфейсу в любой момент без уведомления в случае мошенничества, манипулирования рынком, санкционного или правового риска, нарушения этих Условий или угрозы безопасности. Ограничение доступа к интерфейсу не затрагивает ваши ончейн-активы — они остаются под контролем вашего кошелька. Положения, которые по своей природе должны сохранять силу (включая раскрытие рисков, отказы от гарантий, ограничения ответственности, возмещение убытков и разрешение споров), продолжают действовать после прекращения."],
        ["29. Применимое право",
         "Эти Условия и любой спор из них или из вашего использования интерфейса регулируются правом, применимым по месту нахождения оператора, без учёта коллизионных норм, если императивные нормы защиты потребителей вашей юрисдикции не предусматривают иное."],
        ["30. Разрешение споров; арбитраж и отказ от коллективных исков",
         "До предъявления любого формального требования вы соглашаетесь сначала попытаться урегулировать спор добросовестно, связавшись с нами (раздел 33) и дав 60 дней. Любой неурегулированный так спор в максимально допустимой законом мере разрешается окончательным и обязательным индивидуальным арбитражем, а не в суде, за исключением того, что любая сторона может обратиться в суд по мелким искам либо за обеспечительными мерами по вопросам интеллектуальной собственности или несанкционированного доступа. ВЫ И HOOD СОГЛАШАЕТЕСЬ, ЧТО ТРЕБОВАНИЯ МОГУТ ПРЕДЪЯВЛЯТЬСЯ ТОЛЬКО В ИНДИВИДУАЛЬНОМ КАЧЕСТВЕ, А НЕ В КАЧЕСТВЕ ИСТЦА ИЛИ УЧАСТНИКА ГРУППЫ В ЛЮБОМ КОЛЛЕКТИВНОМ ИЛИ ПРЕДСТАВИТЕЛЬСКОМ ПРОИЗВОДСТВЕ, И ЧТО НИ ОДИН АРБИТРАЖ ИЛИ ИСК НЕ БУДЕТ ОБЪЕДИНЁН С ДРУГИМ. Любое требование должно быть предъявлено в течение одного года после его возникновения, иначе оно безвозвратно погашается, в допустимой законом мере."],
        ["31. Общие положения",
         "Если какое-либо положение этих Условий признано неисполнимым, оно ограничивается или отделяется в минимально необходимой мере, а остальные сохраняют полную силу. Неприменение нами какого-либо права не является отказом от него. Вы не можете уступать свои права по этим Условиям без нашего согласия; мы можем уступить свои в связи с управлением платформой или её передачей. Заголовки приведены только для удобства. Эти Условия вместе с Политикой конфиденциальности составляют полное соглашение между вами и hood в отношении интерфейса."],
        ["32. Изменения условий",
         "Мы можем обновлять эти Условия по мере развития продукта. Актуальная версия с датой вступления в силу всегда доступна на этой странице; о существенных изменениях мы можем дополнительно сообщить в интерфейсе. Продолжение использования после даты вступления в силу означает согласие."],
        ["33. Контакты",
         "Вопросы по этим Условиям, а также уведомления по интеллектуальной собственности и комплаенсу: contact@hoodandarrow.com."],
      ]}
    />
  );
}
