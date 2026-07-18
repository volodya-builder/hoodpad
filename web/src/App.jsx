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
          <a className="logo" href="#/">
            hood<span className="dot">pad</span>
          </a>
          <nav className="nav">
            <span className="dim">{CHAIN.name}</span>
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
