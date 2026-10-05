// Minimal Chrome DevTools Protocol client (Node 24: global WebSocket + fetch).
const { spawn } = require("child_process");
const path = require("path"), os = require("os"), fs = require("fs");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";   // set CHROME on macOS/Linux
async function launch(port = 9333) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vqrec-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + dir,
    "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--window-size=1280,720", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch("http://127.0.0.1:" + port + "/json/version"); break; } catch (_) { await new Promise((r) => setTimeout(r, 200)); } }
  const open = async (url) => {
    const t = await (await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(url), { method: "PUT" })).json();
    return connect(t.webSocketDebuggerUrl);
  };
  return { proc, open, close: () => { try { proc.kill(); } catch (_) {} } };
}
function connect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url); let id = 0; const wait = new Map(), handlers = new Map();
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.id && wait.has(j.id)) { const { res, rej } = wait.get(j.id); wait.delete(j.id); j.error ? rej(new Error(j.error.message)) : res(j.result); }
      else if (j.method && handlers.has(j.method)) handlers.get(j.method)(j.params);
    };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const on = (method, fn) => handlers.set(method, fn);
    const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
    ws.onopen = () => resolve({ send, on, eval: evalJs, close: () => ws.close() });
  });
}
module.exports = { launch };
