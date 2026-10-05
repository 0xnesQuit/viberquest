-- Vibequest v3: fantasy launchpad league, story chain, rerolls, salvage.

-- fantasy roster: up to 5 vibe/vibe tokens per player per ISO week; a pick only scores what happens after added_at
create table if not exists vq_fantasy (
  wallet   text not null references vq_players(wallet),
  week     text not null,
  curve    text not null,
  captain  boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (wallet, week, curve)
);
create unique index if not exists vq_fantasy_one_captain on vq_fantasy (wallet, week) where captain;

-- computed by the engine every few minutes
create table if not exists vq_fantasy_scores (
  wallet  text not null,
  week    text not null,
  points  int not null default 0,
  detail  jsonb,
  updated_at timestamptz not null default now(),
  primary key (wallet, week)
);

-- story chain: shown one at a time in this order
insert into vq_quests (id, kind, title, descr, rule, reward, sort) values
('s_welcome',  'story', 'Welcome to Viberquest', 'Make your first trade after signing in.',                         '{"type":"buys","count":1,"min_eth":0.002}',       '{"xp":100,"mat":{"copper":5}}', 200),
('s_explorer', 'story', 'Explorer',             'Buy 3 different tokens on vibe/vibe.',                            '{"type":"distinct_buys","count":3,"min_eth":0.002}', '{"xp":150,"mat":{"copper":5,"silver":1}}', 210),
('s_guild',    'story', 'Find your people',     'Join a vibe/vibe guild and turn on "show me in the member list".','{"type":"in_guild"}',                              '{"xp":150,"mat":{"silver":2}}', 220),
('s_pool',     'story', 'After graduation',     'Buy a graduated token in its pool.',                              '{"type":"pool_buys","count":1,"min_eth":0.002}', '{"xp":150,"mat":{"silver":2}}', 230),
('s_early',    'story', 'First in line',        'Be one of the first 10 buyers of a token.',                       '{"type":"early_buy","max_position":10,"min_eth":0.002}', '{"xp":200,"mat":{"gold":1}}', 240),
('s_grad',     'story', 'Ride it home',         'Buy a token before it graduates and see it graduate.',            '{"type":"graduation_caught","count":1,"min_eth":0.002}', '{"xp":300,"mat":{"gold":1,"silver":2}}', 250),
('s_founder',  'story', 'Your own token',       'Launch a token on vibe/vibe.',                                    '{"type":"launches","count":1}',                    '{"xp":300,"mat":{"diamond":1}}', 260)
on conflict (id) do update set kind = excluded.kind, title = excluded.title, descr = excluded.descr, rule = excluded.rule, reward = excluded.reward, sort = excluded.sort;
