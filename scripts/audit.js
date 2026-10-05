// Opens every window and tab of the live game as a signed-in player and reports console errors, failed requests,
// error messages shown in windows and empty windows. Usage: node scripts/audit.js <cookie value>
const { launch } = require("./cdp");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await launch(9377), p = await b.open("about:blank"), problems = [];
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send("Runtime.enable"); await p.send("Network.enable"); await p.send("Page.enable"); await p.send("Log.enable");
  p.on("Runtime.exceptionThrown", e => problems.push("EXCEPTION " + (e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text).slice(0, 200)));
  p.on("Runtime.consoleAPICalled", e => { if (e.type === "error") problems.push("CONSOLE " + e.args.map(a => a.value || a.description || "").join(" ").slice(0, 200)); });
  p.on("Network.responseReceived", e => { const u = e.response.url; if (e.response.status >= 400 && !/favicon/.test(u)) problems.push(`HTTP ${e.response.status} ${u.replace("https://viberquest.fun", "")}`); });
  await p.send("Network.setCookie", { name: "vq", value: process.argv[2], domain: "viberquest.fun", path: "/", secure: true, httpOnly: true });
  await p.send("Page.navigate", { url: "https://viberquest.fun/" });
  await sleep(5000);
  await p.eval("tutEnd()");
  const steps = [
    ["quests daily", "questTab='daily'; openWin('quests')"], ["quests weekly", "questTab='weekly'; renderWin()"], ["quests story", "questTab='story'; renderWin()"], ["quests hard", "questTab='hard'; renderWin()"],
    ...["common", "rare", "epic", "legendary", "mythic"].map(r => ["forge " + r, `forgeSel.rarity='${r}'; openWin('forge')`]),
    ["hero", "openWin('hero')"], ["guild", "openWin('guild')"], ["arena", "openWin('arena')"], ["fame now", "fameTab='now'; openWin('fame')"], ["fame past", "fameTab='past'; openWin('fame')"],
    ["chest", "openWin('chest')"], ["furnace", "openWin('furnace')"], ["tailor", "openWin('tailor')"], ["billboard", "openWin('billboard')"], ["treasury", "openWin('treasury')"],
    ["player", "viewing = [...OTHERS.keys()][0] || NPCS[0] && NPCS[0].wallet; viewing ? openWin('player') : 'none'"],
    ["arena search", "openWin('arena'); setTimeout(()=>{const i=document.getElementById('tq'); if(i){i.value='stan'; i.dispatchEvent(new Event('input',{bubbles:true}))}},1500)"],
    ["emote", "emote('gm')"], ["walk", "routeTo(hero, 600, 380)"], ["goTo forge", "closeWin(); goTo('forge')"],
  ];
  for (const [name, js] of steps) {
    await p.eval(js).catch(e => problems.push(`STEP ${name}: ${e.message.slice(0, 160)}`));
    await sleep(name === "goTo forge" ? 5000 : 2200);
    const st = await p.eval(`({ open: !!current, title: (document.getElementById('wt')||{}).textContent || '', len: (document.getElementById('wb')||{}).innerText ? document.getElementById('wb').innerText.length : 0,
      bad: [...document.querySelectorAll('#wb .empty')].map(e => e.textContent).filter(t => /could not|wrong|error/i.test(t)), toast: document.getElementById('toast').classList.contains('on') ? document.getElementById('toast').textContent : '' })`);
    const note = name === "goTo forge" ? (st.open && /FORGE/.test(st.title) ? "walked and opened" : "DID NOT OPEN") : `${st.title.slice(0, 40)} | ${st.len} chars`;
    console.log(name.padEnd(16), note, st.bad.length ? "BAD: " + st.bad.join(" / ") : "", st.toast ? "toast: " + st.toast : "");
    if (st.bad.length) problems.push(`WINDOW ${name}: ${st.bad.join(" / ")}`);
    if (st.open && st.len < 20 && name !== "emote" && name !== "walk") problems.push(`WINDOW ${name}: nearly empty`);
  }
  for (const u of ["/guide", "/h/0x19298c37fdcbeb0a7619e9d1cf6058d932ee74fc", "/hcard/0x19298c37fdcbeb0a7619e9d1cf6058d932ee74fc.png", "/api/leaderboard", "/api/guild", "/api/seasons", "/api/tokens?q=", "/api/treasury", "/api/sponsor", "/api/fantasy"]) {
    const r = await fetch("https://viberquest.fun" + u); console.log("GET", u.padEnd(60), r.status); if (r.status >= 400) problems.push(`GET ${u} ${r.status}`);
  }
  console.log("\nPROBLEMS:", problems.length ? "\n" + [...new Set(problems)].join("\n") : "none");
  b.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
