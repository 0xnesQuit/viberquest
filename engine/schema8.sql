-- Viberquest v8: dungeon quests, weekly dungeon prizes, gold shop.
alter table vq_quests drop constraint if exists vq_quests_kind_check;
alter table vq_quests add constraint vq_quests_kind_check check (kind in ('daily', 'weekly', 'story', 'hard', 'sponsored', 'dungeon'));

-- dungeon quests: ids dd_* are handed out per day (2), dw_* per week (1); progress comes from vq_runs
insert into vq_quests (id, kind, title, descr, rule, reward, sort) values
('dd_kills20',  'dungeon', 'Monster hunter',  'Defeat 20 monsters in the dungeon today.',         '{"type":"dungeon","stat":"kills","count":20}',  '{"xp":60,"mat":{"copper":3}}', 300),
('dd_chests3',  'dungeon', 'Treasure hunter', 'Open 3 dungeon chests today.',                     '{"type":"dungeon","stat":"chests","count":3}',  '{"xp":60,"mat":{"silver":1}}', 310),
('dd_floor4',   'dungeon', 'Going down',      'Reach floor 4 of the dungeon today.',              '{"type":"dungeon","stat":"floor","count":4}',   '{"xp":80,"mat":{"silver":1}}', 320),
('dd_runs2',    'dungeon', 'Back for more',   'Finish 2 dungeon runs today (walk out or fall).',  '{"type":"dungeon","stat":"runs","count":2}',    '{"xp":50,"mat":{"copper":3}}', 330),
('dw_boss',     'dungeon', 'Boss slayer',     'Defeat a dungeon boss this week.',                 '{"type":"dungeon","stat":"bosses","count":1}',  '{"xp":250,"mat":{"gold":1}}', 340),
('dw_floor10',  'dungeon', 'Deep diver',      'Reach floor 10 of the dungeon this week.',         '{"type":"dungeon","stat":"floor","count":10}',  '{"xp":300,"mat":{"gold":1}}', 350),
('dw_kills200', 'dungeon', 'Exterminator',    'Defeat 200 monsters in the dungeon this week.',    '{"type":"dungeon","stat":"kills","count":200}', '{"xp":300,"mat":{"gold":1,"silver":2}}', 360)
on conflict (id) do update set kind = excluded.kind, title = excluded.title, descr = excluded.descr, rule = excluded.rule, reward = excluded.reward, sort = excluded.sort;

-- weekly dungeon prizes in $VQUEST (in-game balance) for the deepest runs of the week, paid from the dungeon pool
insert into vq_config (key, value) values ('dungeon_weekly_prizes', '5000,3000,2000,500,500,500,500,500,500,500') on conflict (key) do nothing;
