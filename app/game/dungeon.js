/* ================= the dungeon (Phaser, Viberquest's own art from tools/art/build.py) ================= */
// Below the town gate. The server owns every number that matters (monster HP, damage, loot, $VQUEST, caps); this scene
// draws the floor from the run's seed, moves things around and reports sword swings and hits taken.
// Loaded after the main page script, so it shares its globals: GAME, ME, api, openWin, current, sfx, toast, banner...
const MON_SIZE = {"RugSlime":[20,16],"FudBat":[24,16],"Jeet":[22,20],"PaperHands":[18,20],"BearBot":[18,20],"GasGhost":[22,20],"Rugpuller":[20,22],"Dumpster":[22,22],"TheRugger":[56,48],"BearKing":[48,48],"GasGolem":[48,48],"TheWhale":[56,44]};   // frame sizes, 4 frames per sheet
const MON_SPEED = { FudBat: 50, GasGhost: 40, PaperHands: 44, RugSlime: 26, Dumpster: 22, Jeet: 36 };
const PROPS = [3, 4, 5, 6, 7];   // props.png frames: bones, barrel, crate, urn, skull candle
const LIGHTS = { 0: 0xdff902, 2: 0x3ee6d0 };   // light sources along the walls: brazier, crystal
const MAT_C = { copper: "#e08a4f", silver: "#cfd6de", gold: "#ffd23f", diamond: "#7fe7ff" };
let DLOBBY = null, DSUM = null, DPOTS = 0;

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// rooms + 3-wide corridors from the run seed; same seed, same floor (so a reload puts things back where they were)
function genFloor(run) {
  const R = mulberry(run.seed), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), pick = a => a[Math.floor(R() * a.length)];
  const W = 48, H = 36, g = Array.from({ length: H }, () => new Uint8Array(W)), rooms = [];
  const set = (x, y) => { if (x >= 1 && x < W - 1 && y >= 3 && y < H - 1) g[y][x] = 1; };
  if (run.boss) rooms.push({ x: 19, y: 26, w: 10, h: 6 }, { x: 10, y: 4, w: 28, h: 15 });
  else {
    const n = ri(6, 8);
    for (let tries = 0; rooms.length < n && tries < 500; tries++) {
      const w = ri(6, 11), h = ri(5, 8), x = ri(2, W - w - 2), y = ri(4, H - h - 2);
      if (!rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) rooms.push({ x, y, w, h });
    }
  }
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y);
  const cx = r => r.x + (r.w >> 1), cy = r => r.y + (r.h >> 1);
  const hline = (x1, x2, y) => { for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let d = -1; d <= 1; d++) set(x, y + d); };
  const vline = (y1, y2, x) => { for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let d = -1; d <= 1; d++) set(x + d, y); };
  const done = [rooms[0]], todo = rooms.slice(1);
  while (todo.length) {   // join every room to its nearest already-joined room
    let best = null;
    for (const a of todo) for (const b of done) { const d = Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b)); if (!best || d < best.d) best = { a, b, d }; }
    const { a, b } = best;
    if (R() < 0.5) { hline(cx(a), cx(b), cy(a)); vline(cy(a), cy(b), cx(b)); } else { vline(cy(a), cy(b), cx(a)); hline(cx(a), cx(b), cy(b)); }
    done.push(a); todo.splice(todo.indexOf(a), 1);
  }
  const start = rooms[0], fight = rooms.slice(1), px = (x, y) => ({ x: x * 16 + 8, y: y * 16 + 14 });
  const far = fight.reduce((m, r) => (Math.hypot(cx(r) - cx(start), cy(r) - cy(start)) > Math.hypot(cx(m) - cx(start), cy(m) - cy(start)) ? r : m), fight[0]);
  const used = new Set(), cell = (r, top) => {
    for (let i = 0; i < 40; i++) {
      const x = ri(r.x + 1, r.x + r.w - 2), y = top ? r.y : ri(r.y + 1, r.y + r.h - 2), k = x + "," + y;
      if (!used.has(k)) { used.add(k); return [x, y]; }
    }
    return [cx(r), cy(r)];
  };
  used.add(cx(start) + "," + cy(start));
  const stairs = run.boss ? [cx(far), far.y + 1] : [cx(far), cy(far)]; used.add(stairs.join(","));
  const exit = [start.x + 1, start.y]; used.add(exit.join(","));
  const mobs = {}, chests = {}, props = [], orbs = [];
  for (const id of Object.keys(run.mobs).sort()) {
    const m = run.mobs[id];
    mobs[id] = m.boss ? px(cx(far), cy(far) + 2) : px(...cell(pick(fight)));
  }
  for (const id of Object.keys(run.chests).sort()) chests[id] = px(...cell(pick(fight), true));
  for (const r of rooms) {
    for (let i = ri(1, 3); i > 0; i--) { const [x, y] = cell(r, true); props.push({ ...px(x, y), f: pick(PROPS) }); }
    const [ox, oy] = cell(r, true); orbs.push({ ...px(ox, oy), f: R() < 0.7 ? 0 : 2 });
  }
  return { W, H, g, rooms, spawn: px(cx(start), cy(start)), stairs: px(...stairs), exit: px(...exit), mobs, chests, props, orbs };
}

class DungeonScene extends Phaser.Scene {
  constructor() { super("dungeon"); }
  init(d) {   // the same scene object is reused floor after floor, so reset everything here
    this.run = d.run; this.over = false; this.busy = false; this.bites = new Set(); this.hurting = false;
    this.openedOnce = false; this.kb = null; this.attacking = 0; this.press = null; this.inv = 0; this.lastFlush = 0;
  }
  preload() {
    const G = "/game/", L = this.load, T = this.textures, A = this.cache.audio;
    if (!T.exists("t_dng")) L.image("t_dng", G + "dng/tiles.png" + GV);
    if (!T.exists("props")) L.spritesheet("props", G + "dng/props.png" + GV, { frameWidth: 16, frameHeight: 16 });
    if (!T.exists("coin")) L.spritesheet("coin", G + "items/coin.png" + GV, { frameWidth: 8, frameHeight: 8 });
    if (!T.exists("potion")) L.image("potion", G + "items/potion.png" + GV);
    if (!T.exists("fx_slash")) L.spritesheet("fx_slash", G + "fx/slash.png" + GV, { frameWidth: 32, frameHeight: 32 });
    for (const m of Object.values(this.run.mobs)) {
      const z = MON_SIZE[m.type];
      if (z && !T.exists("mon_" + m.type)) L.spritesheet("mon_" + m.type, `${G}mons/${m.type}.png${GV}`, { frameWidth: z[0], frameHeight: z[1] });
    }
    for (const s of ["slash", "slash2", "hit", "hit2", "coin", "bonus", "levelup", "secret", "gameover", "accept"]) if (!A.exists("s_" + s)) L.audio("s_" + s, `${G}sfx/${s}.wav${GV}`);
    for (const m of ["cave", "fight"]) if (!A.exists("m_" + m)) L.audio("m_" + m, `${G}music/${m}.mp3${GV}`);
  }
  create() {
    const run = this.run, F = this.F = genFloor(run), MW = F.W * 16, MH = F.H * 16;
    SCENE = null; $("world").classList.add("indungeon"); $("dhud").hidden = false;
    this.cameras.main.setBackgroundColor("#0b0910");
    // tiles: cave floor, a two-high rock face on every wall that has floor below it, an invisible collision layer
    const map = this.make.tilemap({ tileWidth: 16, tileHeight: 16, width: F.W, height: F.H });
    const ts = map.addTilesetImage("dng", "t_dng", 16, 16, 0, 0, 0);
    const fl = map.createBlankLayer("f", ts).setDepth(-20), wl = map.createBlankLayer("w", ts).setDepth(-19), cl = map.createBlankLayer("c", ts).setVisible(false);
    const G = (x, y) => (y >= 0 && y < F.H && x >= 0 && x < F.W ? F.g[y][x] : 0);
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
      if (G(x, y)) { const h = ((x * 73856093) ^ (y * 19349663)) >>> 0; fl.putTileAt(h % 13 === 0 ? 4 + (h >>> 5) % 4 : (h >>> 3) % 4, x, y); continue; }
      cl.putTileAt(0, x, y);
      const face = (xx, yy) => !G(xx, yy) && G(xx, yy + 1), face2 = (xx, yy) => !G(xx, yy) && !G(xx, yy + 1) && G(xx, yy + 2);
      const h = ((x * 2654435761) ^ (y * 40503)) >>> 0;
      if (face(x, y)) wl.putTileAt(face(x - 1, y) ? (face(x + 1, y) ? (h % 17 === 0 ? 14 + (h >>> 6) % 2 : 9) : 10) : 8, x, y);
      else if (face2(x, y)) wl.putTileAt(face2(x - 1, y) ? (face2(x + 1, y) ? 12 : 13) : 11, x, y);
    }
    cl.setCollision(0);
    this.physics.world.setBounds(0, 0, MW, MH);
    const mk = (k, cfg) => { if (!this.anims.exists(k)) this.anims.create({ key: k, ...cfg }); };   // anims are global, made once
    for (const p of F.props) this.add.image(p.x, p.y, "props", p.f).setOrigin(0.5, 1).setDepth(p.y);
    mk("brazier", { frames: this.anims.generateFrameNumbers("props", { frames: [0, 1] }), frameRate: 5, repeat: -1 });
    this.orbs = F.orbs.map(o => {
      const s = this.add.sprite(o.x, o.y, "props", o.f).setOrigin(0.5, 1).setDepth(o.y); if (o.f === 0) s.play({ key: "brazier", startFrame: Phaser.Math.Between(0, 1) });
      return { ...o, glow: this.add.circle(o.x, o.y - 9, 8, LIGHTS[o.f], 0.22).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.y + 1) };
    });
    this.add.image(F.exit.x, F.exit.y - 6, "props", 9).setDepth(-5);
    this.stairs = this.add.image(F.stairs.x, F.stairs.y - 6, "props", 8).setDepth(-5);
    this.chests = Object.entries(F.chests).map(([id, p]) => ({ id, ...p, open: run.chests[id].opened, s: this.add.sprite(p.x, p.y + 2, "props", run.chests[id].opened ? 11 : 10).setOrigin(0.5, 1).setDepth(p.y) }));
    mk("slash", { frames: this.anims.generateFrameNumbers("fx_slash", { start: 0, end: 3 }), frameRate: 22, hideOnComplete: true });
    mk("coin_spin", { frames: this.anims.generateFrameNumbers("coin", { start: 0, end: 3 }), frameRate: 12, repeat: -1 });
    // the hero
    const look = lookOf(this, ME.wallet, ME.cls);
    this.look = look; this.dir = "down";
    this.me = this.physics.add.sprite(F.spawn.x, F.spawn.y, look, 0).setOrigin(0.5, 1);
    this.me.body.setSize(10, 6).setOffset(3, 16);
    this.physics.add.collider(this.me, cl);
    this.hp = run.hp; this.maxHp = run.max_hp; this.bag = run.bag; this.inv = 0; this.nextSwing = 0;
    // monsters
    this.mobs = [];
    for (const [id, m] of Object.entries(run.mobs)) {
      if (m.hp <= 0) continue;
      const p = F.mobs[id], z = MON_SIZE[m.type] || [16, 16];
      mk(m.type + "_move", { frames: this.anims.generateFrameNumbers("mon_" + m.type, { start: 0, end: 3 }), frameRate: m.boss ? 5 : 7, repeat: -1 });
      const s = this.physics.add.sprite(p.x, p.y, "mon_" + m.type, 0).setOrigin(0.5, 1).play({ key: m.type + "_move", startFrame: Phaser.Math.Between(0, 3) });
      s.body.setSize(z[0] * 0.6, Math.max(6, z[1] * 0.3)).setOffset(z[0] * 0.2, z[1] * 0.68);
      this.physics.add.collider(s, cl);
      this.mobs.push({ id, ...m, s, boss: !!m.boss, r: m.boss ? z[0] * 0.32 : 8, speed: m.boss ? 26 : (MON_SPEED[m.type] || 34) * (1 + Math.min(0.5, run.floor * 0.02)), bite: 0, stun: 0, wander: 0, dash: 0, dir: "down" });
    }
    this.total = Object.keys(run.mobs).length;
    this.bars = this.add.graphics().setDepth(9400);
    // darkness with a torch around the hero and the orbs
    if (!this.textures.exists("light")) {
      const c = this.textures.createCanvas("light", 256, 256), x = c.getContext(), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.45, "rgba(255,255,255,.85)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 256, 256); c.refresh();
    }
    this.dark = this.add.renderTexture(0, 0, MW, MH).setOrigin(0, 0).setDepth(9000);
    this.lamp = this.make.image({ key: "light", add: false });
    // camera + input
    this.cameras.main.setBounds(0, 0, MW, MH).startFollow(this.me, true, 0.14, 0.14).setRoundPixels(true);
    this.fitZoom(); this.scale.on("resize", this.fitZoom, this);
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,ENTER,SPACE,J,Q");
    this.input.keyboard.enableGlobalCapture();
    this.input.on("pointerdown", p => { if (!current) this.press = { t: this.time.now, p }; });
    this.input.on("pointerup", p => {
      const pr = this.press; this.press = null;
      if (pr && !current && this.time.now - pr.t < 220) { this.faceTo(p.worldX, p.worldY); this.swing(); }
    });
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.fitZoom, this); this.input.keyboard.disableGlobalCapture();
      $("dhud").hidden = true;
    });
    try { if (SND.on) this.sound.play(run.boss ? "m_fight" : "m_cave", { loop: true, volume: 0.28 }); } catch (_) { }
    this.cameras.main.fadeIn(350, 0, 0, 0);
    banner(run.boss ? `FLOOR ${run.floor} · BOSS` : `FLOOR ${run.floor}`, run.boss ? "the stairs open when it falls" : `${this.total} monsters, ${this.chests.length} chest${this.chests.length > 1 ? "s" : ""}`);
    this.dhud();
  }
  fitZoom() { this.cameras.main.setZoom(Math.max(2, Math.round(this.scale.height / 190))); }
  faceTo(x, y) { const dx = x - this.me.x, dy = y - (this.me.y - 8); this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"); }
  alive() { return this.mobs.filter(m => !m.dead); }
  stairsOpen() {
    const down = this.total - this.alive().length;
    return this.run.boss ? !this.mobs.some(m => m.boss && !m.dead) : down >= Math.ceil(this.total * 0.7);
  }
  float(x, y, text, color, big) {
    const t = this.add.text(x, y, text, { fontFamily: "monospace", fontSize: big ? "10px" : "8px", fontStyle: "bold", color, stroke: "#000", strokeThickness: 3, resolution: 4 }).setOrigin(0.5).setDepth(9600);
    this.tweens.add({ targets: t, y: y - (big ? 26 : 16), alpha: { from: 1, to: 0 }, delay: big ? 500 : 150, duration: big ? 1600 : 900, onComplete: () => t.destroy() });
  }
  sfx(k, v = 0.5) { try { if (SND.on) this.sound.play("s_" + k, { volume: v }); } catch (_) { } }
  // ---- fighting
  swing() {
    if (this.over || this.time.now < this.nextSwing) return;
    this.nextSwing = this.time.now + 340;
    const me = this.me, v = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.dir], hx = me.x + v[0] * 13, hy = me.y - 7 + v[1] * 12;
    me.anims.stop(); me.setFrame(16 + DIRS.indexOf(this.dir)); this.attacking = this.time.now + 200;
    const fx = this.add.sprite(hx, hy - 2, "fx_slash").setDepth(9300).setAngle({ right: 0, down: 90, left: 180, up: -90 }[this.dir]).play("slash");
    fx.once("animationcomplete", () => fx.destroy());
    this.sfx(Math.random() < 0.5 ? "slash" : "slash2", 0.35);
    const hit = this.alive().filter(m => Math.hypot(m.s.x - hx, m.s.y - 8 - hy) < 15 + m.r || Math.hypot(m.s.x - me.x, m.s.y - me.y) < 10 + m.r * 0.5).slice(0, 4);
    if (!hit.length) return;
    for (const m of hit) {   // feel it right away, the server decides the numbers
      m.s.setTintFill(0xffffff); this.time.delayedCall(70, () => m.s.active && m.s.clearTint());
      if (!m.boss) { m.stun = this.time.now + 160; const a = Math.atan2(m.s.y - me.y, m.s.x - me.x); m.s.setVelocity(Math.cos(a) * 140, Math.sin(a) * 140); }
    }
    this.sfx("hit", 0.4);
    api("run/swing", { run: this.run.id, mobs: hit.map(m => m.id) }).then(r => this.onSwing(r)).catch(() => { });
  }
  onSwing(r) {
    if (!r || this.over) return;
    if (r.error === "no_run") return this.lost();
    if (!r.ok) return;
    this.bag = r.bag;
    for (const h of r.hits) {
      const m = this.mobs.find(x => x.id === h.id); if (!m || m.dead) continue;
      m.hp = h.hp;
      this.float(m.s.x + (Math.random() * 8 - 4), m.s.y - (m.boss ? 40 : 18), (h.crit ? "CRIT " : "") + h.dmg, h.crit ? "#ffd23f" : "#ffffff");
      if (m.boss && h.hp > 0) { m.s.setScale(1.06); this.time.delayedCall(90, () => m.s.active && m.s.setScale(1)); }
      if (h.hp <= 0) this.kill(m, h.drop);
    }
    if (typeof r.hp === "number") this.hp = r.hp;
    if (r.took) {   // monsters you fight hit back (the server rolls it)
      this.me.setTint(0xff5050); this.time.delayedCall(140, () => this.me.active && this.me.clearTint());
      this.cameras.main.shake(80, 0.003); this.sfx("hit2", 0.4); this.float(this.me.x, this.me.y - 24, "-" + r.took, "#ff6b6b");
    }
    if (r.dead) return this.end(true, r.banked);
    this.dhud();
  }
  kill(m, d) {
    m.dead = true; m.s.body.enable = false;
    for (let i = 0; i < 8; i++) {
      const p = this.add.circle(m.s.x, m.s.y - 8, Phaser.Math.Between(1, 3), 0xe8e2d0, 0.9).setDepth(9200), a = Math.random() * Math.PI * 2;
      this.tweens.add({ targets: p, x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 12, alpha: 0, duration: 420, onComplete: () => p.destroy() });
    }
    const ring = this.add.circle(m.s.x, m.s.y - 8, m.boss ? 14 : 6, 0xdff902, 0).setStrokeStyle(2, 0xdff902, 0.9).setDepth(9200);
    this.tweens.add({ targets: ring, scale: m.boss ? 4 : 2.6, alpha: 0, duration: m.boss ? 700 : 320, onComplete: () => ring.destroy() });
    m.s.setTintFill(0xffffff);
    this.tweens.add({ targets: m.s, scaleX: m.boss ? 1.5 : 1.4, scaleY: 0.2, alpha: 0, y: m.s.y + 2, duration: m.boss ? 900 : 240, ease: "Back.easeIn", onComplete: () => m.s.destroy() });
    if (m.boss) { this.cameras.main.shake(500, 0.01); this.cameras.main.flash(300, 255, 240, 200); this.sfx("levelup", 0.6); banner("BOSS DOWN", "the stairs are open"); }
    else this.sfx("hit2", 0.35);
    if (d) this.drop(m.s.x, m.s.y - (m.boss ? 30 : 12), d);
    if (this.stairsOpen() && !this.openedOnce) { this.openedOnce = true; if (!m.boss) toast("the stairs down are open"); this.stairsGlow(); }
  }
  drop(x, y, d) {
    let dy = 0;
    if (d.gold) {
      for (let i = 0; i < Math.min(6, 1 + (d.gold >> 3)); i++) {
        const c = this.add.sprite(x, y, "coin").setDepth(9500).play("coin_spin");
        this.tweens.add({ targets: c, x: x + Phaser.Math.Between(-14, 14), y: y - Phaser.Math.Between(6, 16), duration: 220, yoyo: false,
          onComplete: () => this.tweens.add({ targets: c, x: () => this.me.x, y: () => this.me.y - 10, duration: 380, delay: 120 + i * 40, onComplete: () => c.destroy() }) });
      }
      this.float(x, y - dy, "+" + d.gold + " gold", "#ffd23f"); dy += 9; this.sfx("coin", 0.35);
    }
    for (const [k, n] of Object.entries(d.mat || {})) { this.float(x, y - dy, `+${n} ${k}`, MAT_C[k] || "#fff"); dy += 9; }
    if (d.potion) { this.float(x, y - dy, "+1 potion", "#ff8fb1"); dy += 9; }
    if (d.vquest > 0) {
      this.float(x, y - dy - 6, `+${fmt(d.vquest)} $VQUEST`, "#dff902", true);
      this.sfx("bonus", 0.6); this.cameras.main.flash(180, 223, 249, 2);
      banner(`+${fmt(d.vquest)} $VQUEST`, "it's in your bag already, even if you fall"); dy += 14;
    }
    if (d.gear) {
      const col = (Items.RARITY[d.gear.rarity] || {}).color || "#ffffff";
      this.float(x, y - dy - 6, `${d.gear.rarity.toUpperCase()} ${d.gear.name.toUpperCase()}`, col, true);
      this.sfx("secret", 0.6); this.cameras.main.flash(200, 178, 107, 255);
      setTimeout(() => banner("NEW GEAR", `${d.gear.rarity} ${d.gear.name}, power ${d.gear.power}. it's in your inventory already`), d.vquest > 0 ? 1800 : 0);
    }
  }
  stairsGlow() {
    const g = this.add.circle(this.stairs.x, this.stairs.y, 12, 0xdff902, 0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(-4);
    this.tweens.add({ targets: g, scale: 1.4, alpha: 0.1, yoyo: true, repeat: -1, duration: 700 });
  }
  hurt(m) {
    if (this.time.now < this.inv || this.over) return;
    this.inv = this.time.now + 650; this.bites.add(m.id); this.hp = Math.max(1, this.hp - m.dmg);   // shown now, the server decides
    this.me.setTint(0xff5050); this.time.delayedCall(140, () => this.me.active && this.me.clearTint());
    const a = Math.atan2(this.me.y - m.s.y, this.me.x - m.s.x); this.kb = { t: this.time.now + 130, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170 };
    this.cameras.main.shake(90, 0.004); this.sfx("hit2", 0.45); this.float(this.me.x, this.me.y - 24, "-" + m.dmg, "#ff6b6b");
    this.dhud();
  }
  flushHurt() {
    if (!this.bites.size || this.hurting || this.over) return;
    const bites = [...this.bites]; this.bites.clear(); this.hurting = true;
    api("run/hurt", { run: this.run.id, bites }).then(r => {
      this.hurting = false;
      if (!r || this.over) return;
      if (r.error === "no_run") return this.lost();
      if (!r.ok) return;
      this.hp = r.hp;
      if (r.dead) this.end(true, r.banked); else this.dhud();
    }).catch(() => { this.hurting = false; });
  }
  // ---- chests, potions, stairs
  interactable() {
    const me = this.me, near = (o, d) => Math.hypot(o.x - me.x, o.y - me.y) < d;
    const c = this.chests.find(c => !c.open && near(c, 20)); if (c) return { kind: "chest", c, label: "open chest" };
    if (near({ x: this.stairs.x, y: this.stairs.y + 6 }, 18)) return { kind: "down", label: this.stairsOpen() ? (this.run.boss ? "go deeper" : "go down") : "sealed" };
    if (near(this.F.exit, 18)) return { kind: "exit", label: "walk out with the bag" };
    return null;
  }
  async interact() {
    const it = this.interactable(); if (!it || this.busy || this.over) return;
    if (it.kind === "chest") {
      this.busy = true; const r = await api("run/chest", { run: this.run.id, id: it.c.id }).catch(() => null); this.busy = false;
      if (!r) return; if (r.error === "no_run") return this.lost(); if (!r.ok) return;
      it.c.open = true; it.c.s.setFrame(11); this.bag = r.bag; this.sfx("secret", 0.5); this.drop(it.c.x, it.c.y - 16, r.drop); this.dhud();
    } else if (it.kind === "down") {
      if (!this.stairsOpen()) { const need = this.run.boss ? 0 : Math.ceil(this.total * 0.7) - (this.total - this.alive().length); return toast(this.run.boss ? "beat the boss to open the stairs" : `sealed: ${need} more monster${need > 1 ? "s" : ""} to go`); }
      this.busy = true; const r = await api("run/next", { run: this.run.id }).catch(() => null); this.busy = false;
      if (!r) return; if (r.error === "no_run") return this.lost(); if (!r.ok) return toast("not yet");
      this.over = true; this.sfx("accept", 0.5); this.sound.stopAll();
      this.cameras.main.fadeOut(300, 0, 0, 0); this.cameras.main.once("camerafadeoutcomplete", () => this.scene.restart({ run: r.run }));
    } else if (it.kind === "exit") this.leave();
  }
  async potion() {
    if (this.busy || this.over) return;
    if (!(this.bag.potions > 0)) return toast("no potions: they drop from monsters, or buy some before a run");
    if (this.hp >= this.maxHp) return toast("already at full health");
    this.busy = true; const r = await api("run/potion", { run: this.run.id }).catch(() => null); this.busy = false;
    if (!r || !r.ok) return;
    this.hp = r.hp; this.bag = r.bag; this.sfx("bonus", 0.4); this.float(this.me.x, this.me.y - 26, "+HP", "#7dff9a"); this.dhud();
  }
  async leave() {
    if (this.busy || this.over) return;
    this.busy = true; const r = await api("run/leave", { run: this.run.id }).catch(() => null); this.busy = false;
    if (!r) return toast("could not reach the gate, try again");
    if (r.error === "no_run") return this.lost();
    if (r.ok) this.end(false, r.banked);
  }
  end(dead, banked) {
    this.over = true; this.me.setVelocity(0, 0); for (const m of this.mobs) if (m.s.active && m.s.body) m.s.setVelocity(0, 0);
    this.sound.stopAll(); this.sfx(dead ? "gameover" : "levelup", 0.6);
    if (dead) { this.me.setTint(0x777777); this.me.setAngle(90); }
    const sum = { dead, floor: this.run.floor, banked: banked || {}, kills: this.bag.kills || 0 };
    setTimeout(() => { DSUM = sum; openWin("dsum"); }, dead ? 900 : 300);   // closing that window walks you back to town
    if (typeof load === "function") load();
  }
  lost() { if (this.over) return; this.over = true; toast("this run timed out"); goTown(); }
  dhud() {
    const b = this.bag || {};
    $("dfl").textContent = `FLOOR ${this.run.floor}`;
    $("dhpb").style.width = Math.max(0, this.hp / this.maxHp * 100) + "%"; $("dhpt").textContent = `${Math.max(0, Math.round(this.hp))} / ${this.maxHp}`;
    $("dgold").textContent = fmt(b.gold); $("dvq").textContent = fmt(b.vquest); $("dkills").textContent = fmt(b.kills); $("dpots").textContent = b.potions || 0;
    $("dmats").innerHTML = Object.entries(b.mat || {}).filter(([, n]) => n > 0).map(([k, n]) => `${gem(k)}${n}`).join(" ");
    const left = this.alive().length, need = Math.max(0, Math.ceil(this.total * 0.7) - (this.total - left));
    $("dleft").textContent = this.run.boss ? (this.mobs.some(m => m.boss && !m.dead) ? "BOSS FLOOR · beat the boss" : "BOSS DOWN · take the stairs") : need ? `${need} more to open the stairs` : "stairs open · press E on them";
  }
  update(time, delta) {
    if (!this.me) return;
    const me = this.me, K = this.keys, JD = Phaser.Input.Keyboard.JustDown;
    let vx = 0, vy = 0;
    if (!this.over && !current) {
      vx = (K.D.isDown || K.RIGHT.isDown ? 1 : 0) - (K.A.isDown || K.LEFT.isDown ? 1 : 0);
      vy = (K.S.isDown || K.DOWN.isDown ? 1 : 0) - (K.W.isDown || K.UP.isDown ? 1 : 0);
      if (TOUCH.x || TOUCH.y) { vx = TOUCH.x; vy = TOUCH.y; }
      const p = this.input.activePointer;
      if (!vx && !vy && this.press && p.isDown && time - this.press.t > 220) { const dx = p.worldX - me.x, dy = p.worldY - me.y; if (Math.hypot(dx, dy) > 6) { vx = dx; vy = dy; } }
      if (JD(K.SPACE) || JD(K.J) || touchTake("atk")) this.swing();
      if (JD(K.E) || JD(K.ENTER) || touchTake("use")) this.interact();
      if (JD(K.Q) || touchTake("pot")) this.potion();
    }
    const len = Math.hypot(vx, vy) || 1, moving = !!(vx || vy);
    if (this.kb && time < this.kb.t) me.setVelocity(this.kb.vx, this.kb.vy);
    else me.setVelocity(moving ? vx / len * 82 : 0, moving ? vy / len * 82 : 0);
    if (moving && time > (this.attacking || 0)) this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? "right" : "left") : (vy > 0 ? "down" : "up");
    if (time > (this.attacking || 0)) { const k = `${this.look}_${moving ? "walk" : "idle"}_${this.dir}`; if (me.anims.currentAnim?.key !== k || !me.anims.isPlaying) me.anims.play(k, true); }
    me.setDepth(me.y);
    if (this.time.now < this.inv) me.setAlpha(Math.floor(time / 70) % 2 ? 0.5 : 1); else me.setAlpha(1);
    // monsters: wander until they notice you, then chase; bosses lunge now and then
    this.bars.clear();
    for (const m of this.mobs) {
      if (m.dead || !m.s.active) continue;
      const s = m.s, dx = me.x - s.x, dy = me.y - s.y, d = Math.hypot(dx, dy);
      if (!this.over && time > m.stun) {
        if (d < (m.boss ? 220 : 105)) {
          let sp = m.speed;
          if (m.boss) { if (time > m.dash + 3200) m.dash = time; if (time - m.dash < 450) sp = 120; }
          s.setVelocity(dx / d * sp, dy / d * sp);
        } else if (time > m.wander) {
          m.wander = time + Phaser.Math.Between(900, 2400);
          const a = Math.random() * Math.PI * 2, go = Math.random() < 0.6;
          s.setVelocity(go ? Math.cos(a) * 14 : 0, go ? Math.sin(a) * 14 : 0);
        }
        if (d < m.r + 7 && !this.over) { if (time > m.bite) { m.bite = time + 850; this.hurt(m); } }
      }
      const bvx = s.body.velocity.x, bvy = s.body.velocity.y;
      if (bvx < -1) s.setFlipX(true); else if (bvx > 1) s.setFlipX(false);
      s.setDepth(s.y);
      if (m.hp < m.max) {
        const w = m.boss ? 40 : 14, x = s.x - w / 2, y = s.y - (m.boss ? s.height + 2 : 19);
        this.bars.fillStyle(0x000000, 0.8).fillRect(x - 1, y - 1, w + 2, 4).fillStyle(m.boss ? 0xff4d6d : 0xff6b6b, 1).fillRect(x, y, w * m.hp / m.max, 2);
      }
    }
    if (time > (this.lastFlush || 0) + 350) { this.lastFlush = time; this.flushHurt(); }
    // light
    const dk = this.dark; dk.clear(); dk.fill(0x07040c, 0.7);
    this.lamp.setScale(1.25 + Math.sin(time / 180) * 0.02); dk.erase(this.lamp, me.x, me.y - 8);
    this.lamp.setScale(0.55); for (const o of this.orbs) dk.erase(this.lamp, o.x, o.y - 10);
    if (this.stairsOpen()) { this.lamp.setScale(0.4); dk.erase(this.lamp, this.stairs.x, this.stairs.y); }
    this.lamp.setScale(0.35); dk.erase(this.lamp, this.F.exit.x, this.F.exit.y - 6);
    // prompt over the hero
    const it = !this.over && this.interactable();
    if (it) drawLabel("press E · " + it.label, me.x, me.y - 24, it.label === "sealed" ? "#ff9a9a" : "#dff902", { key: "dprompt", cls: "me" });
    syncLabels(this.cameras.main);
    if (this.over && !current && DSUM) { DSUM = null; goTown(); }
  }
}

function goTown() {
  GAME.sound.stopAll(); RETURN_AT = "dungeon";
  GAME.scene.stop("dungeon"); GAME.scene.start("town");
}
function startDungeon(run) {
  closeWin(); DSUM = null;
  GAME.sound.stopAll();
  if (GAME.scene.isActive("dungeon")) return GAME.scene.getScene("dungeon").scene.restart({ run });
  GAME.scene.stop("town"); GAME.scene.start("dungeon", { run });   // via the manager, so it works even while the town is still loading
}
GAME.scene.add("dungeon", DungeonScene, false);

$("dpot").onclick = () => { const s = GAME.scene.getScene("dungeon"); if (s && s.potion) s.potion(); };
$("dleave").onclick = e => {
  const b = e.currentTarget, s = GAME.scene.getScene("dungeon"); if (!s || s.over) return;
  if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "SURE? CLICK AGAIN"; setTimeout(() => { b.classList.remove("sure"); b.textContent = "LEAVE"; }, 3000); return; }
  b.classList.remove("sure"); b.textContent = "LEAVE"; s.leave();
};

// the gate window (lobby) and the end-of-run summary
const DERR = { no_energy: "no runs left today. trade on vibe/vibe or buy a run with gold, or come back after 00:00 UTC", already_in_run: "you are already in a run",
  not_enough_gold: "not enough gold", shop_limit: "that's the most extra runs for today", signed_out: "sign in first" };
function renderDungeonWin(wt, wb) {
  if (current === "dsum") {
    const s = DSUM || { banked: {} }, b = s.banked;
    wt.innerHTML = s.dead ? `YOU FELL<small>floor ${s.floor}</small>` : `OUT ALIVE<small>from floor ${s.floor}</small>`;
    wb.innerHTML = `<div class="reveal"><h4 style="color:${s.dead ? "#ff6b6b" : "var(--lime)"}">${s.dead ? "THE DUNGEON GOT YOU" : "THE BAG IS BANKED"}</h4>
      <p>${s.dead ? "half the gold and materials were lost. every $VQUEST you found stays yours." : "everything you carried out is yours."} ${s.kills} monster${s.kills === 1 ? "" : "s"} down.</p>
      <div>${b.gold ? `<span class="chip">+${fmt(b.gold)} gold</span>` : ""}${Object.entries(b.mat || {}).map(([m, n]) => `<span class="chip">${gem(m)}${n} ${m}</span>`).join("")}${b.xp ? `<span class="chip">+${fmt(b.xp)} XP</span>` : ""}${b.vquest ? `<span class="chip" style="color:var(--lime)">+${fmt(b.vquest)} $VQUEST</span>` : ""}${(b.gear || []).map(g => `<span class="chip" style="color:#b26bff">⚔ ${esc(g)}</span>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:6px"><button class="btn lime" id="dagain">GO AGAIN</button><button class="btn ghost" id="dtown">BACK TO TOWN</button></div></div>`;
    $("dagain").onclick = () => { sfx.click(); goTown(); setTimeout(() => openWin("dungeon"), 50); };
    $("dtown").onclick = () => { sfx.click(); closeWin(); };
    return;
  }
  wt.innerHTML = `THE DUNGEON<small>monsters, chests and a boss every 5th floor</small>`;
  if (!ME || ME.watch) {
    wb.innerHTML = `<div class="reveal"><h4>PAIR TO ENTER</h4><p>you are only looking around. pair your wallet (no connect needed) and the gate opens.</p><button class="btn lime" id="dgpair">PAIR TO PLAY</button></div>`;
    $("dgpair").onclick = () => openWin("pair"); return;
  }
  wb.innerHTML = `<p class="note">opening the gate…</p>`;
  api("run").then(d => {
    if (current !== "dungeon" || !d || !d.ok) return;
    DLOBBY = d; const e = d.energy, bal = d.balance, live = d.run;
    const potBtns = [0, 1, 2, 3].map(n => `<button data-dp="${n}" class="${n === DPOTS ? "on" : ""}" ${n * 40 > bal.gold ? "disabled" : ""}>${n}</button>`).join("");
    wb.innerHTML = `<div class="dlob">
      <div class="dstats">
        <div><span class="k">RUNS TODAY</span><b>${e.left} / ${e.max}</b><small>${e.bonus_from_trades ? `+${e.bonus_from_trades} from today's vibe/vibe trades` : "each vibe/vibe trade today adds a run (up to 10)"}</small></div>
        <div><span class="k">GOLD</span><b style="color:#ffd23f">${fmt(bal.gold)}</b><small>potions are 40 gold each</small></div>
        <div><span class="k">$VQUEST FOUND</span><b style="color:var(--lime)">${fmt(bal.vquest)}</b><small>kept in game, withdrawals open once $VQUEST transfers unlock</small></div>
      </div>
      ${live ? `<button class="btn lime" id="dgo" style="width:100%">CONTINUE · FLOOR ${live.floor}</button>`
        : `<div class="dpots">potions to take in: ${potBtns}</div><button class="btn lime" id="dgo" style="width:100%" ${e.left ? "" : "disabled"}>${e.left ? "ENTER THE DUNGEON" : "NO RUNS LEFT TODAY"}</button>`}
      <ul class="drules">
        <li>monsters drop gold, copper, silver and potions. materials go straight to the forge</li>
        <li>1 or 2 chests on every floor, a boss on every 5th floor</li>
        <li>$VQUEST drops by chance from monsters, more often from chests, always from bosses${d.eligible ? "" : ". <b style='color:#ffd23f'>this wallet has not traded on vibe/vibe yet, so $VQUEST drops come as gold until it does</b>"}</li>
        <li>gear drops too: now and then from monsters and chests, always from bosses, rarer the deeper you go. it goes straight to your inventory</li>
        <li>take the stairs up or press LEAVE to keep the whole bag. fall and you keep half the gold and materials, $VQUEST stays yours</li>
        <li>monsters you fight hit back, so keep moving. better gear means more damage and more HP</li>
      </ul>
      <span class="k" style="display:block">GOLD SHOP</span>
      <div class="dshop">${Object.entries(d.shop || {}).map(([k, it]) => `<button class="btn ghost" data-shop="${k}" ${bal.gold < it.gold || (k === "run" && e.bought >= it.per_day) ? "disabled" : ""}>${esc(it.label.toUpperCase())} · ${fmt(it.gold)} GOLD${k === "run" ? ` (${e.bought}/${it.per_day})` : ""}</button>`).join("")}</div>
      ${(d.prizes || []).length ? `<p class="note">weekly prize for the deepest divers: ${d.prizes.slice(0, 3).map((p, i) => `#${i + 1} ${fmt(p)}`).join(", ")}${d.prizes.length > 3 ? `, #4-${d.prizes.length} ${fmt(d.prizes[3])}` : ""} $VQUEST, paid on Monday (wallets that traded on vibe/vibe)</p>` : ""}
      <p class="note">$VQUEST pool today: ${fmt(d.pool.today_left)} left · up to ${fmt(d.pool.wallet_daily)} per wallet a day · testnet game currency, no real value</p>
      <span class="k" style="display:block;margin-top:12px">DEEPEST THIS WEEK</span>
      <table>${(d.top || []).map((t, i) => `<tr><td class="n">${i + 1}</td><td>${t.x_name ? "@" + esc(t.x_name) : short(t.wallet)}${ME && t.wallet === ME.wallet ? " <b style='color:var(--lime)'>(you)</b>" : ""}</td><td class="n">FLOOR ${t.floor}</td><td class="n">${fmt(t.kills)} KILLS</td></tr>`).join("") || `<tr><td>nobody yet. be the first one down</td></tr>`}</table>
    </div>`;
    wb.querySelectorAll("[data-shop]").forEach(b => b.onclick = async () => {
      sfx.click(); b.disabled = true;
      const r = await api("run/shop", { item: b.dataset.shop }).catch(() => null);
      if (!r || !r.ok) { b.disabled = false; return toast(DERR[r && r.error] || "the shop is closed, try again"); }
      sfx.coin(); if (r.item) banner("NEW GEAR", `${r.item.rarity} ${r.item.name}, power ${r.item.power}`); else toast("one more run for today");
      renderWin();
    });
    wb.querySelectorAll("[data-dp]").forEach(b => b.onclick = () => { DPOTS = Number(b.dataset.dp); sfx.click(); wb.querySelectorAll("[data-dp]").forEach(x => x.classList.toggle("on", x === b)); });
    $("dgo").onclick = async () => {
      sfx.click();
      if (live) return startDungeon(live);
      $("dgo").disabled = true;
      const r = await api("run/start", { potions: DPOTS }).catch(() => null);
      if (!r || !r.ok) { $("dgo").disabled = false; return toast(DERR[r && r.error] || "the gate is stuck, try again"); }
      DPOTS = 0; startDungeon(r.run);
    };
  }).catch(() => { if (current === "dungeon") wb.innerHTML = `<p class="note">could not reach the gate, try again</p>`; });
}
