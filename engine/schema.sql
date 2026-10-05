-- Vibequest game tables (vq_ prefix), next to the vibercheck index (vv_*) in db "bureau".
-- Progress is always recomputed from chain data (vv_trades / vv_dex / vv_launches / vv_grads), so it can't drift.

create table if not exists vq_players (
  wallet      text primary key,
  created_at  timestamptz not null default now(),
  game_xp     bigint not null default 0,
  last_seen   timestamptz
);

-- quest catalogue: rule = json evaluated by the engine, reward = {"xp": n, "mat": {"copper": n, ...}}
create table if not exists vq_quests (
  id      text primary key,
  kind    text not null check (kind in ('daily', 'weekly', 'story')),
  title   text not null,
  descr   text not null,
  rule    jsonb not null,
  reward  jsonb not null,
  sort    int not null default 0,
  active  boolean not null default true
);

-- one row per quest given to a player for a period; progress starts counting at accepted_at
create table if not exists vq_progress (
  wallet       text not null references vq_players(wallet),
  quest_id     text not null references vq_quests(id),
  period       text not null,                 -- '2026-10-05' (daily), '2026-W41' (weekly), 'story'
  accepted_at  timestamptz not null default now(),
  expires_at   timestamptz,
  progress     int not null default 0,
  target       int not null default 1,
  detail       jsonb,
  completed_at timestamptz,
  claimed_at   timestamptz,
  primary key (wallet, quest_id, period)
);
create index if not exists vq_progress_open on vq_progress (wallet) where claimed_at is null;

create table if not exists vq_materials (
  wallet   text not null references vq_players(wallet),
  material text not null check (material in ('copper', 'silver', 'gold', 'diamond')),
  amount   int not null default 0 check (amount >= 0),
  primary key (wallet, material)
);

-- audit trail of every reward
create table if not exists vq_ledger (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  wallet   text not null,
  what     text not null,
  xp       int not null default 0,
  mat      jsonb,
  ref      text
);

-- sign-in nonces (SIWE-style message signing, no transaction)
create table if not exists vq_nonces (
  nonce      text primary key,
  created_at timestamptz not null default now(),
  used       boolean not null default false
);

-- claim a completed quest exactly once: adds XP and materials, writes the ledger
create or replace function vq_claim(p_wallet text, p_quest text, p_period text) returns jsonb
language plpgsql as $$
declare r record; q record; m text; amt int;
begin
  select * into r from vq_progress where wallet = p_wallet and quest_id = p_quest and period = p_period for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_quest'); end if;
  if r.completed_at is null then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  if r.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  select * into q from vq_quests where id = p_quest;
  update vq_progress set claimed_at = now() where wallet = p_wallet and quest_id = p_quest and period = p_period;
  update vq_players set game_xp = game_xp + coalesce((q.reward->>'xp')::int, 0) where wallet = p_wallet;
  for m, amt in select key, value::int from jsonb_each_text(coalesce(q.reward->'mat', '{}'::jsonb)) loop
    insert into vq_materials (wallet, material, amount) values (p_wallet, m, amt)
      on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount;
  end loop;
  insert into vq_ledger (wallet, what, xp, mat, ref) values (p_wallet, 'quest', coalesce((q.reward->>'xp')::int, 0), q.reward->'mat', p_quest || '/' || p_period);
  return jsonb_build_object('ok', true, 'reward', q.reward);
end $$;
