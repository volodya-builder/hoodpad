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
        updated="Last updated: July 2026 · applies to the hood interface"
        sections={[
          ["Who we are",
           "hood is a non-custodial web interface to smart contracts deployed on Robinhood Chain. The site is static: it has no accounts, no registration and no server that stores your personal data."],
          ["What we collect",
           "We do not collect names, emails, phone numbers or documents. Connecting a wallet happens locally in your browser between the page and your wallet extension; hood never receives your private keys and cannot move your funds."],
          ["On-chain data",
           "Everything you do through the interface — launching tokens, trading, voting, claiming fees — is a public blockchain transaction. Your wallet address and transaction history are visible to anyone via the network explorer. This is a property of public blockchains, not of hood."],
          ["Chat",
           "Chat messages are stored in a cloud database and are publicly readable by every visitor. Do not post personal or sensitive information in the chat. Messages may be removed at the platform's discretion."],
          ["Local settings",
           "Your language, theme and small caches (for example, token creation dates) are stored in your browser's localStorage and never leave your device. Clearing browser data removes them."],
          ["Third-party services",
           "The interface talks to public infrastructure: Robinhood Chain RPC nodes, the Blockscout explorer API, a public exchange-rate API for the ETH/USD price, and Google Firebase for chat storage. Each of these services has its own privacy policy; your IP address is visible to them as with any web request."],
          ["Changes",
           "We may update this policy as the product evolves; the current version is always available on this page."],
        ]}
      />
    );
  }
  return (
    <Doc
      title="Политика конфиденциальности"
      updated="Обновлено: июль 2026 · относится к интерфейсу hood"
      sections={[
        ["Кто мы",
         "hood — некастодиальный веб-интерфейс к смарт-контрактам в сети Robinhood Chain. Сайт статический: здесь нет аккаунтов, регистрации и сервера, который хранил бы ваши персональные данные."],
        ["Что мы собираем",
         "Мы не собираем имена, почту, телефоны и документы. Подключение кошелька происходит локально в вашем браузере между страницей и расширением кошелька; hood никогда не получает приватные ключи и не может распоряжаться вашими средствами."],
        ["Данные в блокчейне",
         "Всё, что вы делаете через интерфейс — запуск токенов, сделки, голосование, клейм комиссий — это публичные транзакции в блокчейне. Адрес вашего кошелька и история операций видны любому через эксплорер сети. Это свойство публичных блокчейнов, а не hood."],
        ["Чат",
         "Сообщения чата хранятся в облачной базе данных и публично видны каждому посетителю. Не публикуйте в чате персональные или чувствительные данные. Сообщения могут быть удалены по усмотрению платформы."],
        ["Локальные настройки",
         "Язык, тема и небольшие кэши (например, даты создания токенов) хранятся в localStorage вашего браузера и не покидают устройство. Очистка данных браузера удаляет их."],
        ["Сторонние сервисы",
         "Интерфейс обращается к публичной инфраструктуре: RPC-узлам Robinhood Chain, API эксплорера Blockscout, публичному API курса ETH/USD и Google Firebase для хранения чата. У каждого сервиса своя политика конфиденциальности; ваш IP-адрес виден им, как при любом веб-запросе."],
        ["Изменения",
         "Мы можем обновлять эту политику по мере развития продукта; актуальная версия всегда доступна на этой странице."],
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
