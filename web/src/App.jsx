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
              <rect width="64" height="64" rx="15" fill="#f2f2ee" stroke="#d9d9d0" strokeWidth="1" />
              <path d="M32 6 C23 12 11 31 11 47 C11 53 15 56 20 55 L44 55 C49 56 53 53 53 47 C53 31 41 12 32 6 Z" fill="#43464b" />
              <path d="M32 19 C26.5 23.5 20 32 20 42.5 C20 50 25 54.5 32 54.5 C39 54.5 44 50 44 42.5 C44 32 37.5 23.5 32 19 Z" fill="#0c0d0e" stroke="#f2f2ee" strokeWidth="2.6" />
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
