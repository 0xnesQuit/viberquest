// Records the "dungeon update" promo of Viberquest in headless Chrome and encodes it to MP4 inside Chrome:
// email login (Privy) and guest play, the new hand-drawn neon town, the profile window, dungeon quests, and a dungeon
// run with a boss. The demo hero is set up on the server by scripts/demo_dungeon.cjs and removed afterwards.
// Usage: node scripts/record4.js <out.mp4>
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const { launch } = require("./cdp");
const SITE = "https://viberquest.fun";
const OUT = path.resolve(process.argv[2] || "viberquest-dungeon.mp4");
const W = 1280, H = 720, DPR = 1.5, FPS = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const remote = (...args) => execFileSync("ssh", ["bureau", "sudo -u postgres node /tmp/demo_dungeon.cjs " + args.join(" ")], { encoding: "utf8" });

(async () => {
  remote("setup");
  const demo = JSON.parse(execFileSync("ssh", ["bureau", "node /tmp/demo_dungeon.cjs cookie"], { encoding: "utf8" }));
  const b = await launch(9372), p = await b.open("about:blank");
  await p.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await p.send("Page.enable"); await p.send("Network.enable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vqframes-"));
  const frames = [];
  let rec = false, clock = 0, lastTs = null;
  p.on("Page.screencastFrame", async ev => {
    p.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
    const ts = ev.metadata.timestamp;
    if (!rec) { lastTs = null; return; }
    if (lastTs != null) clock += Math.min(1.5, ts - lastTs);   // a still screen sends few frames, keep its real length
    lastTs = ts;
    const f = path.join(dir, frames.length + ".jpg"); fs.writeFileSync(f, Buffer.from(ev.data, "base64"));
    frames.push({ file: f, t: clock });
  });
  const start = () => { lastTs = null; rec = true; }, stop = () => { rec = false; };
  const caps = [], cap = text => caps.push({ t: clock, text });
  const js = e => p.eval(e);
  const wait = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return true; await sleep(120); } return false; };
  await p.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });

  // 1. the welcome screen: four ways in, then the Privy email login
  await p.send("Page.navigate", { url: SITE + "/" });
  await wait("document.fonts.status === 'loaded' && !document.getElementById('welcome').hidden && !!document.getElementById('privybtn')");
  await sleep(1500); start(); cap("new: log in with just your email"); await sleep(2200);
  await js("document.getElementById('privybtn').click()");
  await wait("!!document.getElementById('privy-modal-content') || !!document.querySelector('#privy-root [role=dialog]') || [...document.querySelectorAll('div')].some(d => /Sign in to Viberquest/.test(d.textContent) && d.offsetParent)", 20000);
  await sleep(600); cap("privy makes a wallet for you, no extension needed"); await sleep(3600);
  cap("or play as a guest, or bring your own wallet"); await sleep(2200); stop();

  // 2. signed in as the demo hero
  await p.send("Network.setCookie", { name: "vq", value: demo.cookie, domain: "viberquest.fun", path: "/", secure: true, httpOnly: true });
  await js("localStorage.setItem('vq_tut','1'); localStorage.setItem('vq_snd','0')");
  await p.send("Page.navigate", { url: SITE + "/" });
  await wait("typeof ME !== 'undefined' && ME && ME.wallet && typeof TOWN !== 'undefined' && TOWN && GAME.scene.isActive('town')", 30000);
  await sleep(2500);
  // a few other players walking the plaza (shown in this browser only)
  await js(`(() => {
    const fake = [["0x8a1f3c0de11a7e2b9c44d0e5a6b7c8d9e0f12345", 330, 260, "GM"], ["0x51c0ffee2a3b4c5d6e7f8091a2b3c4d5e6f70809", 470, 420, "LFG"], ["0xb0b0cafe1234567890abcdef1234567890abcdef", 560, 250, null]];
    window.__fakeOthers = () => { for (const [w, x, y, e] of fake) if (!OTHERS.has(w)) OTHERS.set(w, { w, x, y, tx: x, ty: y, level: 7 + (x % 9), cls: "Fresh", color: null, bubble: e ? { text: e, t: performance.now(), c: null } : null }); onlineCount(); };
    window.__fakeOthers(); setInterval(() => { window.__fakeOthers(); for (const o of OTHERS.values()) if (o.w.startsWith("0x8a1f") || o.w.startsWith("0x51c0") || o.w.startsWith("0xb0b0")) { if (Math.abs(o.tx - o.x) < 2 && Math.random() < .3) { o.tx = 260 + Math.random() * 300; o.ty = Math.random() < .5 ? 232 : 425; } } }, 1500);
  })()`);
  await js("hero.x = hero.tx = 384; hero.y = hero.ty = 300; SCENE.me.body.reset(384, 300); hero.path = []");
  await sleep(800); start(); cap("a brand new town, every pixel drawn for viberquest"); await sleep(2600);
  await js("routeTo(hero, 384, 228)"); await sleep(1800);
  cap("every building has a sign now"); await js("routeTo(hero, 130, 228)"); await sleep(3800);
  cap("locals who talk to you"); await sleep(2800);
  await js("routeTo(hero, 560, 228)"); await sleep(3000); cap("other players walk the same plaza, live"); await sleep(3600);

  // 3. profile window and dungeon quests
  await js("openWin('profile')"); cap("your wallet, tokens and assets in one place"); await wait("!!document.querySelector('.prof .grid')", 8000); await sleep(3800);
  await js("openWin('quests')"); await sleep(600); await js("document.querySelector('[data-qtab=dungeon]') && document.querySelector('[data-qtab=dungeon]').click()");
  cap("new dungeon quests every day"); await sleep(3200); await js("closeWin()"); await sleep(400);

  // 4. the dungeon gate and the lobby
  await js("goTo('dungeon')"); cap("then head down the gate"); await wait("current === 'dungeon' && !!document.getElementById('dgo')", 15000); await sleep(1600);
  cap("runs, gold shop and a weekly prize for the deepest divers"); await js("document.querySelector('.win-b').scrollTo({ top: 420, behavior: 'smooth' })"); await sleep(3200);
  await js("document.getElementById('dgo').click()");
  await wait("!!(GAME.scene.isActive('dungeon') && GAME.scene.getScene('dungeon').mobs)", 20000); await sleep(1800);
  stop();
  const runId = await js("GAME.scene.getScene('dungeon').run.id"); remote("eligible", runId);

  // helpers in the page: walk with the joystick input and swing when close, like a player would
  await js(`(() => {
    const S = () => GAME.scene.getScene("dungeon"), D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    window.__fight = async (ms, onlyBoss) => {
      const s = S(), t0 = performance.now(); let tgt = null, since = performance.now();
      while (performance.now() - t0 < ms && !s.over) {
        const al = s.alive().filter(m => !onlyBoss || m.boss); if (!al.length) break;
        if (!tgt || tgt.dead || performance.now() - since > 2500) { tgt = al.sort((a, b) => D(a.s, s.me) - D(b.s, s.me))[0]; since = performance.now(); }
        const dx = tgt.s.x - s.me.x, dy = tgt.s.y - s.me.y, d = Math.hypot(dx, dy);
        if (d > 12 + tgt.r) { TOUCH.x = dx / d; TOUCH.y = dy / d; }
        else { TOUCH.x = TOUCH.y = 0; s.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"); TOUCH.atk = true; since = performance.now(); }
        await new Promise(r => setTimeout(r, 80));
      }
      TOUCH.x = TOUCH.y = 0;
    };
    window.__walk = async (x, y, ms) => { const s = S(), t0 = performance.now(); while (performance.now() - t0 < ms) { const dx = x - s.me.x, dy = y - s.me.y, d = Math.hypot(dx, dy); if (d < 6) break; TOUCH.x = dx / d; TOUCH.y = dy / d; await new Promise(r => setTimeout(r, 60)); } TOUCH.x = TOUCH.y = 0; };
    window.__near = () => { const s = S(), m = s.alive()[0]; if (m) s.me.body.reset(m.s.x - 46, m.s.y + 4); };
  })()`);

  // 5. floor 1: fight, then a chest
  await js("__near()"); await sleep(500); start(); cap("fight crypto monsters: rug slimes, fud bats and worse"); await js("__fight(7000)"); await sleep(300);
  stop(); await js("__near()"); await sleep(400); start(); await js("__fight(5000)"); stop();
  await js("(() => { const s = GAME.scene.getScene('dungeon'), c = s.chests.find(c => !c.open); if (c) s.me.body.reset(c.x, c.y + 26); })()"); await sleep(400);
  start(); cap("open chests for gold, materials and $VQUEST");
  await js("(async () => { const s = GAME.scene.getScene('dungeon'), c = s.chests.find(c => !c.open); if (!c) return; await __walk(c.x, c.y + 6, 1500); const it = s.interactable(); if (it && it.kind === 'chest') TOUCH.use = true; })()"); await sleep(3600);
  stop();

  // 6. a boss floor
  remote("toboss", runId);
  await js("(async () => { const s = GAME.scene.getScene('dungeon'); const r = await api('run/next', { run: s.run.id }); if (r.ok) startDungeon(r.run); })()");
  await wait("!!(GAME.scene.getScene('dungeon').run.boss && GAME.scene.getScene('dungeon').mobs && GAME.scene.getScene('dungeon').mobs.some(m => m.boss))", 20000); await sleep(2200);
  await js("(() => { const s = GAME.scene.getScene('dungeon'), b = s.mobs.find(m => m.boss); s.me.body.reset(b.s.x, b.s.y + 70); })()"); await sleep(500);
  start(); cap("a boss waits on every 5th floor"); await sleep(1800);
  await js("__fight(12000, true)"); await sleep(400);
  cap("bosses always drop $VQUEST and gear"); await sleep(3800);
  cap("gear drops get rarer the deeper you go"); await sleep(1500);
  await js("document.getElementById('dleave').click(); document.getElementById('dleave').click()");
  await wait("current === 'dsum'", 8000); await sleep(400);
  cap("walk out and keep the whole bag"); await sleep(4200);
  cap(null); await sleep(600); stop();
  await p.send("Page.stopScreencast");
  console.log("captured", frames.length, "frames,", clock.toFixed(1), "s");
  remote("clean");

  // resample to constant fps: each output frame shows the newest captured frame at that time
  const INTRO = 3.0, OUTRO = 4.0, plan = [], capAt = []; let j = 0;
  for (let k = 0; k < INTRO * FPS; k++) { plan.push(-1); capAt.push(null); }
  for (let k = 0; k * (1 / FPS) <= clock; k++) {
    const t = k / FPS; while (j + 1 < frames.length && frames[j + 1].t <= t) j++; plan.push(j);
    const c = caps.filter(x => x.t <= t + 0.05).pop(); capAt.push(c ? c.text : null);
  }
  for (let k = 0; k < OUTRO * FPS; k++) { plan.push(-2); capAt.push(null); }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/enc") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end('<!doctype html><title>enc</title><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Instrument+Sans:wght@500&display=block" rel="stylesheet">'); }
    if (u.pathname === "/logo") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(fs.readFileSync(path.join(__dirname, "..", "brand", "viberquest-icon.png"))); }
    if (u.pathname === "/plan") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ plan, capAt, w: W * DPR, h: H * DPR, fps: FPS })); }
    if (u.pathname.startsWith("/f/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(fs.readFileSync(frames[Number(u.pathname.slice(3))].file)); }
    if (u.pathname === "/out" && req.method === "POST") { const parts = []; req.on("data", c => parts.push(c)); req.on("end", () => { fs.writeFileSync(OUT, Buffer.concat(parts)); res.end("ok"); server.emit("done"); }); return; }
    res.writeHead(404); res.end();
  }).listen(9446);
  const e = await b.open("http://127.0.0.1:9446/enc");
  await sleep(800);
  const done = new Promise(r => server.once("done", r));
  const info = await e.eval(`(async () => {
    const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.mjs');
    const { plan, capAt, w, h, fps } = await (await fetch('/plan')).json();
    await document.fonts.load('40px "Press Start 2P"'); await document.fonts.load('36px "Instrument Sans"');
    const logo = await createImageBitmap(await (await fetch('/logo')).blob());
    const card = (g, k, kind) => {   // intro / outro title cards with the logo
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      g.imageSmoothingEnabled = false; const ls = 300 + Math.min(1, k / 18) * 20; g.globalAlpha = Math.min(1, k / 10); g.drawImage(logo, w / 2 - ls / 2, h / 2 - 330 - (ls - 300) / 2, ls, ls); g.globalAlpha = 1;
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(223,249,2,' + (0.05 + 0.05 * ((i * 7) % 3)) + ')'; g.fillRect((i * 331) % w, (i * 197) % h, 6, 6); }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const a = Math.min(1, k / 12); g.globalAlpha = a;
      g.fillStyle = '#3d4a00'; g.font = '110px "Press Start 2P"'; g.fillText('VIBERQUEST', w / 2 + 8, h / 2 + 40 + 8);
      g.fillStyle = '#dff902'; g.fillText('VIBERQUEST', w / 2, h / 2 + 40);
      g.fillStyle = '#f2f4f3'; g.font = '34px "Press Start 2P"';
      g.fillText(kind === 'intro' ? 'THE DUNGEON UPDATE' : 'PLAY NOW AT VIBERQUEST.FUN', w / 2, h / 2 + 170);
      g.fillStyle = '#7d848a'; g.font = '36px "Instrument Sans"';
      g.fillText(kind === 'intro' ? 'new town · email login · dungeon, bosses and $VQUEST drops' : 'free to play · guide at viberquest.fun/guide · by @0xHaileyy', w / 2, h / 2 + 250);
      g.globalAlpha = 1; g.textAlign = 'left';
    };
    const caption = (g, text) => {
      if (!text) return;
      g.font = '30px "Press Start 2P"'; const tw = g.measureText(text.toUpperCase()).width, bw = tw + 70, bx = (w - bw) / 2, by = h - 140;
      g.fillStyle = 'rgba(0,0,0,.82)'; g.fillRect(bx, by, bw, 84); g.fillStyle = '#dff902'; g.fillRect(bx, by, bw, 5);
      g.fillStyle = '#f2f4f3'; g.textBaseline = 'middle'; g.fillText(text.toUpperCase(), bx + 35, by + 45);
    };
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { throw e; } });
    enc.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 12_000_000, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
    const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d'), bc = new OffscreenCanvas(w, h), base = bc.getContext('2d');
    let shown = -1;
    for (let k = 0; k < plan.length; k++) {
      if (plan[k] < 0) { const k0 = plan.indexOf(plan[k]); card(g, k - k0, plan[k] === -1 ? 'intro' : 'outro'); shown = -9; }
      else { if (plan[k] !== shown) { const bmp = await createImageBitmap(await (await fetch('/f/' + plan[k])).blob()); base.drawImage(bmp, 0, 0, w, h); bmp.close(); shown = plan[k]; } g.drawImage(bc, 0, 0); caption(g, capAt[k]); }
      const vf = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: k % (fps * 2) === 0 }); vf.close();
      if (enc.encodeQueueSize > 12) await new Promise(r => setTimeout(r, 5));
    }
    await enc.flush(); muxer.finalize();
    const buf = muxer.target.buffer;
    await fetch('/out', { method: 'POST', body: buf });
    return { frames: plan.length, bytes: buf.byteLength };
  })()`);
  await done;
  console.log("encoded", info.frames, "frames,", (info.bytes / 1e6).toFixed(1), "MB ->", OUT);
  server.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
