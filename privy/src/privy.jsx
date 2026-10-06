// Privy login for Viberquest, bundled to app/game/privy/ (npm run build) and loaded only when someone picks
// "LOGIN WITH EMAIL". Privy handles email codes and makes a wallet for people who don't have one; that wallet then
// signs the game's normal sign-in message, so the server treats it like any other wallet.
import "./shims.js";   // first, before Privy loads
import React, { useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets, useLogin } from "@privy-io/react-auth";
import { defineChain } from "viem";

const APP_ID = "cmux5eyeu007e0djozb87s7nq";
const robinhood = defineChain({
  id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } }, testnet: true,
});

let pending = null;   // the login modal in flight: { resolve, reject }
const state = { current: null };
function Bridge() {
  const { ready, authenticated, logout, exportWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { login } = useLogin({
    onComplete: () => { if (pending) { pending.resolve(); pending = null; } },
    onError: e => { if (pending) { pending.reject(new Error(e === "exited_auth_flow" ? "cancelled" : String(e))); pending = null; } },
  });
  const ref = useRef(null);
  ref.current = { ready, authenticated, wallets, walletsReady, login, logout, exportWallet };
  useEffect(() => { state.current = ref.current; });
  state.current = ref.current;
  return null;
}

const wait = async (ok, ms, what) => {
  const t0 = Date.now();
  while (!ok()) { if (Date.now() - t0 > ms) throw new Error(what + " timed out"); await new Promise(r => setTimeout(r, 150)); }
};
const P = () => state.current || {};

window.VQPrivy = {
  // log in with Privy (if needed), then sign the game's message with the user's wallet
  async signIn(getMessage) {
    await wait(() => P().ready, 20000, "privy");
    if (!P().authenticated) {
      const done = new Promise((resolve, reject) => { pending = { resolve, reject }; });
      P().login();
      await done;
    }
    await wait(() => P().walletsReady && P().wallets.length > 0, 30000, "wallet");
    const ws = P().wallets, w = ws.find(x => x.walletClientType === "privy") || ws[0];
    const message = await getMessage();
    const provider = await w.getEthereumProvider();
    const signature = await provider.request({ method: "personal_sign", params: [message, w.address] });
    return { address: w.address, signature, message, embedded: w.walletClientType === "privy" };
  },
  async logout() { if (P().authenticated) await P().logout(); },
  // Privy's own secure screen shows the key (the game never sees it). Needs a Privy session, so log in first if needed.
  async exportWallet() {
    await wait(() => P().ready, 20000, "privy");
    if (!P().authenticated) { const done = new Promise((resolve, reject) => { pending = { resolve, reject }; }); P().login(); await done; }
    await P().exportWallet();
  },
};

const el = document.createElement("div"); el.id = "privy-root"; document.body.appendChild(el);
createRoot(el).render(
  <PrivyProvider appId={APP_ID} config={{
    loginMethods: ["email", "wallet"],
    appearance: { theme: "dark", accentColor: "#dff902", logo: "https://viberquest.fun/brand/viberquest-icon.png", landingHeader: "Sign in to Viberquest", walletChainType: "ethereum-only" },
    embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
    defaultChain: robinhood, supportedChains: [robinhood],
  }}>
    <Bridge />
  </PrivyProvider>
);
