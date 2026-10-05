// Vibequest quest engine. Every open quest's progress is recomputed from chain data (the vibercheck index), so it is
// idempotent and can't double count. Runs right away when one of the player's trades lands (NOTIFY vv_trade from the
// indexers) and sweeps everything every 60 s for time-based rules (holds, graduations, expiry).
// Pushes NOTIFY vq_event {w, quest, period, progress, target, done} for the live UI.
import pg from "pg";

const VIBEVIBE = "0xf1f6b050550531226ee0257fec4a1e575ff4c341";
const db = new pg.Pool({ host: "/var/run/postgresql", database: "bureau", user: "postgres", max: 4 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// every trade of a wallet, curve and pool, in ETH; valued=false trades (token paid directly, no ETH known) are left out
await db.query(`create or replace view vq_trades as
  select t.wallet, t.curve, t.side, t.eth / 1e18 as eth, t.tokens, t.ts, t.block, t.log_idx, 'curve'::text as venue
    from vv_trades t where t.valued
  union all
  select d.wallet, d.curve, d.side, d.eth / 1e18, d.tokens, d.ts, d.block, d.log_idx, 'pool' from vv_dex d`);

const epoch = d => Math.floor(new Date(d).getTime() / 1000);

// position of a curve buy among all buys of that curve (creator excluded); never changes, so cached forever
const positions = new Map();
async function position(t) {
  const k = t.curve + ":" + t.block + ":" + t.log_idx;
  if (!positions.has(k)) {
    const q = await db.query(`select count(*)::int n from vv_trades p where p.curve = $1 and p.side = 1 and p.wallet <> $2 and (p.block, p.log_idx) < ($3::bigint, $4::int)`, [t.curve, t.creator, t.block, t.log_idx]);
    positions.set(k, q.rows[0].n + 1);
    if (positions.size > 500000) positions.clear();
  }
  return positions.get(k);
}

// one query per wallet: its trades since its oldest open quest, with what the rules need about each token
async function walletData(w, since) {
  const t = await db.query(`select t.curve, t.side, t.eth::float, t.ts::bigint, t.block::bigint, t.log_idx, t.venue, l.creator, l.ts::bigint as launch_ts, l.native, l.pair,
      exists (select 1 from vv_launches x where x.token = l.pair) as pair_is_vibe, g.block::bigint as grad_block
    from vq_trades t join vv_launches l using (curve) left join vv_grads g using (curve)
    where t.wallet = $1 and t.ts >= $2 order by t.ts, t.block, t.log_idx`, [w, since]);
  return t.rows.map(r => ({ ...r, ts: Number(r.ts), block: Number(r.block), launch_ts: Number(r.launch_ts), grad_block: r.grad_block == null ? null : Number(r.grad_block) }));
}

// each rule: (trades in the quest window, rule, ctx) -> { progress, target }
const RULES = {
  buys: (T, r) => ({ progress: T.filter(t => t.side === 1 && t.eth >= (r.min_eth || 0)).length, target: r.count || 1 }),
  distinct_buys: (T, r) => ({ progress: new Set(T.filter(t => t.side === 1 && t.eth >= (r.min_eth || 0)).map(t => t.curve)).size, target: r.count || 1 }),
  pool_buys: (T, r) => ({ progress: T.filter(t => t.side === 1 && t.venue === "pool" && t.eth >= (r.min_eth || 0)).length, target: r.count || 1 }),
  fresh_buy: (T, r) => ({ progress: T.some(t => t.side === 1 && t.eth >= (r.min_eth || 0) && t.ts - t.launch_ts <= (r.max_age_min || 60) * 60) ? 1 : 0, target: 1 }),
  pair_buy: (T, r) => ({
    progress: T.some(t => t.side === 1 && t.eth >= (r.min_eth || 0) && (r.pair === "vibevibe" ? t.pair === VIBEVIBE : !t.native && t.pair !== VIBEVIBE && !t.pair_is_vibe)) ? 1 : 0, target: 1 }),
  hold(T, r, ctx) {
    // a buy in the window, no sell of that token for `hours` after it, and those hours have passed
    const secs = (r.hours || 6) * 3600; let best = 0;
    for (const b of (r.curve ? T.filter(t => t.curve === r.curve) : T)) {
      if (b.side !== 1 || b.eth < (r.min_eth || 0)) continue;
      const sell = ctx.all.find(s => s.curve === b.curve && s.side === -1 && s.ts >= b.ts);
      const heldTo = sell ? sell.ts : ctx.now;
      if (heldTo - b.ts >= secs) return { progress: secs / 60, target: secs / 60 };
      if (!sell) best = Math.max(best, ctx.now - b.ts);
    }
    return { progress: Math.floor(best / 60), target: secs / 60 };   // minutes, so the bar moves while you hold
  },
  async early_buy(T, r) {
    const hit = new Set();
    for (const t of T) {
      if (t.side !== 1 || t.venue !== "curve" || t.eth < (r.min_eth || 0) || hit.has(t.curve) || t.creator === T.wallet) continue;
      if (await position(t) <= (r.max_position || 10)) hit.add(t.curve);
      if (hit.size >= (r.count || 1)) break;
    }
    return { progress: hit.size, target: r.count || 1 };
  },
  flip_profit: (T, r, ctx) => ({
    progress: T.some(b => b.side === 1 && b.eth >= (r.min_eth || 0) && ctx.all.some(s => s.curve === b.curve && s.side === -1 && s.ts >= b.ts && s.ts <= b.ts + (r.minutes || 10) * 60 && s.eth > b.eth)) ? 1 : 0, target: 1 }),
  volume(T, r) {   // milli-ETH; wash filter: a buy sold again within 10 minutes, and that sell, don't count
    const wash = new Set();
    for (const b of T) if (b.side === 1) for (const x of T) if (x.side === -1 && x.curve === b.curve && x.ts >= b.ts && x.ts - b.ts <= 600) { wash.add(b); wash.add(x); }
    return { progress: Math.floor(T.filter(t => !wash.has(t)).reduce((a, t) => a + t.eth, 0) * 1000), target: Math.round((r.eth || 1) * 1000) };
  },
  active_days: (T, r) => ({ progress: new Set(T.filter(t => t.eth >= (r.min_eth || 0)).map(t => Math.floor(t.ts / 86400))).size, target: r.days || 5 }),
  graduation_caught: (T, r) => ({
    progress: new Set(T.filter(t => t.side === 1 && t.venue === "curve" && t.eth >= (r.min_eth || 0) && t.grad_block != null && t.grad_block > t.block).map(t => t.curve)).size, target: r.count || 1 }),
  sponsor_hold: (T, r, ctx) => RULES.hold(T, r, ctx),   // a sponsored quest: buy that token and hold it
  async in_guild(T, r, ctx) {   // listed in the public member list of any vibe/vibe guild
    const q = await db.query("select 1 from vv_guild_members where address = $1 limit 1", [ctx.wallet]);
    return { progress: q.rowCount ? 1 : 0, target: 1 };
  },
  async launches(T, r, ctx) {
    const q = await db.query("select count(*)::int n from vv_launches where creator=$1 and ts between $2 and $3", [ctx.wallet, ctx.since, ctx.until]);
    return { progress: q.rows[0].n, target: r.count || 1 };
  },
  async launch_buyers(T, r, ctx) {
    const q = await db.query(`select coalesce(max(n),0)::int n from (select count(distinct t.wallet) n from vv_launches l join vq_trades t using (curve)
      where l.creator=$1 and l.ts between $2 and $3 and t.side=1 and t.wallet <> l.creator group by l.curve) x`, [ctx.wallet, ctx.since, ctx.until]);
    return { progress: Math.min(q.rows[0].n, r.buyers || 20), target: r.buyers || 20 };
  },
};

async function evaluateWallet(wallet, rows) {
  const since = Math.min(...rows.map(r => epoch(r.accepted_at))), now = Math.floor(Date.now() / 1000);
  const all = await walletData(wallet, since);
  for (const row of rows) {
    const fn = RULES[row.rule.type]; if (!fn) continue;
    try {
      const s = epoch(row.accepted_at), u = row.expires_at ? epoch(row.expires_at) : 4e9;
      const T = all.filter(t => t.ts >= s && t.ts <= u && t.creator !== wallet); T.wallet = wallet;   // own launches never count
      const r = await fn(T, row.rule, { all, now, wallet, since: s, until: u });
      const progress = Math.min(r.progress, r.target), done = progress >= r.target;
      if (progress === row.progress && r.target === row.target && done === !!row.completed_at) continue;
      await db.query(`update vq_progress set progress=$4, target=$5, completed_at = case when $6 and completed_at is null then now() else completed_at end
        where wallet=$1 and quest_id=$2 and period=$3`, [wallet, row.quest_id, row.period, progress, r.target, done]);
      await db.query("select pg_notify('vq_event', $1)", [JSON.stringify({ w: wallet, quest: row.quest_id, period: row.period, progress, target: r.target, done })]);
    } catch (e) { console.error("eval", row.quest_id, e.message); }
  }
}

const OPEN = `select p.*, q.rule from vq_progress p join vq_quests q on q.id = p.quest_id
  where p.completed_at is null and (p.expires_at is null or p.expires_at > now() - interval '10 minutes')`;
async function sweep(wallet) {
  const rows = (await db.query(wallet ? OPEN + " and p.wallet = $1" : OPEN, wallet ? [wallet] : [])).rows;
  const byWallet = new Map();
  for (const r of rows) { if (!byWallet.has(r.wallet)) byWallet.set(r.wallet, []); byWallet.get(r.wallet).push(r); }
  for (const [w, rs] of byWallet) { try { await evaluateWallet(w, rs); } catch (e) { console.error("wallet", w, e.message); } }
  return rows.length;
}

// ---------- fantasy launchpad league ----------
// each pick scores only what happens after it was added: graduation +100, new unique buyers +1 (max 300),
// volume +5 per ETH (max 500), wallets that turned net sellers -1 (max -300); the captain counts 1.5x
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}
// rug signal: the creator sold after the pick and has sold at least half of everything it bought: -200
async function scorePick(curve, since, until, picker) {
  const q = await db.query(`select
      coalesce(sum(eth) filter (where eth >= 0.002 and wallet <> $4), 0)::float as vol,
      count(distinct wallet) filter (where side = 1 and eth >= 0.002 and wallet <> $4)::int as buyers,
      (select count(*) from (select wallet from vq_trades where curve = $1 and ts >= $2 and ts < $3 group by wallet having sum(case when side = 1 then tokens else -tokens end) < 0) z)::int as sellers,
      exists (select 1 from vv_grads g where g.curve = $1 and g.ts >= $2 and g.ts < $3) as grad,
      (select coalesce(bool_or(c.side = -1 and c.ts >= $2 and c.ts < $3), false) and coalesce(sum(c.tokens) filter (where c.side = -1), 0) >= 0.5 * coalesce(sum(c.tokens) filter (where c.side = 1), 0)
         from vq_trades c join vv_launches l on l.curve = c.curve and c.wallet = l.creator where c.curve = $1 and c.ts < $3) as rug
    from vq_trades where curve = $1 and ts >= $2 and ts < $3`, [curve, since, until, picker]);
  const r = q.rows[0], parts = { grad: r.grad ? 100 : 0, buyers: Math.min(300, r.buyers), volume: Math.min(500, Math.floor(r.vol * 5)), sellers: -Math.min(300, r.sellers), rug: r.rug ? -200 : 0 };
  return { parts, points: parts.grad + parts.buyers + parts.volume + parts.sellers + parts.rug };
}
async function scoreFantasy(week = isoWeek(new Date()), until = 4e9) {
  const picks = (await db.query("select wallet, curve, captain, extract(epoch from added_at)::bigint as since from vq_fantasy where week = $1", [week])).rows;
  const byWallet = new Map();
  for (const p of picks) {
    const s = await scorePick(p.curve, Number(p.since), until, p.wallet), pts = p.captain ? Math.round(s.points * 1.5) : s.points;
    if (!byWallet.has(p.wallet)) byWallet.set(p.wallet, { points: 0, detail: {} });
    const w = byWallet.get(p.wallet); w.points += pts; w.detail[p.curve] = { ...s.parts, points: pts, captain: p.captain };
  }
  for (const [wallet, v] of byWallet)
    await db.query(`insert into vq_fantasy_scores (wallet, week, points, detail, updated_at) values ($1,$2,$3,$4,now())
      on conflict (wallet, week) do update set points = excluded.points, detail = excluded.detail, updated_at = now()`, [wallet, week, v.points, JSON.stringify(v.detail)]);
  await db.query("delete from vq_fantasy_scores s where week = $1 and not exists (select 1 from vq_fantasy f where f.wallet = s.wallet and f.week = s.week)", [week]);
  return picks.length;
}
setInterval(() => { scoreFantasy().catch(e => console.error("fantasy", e.message)); }, 120_000);
scoreFantasy().catch(e => console.error("fantasy", e.message));

// ---------- guild weekly goal: combined volume of every visible member of guilds that have Vibequest players ----------
const mondayOf = d => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1)); return t; };
async function guildWeek() {
  const now = new Date(), week = isoWeek(now), from = Math.floor(mondayOf(now).getTime() / 1000);
  const rows = (await db.query(`select m.slug, count(distinct m.address)::int members, coalesce(sum(t.eth), 0)::float volume
      from vv_guild_members m left join vq_trades t on t.wallet = m.address and t.ts >= $1
      where m.slug in (select distinct g.slug from vv_guild_members g join vq_players p on p.wallet = g.address)
      group by m.slug`, [from])).rows;
  for (const r of rows)
    await db.query(`insert into vq_guild_week (slug, week, volume, members, updated_at) values ($1,$2,$3,$4,now())
      on conflict (slug, week) do update set volume = excluded.volume, members = excluded.members, updated_at = now()`, [r.slug, week, r.volume, r.members]);
  return rows.length;
}
setInterval(() => { guildWeek().catch(e => console.error("guildweek", e.message)); }, 300_000);
guildWeek().catch(e => console.error("guildweek", e.message));

// ---------- $VQUEST on chain: burns to 0x...dEaD become Embers, treasury payouts are recorded ----------
const RPC = "https://rpc.testnet.chain.robinhood.com";
const DEAD = "0x000000000000000000000000000000000000dead";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = a => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const unpad = t => "0x" + t.slice(26).toLowerCase();
async function rpc(method, params) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).catch(() => null);
    if (r && r.ok) { const j = await r.json(); if (!j.error) return j.result; if (!/rate|limit|429/i.test(JSON.stringify(j.error))) throw new Error(j.error.message); }
    await sleep(800 * (i + 1));
  }
  throw new Error("rpc " + method + " failed");
}
const blockTs = new Map();
async function tsOf(bn) {
  if (!blockTs.has(bn)) { const b = await rpc("eth_getBlockByNumber", ["0x" + bn.toString(16), false]); blockTs.set(bn, parseInt(b.timestamp, 16)); if (blockTs.size > 5000) blockTs.clear(); }
  return blockTs.get(bn);
}
async function econConfig() { return Object.fromEntries((await db.query("select key, value from vq_config")).rows.map(r => [r.key, r.value ? r.value.toLowerCase() : null])); }
async function indexToken() {
  const c = await econConfig(); if (!c.token) return 0;
  let cur = (await db.query("select block from vq_chain_cursor where name = 'vq_token'")).rows[0];
  let from = cur ? Number(cur.block) + 1 : Number(((await db.query("select block from vv_launches where token = $1", [c.token])).rows[0] || {}).block || 0);
  if (!from) from = parseInt(await rpc("eth_blockNumber", []), 16) - 1000;
  const head = parseInt(await rpc("eth_blockNumber", []), 16) - 2;   // a couple of blocks of safety
  let n = 0;
  while (from <= head) {
    const to = Math.min(head, from + 9999);
    const range = { address: c.token, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) };
    const logs = [...await rpc("eth_getLogs", [{ ...range, topics: [TRANSFER, null, pad(DEAD)] }])];
    if (c.treasury) logs.push(...await rpc("eth_getLogs", [{ ...range, topics: [TRANSFER, pad(c.treasury)] }]));
    for (const l of logs) {
      const src = unpad(l.topics[1]), dst = unpad(l.topics[2]), amount = BigInt(l.data).toString(), bn = parseInt(l.blockNumber, 16), li = parseInt(l.logIndex, 16);
      const kind = dst === DEAD ? "burn" : "payout", ts = await tsOf(bn);
      const ins = await db.query("insert into vq_transfers (tx, log_idx, block, ts, src, dst, amount, kind) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning tx", [l.transactionHash, li, bn, ts, src, dst, amount, kind]);
      if (ins.rowCount && kind === "burn") {
        const embers = Number(BigInt(amount) / 10n ** 14n) / 1e4;   // 1 VQUEST = 1 Ember, 4 decimals kept
        await db.query("insert into vq_embers (wallet, delta, what, ref, at) values ($1,$2,'burn',$3, to_timestamp($4)) on conflict do nothing", [src, embers, l.transactionHash + ":" + li, ts]);
        await db.query("select pg_notify('vq_event', $1)", [JSON.stringify({ w: src, kind: "embers", amount: embers })]);
        n++;
      }
    }
    await db.query("insert into vq_chain_cursor (name, block) values ('vq_token', $1) on conflict (name) do update set block = excluded.block", [to]);
    from = to + 1;
  }
  return n;
}
(async function tokenLoop() {
  for (;;) {
    try { const n = await indexToken(); if (n) console.log(`credited ${n} burn(s) as Embers`); } catch (e) { console.error("token", e.message); }
    await sleep(6000);
  }
})();

// ---------- end of season: archive last week's boards, hand out badges, move guilds between tiers ----------
const TIERS = ["bronze", "silver", "gold", "diamond"];
async function finalize() {
  const prev = new Date(Date.now() - 7 * 864e5), week = isoWeek(prev);
  if ((await db.query("select 1 from vq_season_done where week = $1", [week])).rowCount) return;
  const from = mondayOf(prev), to = new Date(from.getTime() + 7 * 864e5);
  await scoreFantasy(week, Math.floor(to.getTime() / 1000));   // last scoring pass, cut at the week end
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('vq_finalize'))");
    if ((await c.query("select 1 from vq_season_done where week = $1", [week])).rowCount) { await c.query("rollback"); return; }
    const players = (await c.query("select wallet as ref, sum(xp)::int points from vq_ledger where at >= $1 and at < $2 and xp > 0 group by wallet order by points desc limit 100", [from, to])).rows;
    const arena = (await c.query("select wallet as ref, points from vq_fantasy_scores where week = $1 and points > 0 order by points desc, updated_at limit 100", [week])).rows;
    const guilds = (await c.query("select slug as ref, points, players, raw from vq_guild_points($1, $2) where points > 0 order by points desc", [from, to])).rows;
    const tiers = new Map((await c.query("select slug, tier from vq_guild_tier")).rows.map(r => [r.slug, r.tier]));
    for (const g of guilds) if (!tiers.has(g.ref)) tiers.set(g.ref, 0);
    const pts = new Map(guilds.map(g => [g.ref, g.points]));
    // tiers: in each tier the top 20% (at least one, with points) go up, the bottom 20% and anyone with no points go down
    const moves = new Map();
    for (let t = 0; t < 4; t++) {
      const list = [...tiers].filter(([, x]) => x === t).map(([slug]) => slug).sort((a, b) => (pts.get(b) || 0) - (pts.get(a) || 0));
      if (!list.length) continue;
      const k = Math.max(1, Math.floor(list.length * .2));
      if (t < 3) list.slice(0, k).filter(sl => (pts.get(sl) || 0) > 0).forEach(sl => moves.set(sl, "up"));
      if (t > 0) list.forEach((sl, i) => { if (moves.has(sl)) return; if (!(pts.get(sl) > 0) || (list.length >= 3 && i >= list.length - Math.floor(list.length * .2))) moves.set(sl, "down"); });
    }
    for (const [slug, tier] of tiers) {
      const mv = moves.get(slug) || null, nt = Math.max(0, Math.min(3, tier + (mv === "up" ? 1 : mv === "down" ? -1 : 0)));
      await c.query(`insert into vq_guild_tier (slug, tier, moved, updated_week) values ($1,$2,$3,$4)
        on conflict (slug) do update set tier = excluded.tier, moved = excluded.moved, updated_week = excluded.updated_week`, [slug, nt, mv, week]);
    }
    const save = (board, rows, extra) => Promise.all(rows.map((r, i) => c.query("insert into vq_seasons (week, board, rank, ref, points, extra) values ($1,$2,$3,$4,$5,$6) on conflict do nothing",
      [week, board, i + 1, r.ref, r.points, extra ? JSON.stringify(extra(r)) : null])));
    await save("player", players); await save("arena", arena);
    await save("guild", guilds, g => ({ players: g.players, raw: g.raw, tier: TIERS[tiers.get(g.ref) || 0], moved: moves.get(g.ref) || null }));
    const badge = (wallet, b, rank) => c.query("insert into vq_badges (wallet, week, badge, rank) values ($1,$2,$3,$4) on conflict do nothing", [wallet, week, b, rank]);
    for (const [i, r] of players.slice(0, 3).entries()) await badge(r.ref, "fame", i + 1);
    for (const [i, r] of arena.slice(0, 3).entries()) await badge(r.ref, "arena", i + 1);
    if (guilds[0]) {   // everyone in the winning guild who earned quest XP that week
      const champs = (await c.query(`select distinct l.wallet from vq_ledger l join vv_guild_members m on m.address = l.wallet
        where m.slug = $1 and l.at >= $2 and l.at < $3 and l.xp > 0`, [guilds[0].ref, from, to])).rows;
      for (const r of champs) await badge(r.wallet, "guild", 1);
    }
    await c.query("insert into vq_season_done (week) values ($1)", [week]);
    await c.query("commit");
    console.log(`season ${week} archived: ${players.length} players, ${arena.length} arena, ${guilds.length} guilds`);
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
setInterval(() => { finalize().catch(e => console.error("finalize", e.message)); }, 300_000);
finalize().catch(e => console.error("finalize", e.message));

// live: re-check a wallet's quests when one of its trades lands (debounced per wallet)
const pending = new Map();
const listener = new pg.Client({ host: "/var/run/postgresql", database: "bureau", user: "postgres" });
listener.on("notification", m => {
  let t; try { t = JSON.parse(m.payload); } catch (_) { return; }
  if (pending.has(t.w)) return;
  pending.set(t.w, setTimeout(() => { pending.delete(t.w); sweep(t.w).catch(e => console.error("live", e.message)); }, 1500));
});
listener.on("error", e => { console.error("listener", e.message); process.exit(1); });   // systemd restarts us
await listener.connect(); await listener.query("LISTEN vv_trade");
console.log("vibequest engine up");
for (;;) {
  const t0 = Date.now();
  try { const n = await sweep(); if (n) console.log(`swept ${n} open quests in ${Date.now() - t0} ms`); } catch (e) { console.error("sweep", e.message); }
  await sleep(60_000);
}
