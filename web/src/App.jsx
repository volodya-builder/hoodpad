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
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onAccounts = (accs) => {
      if (accs.length === 0) setWallet(null);
      else connect();
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
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
      <path d="M32 8.6 C30 8.6 27.6 11 25.4 14.2 C20.4 21.4 15.2 31.6 13.2 41 C12.2 45.4 12.7 48.7 15.3 50.5 C17.9 52.2 23 51.3 32 51.3 C41 51.3 46.1 52.2 48.7 50.5 C51.3 48.7 51.8 45.4 50.8 41 C48.8 31.6 43.6 21.4 38.6 14.2 C36.4 11 34 8.6 32 8.6 Z" fill="#4a4d51"/>
      <path d="M32 25 C26.6 28.6 20.6 35.4 20.1 42.6 C19.8 46 21 48.4 22.5 50.2 C23.6 51.6 24 53 25.4 54.1 C27.2 55.4 29.4 55.8 32 55.8 C34.6 55.8 36.8 55.4 38.6 54.1 C40 53 40.4 51.6 41.5 50.2 C43 48.4 44.2 46 43.9 42.6 C43.4 35.4 37.4 28.6 32 25 Z" fill="#101112" stroke="#f5f5f2" strokeWidth="2.1"/>
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
