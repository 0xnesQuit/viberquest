// Records a promo walkthrough of Viberquest in headless Chrome and encodes it to MP4 (H.264) inside Chrome.
// The game animates in real time, so frames come from Page.startScreencast with their real timestamps and are
// resampled to a constant 30 fps. Gaps where recording is paused (page loads, retries) are cut out.
// Usage: node scripts/record.js <demo.json with {wallet, cookie}> <out.mp4>
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const { launch } = require("./cdp");
const SITE = "https://viberquest.fun";
const demo = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const OUT = path.resolve(process.argv[3] || "viberquest.mp4");
const W = 1280, H = 720, DPR = 1.5, FPS = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await launch(9371), p = await b.open("about:blank");
  await p.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await p.send("Page.enable"); await p.send("Network.enable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vqframes-"));
  const frames = [];   // { file, t } with t = recorded time in seconds (pauses removed)
  let rec = false, clock = 0, lastTs = null;
  p.on("Page.screencastFrame", async ev => {
    p.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
    const ts = ev.metadata.timestamp;
    if (!rec) { lastTs = null; return; }
    if (lastTs != null) clock += Math.min(0.2, ts - lastTs);
    lastTs = ts;
    const f = path.join(dir, frames.length + ".jpg"); fs.writeFileSync(f, Buffer.from(ev.data, "base64"));
    frames.push({ file: f, t: clock });
  });
  const start = () => { lastTs = null; rec = true; }, stop = () => { rec = false; };
  const caps = [];   // captions under the picture: { t, text } (text null = none)
  const cap = text => caps.push({ t: clock, text });
  const js = e => p.eval(e);
  const wait = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const walkDone = () => wait("!!current", 12000);   // goTo() walks, then opens the window
  const remote = (...args) => execFileSync("ssh", ["bureau", "sudo -u postgres node /tmp/demo_done.cjs " + args.join(" ")], { encoding: "utf8" });
  await p.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });

  // 1. signed out: the welcome screen
  await p.send("Page.navigate", { url: SITE + "/" });
  await wait("document.fonts.status === 'loaded' && !document.getElementById('welcome').hidden");
  await sleep(1200); start(); cap("a pixel RPG on top of vibe/vibe"); await sleep(3500); stop();

  // 2. sign in as the demo hero (cookie), skip the tutorial
  await p.send("Network.setCookie", { name: "vq", value: demo.cookie, domain: "viberquest.fun", path: "/", secure: true, httpOnly: true });
  await js("localStorage.setItem('vq_tut','1'); localStorage.setItem('vq_snd','0')");
  await p.send("Page.navigate", { url: SITE + "/" });
  await wait("typeof ME !== 'undefined' && ME && ME.wallet");
  await sleep(1500);
  await js("hero.x = hero.tx = 150; cam = 0");
  await sleep(400); start(); cap("your wallet is your character"); await sleep(1800);

  // 3. stroll down the street to the Arena and back
  await js("hero.tx = 470"); await sleep(2600);
  await js("hero.tx = 120"); await sleep(1200);

  // 4. quest board: a quest completes live, then claim it
  await js("goTo('quests')"); cap("trade on vibe/vibe, quests complete live"); await walkDone(); await sleep(1500);
  remote(demo.wallet); await wait("document.getElementById('banner').classList.contains('on')", 8000); await sleep(2200);
  cap("claim XP and materials"); await js("document.querySelector('[data-claim]') && document.querySelector('[data-claim]').click()"); await sleep(2600);
  await js("closeWin()"); await sleep(500);

  // 5. forge a legendary head piece (failed rolls are cut)
  await js("goTo('forge')"); cap("forge gear, it boosts your XP"); await walkDone(); await sleep(900);
  await js("document.querySelector('[data-tier=legendary]').click()"); await sleep(700);
  await js("document.querySelector('[data-slot=head]').click()"); await sleep(1000);
  for (let i = 0; i < 4; i++) {
    await js("doForge()"); await wait("!!document.getElementById('revealcv') || document.getElementById('banner').classList.contains('on')", 10000);
    if (await js("!!document.getElementById('revealcv')")) break;
    stop(); await sleep(2000); await js("renderWin()"); await sleep(800); start();
  }
  await sleep(2600);
  await js("document.querySelector('#wb [data-equip]') && document.querySelector('#wb [data-equip]').click()"); cap("wear it"); await sleep(2200);   // equip -> hero window
  await js("closeWin()"); await sleep(400);

  // 6. arena: pick two tokens
  await js("goTo('arena')"); cap("pick 5 tokens in the Arena fantasy league"); await walkDone(); await wait("!!document.querySelector('#tres [data-pick]:not([disabled])')", 10000); await sleep(1200);
  for (let i = 0; i < 2; i++) { await js("document.querySelector('#tres [data-pick]:not([disabled])').click()"); await sleep(1500); }
  await sleep(1200); await js("closeWin()"); await sleep(400);

  // 7. guild hall, then the share card
  await js("goTo('guild')"); cap("climb weekly seasons with your vibe/vibe guild"); await walkDone(); await sleep(2800); await js("closeWin()"); await sleep(300);
  await js("openWin('hero')"); cap("share your hero on X"); await sleep(1500);
  await js("document.querySelector('.cardimg').scrollIntoView({behavior:'smooth', block:'center'})"); await wait("document.querySelector('.cardimg').complete", 8000); await sleep(3000);
  await js("closeWin()"); await sleep(400);

  // 8. end on the street
  cap(null); await js("hero.tx = 300"); await sleep(2000); stop();
  await p.send("Page.stopScreencast");
  console.log("captured", frames.length, "frames,", clock.toFixed(1), "s");

  // resample to constant fps: each output frame shows the newest captured frame at that time
  const INTRO = 2.6, OUTRO = 3.6, plan = [], capAt = []; let j = 0;
  for (let k = 0; k < INTRO * FPS; k++) { plan.push(-1); capAt.push(null); }
  for (let k = 0; k * (1 / FPS) <= clock; k++) {
    const t = k / FPS; while (j + 1 < frames.length && frames[j + 1].t <= t) j++; plan.push(j);
    const c = caps.filter(x => x.t <= t + 0.05).pop(); capAt.push(c ? c.text : null);
  }
  for (let k = 0; k < OUTRO * FPS; k++) { plan.push(-2); capAt.push(null); }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/enc") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end('<!doctype html><title>enc</title><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Instrument+Sans:wght@500&display=block" rel="stylesheet">'); }
    if (u.pathname === "/plan") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ plan, capAt, w: W * DPR, h: H * DPR, fps: FPS })); }
    if (u.pathname.startsWith("/f/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(fs.readFileSync(frames[Number(u.pathname.slice(3))].file)); }
    if (u.pathname === "/out" && req.method === "POST") { const parts = []; req.on("data", c => parts.push(c)); req.on("end", () => { fs.writeFileSync(OUT, Buffer.concat(parts)); res.end("ok"); server.emit("done"); }); return; }
    res.writeHead(404); res.end();
  }).listen(9445);
  const e = await b.open("http://127.0.0.1:9445/enc");
  await sleep(800);
  const done = new Promise(r => server.once("done", r));
  const info = await e.eval(`(async () => {
    const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.mjs');
    const { plan, capAt, w, h, fps } = await (await fetch('/plan')).json();
    await document.fonts.load('40px "Press Start 2P"'); await document.fonts.load('36px "Instrument Sans"');
    const card = (g, k, kind) => {   // intro / outro title cards, with a little pulse
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(223,249,2,' + (0.05 + 0.05 * ((i * 7) % 3)) + ')'; g.fillRect((i * 331) % w, (i * 197) % h, 6, 6); }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const a = Math.min(1, k / 12); g.globalAlpha = a;
      g.fillStyle = '#3d4a00'; g.font = '110px "Press Start 2P"'; g.fillText('VIBERQUEST', w / 2 + 8, h / 2 - 90 + 8);
      g.fillStyle = '#dff902'; g.fillText('VIBERQUEST', w / 2, h / 2 - 90);
      g.fillStyle = '#f2f4f3'; g.font = '34px "Press Start 2P"';
      g.fillText(kind === 'intro' ? 'YOUR TRADES ARE YOUR QUESTS' : 'PLAY NOW AT VIBERQUEST.FUN', w / 2, h / 2 + 40);
      g.fillStyle = '#7d848a'; g.font = '36px "Instrument Sans"';
      g.fillText(kind === 'intro' ? 'a pixel RPG on vibe/vibe · Robinhood Chain testnet' : 'free to play · guide at viberquest.fun/guide · by @0xHaileyy', w / 2, h / 2 + 130);
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
