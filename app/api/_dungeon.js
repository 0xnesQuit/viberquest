// The dungeon, server side. Everything that matters is decided here: monster HP, damage, drops, VQUEST caps.
// The browser animates and reports swings and bites; it never says "I killed X", "I found Y" or "I took N damage".
//   GET  /api/run               -> the live run (if any), today's energy, balances, shop, weekly board
//   POST /api/run/start {potions} -> spend one energy, floor 1 (potions bought with gold, 40 each, max 3)
//   POST /api/run/swing {mobs}   -> one sword swing hitting up to 4 monsters; monsters you fight may hit back
//   POST /api/run/hurt {bites}   -> monsters that touched you (ids); each can bite once per BITE_MS, damage is theirs
//   POST /api/run/chest {id}     -> open a chest once
//   POST /api/run/potion         -> drink a potion from the bag
//   POST /api/run/next           -> stairs: next floor once most monsters are down
//   POST /api/run/leave          -> walk out and bank the bag
//   POST /api/run/shop {item}    -> spend gold: an extra run today, or a gear box
const crypto = require("crypto");

const MOBS = [   // by depth: [floor from, types]
  [1, ["RugSlime", "FudBat"]],
  [3, ["RugSlime", "FudBat", "Jeet", "PaperHands"]],
  [6, ["Jeet", "PaperHands", "BearBot", "GasGhost"]],
  [11, ["BearBot", "GasGhost", "Rugpuller", "Dumpster"]],
];
const BOSSES = ["TheRugger", "BearKing", "GasGolem", "TheWhale"];
const POTION = 40, BITE_MS = 800;
const SHOP = { run: { gold: 150, per_day: 3, label: "Extra run today" }, gearbox: { gold: 400, label: "Gear box (common or rare)" } };
const rnd = (a, b) => a + crypto.randomInt(b - a + 1);
const chance = p => crypto.randomInt(1_000_000) < p * 1_000_000;
const pickOne = a => a[crypto.randomInt(a.length)];

module.exports = function dungeon({ db, Items }) {
  async function cfg() {
    const c = Object.fromEntries((await db.query("select key, value from vq_config where key like 'dungeon_%'")).rows.map(r => [r.key, r.value]));
    return { pool: Number(c.dungeon_pool) || 5e6, daily: Number(c.dungeon_daily) || 5e4, walletDaily: Number(c.dungeon_wallet_daily) || 3000, runs: Number(c.dungeon_runs) || 5,
      prizes: String(c.dungeon_weekly_prizes || "").split(",").map(Number).filter(n => n > 0) };
  }
  const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
  async function energy(w) {
    const c = await cfg(), since = dayStart();
    const [used, trades, bought] = await Promise.all([
      db.query("select count(*)::int n from vq_runs where wallet=$1 and started_at >= $2", [w, since]),
      db.query("select count(*)::int n from vq_trades where wallet=$1 and ts >= $2", [w, Math.floor(since / 1000)]),
      db.query("select count(*)::int n from vq_ledger where wallet=$1 and what='shop_run' and at >= $2", [w, since]),
    ]);
    const bonus = Math.min(10, trades.rows[0].n), max = c.runs + bonus + bought.rows[0].n;
    return { max, used: used.rows[0].n, left: Math.max(0, max - used.rows[0].n), bonus_from_trades: bonus, bought: bought.rows[0].n };
  }
  // $VQUEST only drops for wallets that have traded on vibe/vibe at least once (fresh or guest wallets get gold instead)
  async function eligible(w) { return (await db.query("select 1 from vq_trades where wallet=$1 limit 1", [w])).rowCount > 0; }
  async function power(w) {   // gear power -> damage and hp
    const p = Number((await db.query("select coalesce(sum(power),0)::int p from vq_items where wallet=$1 and equipped", [w])).rows[0].p);
    return { atk: 10 + Math.round(p * 1.6), hp: 100 + p * 4 };
  }
  function floorState(floor, keep) {
    const boss = floor % 5 === 0, tier = MOBS.filter(m => floor >= m[0]).pop()[1];
    const mobs = {}, n = boss ? 4 + Math.min(6, floor) : Math.min(16, 6 + floor * 2);
    for (let i = 0; i < n; i++) { const hp = 18 + floor * 12; mobs["m" + i] = { type: pickOne(tier), hp, max: hp, dmg: 5 + floor * 2 }; }
    if (boss) { const hp = 150 + floor * 40; mobs.boss = { type: BOSSES[(floor / 5 - 1) % BOSSES.length], hp, max: hp, dmg: 8 + floor * 2, boss: true }; }
    const chests = {}; for (let i = 0; i < (boss ? 3 : rnd(1, 2)); i++) chests["c" + i] = { opened: false };
    return { seed: crypto.randomInt(2 ** 31), boss, mobs, chests, bites: {}, eligible: keep ? keep.eligible : false };
  }
  async function live(w) { return (await db.query("select * from vq_runs where wallet=$1 and status='live' and updated_at > now() - interval '45 minutes' order by started_at desc limit 1", [w])).rows[0] || null; }
  const pub = r => r && { id: r.id, floor: r.floor, hp: r.hp, max_hp: r.max_hp, status: r.status, bag: r.bag, eligible: !!r.state.eligible,
    seed: r.state.seed, boss: r.state.boss, mobs: Object.fromEntries(Object.entries(r.state.mobs).map(([k, m]) => [k, { type: m.type, hp: m.hp, max: m.max, dmg: m.dmg, boss: !!m.boss }])),
    chests: r.state.chests };
  async function save(c, r) { await c.query("update vq_runs set floor=$2, hp=$3, state=$4, bag=$5, status=$6, updated_at=now(), last_swing=$7 where id=$1", [r.id, r.floor, r.hp, r.state, r.bag, r.status, r.last_swing]); }
  async function withRun(w, id, fn) {   // row-locked run for every action
    const c = await db.connect();
    try {
      await c.query("begin");
      const r = (await c.query("select * from vq_runs where id=$1 and wallet=$2 for update", [String(id || ""), w])).rows[0];
      if (!r || r.status !== "live") { await c.query("rollback"); return { ok: false, error: "no_run" }; }
      r.state.bites = r.state.bites || {};
      const out = await fn(r, c);
      if (out && out.ok !== false) await save(c, r);
      await c.query("commit");
      if (out && (out.dead || out.banked || out.run)) db.query("select pg_notify('vv_trade', $1)", [JSON.stringify({ w })]).catch(() => {});   // dungeon quests re-check now
      return out;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  // VQUEST: rolls a drop under the caps, credits it to the balance at once. Not eligible: a fifth of it as gold instead.
  async function vquest(c, r, src, amount) {
    if (!r.state.eligible) { const g = Math.max(1, Math.floor(amount / 5)); r.bag.gold += g; return 0; }
    const w = r.wallet, k = await cfg(), since = dayStart();
    const q = (await c.query(`select coalesce(sum(amount),0)::float total, coalesce(sum(amount) filter (where at >= $1 and src <> 'weekly'),0)::float today,
      coalesce(sum(amount) filter (where at >= $1 and wallet = $2 and src <> 'weekly'),0)::float mine from vq_vquest_drops`, [since, w])).rows[0];
    const room = Math.min(k.pool - q.total, k.daily - q.today, k.walletDaily - q.mine);
    const amt = Math.floor(Math.min(amount, room));
    if (amt <= 0) return 0;
    await c.query("insert into vq_vquest_drops (wallet, run, src, amount) values ($1,$2,$3,$4)", [w, r.id, src, amt]);
    await c.query(`insert into vq_balances (wallet, vquest) values ($1,$2) on conflict (wallet) do update set vquest = vq_balances.vquest + excluded.vquest, updated_at = now()`, [w, amt]);
    return amt;
  }
  // gear: straight into the inventory (kept even if you fall). Rarity climbs with depth; bosses always drop.
  function rollRarity(floor, src) {
    const deep = Math.min(1, floor / 25);
    const w = src === "boss" ? { rare: 50 - 30 * deep, epic: 40, legendary: 10 + 25 * deep, mythic: floor >= 20 ? 5 : 0 }
      : src === "box" ? { common: 70, rare: 30 }
      : { common: 60 - 40 * deep, rare: 30, epic: 9 + 15 * deep, legendary: 1 + 6 * deep };
    let t = crypto.randomInt(1_000_000) / 1_000_000 * Object.values(w).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(w)) { if ((t -= v) < 0) return k; }
    return "common";
  }
  async function gear(c, w, floor, src) {
    const rarity = rollRarity(floor, src), pool = Items.TEMPLATES.filter(t => t.rarity === rarity);
    if (!pool.length) return null;
    const t = pickOne(pool), [lo, hi] = Items.RARITY[rarity].power, power = lo + crypto.randomInt(hi - lo + 1);
    const it = (await c.query("insert into vq_items (wallet, slot, template, rarity, power) values ($1,$2,$3,$4,$5) returning id", [w, t.slot, t.id, rarity, power])).rows[0];
    await c.query("insert into vq_ledger (wallet, what, ref) values ($1, 'dungeon_gear', $2)", [w, String(it.id)]);
    return { id: it.id, slot: t.slot, template: t.id, name: t.name, rarity, power };
  }
  function addMat(bag, m, n) { bag.mat = bag.mat || {}; bag.mat[m] = (bag.mat[m] || 0) + n; }
  async function mobLoot(c, r, m) {
    const f = r.floor, d = { gold: rnd(2 + f, 6 + 2 * f), mat: {}, vquest: 0, potion: false };
    if (chance(0.30)) d.mat.copper = rnd(1, 2);
    if (f >= 3 && chance(0.08)) d.mat.silver = 1;
    if (f >= 5 && chance(0.025)) d.mat.gold = 1;
    if (f >= 8 && chance(0.006)) d.mat.diamond = 1;
    if (chance(0.10)) d.potion = true;
    if (m.boss) {
      d.gold *= 8; d.mat.gold = (d.mat.gold || 0) + 1; if (f >= 10) d.mat.diamond = (d.mat.diamond || 0) + 1;
      d.vquest = await vquest(c, r, "boss", rnd(500, 1500) * (1 + f / 10)); d.gear = await gear(c, r.wallet, f, "boss");
      r.bag.bosses = (r.bag.bosses || 0) + 1;
    } else {
      if (chance(Math.min(0.15, 0.06 + f * 0.005))) d.vquest = await vquest(c, r, "mob", rnd(10, 60) * (1 + f * 0.25));
      if (chance(0.012 + f * 0.0008)) d.gear = await gear(c, r.wallet, f, "mob");
      if (d.vquest === 0 && chance(0.02)) d.gold += 25;   // a lucky purse when the VQUEST roll misses
    }
    r.bag.gold += d.gold; r.bag.vquest = (r.bag.vquest || 0) + d.vquest; r.bag.kills = (r.bag.kills || 0) + 1; if (d.potion) r.bag.potions = (r.bag.potions || 0) + 1;
    if (d.gear) r.bag.gear = [...(r.bag.gear || []), d.gear.name];
    for (const [k, n] of Object.entries(d.mat)) addMat(r.bag, k, n);
    return d;
  }
  // a monster bites: once per BITE_MS each, its own damage. Returns damage dealt.
  function bite(r, id, now) {
    const m = r.state.mobs[id]; if (!m || m.hp <= 0) return 0;
    if (now - (r.state.bites[id] || 0) < (m.boss ? BITE_MS * 2 : BITE_MS)) return 0;
    r.state.bites[id] = now; r.hp = Math.max(0, r.hp - m.dmg); return m.dmg;
  }
  async function bank(c, r, keepShare) {   // move the bag into the account (keepShare 1 = all, .5 on death)
    const w = r.wallet, b = r.bag, gold = Math.floor((b.gold || 0) * keepShare);
    await c.query(`insert into vq_balances (wallet, gold) values ($1,$2) on conflict (wallet) do update set gold = vq_balances.gold + excluded.gold, updated_at = now()`, [w, gold]);
    const mats = {};
    for (const [m, n] of Object.entries(b.mat || {})) { const k = Math.floor(n * keepShare); if (k > 0) { mats[m] = k; await c.query("insert into vq_materials (wallet, material, amount) values ($1,$2,$3) on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount", [w, m, k]); } }
    const xp = (b.kills || 0) * (2 + r.floor);
    await c.query("update vq_players set game_xp = game_xp + $2 where wallet = $1", [w, xp]);
    await c.query("insert into vq_ledger (wallet, what, xp, mat, ref) values ($1, $2, $3, $4, $5)", [w, keepShare < 1 ? "dungeon_death" : "dungeon", xp, JSON.stringify({ ...mats, gold_coins: gold }), r.id + "/f" + r.floor]);
    return { gold, mat: mats, xp, vquest: b.vquest || 0, gear: b.gear || [] };
  }
  async function die(c, r) { r.status = "dead"; return bank(c, r, 0.5); }

  return async function handle(route, req, w, body) {
    if (route === "run" && req.method === "GET") {
      const wk = new Date(dayStart() - ((new Date().getUTCDay() + 6) % 7) * 864e5);   // monday 00:00 UTC
      const [r, e, b, top, pool, c, el] = await Promise.all([live(w), energy(w), db.query("select gold, vquest::float from vq_balances where wallet=$1", [w]),
        db.query(`select r.wallet, max(r.floor)::int floor, sum((r.bag->>'kills')::int)::int kills, (select m.x_username from vv_guild_members m where m.address = r.wallet limit 1) x_name
          from vq_runs r where r.started_at >= $1 group by r.wallet order by 2 desc, 3 desc limit 10`, [wk]),
        db.query("select coalesce(sum(amount) filter (where at >= $1 and src <> 'weekly'),0)::float today, coalesce(sum(amount),0)::float total from vq_vquest_drops", [dayStart()]), cfg(), eligible(w)]);
      return { ok: true, run: pub(r), energy: e, balance: b.rows[0] || { gold: 0, vquest: 0 }, top: top.rows, eligible: el, shop: SHOP, prizes: c.prizes,
        pool: { left: Math.max(0, c.pool - pool.rows[0].total), today_left: Math.max(0, c.daily - pool.rows[0].today), wallet_daily: c.walletDaily } };
    }
    if (route === "run/start") {
      if (await live(w)) return { ok: false, error: "already_in_run" };
      const e = await energy(w); if (e.left <= 0) return { ok: false, error: "no_energy", energy: e };
      const p = await power(w), id = crypto.randomBytes(12).toString("hex"), pots = Math.max(0, Math.min(3, Math.floor(Number(body.potions) || 0)));
      if (pots && !(await db.query("update vq_balances set gold = gold - $2, updated_at = now() where wallet=$1 and gold >= $2", [w, pots * POTION])).rowCount) return { ok: false, error: "not_enough_gold" };
      await db.query("insert into vq_runs (id, wallet, floor, hp, max_hp, state, bag) values ($1,$2,1,$3,$3,$4,$5)", [id, w, p.hp, floorState(1, { eligible: await eligible(w) }),
        { gold: 0, mat: {}, vquest: 0, kills: 0, chests: 0, bosses: 0, potions: pots }]);
      return { ok: true, run: pub(await live(w)), energy: await energy(w) };
    }
    if (route === "run/shop") {
      const it = SHOP[String(body.item)]; if (!it) return { ok: false, error: "no_item" };
      const c = await db.connect();
      try {
        await c.query("begin"); await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_gold:" + w]);
        if (body.item === "run" && (await c.query("select count(*)::int n from vq_ledger where wallet=$1 and what='shop_run' and at >= $2", [w, dayStart()])).rows[0].n >= it.per_day) {
          await c.query("rollback"); return { ok: false, error: "shop_limit" };
        }
        if (!(await c.query("update vq_balances set gold = gold - $2, updated_at = now() where wallet=$1 and gold >= $2", [w, it.gold])).rowCount) { await c.query("rollback"); return { ok: false, error: "not_enough_gold" }; }
        let item = null;
        if (body.item === "run") await c.query("insert into vq_ledger (wallet, what, ref) values ($1, 'shop_run', $2)", [w, String(it.gold)]);
        else item = await gear(c, w, 1, "box");
        await c.query("commit");
        return { ok: true, item, energy: await energy(w) };
      } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    }
    if (route === "run/swing") return withRun(w, body.run, async (r, c) => {
      const now = Date.now();
      if (r.last_swing && now - new Date(r.last_swing).getTime() < 300) return { ok: false, error: "too_fast" };   // ~3 swings a second at most
      r.last_swing = new Date(now);
      const p = await power(w), out = []; let took = 0;
      for (const id of [...new Set((body.mobs || []).map(String))].slice(0, 4)) {
        const m = r.state.mobs[id]; if (!m || m.hp <= 0) continue;
        const crit = chance(0.12), dmg = Math.round(p.atk * (0.8 + Math.random() * 0.4) * (crit ? 2 : 1));
        m.hp = Math.max(0, m.hp - dmg);
        const hit = { id, dmg, crit, hp: m.hp };
        if (m.hp === 0) hit.drop = await mobLoot(c, r, m);
        else if (chance(m.boss ? 0.15 : 0.1)) { const t = bite(r, id, now); if (t) { took += t; hit.bit = t; } }   // it hits back, you are right next to it
        out.push(hit);
      }
      const res = { ok: true, hits: out, bag: r.bag, hp: r.hp, took, left: Object.values(r.state.mobs).filter(m => m.hp > 0).length };
      if (r.hp <= 0) { res.dead = true; res.banked = await die(c, r); }
      return res;
    });
    if (route === "run/hurt") return withRun(w, body.run, async (r, c) => {
      const now = Date.now(); let took = 0;
      for (const id of [...new Set((body.bites || []).map(String))].slice(0, 8)) took += bite(r, id, now);
      if (r.hp > 0) return { ok: true, hp: r.hp, took };
      return { ok: true, hp: 0, took, dead: true, banked: await die(c, r) };
    });
    if (route === "run/chest") return withRun(w, body.run, async (r, c) => {
      const ch = r.state.chests[String(body.id)]; if (!ch || ch.opened) return { ok: false, error: "no_chest" };
      ch.opened = true; const f = r.floor, d = { gold: rnd(15 + 5 * f, 30 + 10 * f), mat: { copper: 3 }, vquest: 0 };
      if (chance(0.4)) d.mat.silver = rnd(1, 2);
      if (chance(0.15)) d.mat.gold = 1;
      if (chance(0.03)) d.mat.diamond = 1;
      if (chance(0.35)) d.vquest = await vquest(c, r, "chest", rnd(80, 300) * (1 + f * 0.2));
      if (chance(0.10)) { d.gear = await gear(c, w, f, "chest"); r.bag.gear = [...(r.bag.gear || []), d.gear.name]; }
      r.bag.gold += d.gold; r.bag.vquest = (r.bag.vquest || 0) + d.vquest; r.bag.chests = (r.bag.chests || 0) + 1;
      for (const [k, n] of Object.entries(d.mat)) addMat(r.bag, k, n);
      return { ok: true, drop: d, bag: r.bag };
    });
    if (route === "run/potion") return withRun(w, body.run, async (r) => {
      if (!(r.bag.potions > 0)) return { ok: false, error: "no_potion" };
      r.bag.potions -= 1; r.hp = Math.min(r.max_hp, r.hp + Math.round(r.max_hp * 0.4));
      return { ok: true, hp: r.hp, bag: r.bag };
    });
    if (route === "run/next") return withRun(w, body.run, async (r) => {
      const all = Object.values(r.state.mobs), down = all.filter(m => m.hp <= 0).length;
      if (r.state.boss ? all.some(m => m.boss && m.hp > 0) : down < Math.ceil(all.length * 0.7)) return { ok: false, error: "floor_not_clear" };
      r.floor += 1; r.state = floorState(r.floor, r.state); r.hp = Math.min(r.max_hp, r.hp + Math.round(r.max_hp * 0.25));
      return { ok: true, run: pub(r) };
    });
    if (route === "run/leave") return withRun(w, body.run, async (r, c) => {
      r.status = "done"; const banked = await bank(c, r, 1);
      return { ok: true, banked };
    });
    return null;
  };
};
