// Pixel viber generator: wallet address + class + level -> 32x32 sprite. Same output in the browser (SVG) and on the server (canvas).
(function (root) {
  const N = 32;
  const SKINS = ["#dff902", "#8b84ff", "#ff6b57", "#3ee6d0", "#ff7ad9", "#ffb13b", "#b7bdc0", "#7cf29a"];
  const INK = "#0b0c0e", VISOR = "#15171a", GLOW = "#dff902", WHITE = "#f2f4f3", GOLD = "#ffd23f", ICE = "#8fe9ff";
  const TIERS = [[0, "#3a3f45"], [10, "#6a63c8"], [25, "#dff902"], [50, "#ffd23f"]];

  function rng(addr) { // xorshift seeded from the address
    let h = 2166136261 >>> 0;
    for (const c of String(addr).toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  }
  const shade = (hex, f) => "#" + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("");

  function sprite(addr, cls, level) {
    const r = rng(addr), g = Array.from({ length: N }, () => Array(N).fill(null));
    const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); };
    const skin = SKINS[Math.floor(r() * SKINS.length)], dark = shade(skin, 0.62), lite = shade(skin, 1.25);
    const eyes = Math.floor(r() * 5), ant = Math.floor(r() * 4), mouth = Math.floor(r() * 3), ear = r() < 0.5;
    const tier = TIERS.filter(t => level >= t[0]).pop()[1];

    // shoulders
    rect(7, 27, 18, 5, dark); rect(9, 26, 14, 1, dark); rect(8, 27, 16, 1, skin);
    // neck
    rect(13, 24, 6, 3, INK);
    // head: rounded block 20x17
    rect(7, 8, 18, 17, skin); rect(6, 10, 1, 13, skin); rect(25, 10, 1, 13, skin);
    rect(8, 7, 16, 1, skin); rect(8, 8, 16, 1, lite); rect(7, 9, 1, 3, lite);
    rect(8, 24, 16, 1, dark); rect(25, 12, 1, 11, dark);
    // outline
    const edge = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = (g[y + dy] || [])[x + dx]; return c && c !== INK; })) edge.push([x, y]);
    for (const [x, y] of edge) g[y][x] = INK;
    // ears / side bolts
    if (ear) { rect(4, 14, 2, 5, dark); rect(26, 14, 2, 5, dark); px(4, 14, INK); px(27, 14, INK); }
    // visor
    rect(8, 12, 16, 7, VISOR); rect(9, 11, 14, 1, VISOR); rect(9, 19, 14, 1, VISOR);
    const E = GLOW;
    if (eyes === 0) { rect(11, 14, 2, 3, E); rect(19, 14, 2, 3, E); }
    else if (eyes === 1) { rect(10, 15, 12, 2, E); px(10, 14, VISOR); }
    else if (eyes === 2) { rect(11, 15, 3, 1, E); px(12, 14, E); rect(18, 15, 3, 1, E); px(19, 14, E); } // happy ^^
    else if (eyes === 3) { rect(10, 14, 4, 3, E); rect(18, 14, 4, 3, E); px(11, 15, VISOR); px(19, 15, VISOR); } // goggles
    else { rect(10, 15, 2, 2, E); rect(20, 15, 2, 2, E); rect(13, 16, 6, 1, shade(E, 0.5)); } // scanner
    px(22, 12, "#ffffff55");
    // mouth grill
    if (mouth === 0) for (let i = 0; i < 4; i++) px(13 + i * 2, 21, INK);
    else if (mouth === 1) rect(13, 21, 6, 1, INK);
    else { rect(14, 21, 4, 1, INK); px(13, 20, INK); px(18, 20, INK); }
    // antenna
    if (ant === 1) { rect(16, 3, 1, 4, INK); rect(15, 1, 3, 2, GLOW); }
    else if (ant === 2) { rect(10, 4, 1, 3, INK); rect(21, 4, 1, 3, INK); px(10, 3, GLOW); px(21, 3, GLOW); }
    else if (ant === 3) { rect(13, 5, 6, 2, dark); rect(12, 4, 8, 1, INK); rect(15, 6, 2, 1, GLOW); }

    // class gear
    if (cls === "Sniper") { // scope monocle on the right eye + crosshair
      rect(17, 12, 7, 7, INK); rect(18, 13, 5, 5, "#2a0f10"); rect(20, 13, 1, 5, "#ff4b4b"); rect(18, 15, 5, 1, "#ff4b4b"); px(20, 15, WHITE);
      rect(24, 15, 3, 1, INK);
    } else if (cls === "Launcher") { // rocket on the shoulder
      rect(26, 19, 3, 7, WHITE); px(27, 18, WHITE); px(27, 17, "#ff6b57"); rect(26, 22, 3, 1, "#6a63c8"); px(25, 25, "#ff6b57"); px(29, 25, "#ff6b57");
      px(27, 26, GOLD); px(27, 27, "#ff6b57");
    } else if (cls === "Diamond Hands") { // diamond on the chest
      rect(14, 28, 4, 1, ICE); rect(13, 29, 6, 1, ICE); rect(14, 30, 4, 1, shade(ICE, 0.7)); rect(15, 31, 2, 1, shade(ICE, 0.7)); px(14, 28, WHITE);
    } else if (cls === "Flipper") { // coin mid-flip above the head
      rect(24, 2, 4, 5, GOLD); px(24, 2, null); px(27, 2, null); px(24, 6, null); px(27, 6, null); rect(25, 3, 1, 3, shade(GOLD, 0.7));
      px(22, 7, WHITE); px(29, 4, WHITE);
    } else if (cls === "Whale") { // gold chain + crown
      for (let i = 9; i < 23; i += 2) px(i, 27, GOLD); rect(15, 28, 2, 2, GOLD);
      rect(11, 4, 10, 3, GOLD); px(11, 3, GOLD); px(15, 2, GOLD); px(16, 2, GOLD); px(20, 3, GOLD); px(13, 5, "#ff6b57"); px(18, 5, "#3ee6d0");
    } else if (cls === "Curve Surfer") { // headphones + wave
      rect(4, 12, 3, 8, "#6a63c8"); rect(25, 12, 3, 8, "#6a63c8"); rect(6, 6, 20, 2, "#6a63c8"); rect(5, 8, 2, 4, "#6a63c8"); rect(25, 8, 2, 4, "#6a63c8");
      rect(10, 29, 3, 1, "#3ee6d0"); rect(13, 28, 3, 1, "#3ee6d0"); rect(16, 29, 3, 1, "#3ee6d0"); rect(19, 28, 3, 1, "#3ee6d0");
    } else { // Fresh: a little sprout on top
      rect(16, 3, 1, 4, "#2f9e55"); rect(14, 2, 2, 2, "#7cf29a"); rect(17, 3, 2, 2, "#7cf29a");
    }
    return { grid: g, tier, skin };
  }

  function svg(addr, cls, level, size) {
    const { grid, tier } = sprite(addr, cls, level); let out = "";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let c = grid[y][x]; if (!c) continue; let op = "";
      if (c.length === 9) { op = ` fill-opacity="${(parseInt(c.slice(7), 16) / 255).toFixed(2)}"`; c = c.slice(0, 7); }
      out += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"${op}/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${size || 256}" height="${size || 256}" shape-rendering="crispEdges" data-tier="${tier}">${out}</svg>`;
  }

  function draw(ctx, addr, cls, level, x0, y0, scale) {
    const { grid } = sprite(addr, cls, level);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = grid[y][x]; if (!c) continue;
      ctx.fillStyle = c; ctx.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
    }
  }

  // tiny 32x32 PNG data URL (browser only), shown scaled with image-rendering: pixelated; far lighter than 1000 SVG rects
  const urls = new Map();
  function url(addr, cls, level) {
    const key = addr + "|" + cls + "|" + level;
    if (!urls.has(key)) {
      const c = document.createElement("canvas"); c.width = c.height = N;
      draw(c.getContext("2d"), addr, cls, level, 0, 0, 1);
      urls.set(key, c.toDataURL("image/png"));
    }
    return urls.get(key);
  }

  const api = { sprite, svg, draw, url, TIERS };
  if (typeof module !== "undefined") module.exports = api; else root.Viber = api;
})(this);
