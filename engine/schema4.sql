-- Vibequest v4: season archive + badges, guild tiers with a per-member cap, guild weekly goal + chest, sybil guards.

-- a finished ISO week is archived exactly once (the engine finalizes it after Monday 00:00 UTC)
create table if not exists vq_season_done (week text primary key, at timestamptz not null default now());

-- final standings of a finished week: board = 'player' (quest XP), 'arena' (fantasy points), 'guild' (guild points)
create table if not exists vq_seasons (
  week   text not null,
  board  text not null,
  rank   int  not null,
  ref    text not null,          -- wallet or guild slug
  points int  not null,
  extra  jsonb,
  primary key (week, board, ref)
);

-- badges earned at the end of a week (top 3 of each board, members of the #1 guild)
create table if not exists vq_badges (
  wallet text not null,
  week   text not null,
  badge  text not null,          -- fame / arena / guild
  rank   int  not null,
  primary key (wallet, week, badge)
);

-- guild league tiers: 0 bronze, 1 silver, 2 gold, 3 diamond; moved up/down when a week is finalized
create table if not exists vq_guild_tier (slug text primary key, tier int not null default 0, moved text, updated_week text);

-- guild weekly goal: visible members' combined trading volume, refreshed by the engine
create table if not exists vq_guild_week (slug text not null, week text not null, volume float not null default 0, members int not null default 0, updated_at timestamptz not null default now(), primary key (slug, week));

-- guild points between two instants: every member's claimed quest XP, each member adds at most 1000 per week
-- (so one whale can't carry a guild)
create or replace function vq_guild_points(p_from timestamptz, p_to timestamptz)
returns table (slug text, players int, raw int, points int) language sql stable as $$
  select m.slug, count(*)::int, sum(x.xp)::int, sum(least(x.xp, 1000))::int
  from (select l.wallet, sum(l.xp)::int xp from vq_ledger l where l.at >= p_from and l.at < p_to and l.xp > 0 group by l.wallet) x
  join vv_guild_members m on m.address = x.wallet
  group by m.slug
$$;

grant select on vq_season_done, vq_seasons, vq_badges, vq_guild_tier, vq_guild_week to vq_app;
grant execute on function vq_guild_points(timestamptz, timestamptz) to vq_app;
