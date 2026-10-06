// Demo hero for the promo video (run on the server as postgres): node demo_dungeon.cjs <cmd> [run id]
//   setup          -> fresh demo wallet with good gear, some XP/materials/gold
//   cookie         -> its session cookie (run as root: reads the app's .env, no database)
//   eligible <id>  -> let this run drop $VQUEST (the demo wallet has no vibe/vibe trades)
//   toboss <id>    -> clear the floor and jump to floor 4, so the stairs lead to the floor 5 boss
//   clean          -> delete everything the demo wallet left behind
const fs = require("fs"), crypto = require("crypto");
const { Client } = require("/srv/apps/vibequest/node_modules/pg");
const W = "0x0000000000000000000000000000000000d3a0d0";
(async () => {
  const [cmd, id] = process.argv.slice(2);
  if (cmd === "cookie") {
    const env = Object.fromEntries(fs.readFileSync("/srv/apps/vibequest/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
    const v = `${W}.${Math.floor(Date.now() / 1000) + 7200}`;
    return console.log(JSON.stringify({ wallet: W, cookie: v + "." + crypto.createHmac("sha256", env.SESSION_SECRET).update(v).digest("hex").slice(0, 40) }));
  }
  const db = new Client({ host: "/var/run/postgresql", database: "bureau" }); await db.connect();
  if (cmd === "setup" || cmd === "clean") {
    for (const t of ["vq_runs", "vq_balances", "vq_vquest_drops", "vq_ledger", "vq_materials", "vq_items", "vq_progress", "vq_badges"]) await db.query(`delete from ${t} where wallet=$1`, [W]);
    await db.query("delete from vq_players where wallet=$1", [W]);
  }
  if (cmd === "setup") {
    await db.query("insert into vq_players (wallet, game_xp) values ($1, 5200)", [W]);
    for (const [slot, t] of [["head", "crown"], ["eyes", "diamondeye"], ["body", "goldarmor"], ["aura", "rainbow"], ["pet", "frog"]])
      await db.query("insert into vq_items (wallet, slot, template, rarity, power, equipped) values ($1,$2,$3,'legendary',10,true)", [W, slot, t]);
    for (const [m, n] of [["copper", 42], ["silver", 17], ["gold", 6], ["diamond", 2]]) await db.query("insert into vq_materials (wallet, material, amount) values ($1,$2,$3)", [W, m, n]);
    await db.query("insert into vq_balances (wallet, gold) values ($1, 640)", [W]);
  }
  if (cmd === "eligible") await db.query("update vq_runs set state = jsonb_set(state, '{eligible}', 'true') where id=$1 and wallet=$2", [id, W]);
  if (cmd === "toboss") await db.query(`update vq_runs set floor = 4, state = jsonb_set(state, '{mobs}',
    (select jsonb_object_agg(k, jsonb_set(v, '{hp}', '0')) from jsonb_each(state->'mobs') x(k, v))) where id=$1 and wallet=$2`, [id, W]);
  await db.end(); console.log(cmd, "ok");
})().catch(e => { console.error(e.message); process.exit(1); });
