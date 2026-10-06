/* ================= touch controls, guest wallets, town NPCs ================= */
// Loaded after the main page script and shares its globals ($, api, ME, load, openWin, current, drawLabel, toast...).

// ---- touch: a joystick on the left, action buttons on the right (phones and tablets only)
const TOUCH = { on: false, x: 0, y: 0, atk: false, use: false, pot: false };
(function () {
  if (!matchMedia("(pointer: coarse)").matches) return;
  TOUCH.on = true; document.body.classList.add("touch");
  const w = $("world"), pad = document.createElement("div"), btns = document.createElement("div");
  pad.className = "tpad"; pad.innerHTML = '<div class="tbase"><i class="tknob"></i></div>';
  btns.className = "tbtns"; btns.innerHTML = '<button data-t="pot" class="tpot">♥</button><button data-t="use">E</button><button data-t="atk" class="tatk">⚔</button>';
  w.appendChild(pad); w.appendChild(btns);
  const base = pad.querySelector(".tbase"), knob = pad.querySelector(".tknob"); let id = null;
  const move = e => {
    const r = base.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; TOUCH.x = Math.abs(dx) > 6 ? dx / R : 0; TOUCH.y = Math.abs(dy) > 6 ? dy / R : 0;
  };
  base.addEventListener("pointerdown", e => { id = e.pointerId; base.setPointerCapture(id); move(e); e.preventDefault(); e.stopPropagation(); });
  base.addEventListener("pointermove", e => { if (e.pointerId === id) move(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; TOUCH.x = TOUCH.y = 0; knob.style.transform = ""; };
  base.addEventListener("pointerup", end); base.addEventListener("pointercancel", end);
  btns.querySelectorAll("button").forEach(b => b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); TOUCH[b.dataset.t] = true; b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 120); }));
})();
const touchTake = k => { if (!TOUCH[k]) return false; TOUCH[k] = false; return true; };

// ---- guest: a throwaway wallet made in this browser, signs in like any wallet (no extension, no transaction)
const GUEST_KEY = "vq_guest_key";
function guestKey() { try { return localStorage.getItem(GUEST_KEY); } catch (_) { return null; } }
async function loadEthers() {
  if (window.ethers) return window.ethers;
  await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  return window.ethers;
}
async function playAsGuest() {
  const m = $("msg"), b = $("guestbtn");
  try {
    b.disabled = true; m.className = "msg"; m.textContent = "making your guest hero…";
    const E = await loadEthers();
    let key = guestKey(); if (!key) { key = E.Wallet.createRandom().privateKey; try { localStorage.setItem(GUEST_KEY, key); } catch (_) { } }
    const wallet = new E.Wallet(key), n = await api("nonce");
    try { localStorage.setItem("vq_guest_addr", wallet.address.toLowerCase()); } catch (_) { }
    const signature = await wallet.signMessage(n.message);
    const r = await api("login", { address: wallet.address, signature, message: n.message });
    if (!r.ok) throw new Error(r.error);
    m.textContent = ""; sfx.win(); await load(); banner("WELCOME, GUEST", "the dungeon is open. $VQUEST drops unlock once you trade on vibe/vibe");
  } catch (e) { m.className = "msg err"; m.textContent = "could not start a guest hero: " + (e.message || e); }
  b.disabled = false;
}
(function () {
  const ways = document.querySelector("#welcome .ways"); if (!ways) return;
  const b = document.createElement("button"); b.className = "btn ghost"; b.id = "guestbtn"; b.textContent = guestKey() ? "CONTINUE AS GUEST" : "PLAY AS GUEST";
  b.onclick = () => { sfx.click(); playAsGuest(); }; ways.appendChild(b);
})();
const isGuest = () => { try { return !!(ME && localStorage.getItem("vq_guest_addr") === ME.wallet); } catch (_) { return false; } };
// the hero window shows this for guest heroes: the key, so the hero can be moved into a real wallet later
function guestPanel() {
  if (!isGuest()) return "";
  return `<div class="guestbox"><b>GUEST HERO</b><p>this hero lives in this browser. save the key to keep it, or import it into a wallet app. testnet only, never put real funds on it.</p>
    <button class="btn ghost" id="showkey">SHOW KEY</button><code id="gkey" hidden></code></div>`;
}
document.addEventListener("click", e => {
  if (e.target.id !== "showkey") return;
  const c = $("gkey"); c.hidden = !c.hidden; c.textContent = c.hidden ? "" : guestKey(); e.target.textContent = c.hidden ? "SHOW KEY" : "HIDE KEY";
});

// ---- Privy: email login (Privy makes a wallet for people who don't have one), loaded only on click
async function loginWithPrivy() {
  const m = $("msg"), b = $("privybtn");
  try {
    b.disabled = true; m.className = "msg"; m.textContent = "opening the login…";
    if (!window.VQPrivy) await import("/game/privy/privy.js?v=3");
    const r0 = await VQPrivy.signIn(async () => (await api("nonce")).message);
    m.textContent = "signing you in…";
    const r = await api("login", { address: r0.address, signature: r0.signature, message: r0.message });
    if (!r.ok) throw new Error(r.error);
    try { localStorage.setItem("vq_privy_addr", r0.address.toLowerCase()); } catch (_) { }
    m.textContent = ""; sfx.win(); await load(); banner("WELCOME", r0.embedded ? "your hero has its own wallet now, made by Privy" : "your quests are on the board");
  } catch (e) { m.className = "msg err"; m.textContent = /cancel/i.test(e && e.message) ? "login cancelled" : "could not log in: " + (e.message || e); }
  b.disabled = false;
}
(function () {
  const ways = document.querySelector("#welcome .ways"); if (!ways) return;
  const b = document.createElement("button"); b.className = "btn lime"; b.id = "privybtn"; b.textContent = "LOGIN WITH EMAIL";
  b.onclick = () => { sfx.click(); loginWithPrivy(); }; ways.insertBefore(b, $("pairbtn"));
  $("out").addEventListener("click", () => { if (window.VQPrivy) VQPrivy.logout().catch(() => {}); });
})();

// ---- profile: a button top right (avatar + short address) and a window with wallet, tokens and game assets
const isPrivy = () => { try { return !!(ME && localStorage.getItem("vq_privy_addr") === ME.wallet); } catch (_) { return false; } };
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
let profSeen = "";
setInterval(() => {   // keep the button in sync with who is signed in
  const b = $("prof"), k = ME ? ME.wallet + (ME.watch ? "w" : "") : "";
  if (k === profSeen) return; profSeen = k; b.hidden = !ME;
  if (!ME) return;
  $("profaddr").textContent = ME.watch ? "WATCHING" : short(ME.wallet);
  const cv = $("profcv"), g = cv.getContext("2d"); g.clearRect(0, 0, 32, 32); Viber.draw(g, ME.wallet, ME.cls, ME.level, 0, 0, 1);
}, 500);
$("prof").onclick = () => { sfx.click(); openWin("profile"); };
function renderProfile(wt, wb) {
  const m = ME; if (!m) return closeWin();
  const kind = m.watch ? "WATCHING" : isGuest() ? "GUEST" : isPrivy() ? "EMAIL (PRIVY)" : "WALLET";
  wt.innerHTML = `PROFILE<small>your wallet, tokens and game assets</small>`;
  wb.innerHTML = `<p class="note">loading…</p>`;
  (m.watch ? Promise.resolve(null) : api("profile").catch(() => null)).then(p => {
    if (current !== "profile") return;
    const num = (v, d = 4) => v == null ? "-" : fmt(v, d);
    const it = (p && p.items) || {}, gearN = Object.values(it).reduce((a, x) => a + x.n, 0), dg = (p && p.dungeon) || {};
    wb.innerHTML = `<div class="prof">
      <div class="ptop"><canvas id="profbig" width="32" height="32"></canvas><div>
        <div><span class="tag">${kind}</span><span class="tag">LV ${m.level}</span><span class="tag">${esc(m.cls)}</span></div>
        <div class="addr" style="margin-top:6px">${esc(m.wallet)}</div>
        <div class="links"><button id="pcopy">COPY ADDRESS</button><a href="${EXPLORER}/address/${m.wallet}" target="_blank" rel="noopener">EXPLORER ↗</a><a href="/h/${m.wallet}" target="_blank" rel="noopener">HERO CARD ↗</a></div>
      </div></div>
      ${p ? `<span class="k">ON CHAIN · ROBINHOOD TESTNET</span>
      <div class="grid">
        <div><span class="k">ETH</span><b>${num(p.chain.eth)}</b><small>for gas and trading</small></div>
        <div><span class="k">$VQUEST</span><b style="color:var(--lime)">${num(p.chain.vquest, 2)}</b><small>${p.graduated ? "in your wallet" : "in your wallet · transfers unlock at graduation"}</small></div>
        <div><span class="k">TOKEN</span><b style="font-size:10px">${p.token ? short(p.token) : "-"}</b><small>${p.token ? `<a href="${EXPLORER}/token/${p.token}" target="_blank" rel="noopener">view ↗</a>` : ""}</small></div>
      </div>
      <span class="k">IN GAME</span>
      <div class="grid">
        <div><span class="k">$VQUEST FOUND</span><b style="color:var(--lime)">${fmt(p.game.vquest)}</b><small>dungeon drops${p.game.vquest_prizes ? ` + ${fmt(p.game.vquest_prizes)} weekly prizes` : ""}. withdrawals open once transfers unlock</small></div>
        <div><span class="k">GOLD</span><b style="color:#ffd23f">${fmt(p.game.gold)}</b><small>potions, extra runs, gear boxes</small></div>
        <div><span class="k">EMBERS</span><b style="color:#ff9a3c">${fmt(m.embers || 0)}</b><small>from the Furnace</small></div>
        <div><span class="k">XP</span><b>${fmt(m.xp || 0)}</b><small>level ${m.level}</small></div>
        <div><span class="k">GEAR</span><b>${gearN}</b><small>${Object.entries(it).map(([r, x]) => `${x.n} ${r}`).join(", ") || "none yet"}</small></div>
        <div><span class="k">MATERIALS</span><b style="font-size:11px">${Object.entries(m.materials || {}).filter(([, n]) => n > 0).map(([k, n]) => `${gem(k)}${n}`).join(" ") || "-"}</b><small>for the Forge</small></div>
      </div>
      <span class="k">DUNGEON</span>
      <div class="grid">
        <div><span class="k">DEEPEST FLOOR</span><b>${dg.best || 0}</b><small>${dg.runs || 0} runs</small></div>
        <div><span class="k">MONSTERS</span><b>${fmt(dg.kills || 0)}</b><small>${dg.bosses || 0} bosses</small></div>
        <div><span class="k">CHESTS</span><b>${fmt(dg.chests || 0)}</b><small>opened</small></div>
      </div>` : `<p class="note">you are only looking around. pair or sign in to see balances.</p>`}
      ${guestPanel()}
      ${isPrivy() ? `<div class="guestbox"><b>EMAIL WALLET</b><p>Privy made this wallet for your email. You can export its key to use it in any wallet app. Testnet only.</p><button class="btn ghost" id="pexport">EXPORT KEY</button></div>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn ghost" data-open="hero">HERO &amp; GEAR</button><button class="btn ghost" data-open="dungeon">DUNGEON</button><button class="btn ghost" id="pout">SIGN OUT</button></div>
    </div>`;
    const cv = $("profbig").getContext("2d"); Viber.draw(cv, m.wallet, m.cls, m.level, 0, 0, 1);
    $("pcopy").onclick = () => { navigator.clipboard.writeText(m.wallet).then(() => toast("address copied")).catch(() => { }); };
    $("pout").onclick = () => { closeWin(); $("out").click(); };
    wb.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openWin(b.dataset.open));
    const ex = $("pexport"); if (ex) ex.onclick = async () => {
      try { if (!window.VQPrivy) await import("/game/privy/privy.js?v=3"); await VQPrivy.exportWallet(); } catch (e) { toast("could not open the export: " + (e.message || e)); }
    };
  });
}

// ---- town NPCs: a few vibers who live here, standing by their buildings or walking the streets
const NPCS_DEF = [
  { id: "gatekeeper", name: "GATEKEEPER", door: "dungeon", dx: 34, dy: -4, cls: "Whale", lines: ["the gate is open. monsters below, chests too", "bosses guard every 5th floor", "walk out with the stairs and you keep the whole bag"] },
  { id: "smith", name: "BLACKSMITH", door: "forge", dx: 26, dy: -2, cls: "Launcher", lines: ["bring me copper and silver", "better gear hits harder down there", "the dungeon drops gear too, sometimes epic"] },
  { id: "banker", name: "BANKER", door: "treasury", dx: -28, dy: -2, cls: "Diamond Hands", lines: ["every $VQUEST you find is kept safe here", "the treasury pays the weekly prizes", "deepest diver of the week gets 5,000 $VQUEST"] },
  { id: "crier", name: "QUEST GIVER", door: "quests", dx: -30, dy: -2, cls: "Curve Surfer", lines: ["new quests every day", "dungeon quests are on the board too", "trade on vibe/vibe and the board lights up"] },
  { id: "c1", name: "CITIZEN", walk: 14.6, lines: ["gm", "have you been down the gate?", "lfg"] },
  { id: "c2", name: "CITIZEN", walk: 26.6, lines: ["gm gm", "the market screen is all green today", "wagmi"] },
  { id: "c3", name: "CITIZEN", walk: 14.6, lines: ["i saw a whale on floor 20", "rug slimes everywhere"] },
];
function npcsCreate(scene) {
  scene.npcs = [];
  for (const d of NPCS_DEF) {
    let x, y;
    if (d.door) { const door = TOWN.doors[d.door]; if (!door) continue; x = door.x + d.dx; y = door.y + d.dy; }
    else { x = (8 + Math.random() * 32) * 16; y = d.walk * 16; }
    const key = Chibi.key(scene, "npc:" + d.id, d.cls || "Fresh");
    const s = scene.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setDepth(y);
    scene.npcs.push({ ...d, s, key, x, y, tx: x, dir: "down", wait: 0, say: null, sayAt: 0 });
  }
}
function npcsUpdate(scene, time, delta) {
  if (!scene.npcs) return;
  for (const n of scene.npcs) {
    let moving = false;
    if (n.walk) {
      if (time > n.wait && Math.abs(n.tx - n.x) < 2) { n.tx = (6 + Math.random() * 36) * 16; n.wait = time + 1500 + Math.random() * 4000; }
      if (time > n.wait && Math.abs(n.tx - n.x) >= 2) { const st = 34 * delta / 1000 * Math.sign(n.tx - n.x); n.x += st; n.dir = st > 0 ? "right" : "left"; moving = true; }
      else n.dir = "down";
      n.s.setPosition(n.x, n.y);
    }
    const k = `${n.key}_${moving ? "walk" : "idle"}_${n.dir}`; if (n.s.anims.currentAnim?.key !== k) n.s.play(k, true);
    const near = Math.hypot(hero.x - n.x, hero.y - n.y) < 60;
    if (near && time - n.sayAt > 9000) { n.say = n.lines[Math.floor(Math.random() * n.lines.length)]; n.sayAt = time; }
    drawLabel(n.name, n.x, n.y - 24, "#9fd2ff", { key: "npc:" + n.id, sub: "NPC" });
    if (n.say && time - n.sayAt < 3800) drawLabel(n.say, n.x, n.y - 34, null, { key: "npcb:" + n.id, bubble: true });
  }
}
