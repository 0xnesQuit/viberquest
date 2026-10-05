-- Viberquest v5: the $VQUEST economy. The game never mints and never holds anyone's tokens:
-- players burn VQUEST (a plain transfer to 0x...dEaD from their own wallet), the indexer sees it and credits Embers 1:1.
-- Embers are the in-game spend unit (not transferable). Rewards only come from the token's fee treasury (buybacks).

-- every VQUEST transfer the economy cares about: burns (to dEaD) and treasury payouts (from the treasury)
create table if not exists vq_transfers (
  tx       text not null,
  log_idx  int  not null,
  block    bigint not null,
  ts       bigint not null,
  src      text not null,
  dst      text not null,
  amount   numeric not null,          -- raw units (18 decimals)
  kind     text not null check (kind in ('burn', 'payout')),
  primary key (tx, log_idx)
);
create index if not exists vq_transfers_src on vq_transfers (src);
create index if not exists vq_transfers_dst on vq_transfers (dst);
create table if not exists vq_chain_cursor (name text primary key, block bigint not null);

-- Ember ledger: + from burns (ref = tx:log), - from spends. Balance = sum(delta).
create table if not exists vq_embers (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  wallet text not null,
  delta  numeric not null,
  what   text not null,
  ref    text
);
create unique index if not exists vq_embers_burn_once on vq_embers (ref) where what = 'burn';
create index if not exists vq_embers_wallet on vq_embers (wallet);
create or replace function vq_ember_balance(p_wallet text) returns numeric language sql stable as $$
  select coalesce(sum(delta), 0) from vq_embers where wallet = p_wallet
$$;
-- spend atomically: fails with no change if the balance is short
create or replace function vq_ember_spend(p_wallet text, p_amount numeric, p_what text, p_ref text) returns boolean
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('vq_ember:' || p_wallet));
  if p_amount <= 0 then return true; end if;
  if vq_ember_balance(p_wallet) < p_amount then return false; end if;
  insert into vq_embers (wallet, delta, what, ref) values (p_wallet, -p_amount, p_what, p_ref);
  return true;
end $$;

-- prices in Embers, tunable after launch without a deploy
create table if not exists vq_prices (key text primary key, embers numeric not null, note text);
insert into vq_prices (key, embers, note) values
  ('forge_epic',      100,   'extra Ember cost of an epic forge'),
  ('forge_legendary', 300,   'extra Ember cost of a legendary forge'),
  ('forge_mythic',    1000,  'mythic forge (plus 2 diamonds)'),
  ('hard_mode',       200,   'unlock 3 hard-mode quests for the week'),
  ('extra_swap',      50,    'one more daily quest swap'),
  ('arena_slot6',     150,   'a 6th Arena pick for the week'),
  ('name_color',      300,   'coloured name in town'),
  ('emote_pack',      200,   'extra emotes'),
  ('sponsor_slot',    50000, 'a 24h sponsored quest'),
  ('guild_l1',        5000,  'guild base level 1 (+2% XP)'),
  ('guild_l2',        20000, 'guild base level 2 (+4% XP)'),
  ('guild_l3',        60000, 'guild base level 3 (+6% XP)')
on conflict (key) do nothing;

-- cosmetics and weekly unlocks bought with Embers
create table if not exists vq_unlocks (wallet text not null, key text not null, scope text not null default 'forever', value text, at timestamptz not null default now(), primary key (wallet, key, scope));

-- guild base: members pool Embers, the level gives every member a small XP bonus
create table if not exists vq_guild_base (slug text primary key, embers numeric not null default 0, level int not null default 0, updated_at timestamptz not null default now());
create or replace function vq_guild_bonus(p_wallet text) returns int language sql stable as $$
  select coalesce((select case b.level when 3 then 6 when 2 then 4 when 1 then 2 else 0 end
    from vv_guild_members m join vq_guild_base b using (slug) where m.address = p_wallet limit 1), 0)
$$;

-- sponsored quests: a vibe/vibe builder pays Embers for a 24h "buy and hold" quest on their own token
create table if not exists vq_sponsors (
  id         bigserial primary key,
  sponsor    text not null,
  curve      text not null,
  symbol     text,
  title      text not null,
  hold_hours int  not null default 6 check (hold_hours between 6 and 48),
  min_eth    numeric not null default 0.002,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  embers     numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists vq_sponsors_live on vq_sponsors (starts_at, ends_at);

-- quest kinds for hard mode and sponsored quests
alter table vq_quests drop constraint if exists vq_quests_kind_check;
alter table vq_quests add constraint vq_quests_kind_check check (kind in ('daily', 'weekly', 'story', 'hard', 'sponsored'));
insert into vq_quests (id, kind, title, descr, rule, reward, sort) values
('h_volume5', 'hard', 'Heavy week',      'Trade 5 ETH of volume this week (quick flips filtered out).', '{"type":"volume","eth":5}',                                   '{"xp":800,"mat":{"gold":2}}', 300),
('h_early5',  'hard', 'Sniper elite',    'Be one of the first 10 buyers on 5 different tokens.',          '{"type":"early_buy","count":5,"max_position":10,"min_eth":0.002}', '{"xp":900,"mat":{"gold":1,"diamond":1}}', 310),
('h_grad3',   'hard', 'Graduation hunter','Buy 3 tokens before they graduate and see all 3 graduate.',    '{"type":"graduation_caught","count":3,"min_eth":0.002}',      '{"xp":900,"mat":{"diamond":1}}', 320),
('h_days7',   'hard', 'Every single day', 'Trade on 7 different days this week.',                         '{"type":"active_days","days":7,"min_eth":0.002}',             '{"xp":700,"mat":{"gold":2}}', 330),
('h_launch50','hard', 'Crowd puller',    'A token you launched this week reaches 50 different buyers.',   '{"type":"launch_buyers","buyers":50}',                        '{"xp":1000,"mat":{"diamond":2}}', 340)
on conflict (id) do update set kind = excluded.kind, title = excluded.title, descr = excluded.descr, rule = excluded.rule, reward = excluded.reward, sort = excluded.sort;

-- quest rewards now add the guild base bonus on top of the gear bonus (gear max +50%, base max +6%)
create or replace function vq_claim(p_wallet text, p_quest text, p_period text) returns jsonb
language plpgsql as $$
declare r record; q record; m text; amt int; base int; bonus int; gbonus int; xp int;
begin
  select * into r from vq_progress where wallet = p_wallet and quest_id = p_quest and period = p_period for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_quest'); end if;
  if r.completed_at is null then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  if r.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  select * into q from vq_quests where id = p_quest;
  base := coalesce((q.reward->>'xp')::int, 0);
  bonus := vq_gear_bonus(p_wallet);
  gbonus := vq_guild_bonus(p_wallet);
  xp := base + (base * (bonus + gbonus) / 100);
  update vq_progress set claimed_at = now() where wallet = p_wallet and quest_id = p_quest and period = p_period;
  update vq_players set game_xp = game_xp + xp where wallet = p_wallet;
  for m, amt in select key, value::int from jsonb_each_text(coalesce(q.reward->'mat', '{}'::jsonb)) loop
    insert into vq_materials (wallet, material, amount) values (p_wallet, m, amt)
      on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount;
  end loop;
  insert into vq_ledger (wallet, what, xp, mat, ref) values (p_wallet, 'quest', xp, q.reward->'mat', p_quest || '/' || p_period);
  return jsonb_build_object('ok', true, 'reward', jsonb_build_object('xp', xp, 'base_xp', base, 'bonus', bonus, 'guild_bonus', gbonus, 'mat', coalesce(q.reward->'mat', '{}'::jsonb)));
end $$;

grant select on vq_transfers, vq_chain_cursor, vq_prices, vq_guild_base, vq_sponsors to vq_app;
grant select, insert on vq_embers to vq_app;
grant usage on sequence vq_embers_id_seq, vq_sponsors_id_seq to vq_app;
grant select, insert, update, delete on vq_unlocks to vq_app;
grant insert, update on vq_guild_base, vq_sponsors to vq_app;
grant insert, update on vq_quests to vq_app;
grant execute on function vq_ember_balance(text), vq_ember_spend(text, numeric, text, text), vq_guild_bonus(text) to vq_app;

-- economy switches: token = the VQUEST contract, treasury = the wallet that receives the creator fees and pays rewards.
-- Until token is set the economy is off: Ember prices aren't charged and Ember-only things stay locked.
create table if not exists vq_config (key text primary key, value text);
insert into vq_config (key, value) values ('token', null), ('treasury', null), ('pool_share', '0.30') on conflict (key) do nothing;
grant select on vq_config to vq_app;
