-- Viberquest v7: the dungeon. Runs are server-authoritative: monster HP, damage and every drop are decided here,
-- the browser only animates. VQUEST drops are credited to an in-game balance the moment they drop (withdrawable after
-- VQUEST graduates and transfers unlock), under per-wallet, per-day and total pool caps.
create table if not exists vq_runs (
  id         text primary key,
  wallet     text not null,
  floor      int  not null default 1,
  hp         int  not null,
  max_hp     int  not null,
  state      jsonb not null,               -- { seed, mobs: {id: {type, hp, max, dmg, boss}}, chests: {id: {opened}} }
  bag        jsonb not null default '{"gold":0,"mat":{},"vquest":0,"kills":0,"potions":0}',
  status     text not null default 'live' check (status in ('live', 'done', 'dead')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_swing timestamptz
);
create index if not exists vq_runs_wallet on vq_runs (wallet, started_at desc);

create table if not exists vq_balances (wallet text primary key, gold bigint not null default 0, vquest numeric not null default 0, updated_at timestamptz not null default now());

create table if not exists vq_vquest_drops (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  wallet text not null,
  run    text,
  src    text not null,                    -- mob / chest / boss
  amount numeric not null
);
create index if not exists vq_vquest_drops_day on vq_vquest_drops (at);
create index if not exists vq_vquest_drops_wallet on vq_vquest_drops (wallet, at);

insert into vq_config (key, value) values ('dungeon_pool', '5000000'), ('dungeon_daily', '50000'), ('dungeon_wallet_daily', '3000'), ('dungeon_runs', '5')
on conflict (key) do nothing;

grant select, insert, update on vq_runs, vq_balances to vq_app;
grant select, insert on vq_vquest_drops to vq_app;
grant usage on sequence vq_vquest_drops_id_seq to vq_app;
