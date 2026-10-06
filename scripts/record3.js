// Records a short clip of pairing without a wallet connection (demo wallet; the match is flagged on the server) in headless Chrome and encodes it to MP4 (H.264) inside Chrome.
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
  const remote = w => execFileSync("ssh", ["bureau", `sudo -u postgres psql -d bureau -qAt -c "update vq_pairs set matched_tx = 'demo' where wallet = '${w}' and matched_tx is null"`], { encoding: "utf8" });
  await p.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });

  // short clip: pairing without a wallet connection
  const W8 = demo.wallet;
  await p.send("Page.navigate", { url: SITE + "/" });
  await wait("document.fonts.status === 'loaded' && !document.getElementById('welcome').hidden");
  await js("localStorage.setItem('vq_tut','1'); localStorage.setItem('vq_snd','0'); localStorage.removeItem('vq_pair'); localStorage.removeItem('vq_watch')");
  await sleep(1000); start(); cap("no wallet connection needed"); await sleep(2600);
  await js("document.getElementById('pairbtn').click()"); await wait("!!document.getElementById('pairq')", 5000); await sleep(900);
  cap("type your address");
  await js("document.getElementById('pairq').focus()");
  for (const ch of W8) { await p.send("Input.insertText", { text: ch }); await sleep(28); }
  await sleep(700);
  await js("document.querySelector('#pairf button').click()"); await wait("!!document.getElementById('paircode')", 8000);
  cap("send yourself this tiny amount"); await sleep(4200);
  cap("the game sees it on chain"); await sleep(1500);
  remote(W8);
  await wait("document.getElementById('banner').classList.contains('on')", 12000);
  cap("you're in. nothing signed, nothing approved"); await sleep(3200);
  await js("hero.x = hero.tx = 300; hero.y = hero.ty = 330; hero.path = []"); await sleep(1600);
  cap(null); stop();
  await p.send("Page.stopScreencast");
  console.log("captured", frames.length, "frames,", clock.toFixed(1), "s");

  // resample to constant fps: each output frame shows the newest captured frame at that time
  const INTRO = 2.2, OUTRO = 3.2, plan = [], capAt = []; let j = 0;
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
  }).listen(9445);
  const e = await b.open("http://127.0.0.1:9445/enc");
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
      g.fillText(kind === 'intro' ? 'PLAY WITHOUT CONNECTING' : 'PLAY NOW AT VIBERQUEST.FUN', w / 2, h / 2 + 170);
      g.fillStyle = '#7d848a'; g.font = '36px "Instrument Sans"';
      g.fillText(kind === 'intro' ? 'a pixel RPG on vibe/vibe · Robinhood Chain testnet' : 'free to play · guide at viberquest.fun/guide · by @0xHaileyy', w / 2, h / 2 + 250);
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
