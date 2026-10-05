-- Vibequest quest catalogue v1. Rules are evaluated by engine.mjs against chain data; min_eth keeps dust trades out.
insert into vq_quests (id, kind, title, descr, rule, reward, sort) values
-- daily pool (each player gets 3 per day)
('d_first_buy',  'daily', 'First move',        'Buy any vibe/vibe token.',                                       '{"type":"buys","count":1,"min_eth":0.002}',              '{"xp":50,"mat":{"copper":2}}', 10),
('d_diversity',  'daily', 'Spread out',        'Buy 3 different tokens today.',                                  '{"type":"distinct_buys","count":3,"min_eth":0.002}',     '{"xp":100,"mat":{"copper":3}}', 20),
('d_pool_buy',   'daily', 'Pool walker',       'Buy a graduated token in its pool.',                             '{"type":"pool_buys","count":1,"min_eth":0.002}',         '{"xp":80,"mat":{"copper":2}}', 30),
('d_fresh',      'daily', 'Fresh off the line','Buy a token launched less than an hour before you bought it.',   '{"type":"fresh_buy","max_age_min":60,"min_eth":0.002}', '{"xp":100,"mat":{"copper":2}}', 40),
('d_vibevibe',   'daily', 'Ecosystem friend',  'Buy a token paired with VIBEVIBE.',                              '{"type":"pair_buy","pair":"vibevibe","min_eth":0.002}', '{"xp":100,"mat":{"silver":1}}', 50),
('d_stock',      'daily', 'Stock hunter',      'Buy a token paired with a test stock.',                          '{"type":"pair_buy","pair":"stock","min_eth":0.002}',    '{"xp":120,"mat":{"silver":1}}', 60),
('d_hold6',      'daily', 'Steady hands',      'Buy a token and hold it for 6 hours without selling.',           '{"type":"hold","hours":6,"min_eth":0.002}',             '{"xp":100,"mat":{"copper":2}}', 70),
('d_early',      'daily', 'Early bird',        'Be one of the first 10 buyers of a token.',                     '{"type":"early_buy","max_position":10,"min_eth":0.002}','{"xp":120,"mat":{"silver":1}}', 80),
('d_flip',       'daily', 'Quick flip',        'Buy a token and sell it within 10 minutes for more ETH than you paid.', '{"type":"flip_profit","minutes":10,"min_eth":0.002}', '{"xp":150,"mat":{"silver":1}}', 90),
-- weekly pool (each player gets 5 per week)
('w_volume',     'weekly', 'Big week',         'Trade 1 ETH of volume this week.',                               '{"type":"volume","eth":1}',                               '{"xp":300,"mat":{"gold":1}}', 110),
('w_days',       'weekly', 'Show up',          'Trade on 5 different days this week.',                           '{"type":"active_days","days":5,"min_eth":0.002}',         '{"xp":250,"mat":{"silver":2}}', 120),
('w_grad',       'weekly', 'Graduation ride',  'Buy a token before it graduates, and see it graduate.',           '{"type":"graduation_caught","count":1,"min_eth":0.002}',  '{"xp":250,"mat":{"gold":1}}', 130),
('w_launch',     'weekly', 'Founder',          'Launch a token on vibe/vibe.',                                   '{"type":"launches","count":1}',                           '{"xp":200,"mat":{"gold":1}}', 140),
('w_launch20',   'weekly', 'Founder plus',     'A token you launched this week reaches 20 different buyers.',     '{"type":"launch_buyers","buyers":20}',                    '{"xp":400,"mat":{"diamond":1}}', 150),
('w_early3',     'weekly', 'Sniper week',      'Be one of the first 10 buyers on 3 different tokens.',           '{"type":"early_buy","max_position":10,"count":3,"min_eth":0.002}', '{"xp":300,"mat":{"gold":1}}', 160),
-- story (once, in order)
('s_welcome',    'story', 'Welcome to Vibequest', 'Make your first trade after signing in.',                     '{"type":"buys","count":1,"min_eth":0.002}',              '{"xp":100,"mat":{"copper":5}}', 200)
on conflict (id) do update set kind = excluded.kind, title = excluded.title, descr = excluded.descr, rule = excluded.rule, reward = excluded.reward, sort = excluded.sort;
