// Viberquest API. Sign-in = wallet signature over a one-time nonce (no transaction); the session is an HMAC cookie.
//   GET  /api/nonce                -> { nonce, message }
//   POST /api/login {address, signature, message}
//   POST /api/logout
//   GET  /api/me                   -> character, level, materials, today's/this week's quests (assigned on first visit)
//   POST /api/claim {quest, period}
//   GET  /api/events               -> SSE: quest progress for the signed-in wallet + its trades as they land
//   POST /api/craft {rarity, slot} | POST /api/equip {id} | POST /api/unequip {slot} | POST /api/chest
//   GET  /api/guild                -> this week's guild season (guilds ranked by their players' quest XP)
//   GET  /api/leaderboard          -> players by quest XP this week
//   POST /api/reroll {quest}       -> swap one open daily quest, once per UTC day
//   POST /api/salvage {id}         -> melt an unequipped item back into materials
//   GET  /api/tokens?q=            -> vibe/vibe tokens for the fantasy picker
//   GET  /api/fantasy | POST /api/fantasy {add|remove|captain: curve} -> this week's fantasy roster and league
//   GET  /api/hero/<wallet>        -> public hero
//   POST /api/guildchest {level}   -> open a guild goal chest (guild volume milestones this week)
//   GET  /api/seasons?week=        -> archived boards of a finished week (default: last week)
//   GET  /api/town                 -> SSE: everyone in town (snap, join, move, leave, trade, emote)
//   POST /api/pos {x, tx, face}    -> where you are walking | POST /api/emote {e}
// $VQUEST economy (off until vq_config.token is set):
//   POST /api/buy {key, value?}    -> Ember purchases: hard_mode, arena_slot6, name_color, emote_pack
//   POST /api/guildbase {amount}   -> pool Embers into your guild's base
//   GET  /api/sponsor | POST /api/sponsor {curve, hours} | GET /api/sponsor/<id>/completers
//   GET  /api/treasury             -> treasury balances, burns, buybacks, payouts, last season's reward plan
// pages: /h/<wallet> (share page with OG tags), /hcard/<wallet>.png (1200x630 hero card)
const crypto = require("crypto");
const pg = require("pg");
const { verifyMessage } = require("viem");
const Items = require("../items.js");

const db = new pg.Pool({ connectionString: process.env.VQ_PG_URL, max: 8 });
const SECRET = process.env.SESSION_SECRET || "";
const DOMAIN = process.env.SITE_HOST || "play.vibercheck.xyz";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const level = xp => Math.min(99, 1 + Math.floor(11 * Math.log(1 + xp / 150)));
const xpFor = L => Math.ceil(150 * (Math.exp((L - 1) / 11) - 1));
const LINES = {
  Sniper: "first in, every time", Launcher: "ships tokens for breakfast", "Diamond Hands": "buys the curve, never lets go",
  Flipper: "in and out before the candle closes", Whale: "moves the curve when it moves", "Curve Surfer": "rides them all the way to graduation",
  Fresh: "just booted up. the curve is waiting",
};

function send(res, code, body, extra = {}) {
  res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, no) => { let d = ""; req.on("data", c => { d += c; if (d.length > 20000) { no(new Error("too_large")); req.destroy(); } }); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } }); req.on("error", no); });
}
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=").map(decodeURIComponent)).filter(p => p.length === 2));
const sign = v => crypto.createHmac("sha256", SECRET).update(v).digest("hex").slice(0, 40);
function session(req) {
  const s = cookies(req).vq; if (!s) return null;
  const [w, exp, mac] = s.split(".");
  if (!w || !exp || !mac || Number(exp) < Date.now() / 1000 || sign(w + "." + exp) !== mac) return null;
  return w;
}
function sessionCookie(w) {
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400, v = `${w}.${exp}`;
  return `vq=${encodeURIComponent(v + "." + sign(v))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`;
}

// per-IP limiter (Cloudflare passes the client IP)
const hits = new Map(); setInterval(() => hits.clear(), 60_000).unref();
const limited = (req, n = 120) => { const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?"; const c = (hits.get(ip) || 0) + 1; hits.set(ip, c); return c > n; };

// ---------- quests: which quests a player gets this period ----------
const dayKey = d => d.toISOString().slice(0, 10);
function weekKey(d) {   // ISO week, e.g. 2026-W41
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}
function endOfDay(d) { const e = new Date(d); e.setUTCHours(24, 0, 0, 0); return e; }
function endOfWeek(d) { const e = endOfDay(d); const day = d.getUTCDay() || 7; e.setUTCDate(e.getUTCDate() + (7 - day)); return e; }
function pick(pool, n, seed) {   // deterministic per wallet + period, so a refresh never reshuffles
  return pool.map(q => [crypto.createHash("sha256").update(seed + q.id).digest("hex"), q]).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(0, n).map(x => x[1]);
}
let catalogue = { at: 0, rows: [] };
async function quests() {
  if (Date.now() - catalogue.at < 60_000) return catalogue.rows;
  catalogue = { at: Date.now(), rows: (await db.query("select * from vq_quests where active order by sort")).rows };
  return catalogue.rows;
}
async function assign(w) {
  const all = await quests(), now = new Date(), day = dayKey(now), week = weekKey(now);
  // dailies rerolled away today stay out, so the picker hands out the next one in its order instead
  const gone = new Set((await db.query("select ref from vq_ledger where wallet=$1 and what='reroll' and at >= $2", [w, new Date(day + "T00:00:00Z")])).rows.map(r => r.ref));
  // the story is a chain: only the first story quest not yet claimed is open
  const story = (await db.query("select quest_id, claimed_at from vq_progress where wallet=$1 and period='story'", [w])).rows;
  const claimed = new Set(story.filter(r => r.claimed_at).map(r => r.quest_id)), open = story.some(r => !r.claimed_at);
  const next = open ? null : all.filter(q => q.kind === "story").find(q => !claimed.has(q.id));
  const want = [
    ...pick(all.filter(q => q.kind === "daily" && !gone.has(q.id)), 3, w + day).map(q => [q, day, endOfDay(now)]),
    ...pick(all.filter(q => q.kind === "weekly"), 5, w + week).map(q => [q, week, endOfWeek(now)]),
    ...(next ? [[next, "story", null]] : []),
  ];
  if ((await db.query("select 1 from vq_unlocks where wallet=$1 and key='hard_mode' and scope=$2", [w, week])).rowCount)
    want.push(...pick(all.filter(q => q.kind === "hard"), 3, w + week + "hard").map(q => [q, week, endOfWeek(now)]));
  for (const sp of (await db.query("select id, hold_hours, ends_at from vq_sponsors where starts_at <= now() and ends_at > now()")).rows) {
    const q = all.find(x => x.id === "sp_" + sp.id); if (q) want.push([q, "sp", new Date(new Date(sp.ends_at).getTime() + sp.hold_hours * 3600e3)]);
  }
  for (const [q, period, exp] of want)
    await db.query(`insert into vq_progress (wallet, quest_id, period, expires_at, target) values ($1,$2,$3,$4,1) on conflict do nothing`, [w, q.id, period, exp]);
  return { day, week };
}

async function me(w) {
  await db.query("insert into vq_players (wallet, last_seen) values ($1, now()) on conflict (wallet) do update set last_seen = now()", [w]);
  const { day, week } = await assign(w);
  const [p, chain, mats, qs, items, chest, guild, rr, st, badges] = await Promise.all([
    db.query("select * from vq_players where wallet=$1", [w]),
    db.query("select xp, cls, rank, buys, sells, curves, early, launched, grads_caught, days from vv_wallets where wallet=$1", [w]),
    db.query("select material, amount from vq_materials where wallet=$1", [w]),
    db.query(`select p.quest_id, p.period, p.accepted_at, p.expires_at, p.progress, p.target, p.completed_at, p.claimed_at, q.kind, q.title, q.descr, q.reward, q.rule
      from vq_progress p join vq_quests q on q.id = p.quest_id where p.wallet=$1 and (p.period in ($2,$3) or (p.period in ('story','sp') and (p.claimed_at is null or p.claimed_at > now() - interval '1 day')) and (p.expires_at is null or p.expires_at > now() - interval '1 day'))
      order by q.sort`, [w, day, week]),
    db.query("select id, slot, template, rarity, power, equipped from vq_items where wallet=$1 order by created_at desc", [w]),
    db.query("select 1 from vq_ledger where wallet=$1 and what='chest' and at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'", [w]),
    db.query("select m.slug, g.name from vv_guild_members m left join vv_guilds g using (slug) where m.address=$1 limit 1", [w]),
    db.query("select 1 from vq_ledger where wallet=$1 and what='reroll' and at >= $2", [w, new Date(day + "T00:00:00Z")]),
    db.query("select (select count(*)::int from vq_progress where wallet=$1 and period='story' and claimed_at is not null) done, (select count(*)::int from vq_quests where kind='story' and active) total", [w]),
    db.query("select week, badge, rank from vq_badges where wallet=$1 order by week desc, badge", [w]),
  ]);
  const goal = guild.rows[0] ? await guildGoal(w, guild.rows[0].slug, week) : null;
  const [ec, emb, ul, gb, spn] = await Promise.all([econ(), embersOf(w), unlocks(w), guild.rows[0] ? db.query("select embers, level from vq_guild_base where slug=$1", [guild.rows[0].slug]) : { rows: [] },
    db.query("select id, symbol, curve, hold_hours, ends_at from vq_sponsors where starts_at <= now() and ends_at > now() order by starts_at")]);
  const c = chain.rows[0] || {}, chainXp = Number(c.xp) || 0, gameXp = Number(p.rows[0].game_xp) || 0, xp = chainXp + gameXp, L = level(xp);
  const cls = c.cls || "Fresh";
  const inv = items.rows.map(i => ({ ...i, name: (Items.TEMPLATES.find(t => t.id === i.template) || {}).name || i.template }));
  return {
    items: inv, gear: Object.fromEntries(inv.filter(i => i.equipped).map(i => [i.slot, i.template])),
    bonus: Math.min(50, inv.filter(i => i.equipped).reduce((a, i) => a + i.power, 0)),
    chest_open: !chest.rowCount, guild: guild.rows[0] || null, reroll_open: !rr.rowCount, story: st.rows[0], goal, badges: badges.rows,
    economy: { live: ec.live, launched: ec.launched, graduated: ec.graduated, curve_eth: ec.curve_eth, grad_eth: ec.grad_eth, token: ec.token, prices: ec.prices, colors: NAME_COLORS }, embers: emb,
    unlocks: { hard_mode: has(ul, "hard_mode", week), arena_slot6: has(ul, "arena_slot6", week), emote_pack: has(ul, "emote_pack"), name_color: (ul.find(x => x.key === "name_color") || {}).value || null },
    guild_base: gb.rows[0] ? { embers: Number(gb.rows[0].embers), level: gb.rows[0].level } : { embers: 0, level: 0 }, sponsored: spn.rows,
    wallet: w, cls, line: LINES[cls] || "", level: L, xp, chain_xp: chainXp, game_xp: gameXp, cur: xpFor(L), next: xpFor(Math.min(99, L + 1)),
    stats: { buys: +c.buys || 0, tokens: +c.curves || 0, early: +c.early || 0, launched: +c.launched || 0, grads: +c.grads_caught || 0, days: +c.days || 0 },
    materials: Object.fromEntries(["copper", "silver", "gold", "diamond"].map(m => [m, Number((mats.rows.find(r => r.material === m) || {}).amount) || 0])),
    quests: qs.rows.map(q => ({
      id: q.quest_id, period: q.period, kind: q.kind, title: q.title, descr: q.descr, reward: q.reward, type: q.rule.type,
      progress: q.progress, target: q.target, done: !!q.completed_at, claimed: !!q.claimed_at, expires: q.expires_at, accepted: q.accepted_at,
    })),
  };
}

// ---------- $VQUEST economy: config, prices, Embers ----------
const RPC = "https://rpc.testnet.chain.robinhood.com";
let econCache = { at: 0, v: null };
async function econ() {
  if (Date.now() - econCache.at < 30_000) return econCache.v;
  const [cfg, pr] = await Promise.all([db.query("select key, value from vq_config"), db.query("select key, embers from vq_prices")]);
  const c = Object.fromEntries(cfg.rows.map(r => [r.key, r.value ? r.value.toLowerCase() : null]));
  // vibe/vibe tokens can't be transferred (so can't be burned) until they graduate: Embers only switch on after that
  let grad = false, curveEth = 0;
  if (c.token) {
    const g = (await db.query(`select l.curve, exists (select 1 from vv_grads x where x.curve = l.curve) grad,
        (select coalesce(sum(case when t.side = 1 then t.eth else -t.eth end), 0)::float from vq_trades t where t.curve = l.curve and t.venue = 'curve') eth
      from vv_launches l where l.token = $1`, [c.token])).rows[0];
    if (g) { grad = g.grad; curveEth = g.eth; }
  }
  const v = { live: !!c.token && grad, launched: !!c.token, graduated: grad, curve_eth: curveEth, grad_eth: 4, token: c.token, treasury: c.treasury, pool_share: Number(c.pool_share || 0.3), prices: Object.fromEntries(pr.rows.map(r => [r.key, Number(r.embers)])) };
  econCache = { at: Date.now(), v }; return v;
}
const embersOf = async w => Number((await db.query("select vq_ember_balance($1) b", [w])).rows[0].b);
async function spend(c, w, key, ref) {   // inside a transaction; false when the balance is short
  const e = await econ(), price = e.prices[key];
  if (!e.live || !price) return { ok: false, error: "economy_off" };
  const ok = (await c.query("select vq_ember_spend($1,$2,$3,$4) ok", [w, price, key, ref || null])).rows[0].ok;
  return ok ? { ok: true, price } : { ok: false, error: "not_enough_embers", need: price };
}
const NAME_COLORS = ["#dff902", "#ff4b6e", "#8fe9ff", "#ffd23f", "#b26bff", "#5bd08a", "#ff7ad9", "#ff7a1a"];
async function unlocks(w) { return (await db.query("select key, scope, value from vq_unlocks where wallet=$1", [w])).rows; }
const has = (u, key, scope) => u.some(x => x.key === key && (!scope || x.scope === scope));
async function buy(w, key, value) {
  const week = weekKey(new Date()), e = await econ();
  const scope = key === "hard_mode" || key === "arena_slot6" ? week : "forever";
  if (!["hard_mode", "arena_slot6", "name_color", "emote_pack"].includes(key)) return { ok: false, error: "bad_item" };
  if (key === "name_color" && !NAME_COLORS.includes(String(value))) return { ok: false, error: "bad_color" };
  const c = await db.connect();
  try {
    await c.query("begin");
    const u = (await c.query("select 1 from vq_unlocks where wallet=$1 and key=$2 and scope=$3", [w, key, scope])).rowCount;
    if (u && key === "name_color") { await c.query("update vq_unlocks set value=$4 where wallet=$1 and key=$2 and scope=$3", [w, key, scope, value]); await c.query("commit"); infoCache.delete(w); return { ok: true, changed: true }; }
    if (u) { await c.query("rollback"); return { ok: false, error: "owned" }; }
    const r = await spend(c, w, key, scope); if (!r.ok) { await c.query("rollback"); return r; }
    await c.query("insert into vq_unlocks (wallet, key, scope, value) values ($1,$2,$3,$4)", [w, key, scope, key === "name_color" ? value : null]);
    await c.query("commit");
  } catch (err) { await c.query("rollback").catch(() => {}); throw err; } finally { c.release(); }
  infoCache.delete(w);
  if (key === "hard_mode") await assign(w);
  return { ok: true, spent: e.prices[key] };
}
const BASE_LEVELS = ["guild_l1", "guild_l2", "guild_l3"];
async function guildBase(w, amount) {
  const mem = (await db.query("select slug from vv_guild_members where address=$1 limit 1", [w])).rows[0];
  if (!mem) return { ok: false, error: "no_guild" };
  amount = Math.floor(Number(amount)); if (!(amount >= 10 && amount <= 1e9)) return { ok: false, error: "bad_amount" };
  const e = await econ(); if (!e.live) return { ok: false, error: "economy_off" };
  const c = await db.connect();
  try {
    await c.query("begin");
    const ok = (await c.query("select vq_ember_spend($1,$2,'guild_base',$3) ok", [w, amount, mem.slug])).rows[0].ok;
    if (!ok) { await c.query("rollback"); return { ok: false, error: "not_enough_embers" }; }
    const b = (await c.query(`insert into vq_guild_base (slug, embers) values ($1,$2) on conflict (slug) do update set embers = vq_guild_base.embers + excluded.embers, updated_at = now() returning embers`, [mem.slug, amount])).rows[0];
    const lvl = BASE_LEVELS.filter(k => Number(b.embers) >= e.prices[k]).length;
    await c.query("update vq_guild_base set level=$2 where slug=$1", [mem.slug, lvl]);
    await c.query("commit");
    return { ok: true, embers: Number(b.embers), level: lvl };
  } catch (err) { await c.query("rollback").catch(() => {}); throw err; } finally { c.release(); }
}

// ---------- sponsored quests: a builder buys a 24h "buy and hold" quest on a token they launched ----------
async function sponsorInfo(w) {
  const [mine, live, tokens] = await Promise.all([
    w ? db.query(`select s.*, (select count(*)::int from vq_progress p where p.quest_id = 'sp_' || s.id and p.completed_at is not null) completers,
        (select count(*)::int from vq_progress p where p.quest_id = 'sp_' || s.id) takers from vq_sponsors s where sponsor=$1 order by id desc limit 20`, [w]) : { rows: [] },
    db.query("select id, curve, symbol, title, hold_hours, starts_at, ends_at from vq_sponsors where ends_at > now() order by starts_at limit 10"),
    w ? db.query("select curve, symbol, name, ts::bigint ts from vv_launches where creator=$1 and symbol is not null order by ts desc limit 30", [w]) : { rows: [] },
  ]);
  return { mine: mine.rows, upcoming: live.rows, my_tokens: tokens.rows.map(r => ({ ...r, ts: Number(r.ts) })) };
}
async function sponsorCreate(w, b) {
  const e = await econ(); if (!e.live) return { ok: false, error: "economy_off" };
  const curve = String(b.curve || "").toLowerCase(), hours = Math.max(6, Math.min(48, Math.floor(Number(b.hours) || 6)));
  const l = (await db.query("select creator, symbol from vv_launches where curve=$1", [curve])).rows[0];
  if (!l) return { ok: false, error: "bad_token" };
  if (l.creator !== w) return { ok: false, error: "not_creator" };
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('vq_sponsor_slots'))");
    // at most two sponsored quests run at the same time: take the earliest 24h window with a free slot
    const busy = (await c.query("select starts_at, ends_at from vq_sponsors where ends_at > now()")).rows;
    const cands = [new Date(), ...busy.map(x => new Date(x.ends_at))].sort((a, z) => a - z);
    const start = cands.find(t => busy.filter(x => new Date(x.starts_at) < new Date(t.getTime() + 864e5) && new Date(x.ends_at) > t).length < 2);
    const r = await spend(c, w, "sponsor_slot", curve); if (!r.ok) { await c.query("rollback"); return r; }
    const sp = (await c.query(`insert into vq_sponsors (sponsor, curve, symbol, title, hold_hours, starts_at, ends_at, embers) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [w, curve, l.symbol, `Hold $${l.symbol}`, hours, start, new Date(start.getTime() + 864e5), r.price])).rows[0];
    await c.query(`insert into vq_quests (id, kind, title, descr, rule, reward, sort, active) values ($1,'sponsored',$2,$3,$4,$5,400,true)`,
      ["sp_" + sp.id, `Hold $${l.symbol}`, `Sponsored: buy $${l.symbol} and hold it for ${hours} hours without selling.`, JSON.stringify({ type: "sponsor_hold", curve, hours, min_eth: 0.002 }), JSON.stringify({ xp: 200, mat: { silver: 2 } })]);
    await c.query("commit");
    catalogue.at = 0;
    return { ok: true, id: sp.id, starts_at: start };
  } catch (err) { await c.query("rollback").catch(() => {}); throw err; } finally { c.release(); }
}

// ---------- treasury: everything read from chain data ----------
let chainCache = { at: 0, v: null };
async function rpcCall(method, params) { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; }
const WEIGHTS = [25, 18, 13, 10, 8, 7, 6, 5, 4, 4];
function rewardPlan(pool, seasonRows, eligible, week) {
  // 45% guilds (top 3: 50/30/20, split inside by capped quest XP), 35% Arena top 10, 20% individual (half top 10, half 5-winner raffle)
  const out = new Map(), add = (w, amt, why) => { if (!eligible.has(w) || amt <= 0) return; const o = out.get(w) || { wallet: w, amount: 0, why: [] }; o.amount += amt; o.why.push(why); out.set(w, o); };
  const g = seasonRows.guildMembers;
  [0.5, 0.3, 0.2].forEach((sh, i) => { const gm = g[i]; if (!gm) return; const tot = gm.members.reduce((a, m) => a + m.xp, 0) || 1; for (const m of gm.members) add(m.wallet, pool * .45 * sh * m.xp / tot, `guild #${i + 1}`); });
  const wsum = WEIGHTS.reduce((a, b) => a + b, 0);
  seasonRows.arena.slice(0, 10).forEach((r, i) => add(r.ref, pool * .35 * WEIGHTS[i] / wsum, `arena #${i + 1}`));
  seasonRows.player.slice(0, 10).forEach((r, i) => add(r.ref, pool * .10 * WEIGHTS[i] / wsum, `questers #${i + 1}`));
  const pool5 = [...eligible].map(x => [crypto.createHash("sha256").update(week + x).digest("hex"), x]).sort().slice(0, 5);   // deterministic raffle, anyone can recompute it
  pool5.forEach(([, x]) => add(x, pool * .10 / 5, "raffle"));
  const cap = pool * .10;   // nobody takes more than 10% of a pool
  return [...out.values()].map(o => ({ ...o, amount: Math.min(cap, o.amount) })).sort((a, b) => b.amount - a.amount);
}
async function treasury() {
  const e = await econ();
  if (!e.launched) return { live: false, prices: e.prices };
  const launch = (await db.query("select curve, symbol from vv_launches where token=$1", [e.token])).rows[0] || {};
  const [burns, spent, buys, payouts, lastWeek] = await Promise.all([
    db.query("select coalesce(sum(amount),0)::text total, count(*)::int n, count(distinct src)::int wallets from vq_transfers where kind='burn'"),
    db.query("select coalesce(-sum(delta),0)::float spent from vq_embers where delta < 0"),
    e.treasury && launch.curve ? db.query("select ts, eth::float eth, tokens::text tokens, venue from vq_trades where wallet=$1 and curve=$2 and side=1 order by ts desc limit 50", [e.treasury, launch.curve]) : { rows: [] },
    db.query("select tx, ts, dst, amount::text from vq_transfers where kind='payout' order by ts desc limit 100"),
    db.query("select week from vq_season_done order by week desc limit 1"),
  ]);
  if (Date.now() - chainCache.at > 60_000 && e.treasury) {
    const data = "0x70a08231" + e.treasury.replace(/^0x/, "").padStart(64, "0");
    const [bal, eth] = await Promise.all([rpcCall("eth_call", [{ to: e.token, data }, "latest"]).catch(() => null), rpcCall("eth_getBalance", [e.treasury, "latest"]).catch(() => null)]);
    chainCache = { at: Date.now(), v: { vquest: bal ? Number(BigInt(bal) / 10n ** 14n) / 1e4 : null, eth: eth ? Number(BigInt(eth) / 10n ** 12n) / 1e6 : null } };
  }
  const tok = x => Number(BigInt(x.split(".")[0]) / 10n ** 14n) / 1e4;
  // last finished season: pool = what the treasury bought back during that week
  let plan = null;
  const wk = lastWeek.rows[0] && lastWeek.rows[0].week;
  if (wk) {
    const s = (await db.query("select board, rank, ref, points from vq_seasons where week=$1 order by board, rank", [wk])).rows;
    const [y, n] = wk.split("-W").map(Number), jan4 = new Date(Date.UTC(y, 0, 4)), from = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 864e5 + (n - 1) * 7 * 864e5), to = new Date(from.getTime() + 7 * 864e5);
    const pool = buys.rows.filter(r => r.ts >= from / 1000 && r.ts < to / 1000).reduce((a, r) => a + tok(r.tokens), 0);
    const elig = new Set((await db.query("select wallet from vq_ledger where what='quest' and at >= $1 and at < $2 group by wallet having count(*) >= 5", [from, to])).rows.map(r => r.wallet));
    const topGuilds = s.filter(r => r.board === "guild").slice(0, 3);
    const guildMembers = [];
    for (const gr of topGuilds) guildMembers.push({ slug: gr.ref, members: (await db.query(`select l.wallet, least(sum(l.xp), 1000)::int xp from vq_ledger l join vv_guild_members m on m.address = l.wallet
        where m.slug=$1 and l.at >= $2 and l.at < $3 and l.xp > 0 group by l.wallet`, [gr.ref, from, to])).rows });
    const rows = rewardPlan(pool, { guildMembers, arena: s.filter(r => r.board === "arena"), player: s.filter(r => r.board === "player") }, elig, wk);
    const paid = payouts.rows.filter(p => p.ts >= to / 1000);
    plan = { week: wk, pool, eligible: elig.size, rows: rows.map(r => ({ ...r, amount: Math.floor(r.amount * 100) / 100, paid: paid.some(p => p.dst === r.wallet && tok(p.amount) >= r.amount * .99) })) };
  }
  return {
    live: true, graduated: e.graduated, curve_eth: e.curve_eth, token: e.token, treasury: e.treasury, symbol: launch.symbol || "VQUEST", balances: chainCache.v, pool_share: e.pool_share, prices: e.prices,
    burned: { total: tok(burns.rows[0].total), burns: burns.rows[0].n, wallets: burns.rows[0].wallets }, embers_spent: spent.rows[0].spent,
    buybacks: buys.rows.map(r => ({ ts: Number(r.ts), eth: r.eth, tokens: tok(r.tokens), venue: r.venue })),
    payouts: payouts.rows.map(r => ({ tx: r.tx, ts: Number(r.ts), to: r.dst, amount: tok(r.amount) })), plan,
  };
}

// ---------- crafting: materials in, a random piece of gear out (or half the materials back) ----------
async function craft(w, rarity, slot) {
  const recipe = Items.RECIPES[rarity];
  if (!recipe || !Items.SLOTS[slot]) return { ok: false, error: "bad_recipe" };
  const pool = Items.BY(slot, rarity);
  if (!pool.length) return { ok: false, error: "no_such_gear" };   // e.g. there are no common auras or pets
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_mat:" + w]);
    const have = Object.fromEntries((await c.query("select material, amount from vq_materials where wallet=$1", [w])).rows.map(r => [r.material, r.amount]));
    for (const [m, n] of Object.entries(recipe.cost)) if ((have[m] || 0) < n) { await c.query("rollback"); return { ok: false, error: "not_enough", need: recipe.cost }; }
    const e = await econ(), ek = Items.EMBER_KEY[rarity];
    if (recipe.embersOnly && !e.live) { await c.query("rollback"); return { ok: false, error: "economy_off" }; }
    if (ek && e.live) { const r = await spend(c, w, ek, rarity + "/" + slot); if (!r.ok) { await c.query("rollback"); return r; } }   // Embers go on every attempt
    const success = Math.random() < recipe.chance;
    const spent = Object.fromEntries(Object.entries(recipe.cost).map(([m, n]) => [m, success ? n : n - Math.floor(n / 2)]));
    for (const [m, n] of Object.entries(spent)) await c.query("update vq_materials set amount = amount - $3 where wallet=$1 and material=$2", [w, m, n]);
    let item = null;
    if (success) {
      const t = pool[crypto.randomInt(pool.length)], [lo, hi] = Items.RARITY[rarity].power, power = lo + crypto.randomInt(hi - lo + 1);
      item = (await c.query("insert into vq_items (wallet, slot, template, rarity, power) values ($1,$2,$3,$4,$5) returning id, slot, template, rarity, power, equipped", [w, slot, t.id, rarity, power])).rows[0];
      item.name = t.name;
    }
    await c.query("insert into vq_ledger (wallet, what, mat, ref) values ($1, $2, $3, $4)", [w, success ? "craft" : "craft_fail", JSON.stringify(spent), item ? String(item.id) : rarity + "/" + slot]);
    await c.query("commit");
    return { ok: true, success, item, spent };
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

// ---------- reroll: one open, unfinished daily quest swapped for another, once per UTC day ----------
async function reroll(w, quest, paid) {
  const day = dayKey(new Date()), c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_reroll:" + w]);
    if ((await c.query("select 1 from vq_ledger where wallet=$1 and what='reroll' and at >= $2", [w, new Date(day + "T00:00:00Z")])).rowCount) {
      if (!paid) { await c.query("rollback"); return { ok: false, error: "used_today" }; }
      const r = await spend(c, w, "extra_swap", quest); if (!r.ok) { await c.query("rollback"); return r; }
    }
    const d = await c.query("delete from vq_progress where wallet=$1 and quest_id=$2 and period=$3 and completed_at is null returning quest_id", [w, quest, day]);
    if (!d.rowCount) { await c.query("rollback"); return { ok: false, error: "not_rerollable" }; }
    await c.query("insert into vq_ledger (wallet, what, ref) values ($1, 'reroll', $2)", [w, quest]);
    await c.query("commit");
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  await assign(w);
  return { ok: true };
}

// ---------- salvage: an unequipped item goes back into materials ----------
const SALVAGE = { common: { copper: 2 }, rare: { silver: 2 }, epic: { gold: 1, silver: 1 }, legendary: { diamond: 1 } };
async function salvage(w, id) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_mat:" + w]);
    const it = (await c.query("delete from vq_items where id=$1 and wallet=$2 and not equipped returning rarity, template", [id, w])).rows[0];
    if (!it) { await c.query("rollback"); return { ok: false, error: "no_item" }; }
    const got = SALVAGE[it.rarity] || {};
    for (const [m, n] of Object.entries(got))
      await c.query("insert into vq_materials (wallet, material, amount) values ($1,$2,$3) on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount", [w, m, n]);
    await c.query("insert into vq_ledger (wallet, what, mat, ref) values ($1, 'salvage', $2, $3)", [w, JSON.stringify(got), it.template + "#" + id]);
    await c.query("commit");
    return { ok: true, got };
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

// ---------- fantasy launchpad league: up to 5 vibe/vibe tokens a week, one captain (x1.5) ----------
const CURVE = /^0x[0-9a-f]{40}$/;
let hotCache = { at: 0, rows: [] };
async function tokens(q) {   // empty query: the most traded tokens of the last 24h; otherwise a symbol/name/address search
  const s = String(q || "").trim().toLowerCase().slice(0, 42), like = "%" + s.replace(/[%_\\]/g, "") + "%";
  const cols = `l.curve, l.token, l.symbol, l.name, l.creator, l.ts::bigint ts, g.curve is not null as graduated`;
  if (!s) {
    if (Date.now() - hotCache.at < 120_000) return hotCache.rows;
    const rows = (await db.query(`with a as (select curve, count(*)::int n from vq_trades where ts > extract(epoch from now())::bigint - 86400 group by curve order by n desc limit 30)
      select ${cols}, a.n as trades_24h from a join vv_launches l using (curve) left join vv_grads g using (curve) where l.symbol is not null order by a.n desc`)).rows.map(r => ({ ...r, ts: Number(r.ts) }));
    hotCache = { at: Date.now(), rows }; return rows;
  }
  const rows = (await db.query(`select ${cols}, (select count(*)::int from vq_trades t where t.curve = l.curve and t.ts > extract(epoch from now())::bigint - 86400) as trades_24h
    from vv_launches l left join vv_grads g using (curve)
    where l.symbol is not null and (l.token = $1 or l.curve = $1 or lower(l.symbol) like $2 or lower(l.name) like $2)
    order by (lower(l.symbol) = $1) desc, l.ts desc limit 30`, [s, like])).rows;
  return rows.map(r => ({ ...r, ts: Number(r.ts) })).sort((x, y) => (y.symbol.toLowerCase() === s) - (x.symbol.toLowerCase() === s) || y.trades_24h - x.trades_24h);
}
async function fantasy(w) {
  const week = weekKey(new Date());
  const [picks, mine, table] = await Promise.all([
    w ? db.query(`select f.curve, f.captain, f.added_at, l.symbol, l.name, l.token, g.curve is not null as graduated
        from vq_fantasy f left join vv_launches l using (curve) left join vv_grads g using (curve) where f.wallet=$1 and f.week=$2 order by f.added_at`, [w, week]) : { rows: [] },
    w ? db.query("select points, detail, updated_at from vq_fantasy_scores where wallet=$1 and week=$2", [w, week]) : { rows: [] },
    db.query(`select s.wallet, s.points, (select count(*)::int from vq_fantasy f where f.wallet = s.wallet and f.week = s.week) picks,
        (select json_object_agg(i.slot, i.template) from vq_items i where i.wallet = s.wallet and i.equipped) as gear
      from vq_fantasy_scores s where s.week=$1 order by s.points desc, s.updated_at limit 25`, [week]),
  ]);
  const me = mine.rows[0] || {}, detail = me.detail || {};
  const six = w ? (await db.query("select 1 from vq_unlocks where wallet=$1 and key='arena_slot6' and scope=$2", [w, week])).rowCount : 0;
  return { week, ends: endOfWeek(new Date()), max: six ? 6 : 5, max_live: 3, locked: Date.now() > weekStart().getTime() + 86400e3, lock_at: new Date(weekStart().getTime() + 86400e3), picks: picks.rows.map(p => ({ ...p, score: detail[p.curve] || null })),
    points: me.points || 0, updated: me.updated_at || null, table: table.rows.map((r, i) => ({ rank: i + 1, ...r })) };
}
async function fantasyEdit(w, b) {
  const week = weekKey(new Date()), c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_fan:" + w]);
    const cur = (await c.query("select f.curve, f.captain, exists (select 1 from vv_grads g where g.curve = f.curve) grad from vq_fantasy f where f.wallet=$1 and f.week=$2", [w, week])).rows;
    const fail = async e => { await c.query("rollback"); return { ok: false, error: e }; };
    const locked = Date.now() > weekStart().getTime() + 86400e3;   // after Monday you can still fill empty slots, but not swap
    if (b.add) {
      const curve = String(b.add).toLowerCase(); if (!CURVE.test(curve)) return fail("bad_token");
      const l = (await c.query("select creator from vv_launches where curve=$1", [curve])).rows[0];
      if (!l) return fail("bad_token");
      if (l.creator === w) return fail("own_token");
      if (cur.some(p => p.curve === curve)) return fail("already_picked");
      const slots = (await c.query("select 1 from vq_unlocks where wallet=$1 and key='arena_slot6' and scope=$2", [w, week])).rowCount ? 6 : 5;
      if (cur.length >= slots) return fail("roster_full");
      const grad = (await c.query("select 1 from vv_grads where curve=$1", [curve])).rowCount > 0;
      if (!grad && cur.filter(p => !p.grad).length >= 3) return fail("max_live");
      await c.query("insert into vq_fantasy (wallet, week, curve, captain) values ($1,$2,$3,$4)", [w, week, curve, !cur.some(p => p.captain)]);
    } else if (b.remove) {
      const curve = String(b.remove).toLowerCase(), was = cur.find(p => p.curve === curve);
      if (!was) return fail("not_picked");
      if (locked) return fail("locked");
      await c.query("delete from vq_fantasy where wallet=$1 and week=$2 and curve=$3", [w, week, curve]);
      if (was.captain) await c.query("update vq_fantasy set captain=true where (wallet, week, curve) = (select wallet, week, curve from vq_fantasy where wallet=$1 and week=$2 order by added_at limit 1)", [w, week]);
    } else if (b.captain) {
      const curve = String(b.captain).toLowerCase(); if (!cur.some(p => p.curve === curve)) return fail("not_picked");
      if (locked) return fail("locked");
      await c.query("update vq_fantasy set captain=false where wallet=$1 and week=$2 and captain", [w, week]);
      await c.query("update vq_fantasy set captain=true where wallet=$1 and week=$2 and curve=$3", [w, week, curve]);
    } else return fail("bad_request");
    await c.query("commit");
    return { ok: true };
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

// ---------- public hero: share page + card image ----------
async function hero(w) {
  const [chain, p, items, wk, bd] = await Promise.all([
    db.query("select xp, cls, buys, curves, early, launched, grads_caught from vv_wallets where wallet=$1", [w]),
    db.query("select game_xp from vq_players where wallet=$1", [w]),
    db.query("select slot, template, rarity, power from vq_items where wallet=$1 and equipped", [w]),
    db.query("select coalesce(sum(xp),0)::int xp from vq_ledger where wallet=$1 and at >= $2", [w, weekStart()]),
    db.query("select week, badge, rank from vq_badges where wallet=$1 order by week desc", [w]),
  ]);
  if (!p.rowCount && !chain.rowCount) return null;
  const c = chain.rows[0] || {}, xp = (Number(c.xp) || 0) + (Number((p.rows[0] || {}).game_xp) || 0), cls = c.cls || "Fresh";
  return { wallet: w, cls, line: LINES[cls] || "", level: level(xp), xp, week_xp: wk.rows[0].xp, player: !!p.rowCount, badges: bd.rows,
    bonus: Math.min(50, items.rows.reduce((a, i) => a + i.power, 0)),
    gear: Object.fromEntries(items.rows.map(i => [i.slot, i.template])), items: items.rows.map(i => ({ ...i, name: (Items.TEMPLATES.find(t => t.id === i.template) || {}).name || i.template })),
    stats: { buys: +c.buys || 0, tokens: +c.curves || 0, early: +c.early || 0, launched: +c.launched || 0, grads: +c.grads_caught || 0 } };
}
let Canvas = null;
function canvasLib() {
  if (Canvas) return Canvas;
  Canvas = require("@napi-rs/canvas");
  const F = require("path").join(__dirname, "..", "fonts");
  Canvas.GlobalFonts.registerFromPath(F + "/ClashDisplay-Semibold.ttf", "Clash");
  Canvas.GlobalFonts.registerFromPath(F + "/jbm.ttf", "JBM");
  Canvas.GlobalFonts.registerFromPath(F + "/is.ttf", "IS");
  return Canvas;
}
const cardCache = new Map();
async function heroCard(w) {
  const hit = cardCache.get(w); if (hit && Date.now() - hit.at < 300_000) return hit.png;
  const h = await hero(w); if (!h) return null;
  const { createCanvas } = canvasLib(), Viber = require("../viber.js");
  const cv = createCanvas(1200, 630), g = cv.getContext("2d");
  g.fillStyle = "#05060a"; g.fillRect(0, 0, 1200, 630);
  // pixel street
  for (let i = 0; i < 26; i++) { const x = i * 48, hh = 80 + (i * 37) % 150; g.fillStyle = "#0c0f22"; g.fillRect(x, 470 - hh, 40, hh); g.fillStyle = "#dff90233"; for (let y = 480 - hh; y < 455; y += 18) for (let xx = x + 6; xx < x + 34; xx += 12) if ((xx * 7 + y * 3) % 5 < 2) g.fillRect(xx, y, 5, 7); }
  g.fillStyle = "#2a2d36"; g.fillRect(0, 470, 1200, 160); g.fillStyle = "#3b3f4a"; g.fillRect(0, 470, 1200, 8);
  // hero, big, with aura glow
  const S = 13, X = 70, Y = 50, aura = h.gear.aura && Items.TEMPLATES.find(t => t.id === h.gear.aura);
  if (aura) { const col = aura.aura === "rainbow" ? "#ff7ad9" : aura.aura, gr = g.createRadialGradient(X + 16 * S, Y + 16 * S, 10, X + 16 * S, Y + 16 * S, 260); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = .55; g.fillStyle = gr; g.fillRect(0, 0, 600, 630); g.globalAlpha = 1; }
  g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(X + 6 * S, Y + 31 * S, 20 * S, 2 * S);
  Viber.draw(g, w, h.cls, h.level, X, Y, S);
  Items.drawGear(g, h.gear, X, Y, S, 0);
  if (h.gear.pet) Items.drawPet(g, h.gear.pet, X + 30 * S, Y + 20 * S, 8);
  // text
  const R = 560;
  g.fillStyle = "#dff902"; g.font = "600 30px JBM"; g.fillText("VIBERQUEST", R, 92);
  g.fillStyle = "#f2f4f3"; g.font = "600 84px Clash"; g.fillText(h.cls.toUpperCase(), R, 186);
  g.fillStyle = "#b7bdc0"; g.font = "28px IS"; g.fillText(h.line, R, 230);
  g.fillStyle = "#dff902"; g.fillRect(R, 262, 170, 64); g.fillStyle = "#000"; g.font = "600 38px JBM"; g.fillText("LV " + h.level, R + 18, 308);
  g.fillStyle = "#f2f4f3"; g.font = "600 30px JBM"; g.fillText(`${h.xp.toLocaleString("en-US")} XP`, R + 196, 306);
  g.font = "24px JBM"; g.fillStyle = "#b7bdc0";
  g.fillText(`${h.stats.buys} buys · ${h.stats.tokens} tokens · ${h.stats.early} early · ${h.stats.grads} grads`, R, 376);
  const gearTxt = h.items.length ? h.items.map(i => i.name).join(" · ") : "no gear yet";
  let gx = R; g.font = "22px IS";
  for (const it of (h.items.length ? h.items : [{ name: gearTxt, rarity: "common" }])) {
    const t = it.name, tw = g.measureText(t).width + 24; if (gx + tw > 1170) break;
    g.strokeStyle = Items.RARITY[it.rarity].color; g.lineWidth = 2; g.strokeRect(gx, 400, tw, 40); g.fillStyle = Items.RARITY[it.rarity].color; g.fillText(t, gx + 12, 428); gx += tw + 10;
  }
  if (h.badges.length) {
    const BN = { fame: "FAME", arena: "ARENA", guild: "GUILD CHAMP" }, cnt = {};
    for (const b of h.badges) { const k = b.badge === "guild" ? "GUILD CHAMP" : `${BN[b.badge]} #${b.rank}`; cnt[k] = (cnt[k] || 0) + 1; }
    g.font = "600 20px JBM"; let bx = R;
    for (const [k, n] of Object.entries(cnt)) { const t = "★ " + k + (n > 1 ? " x" + n : ""), tw = g.measureText(t).width + 20; if (bx + tw > 1170) break; g.fillStyle = "#ffd23f"; g.fillRect(bx, 458, tw, 34); g.fillStyle = "#000"; g.fillText(t, bx + 10, 482); bx += tw + 8; }
  }
  g.fillStyle = "#7d848a"; g.font = "22px JBM"; g.fillText(w.slice(0, 6) + "…" + w.slice(-4), R, 590);
  g.fillStyle = "#dff902"; g.textAlign = "right"; g.fillText(DOMAIN, 1160, 590);
  const png = await cv.encode("png");
  cardCache.set(w, { at: Date.now(), png }); if (cardCache.size > 2000) cardCache.clear();
  return png;
}
const escH = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function page(req, res, pathname) {
  // the game moved from play.vibercheck.xyz to its own domain: old links keep working
  const host = (req.headers.host || "").split(":")[0];
  if (host === "play.vibercheck.xyz" && DOMAIN !== host) { res.writeHead(301, { Location: `https://${DOMAIN}${req.url}` }); res.end(); return true; }
  let m = /^\/hcard\/(0x[0-9a-fA-F]{40})\.png$/.exec(pathname);
  if (m) {
    const png = await heroCard(m[1].toLowerCase()).catch(e => { console.error("hcard", e.message); return null; });
    if (!png) { res.statusCode = 404; res.end("not found"); return true; }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" }); res.end(png); return true;
  }
  m = /^\/h\/(0x[0-9a-fA-F]{40})$/.exec(pathname);
  if (!m) return false;
  const w = m[1].toLowerCase(), h = await hero(w).catch(() => null);
  const title = h ? `${h.cls} · level ${h.level} on Viberquest` : "Viberquest", img = `https://${DOMAIN}/hcard/${w}.png`;
  const desc = "A pixel RPG on vibe/vibe. Your wallet is your character, your trades are your quests.";
  res.writeHead(h ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(title)}</title><meta name="description" content="${desc}"><link rel="icon" href="/favicon.svg">
<meta property="og:type" content="website"><meta property="og:title" content="${escH(title)}"><meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}"><meta property="og:url" content="https://${DOMAIN}/h/${w}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escH(title)}"><meta name="twitter:image" content="${img}">
<style>body{margin:0;background:#05060a;color:#f2f4f3;font-family:system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:16px;box-sizing:border-box}
img{width:min(900px,100%);border-radius:14px;border:2px solid #1f2329;image-rendering:pixelated}a{background:#dff902;color:#000;font-weight:700;padding:14px 22px;border-radius:9px;text-decoration:none;box-shadow:0 4px 0 #8fa000}p{color:#7d848a;font-size:13px;margin:0}</style></head>
<body>${h ? `<img src="/hcard/${w}.png" alt="${escH(title)}">` : "<p>this wallet has no hero yet</p>"}<a href="/">PLAY VIBERQUEST</a><p>unofficial community game on vibe/vibe testnet. nothing here has monetary value.</p></body></html>`);
  return true;
}

// ---------- guild goal: the guild's combined volume this week opens up to three chests for its Viberquest players ----------
const GOALS = [
  { eth: 100,  mat: { copper: 3, silver: 1 } },
  { eth: 500,  mat: { silver: 2, gold: 1 } },
  { eth: 2000, mat: { gold: 2 } },
];
async function guildGoal(w, slug, week) {
  const [gw, cl] = await Promise.all([
    db.query("select volume, members, updated_at from vq_guild_week where slug=$1 and week=$2", [slug, week]),
    db.query("select ref from vq_ledger where wallet=$1 and what='guild_chest' and ref like $2", [w, week + "#%"]),
  ]);
  const v = gw.rows[0] || { volume: 0, members: 0, updated_at: null }, got = new Set(cl.rows.map(r => r.ref));
  return { slug, volume: v.volume, members: v.members, updated: v.updated_at, levels: GOALS.map((g, i) => ({ level: i + 1, eth: g.eth, mat: g.mat, reached: v.volume >= g.eth, claimed: got.has(week + "#" + (i + 1)) })) };
}
async function guildChest(w, level) {
  const g = GOALS[level - 1]; if (!g) return { ok: false, error: "bad_level" };
  const week = weekKey(new Date());
  const mem = (await db.query("select slug from vv_guild_members where address=$1 limit 1", [w])).rows[0];
  if (!mem) return { ok: false, error: "no_guild" };
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["vq_mat:" + w]);
    const v = (await c.query("select volume from vq_guild_week where slug=$1 and week=$2", [mem.slug, week])).rows[0];
    if (!v || v.volume < g.eth) { await c.query("rollback"); return { ok: false, error: "not_reached" }; }
    const ref = week + "#" + level;
    if ((await c.query("select 1 from vq_ledger where wallet=$1 and what='guild_chest' and ref=$2", [w, ref])).rowCount) { await c.query("rollback"); return { ok: false, error: "claimed" }; }
    for (const [m, n] of Object.entries(g.mat))
      await c.query("insert into vq_materials (wallet, material, amount) values ($1,$2,$3) on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount", [w, m, n]);
    await c.query("insert into vq_ledger (wallet, what, mat, ref) values ($1, 'guild_chest', $2, $3)", [w, JSON.stringify(g.mat), ref]);
    await c.query("commit");
    return { ok: true, mat: g.mat };
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
// sybil guard for free stuff: the wallet must have traded on vibe/vibe in the last 7 days
async function recentTrader(w) {
  return (await db.query("select 1 from vq_trades where wallet=$1 and ts > extract(epoch from now())::bigint - 7 * 86400 limit 1", [w])).rowCount > 0;
}

// ---------- archive of finished weeks ----------
async function seasons(week) {
  const wk = /^\d{4}-W\d{2}$/.test(week || "") ? week : (await db.query("select week from vq_season_done order by week desc limit 1")).rows.map(r => r.week)[0];
  const weeks = (await db.query("select week from vq_season_done order by week desc limit 12")).rows.map(r => r.week);
  if (!wk) return { week: null, weeks, boards: {} };
  const rows = (await db.query(`select s.board, s.rank, s.ref, s.points, s.extra, g.name,
      (select json_object_agg(i.slot, i.template) from vq_items i where i.wallet = s.ref and i.equipped) as gear
    from vq_seasons s left join vv_guilds g on s.board = 'guild' and g.slug = s.ref where s.week=$1 and s.rank <= 10 order by s.board, s.rank`, [wk])).rows;
  const boards = { player: [], arena: [], guild: [] };
  for (const r of rows) (boards[r.board] || []).push(r);
  return { week: wk, weeks, boards };
}

// ---------- guild season (ISO week): guilds ranked by the quest XP their Viberquest players earned ----------
function weekStart() { const d = new Date(); const day = d.getUTCDay() || 7; d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (day - 1)); return d; }
async function guildSeason(w) {
  const rows = (await db.query(`select p.slug, g.name, p.players, p.raw, p.points, coalesce(t.tier, 0) tier
      from vq_guild_points($1, now() + interval '1 minute') p left join vv_guilds g using (slug) left join vq_guild_tier t using (slug)
      order by p.points desc limit 50`, [weekStart()])).rows;
  const mine = w ? (await db.query("select m.slug, g.name from vv_guild_members m left join vv_guilds g using (slug) where m.address=$1 limit 1", [w])).rows[0] : null;
  const tier = mine ? (await db.query("select tier, moved from vq_guild_tier where slug=$1", [mine.slug])).rows[0] : null;
  return { week: weekKey(new Date()), ends: endOfWeek(new Date()), guilds: rows.map((r, i) => ({ rank: i + 1, ...r })), mine: mine ? { ...mine, tier: tier ? tier.tier : 0, moved: tier ? tier.moved : null } : null, cap: 1000 };
}
async function leaderboard() {
  return (await db.query(`select l.wallet, sum(l.xp)::int week_xp, max(p.game_xp)::int total,
      (select g.name from vv_guild_members m left join vv_guilds g using (slug) where m.address = l.wallet limit 1) as guild,
      (select json_object_agg(i.slot, i.template) from vq_items i where i.wallet = l.wallet and i.equipped) as gear
      from vq_ledger l join vq_players p using (wallet) where l.at >= $1 group by l.wallet order by week_xp desc limit 25`, [weekStart()])).rows;
}

// ---------- live town: who is on the street right now (in memory, one app process) ----------
const STREET = 740, STREET_H = 440, EMOTES = new Set(["gm", "lfg", "gg", "fire", "rocket", "wave"]), PACK = new Set(["wagmi", "ngmi", "diamond", "frog", "pray", "skull"]);
const town = { streams: new Set(), players: new Map() };   // players: wallet -> { w, x, tx, face, at, info, lastEmote, streams }
function tsend(res, ev, data) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { } }
function tcast(ev, data) { for (const r of town.streams) tsend(r, ev, data); }
const infoCache = new Map();
async function playerInfo(w) {
  const c = infoCache.get(w); if (c && Date.now() - c.at < 60_000) return c.info;
  const [chain, p, items, g, nc] = await Promise.all([
    db.query("select xp, cls from vv_wallets where wallet=$1", [w]),
    db.query("select game_xp from vq_players where wallet=$1", [w]),
    db.query("select slot, template from vq_items where wallet=$1 and equipped", [w]),
    db.query("select g.name, m.x_username from vv_guild_members m left join vv_guilds g using (slug) where m.address=$1 limit 1", [w]),
    db.query("select key, value from vq_unlocks where wallet=$1 and key in ('name_color','emote_pack')", [w]),
  ]);
  const xp = (Number((chain.rows[0] || {}).xp) || 0) + (Number((p.rows[0] || {}).game_xp) || 0);
  const info = { cls: (chain.rows[0] || {}).cls || "Fresh", level: level(xp), gear: Object.fromEntries(items.rows.map(i => [i.slot, i.template])), guild: (g.rows[0] || {}).name || null, x_name: (g.rows[0] || {}).x_username || null, color: (nc.rows.find(r => r.key === "name_color") || {}).value || null, pack: nc.rows.some(r => r.key === "emote_pack") };
  infoCache.set(w, { at: Date.now(), info }); if (infoCache.size > 5000) infoCache.clear();
  return info;
}
const pub = p => ({ w: p.w, x: p.x, y: p.y, tx: p.tx, ty: p.ty, face: p.face, ...p.info });
async function townMove(w, b) {
  const num = (v, d, max = STREET) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : d; };
  let p = town.players.get(w);
  const fresh = !p;
  if (fresh) { p = { w, x: num(b.x, 370), y: num(b.y, 370, STREET_H), tx: num(b.x, 370), ty: num(b.y, 370, STREET_H), face: 1, streams: 0, lastEmote: 0, moves: [] }; p.info = await playerInfo(w); town.players.set(w, p); }
  const now = Date.now(); p.moves = p.moves.filter(t => now - t < 1000); if (p.moves.length >= 6) return { ok: false, error: "slow_down" }; p.moves.push(now);
  p.x = num(b.x, p.x); p.y = num(b.y, p.y, STREET_H); p.tx = num(b.tx, p.x); p.ty = num(b.ty, p.y, STREET_H); p.face = b.face < 0 ? -1 : 1; p.at = now;
  if (b.refresh) { infoCache.delete(w); p.info = await playerInfo(w); }
  tcast(fresh || b.refresh ? "join" : "move", fresh || b.refresh ? pub(p) : { w, x: p.x, y: p.y, tx: p.tx, ty: p.ty, face: p.face });
  return { ok: true };
}
function townEmote(w, e) {
  const p = town.players.get(w); if (!p || !(EMOTES.has(e) || (PACK.has(e) && p.info.pack))) return { ok: false, error: "bad_emote" };
  if (Date.now() - p.lastEmote < 2500) return { ok: false, error: "slow_down" };
  p.lastEmote = Date.now(); tcast("emote", { w, e }); return { ok: true };
}
const symCache = new Map();
async function symbolOf(curve) {
  if (symCache.has(curve)) return symCache.get(curve);
  const r = (await db.query("select symbol from vv_launches where curve=$1", [curve]).catch(() => ({ rows: [] }))).rows[0];
  const sym = r && r.symbol ? r.symbol : null; symCache.set(curve, sym); if (symCache.size > 20000) symCache.clear(); return sym;
}
setInterval(() => {   // players whose page went away without a clean close
  const now = Date.now();
  for (const [w, p] of town.players) if (!p.streams && now - (p.at || 0) > 45_000) { town.players.delete(w); tcast("leave", { w }); }
  for (const r of town.streams) { try { r.write(": ping\n\n"); } catch (_) { } }
}, 20_000).unref();

// ---------- live events: one LISTEN connection shared by all open pages ----------
const streams = new Map();   // wallet -> Set(res)
let listener = null;
async function listen() {
  const c = new pg.Client({ connectionString: process.env.VQ_PG_URL });
  c.on("notification", m => {
    let e; try { e = JSON.parse(m.payload); } catch (_) { return; }
    if (m.channel === "vv_trade" && town.players.has(e.w) && Number(e.e) > 0)
      symbolOf(e.c).then(sym => tcast("trade", { w: e.w, side: e.s, eth: Number(e.e) / 1e18, sym }));
    const set = streams.get(e.w); if (!set) return;
    const name = m.channel === "vq_event" ? (e.kind === "embers" ? "embers" : "quest") : "trade";
    const data = name === "trade" ? { side: e.s, eth: Number(e.e) / 1e18, ts: e.t, curve: e.c, pool: !!e.d } : e;
    for (const res of set) { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { } }
  });
  c.on("error", () => { listener = null; setTimeout(listen, 3000); });
  try { await c.connect(); await c.query("LISTEN vq_event"); await c.query("LISTEN vv_trade"); listener = c; } catch (e) { console.error("listen", e.message); setTimeout(listen, 5000); }
}
listen();
setInterval(() => { for (const set of streams.values()) for (const res of set) { try { res.write(": ping\n\n"); } catch (_) { } } }, 20_000).unref();

module.exports = async (req, res) => {
  const u = new URL(req.url, "http://local"), route = u.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  if (route !== "pos" && route !== "emote" && limited(req)) return send(res, 429, { ok: false, error: "slow_down" });
  try {
    if (route === "nonce") {
      const nonce = crypto.randomBytes(12).toString("hex");
      await db.query("insert into vq_nonces (nonce) values ($1)", [nonce]);
      await db.query("delete from vq_nonces where created_at < now() - interval '1 day'");
      const message = `${DOMAIN} wants you to sign in to Viberquest.\n\nThis only proves you own this wallet. It is not a transaction and costs nothing.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      return send(res, 200, { ok: true, nonce, message });
    }
    if (route === "login" && req.method === "POST") {
      if (limited(req, 30)) return send(res, 429, { ok: false, error: "slow_down" });
      const b = await readBody(req);
      if (!ADDR.test(b.address || "") || typeof b.signature !== "string" || typeof b.message !== "string") return send(res, 400, { ok: false, error: "bad_request" });
      const m = /Nonce: ([0-9a-f]{24})/.exec(b.message);
      if (!m || !b.message.startsWith(`${DOMAIN} wants you to sign in to Viberquest.`)) return send(res, 400, { ok: false, error: "bad_message" });
      const n = await db.query("update vq_nonces set used = true where nonce = $1 and not used and created_at > now() - interval '10 minutes' returning nonce", [m[1]]);
      if (!n.rowCount) return send(res, 400, { ok: false, error: "nonce_expired" });
      const ok = await verifyMessage({ address: b.address, message: b.message, signature: b.signature }).catch(() => false);
      if (!ok) return send(res, 401, { ok: false, error: "bad_signature" });
      const w = b.address.toLowerCase();
      return send(res, 200, { ok: true, wallet: w }, { "Set-Cookie": sessionCookie(w) });
    }
    if (route === "logout") return send(res, 200, { ok: true }, { "Set-Cookie": "vq=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });

    const w = session(req);
    if (route === "me") return w ? send(res, 200, { ok: true, ...(await me(w)) }) : send(res, 401, { ok: false, error: "signed_out" });
    if (route === "claim" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      const r = await db.query("select vq_claim($1,$2,$3) r", [w, String(b.quest || ""), String(b.period || "")]);
      return send(res, 200, r.rows[0].r);
    }
    if (route === "craft" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      return send(res, 200, await craft(w, String(b.rarity || ""), String(b.slot || "")));
    }
    if (route === "equip" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req), c = await db.connect();
      try {
        await c.query("begin");
        const it = (await c.query("select id, slot from vq_items where id=$1 and wallet=$2 for update", [Number(b.id) || 0, w])).rows[0];
        if (!it) { await c.query("rollback"); return send(res, 404, { ok: false, error: "no_item" }); }
        await c.query("update vq_items set equipped=false where wallet=$1 and slot=$2 and equipped", [w, it.slot]);
        await c.query("update vq_items set equipped=true where id=$1", [it.id]);
        await c.query("commit");
      } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
      return send(res, 200, { ok: true });
    }
    if (route === "unequip" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      await db.query("update vq_items set equipped=false where wallet=$1 and slot=$2", [w, String(b.slot || "")]);
      return send(res, 200, { ok: true });
    }
    if (route === "chest" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      if (!(await recentTrader(w))) return send(res, 200, { ok: false, error: "trade_first" });
      const r = await db.query("select vq_chest($1) r", [w]);
      return send(res, 200, r.rows[0].r);
    }
    if (route === "reroll" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      return send(res, 200, await reroll(w, String(b.quest || ""), !!b.embers));
    }
    if (route === "salvage" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      return send(res, 200, await salvage(w, Number(b.id) || 0));
    }
    if (route === "tokens") return send(res, 200, { ok: true, rows: await tokens(u.searchParams.get("q")) });
    if (route === "fantasy") {
      if (req.method === "POST") {
        if (!w) return send(res, 401, { ok: false, error: "signed_out" });
        const r = await fantasyEdit(w, await readBody(req));
        return send(res, 200, r.ok ? { ok: true, ...(await fantasy(w)) } : r);
      }
      return send(res, 200, { ok: true, ...(await fantasy(w)) });
    }
    if (route.startsWith("hero/")) {
      const a = route.slice(5).toLowerCase(); if (!ADDR.test(a)) return send(res, 400, { ok: false, error: "bad_wallet" });
      const h = await hero(a); return h ? send(res, 200, { ok: true, ...h }) : send(res, 404, { ok: false, error: "unknown" });
    }
    if (route === "guildchest" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req);
      return send(res, 200, await guildChest(w, Number(b.level) || 0));
    }
    if (route === "town") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\n\n");
      if (town.streams.size > 2000) { tsend(res, "full", {}); return res.end(); }
      town.streams.add(res); res.__w = w || null;
      tsend(res, "snap", { players: [...town.players.values()].map(pub) });
      const p = w && town.players.get(w); if (p) p.streams++;
      req.on("close", () => {
        town.streams.delete(res);
        const q = w && town.players.get(w);
        if (q && --q.streams <= 0) { town.players.delete(w); tcast("leave", { w }); }
      });
      return;
    }
    if (route === "pos" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      if (limited(req, 600)) return send(res, 429, { ok: false, error: "slow_down" });
      const r = await townMove(w, await readBody(req));
      const p = town.players.get(w);
      if (p && !p.streams) for (const st of town.streams) if (st.__w === w) p.streams++;
      return send(res, 200, r);
    }
    if (route === "emote" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      if (limited(req, 300)) return send(res, 429, { ok: false, error: "slow_down" });
      const b = await readBody(req);
      return send(res, 200, townEmote(w, String(b.e || "")));
    }
    if (route === "buy" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req); return send(res, 200, await buy(w, String(b.key || ""), b.value));
    }
    if (route === "guildbase" && req.method === "POST") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const b = await readBody(req); return send(res, 200, await guildBase(w, b.amount));
    }
    if (route === "sponsor") {
      if (req.method === "POST") { if (!w) return send(res, 401, { ok: false, error: "signed_out" }); return send(res, 200, await sponsorCreate(w, await readBody(req))); }
      return send(res, 200, { ok: true, ...(await sponsorInfo(w)), price: (await econ()).prices.sponsor_slot, live: (await econ()).live });
    }
    let sm = /^sponsor\/(\d+)\/completers$/.exec(route);
    if (sm) {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const sp = (await db.query("select sponsor from vq_sponsors where id=$1", [Number(sm[1])])).rows[0];
      if (!sp || sp.sponsor !== w) return send(res, 403, { ok: false, error: "not_yours" });
      const rows = (await db.query("select wallet, completed_at from vq_progress where quest_id=$1 and completed_at is not null order by completed_at", ["sp_" + sm[1]])).rows;
      res.statusCode = 200; res.setHeader("Content-Type", "text/csv"); res.setHeader("Content-Disposition", `attachment; filename="sponsored-${sm[1]}.csv"`);
      return res.end("wallet,completed_at\n" + rows.map(r => `${r.wallet},${new Date(r.completed_at).toISOString()}`).join("\n"));
    }
    if (route === "vqbalance") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      const e = await econ(); if (!e.live) return send(res, 200, { ok: false, error: "economy_off" });
      const bal = await rpcCall("eth_call", [{ to: e.token, data: "0x70a08231" + w.replace(/^0x/, "").padStart(64, "0") }, "latest"]).catch(() => null);
      return send(res, 200, bal ? { ok: true, balance: Number(BigInt(bal) / 10n ** 14n) / 1e4 } : { ok: false, error: "rpc" });
    }
    if (route === "treasury") return send(res, 200, { ok: true, ...(await treasury()) });
    if (route === "seasons") return send(res, 200, { ok: true, ...(await seasons(u.searchParams.get("week"))) });
    if (route === "guild") return send(res, 200, { ok: true, ...(await guildSeason(w)) });
    if (route === "leaderboard") return send(res, 200, { ok: true, rows: await leaderboard() });
    if (route === "events") {
      if (!w) return send(res, 401, { ok: false, error: "signed_out" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\n\nevent: hello\ndata: {}\n\n");
      if (!streams.has(w)) streams.set(w, new Set());
      streams.get(w).add(res);
      req.on("close", () => { const s = streams.get(w); if (s) { s.delete(res); if (!s.size) streams.delete(w); } });
      return;
    }
    return send(res, 404, { ok: false, error: "not_found" });
  } catch (e) {
    console.error(route, e.message);
    return send(res, 500, { ok: false, error: "server" });
  }
};
module.exports.page = page;
