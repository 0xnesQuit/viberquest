-- Vibequest v2: gear, crafting, daily chest, gear bonus on quest rewards.

create table if not exists vq_items (
  id         bigserial primary key,
  wallet     text not null references vq_players(wallet),
  slot       text not null check (slot in ('head', 'eyes', 'body', 'aura', 'pet')),
  template   text not null,
  rarity     text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  power      int not null,
  equipped   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists vq_items_wallet on vq_items (wallet);
-- at most one equipped item per slot
create unique index if not exists vq_items_one_per_slot on vq_items (wallet, slot) where equipped;

-- quest rewards get +1% XP per point of equipped gear power, capped at +50%
create or replace function vq_gear_bonus(p_wallet text) returns int language sql stable as $$
  select least(50, coalesce(sum(power), 0))::int from vq_items where wallet = p_wallet and equipped
$$;

create or replace function vq_claim(p_wallet text, p_quest text, p_period text) returns jsonb
language plpgsql as $$
declare r record; q record; m text; amt int; base int; bonus int; xp int;
begin
  select * into r from vq_progress where wallet = p_wallet and quest_id = p_quest and period = p_period for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_quest'); end if;
  if r.completed_at is null then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  if r.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  select * into q from vq_quests where id = p_quest;
  base := coalesce((q.reward->>'xp')::int, 0);
  bonus := vq_gear_bonus(p_wallet);
  xp := base + (base * bonus / 100);
  update vq_progress set claimed_at = now() where wallet = p_wallet and quest_id = p_quest and period = p_period;
  update vq_players set game_xp = game_xp + xp where wallet = p_wallet;
  for m, amt in select key, value::int from jsonb_each_text(coalesce(q.reward->'mat', '{}'::jsonb)) loop
    insert into vq_materials (wallet, material, amount) values (p_wallet, m, amt)
      on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount;
  end loop;
  insert into vq_ledger (wallet, what, xp, mat, ref) values (p_wallet, 'quest', xp, q.reward->'mat', p_quest || '/' || p_period);
  return jsonb_build_object('ok', true, 'reward', jsonb_build_object('xp', xp, 'base_xp', base, 'bonus', bonus, 'mat', coalesce(q.reward->'mat', '{}'::jsonb)));
end $$;

-- one free chest per UTC day: 2-4 copper, 25% +1 silver, 5% +1 gold, plus 10 XP
create or replace function vq_chest(p_wallet text) returns jsonb
language plpgsql as $$
declare c int; s int := 0; g int := 0; mat jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('vq_chest:' || p_wallet));
  if exists (select 1 from vq_ledger where wallet = p_wallet and what = 'chest' and at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') then
    return jsonb_build_object('ok', false, 'error', 'opened_today');
  end if;
  c := 2 + floor(random() * 3)::int;
  if random() < 0.25 then s := 1; end if;
  if random() < 0.05 then g := 1; end if;
  mat := jsonb_strip_nulls(jsonb_build_object('copper', c, 'silver', nullif(s, 0), 'gold', nullif(g, 0)));
  insert into vq_materials (wallet, material, amount) select p_wallet, key, value::int from jsonb_each_text(mat)
    on conflict (wallet, material) do update set amount = vq_materials.amount + excluded.amount;
  update vq_players set game_xp = game_xp + 10 where wallet = p_wallet;
  insert into vq_ledger (wallet, what, xp, mat, ref) values (p_wallet, 'chest', 10, mat, to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
  return jsonb_build_object('ok', true, 'xp', 10, 'mat', mat);
end $$;
