// renders brand.html in headless Chrome and writes the logo files
const fs = require("fs"), path = require("path");
const { launch } = require("../scripts/cdp");
(async () => {
  const b = await launch(9381), p = await b.open("about:blank"); await p.send("Page.enable");
  await p.send("Page.navigate", { url: "file:///" + path.resolve(__dirname, "brand.html").split(path.sep).join("/") });
  await new Promise(r => setTimeout(r, 2500));
  const o = await p.eval("build()");
  const png = (n, d) => fs.writeFileSync(path.join(__dirname, n), Buffer.from(d.split(",")[1], "base64"));
  png("viberquest-icon.png", o.icon); png("viberquest-icon-dark.png", o.icon_dark); png("viberquest-banner.png", o.banner); png("viberquest-wordmark.png", o.wordmark);
  fs.writeFileSync(path.join(__dirname, "viberquest-icon.svg"), o.svg);
  console.log("ok", Object.keys(o).join(", ")); b.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
