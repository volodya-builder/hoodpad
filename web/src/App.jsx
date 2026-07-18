import React, { useEffect, useState, useCallback } from "react";
import Home from "./pages/Home.jsx";
import Create from "./pages/Create.jsx";
import TokenPage from "./pages/Token.jsx";
import { connectWallet, hasWallet, short } from "./lib/web3.js";
import { CHAIN, FACTORY_ADDRESS } from "./lib/config.js";

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.replace(/^#/, "");
}

export default function App() {
  const route = useHashRoute();
  const [wallet, setWallet] = useState(null); // { account, walletClient }

  const connect = useCallback(async () => {
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e) {
      alert(e.shortMessage || e.message);
    }
  }, []);

  useEffect(() => {
    if (!hasWallet()) return;
    const onAccounts = (accs) => {
      if (accs.length === 0) setWallet(null);
      else connect();
    };
    window.ethereum.on?.("accountsChanged", onAccounts);
    return () => window.ethereum.removeListener?.("accountsChanged", onAccounts);
  }, [connect]);

  const factoryMissing =
    FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000";

  let page;
  if (route.startsWith("/token/")) {
    page = <TokenPage tokenAddress={route.split("/token/")[1]} wallet={wallet} onConnect={connect} />;
  } else if (route === "/create") {
    page = <Create wallet={wallet} onConnect={connect} />;
  } else {
    page = <Home />;
  }

  return (
    <>
      <header>
        <div className="container header-inner">
          <a className="logo" href="#/" aria-label="hood">
            <svg width="32" height="32" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#f5f5f2"/>
      <path d="M32 9.5 C27.5 13 16.5 27 12.8 42.5 C11.8 47 12.6 50.3 15.6 51 L48.4 51 C51.4 50.3 52.2 47 51.2 42.5 C47.5 27 36.5 13 32 9.5 Z" fill="#4a4d51"/>
      <path d="M32 24 C26 28 20.8 34.5 20.2 42 C19.8 46 20.6 49.5 22.3 52 C23.7 54.5 26.5 55.8 32 55.8 C37.5 55.8 40.3 54.5 41.7 52 C43.4 49.5 44.2 46 43.8 42 C43.2 34.5 38 28 32 24 Z" fill="#101112" stroke="#f5f5f2" strokeWidth="2.4"/>
    </svg>
            <span className="logo-word">HOOD</span>
          </a>
          <nav className="nav">
            <span className="net-pill">{CHAIN.name}</span>
            <a className="btn" href="#/create">+ Launch token</a>
            {wallet ? (
              <span className="btn mono">{short(wallet.account)}</span>
            ) : (
              <button className="btn btn-primary" onClick={connect}>
                Connect wallet
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="container">
        {factoryMissing && (
          <div className="error" style={{ marginTop: 16 }}>
            Factory address is not configured. Deploy the contracts and set
            VITE_FACTORY_ADDRESS in web/.env
          </div>
        )}
        {page}
      </main>
    </>
  );
}
