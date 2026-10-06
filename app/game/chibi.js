// Walking vibers: every wallet's profile viber (same skin, eyes, antenna as Viber.sprite) as a small 16x22 chibi with a
// 4-direction walk and an attack pose, drawn once into a canvas texture. Sheet: columns down, up, left, right;
// rows 0-3 walk frames, row 4 attack. Anims: <key>_walk_<dir>, <key>_idle_<dir>; attack frame = 16 + dir index.
(function (root) {
  const FW = 16, FH = 22, DIRS = ["down", "up", "left", "right"];
  const INK = "#0b0c0e", V = "#15171a", LIME = "#dff902", GOLD = "#ffd23f", ICE = "#8fe9ff", RED = "#ff4b4b", IRIS = "#6a63c8";
  const shade = (hex, f) => "#" + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("");

  function frame(look, dir, f) {
    const g = Array.from({ length: FH }, () => Array(FW).fill(null));
    const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < FW && y < FH) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); };
    const { skin, eyes, ant, ear, cls } = look, dk = shade(skin, 0.62), lt = shade(skin, 1.25);
    const atk = f === 4, step = atk ? 0 : f, bob = step === 1 || step === 3 ? 1 : 0, side = dir === "left" || dir === "right";
    const LEG = "#2a2e36", FOOT = "#1b1e24";
    // legs
    if (side) {
      const a = step === 1 ? 1 : step === 3 ? -1 : 0;
      rect(6 + a, 18, 2, 3, LEG); rect(8 - a, 18, 2, 3, shade(LEG, 0.8)); rect(6 + a + (dir === "right" ? 0 : -1), 20, 3, 1, FOOT);
    } else {
      const l = step === 1 ? 1 : 0, r = step === 3 ? 1 : 0;
      rect(5, 18, 2, 3 - r + l, LEG); rect(9, 18, 2, 3 - l + r, LEG); rect(4, 20 + l - r * 0, 3, 1, FOOT); rect(9, 20 + r, 3, 1, FOOT);
    }
    const y0 = bob;   // body + head bob down on steps
    // body + arms
    rect(4, 13 + y0, 8, 6, dk); rect(5, 13 + y0, 6, 1, skin);
    if (side) {
      const sw = atk ? 3 : step === 1 ? 1 : step === 3 ? -1 : 0, ax = dir === "right" ? 7 + sw : 7 - sw;
      rect(ax, 14 + y0, 2, 4, skin);
      if (dir === "right") rect(10, 15 + y0, 2, 2, LIME); else rect(4, 15 + y0, 2, 2, LIME);
    } else {
      const s = step === 1 ? 1 : step === 3 ? -1 : 0;
      rect(2, 14 + y0 + s, 2, 4, skin); rect(12, 14 + y0 - s, 2, 4, skin);
      if (dir === "down") rect(7, 15 + y0, 2, 2, LIME); else rect(6, 14 + y0, 4, 3, shade(dk, 0.8));
    }
    // head
    rect(2, 4 + y0, 12, 9, skin); rect(3, 3 + y0, 10, 1, skin); rect(3, 4 + y0, 10, 1, lt); rect(2, 5 + y0, 1, 3, lt); rect(3, 12 + y0, 10, 1, dk);
    if (ear) { rect(1, 7 + y0, 1, 3, dk); rect(14, 7 + y0, 1, 3, dk); }
    if (dir === "up") rect(4, 6 + y0, 8, 2, dk);
    else if (side) {
      const r = dir === "right";
      rect(r ? 7 : 2, 6 + y0, 7, 4, V);
      rect(r ? 11 : 3, 7 + y0, 2, eyes === 1 || eyes === 4 ? 1 : 2, LIME);
    } else {
      rect(3, 6 + y0, 10, 4, V);
      if (eyes === 0) { rect(5, 7 + y0, 2, 2, LIME); rect(9, 7 + y0, 2, 2, LIME); }
      else if (eyes === 1) rect(4, 8 + y0, 8, 1, LIME);
      else if (eyes === 2) { rect(5, 7 + y0, 2, 1, LIME); rect(9, 7 + y0, 2, 1, LIME); px(4, 8 + y0, LIME); px(11, 8 + y0, LIME); }
      else if (eyes === 3) { rect(4, 7 + y0, 3, 2, LIME); rect(9, 7 + y0, 3, 2, LIME); px(5, 7 + y0, V); px(10, 7 + y0, V); }
      else { rect(5, 8 + y0, 2, 1, LIME); rect(9, 8 + y0, 2, 1, LIME); rect(7, 8 + y0, 2, 1, shade(LIME, 0.5)); }
    }
    // antenna
    if (ant === 1) { rect(7, 1 + y0, 1, 2, INK); px(7, 0 + y0, LIME); }
    else if (ant === 2) { px(4, 2 + y0, INK); px(11, 2 + y0, INK); px(4, 1 + y0, LIME); px(11, 1 + y0, LIME); }
    else if (ant === 3) { rect(5, 2 + y0, 6, 1, dk); rect(7, 2 + y0, 2, 1, LIME); }
    // class gear
    if (cls === "Whale") { rect(4, 1 + y0, 8, 2, GOLD); px(4, 0 + y0, GOLD); px(7, 0 + y0, GOLD); px(11, 0 + y0, GOLD); }
    else if (cls === "Sniper" && dir !== "up") { const x = dir === "left" ? 2 : dir === "right" ? 11 : 9; rect(x, 6 + y0, 3, 3, RED); px(x + 1, 7 + y0, "#ffffff"); }
    else if (cls === "Diamond Hands" && dir === "down") { rect(7, 15 + y0, 2, 2, ICE); px(7, 17 + y0, ICE); }
    else if (cls === "Curve Surfer") { rect(1, 6 + y0, 2, 4, IRIS); rect(13, 6 + y0, 2, 4, IRIS); rect(3, 2 + y0, 10, 1, IRIS); }
    else if (cls === "Launcher" && dir !== "down") { const x = dir === "left" ? 11 : dir === "right" ? 2 : 6; rect(x, 11 + y0, 3, 6, "#f2f4f3"); px(x + 1, 10 + y0, "#ff6b57"); }
    else if (cls === "Fresh" || !cls) { px(8, 1 + y0, "#2f9e55"); px(9, 0 + y0, "#7cf29a"); }
    // sword on the attack pose
    if (atk) {
      if (dir === "right") { rect(12, 15, 4, 1, LIME); px(15, 14, "#ffffff"); }
      else if (dir === "left") { rect(0, 15, 4, 1, LIME); px(0, 14, "#ffffff"); }
      else if (dir === "down") { rect(12, 17, 1, 5, LIME); px(12, 21, "#ffffff"); }
      else { rect(3, 0, 1, 5, LIME); px(3, 0, "#ffffff"); }
    }
    // outline
    const out = g.map(r => r.slice());
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++)
      if (!g[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy] || [])[x + dx])) out[y][x] = INK;
    return out;
  }

  function look(wallet, cls) {
    const s = root.Viber ? root.Viber.sprite(wallet || "0x0", cls || "Fresh", 1) : { skin: LIME, eyes: 0, ant: 1, ear: false };
    return { skin: s.skin, eyes: s.eyes || 0, ant: s.ant || 0, ear: !!s.ear, cls };
  }

  // make (once) the texture + anims for a wallet and return its key
  function key(scene, wallet, cls) {
    const k = "v_" + String(wallet || "0x0").toLowerCase() + "_" + (cls || "");
    if (scene.textures.exists(k)) return k;
    const L = look(wallet, cls), c = document.createElement("canvas"); c.width = FW * 4; c.height = FH * 5;
    const ctx = c.getContext("2d");
    for (let row = 0; row < 5; row++) DIRS.forEach((d, i) => {
      const g = frame(L, d, row);
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const col = g[y][x]; if (col) { ctx.fillStyle = col; ctx.fillRect(i * FW + x, row * FH + y, 1, 1); } }
    });
    scene.textures.addSpriteSheet(k, c, { frameWidth: FW, frameHeight: FH });
    DIRS.forEach((d, i) => {
      scene.anims.create({ key: `${k}_walk_${d}`, frames: [0, 1, 2, 3].map(r => ({ key: k, frame: r * 4 + i })), frameRate: 8, repeat: -1 });
      scene.anims.create({ key: `${k}_idle_${d}`, frames: [{ key: k, frame: i }] });
    });
    return k;
  }
  root.Chibi = { key, FW, FH, DIRS };
  root.GV = "?v=5";   // art version: bump after tools/art/build.py so browsers fetch the new files
})(this);
