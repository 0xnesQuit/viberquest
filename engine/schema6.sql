-- Viberquest v6: play without connecting a wallet.
-- Pairing: the game shows a code amount (e.g. 0.002347 ETH); the player buys any vibe/vibe token for exactly that amount
-- from their wallet within 15 minutes. That trade proves the wallet is theirs, and this browser gets a session.
create table if not exists vq_pairs (
  id         text primary key,                 -- random, only this browser knows it
  wallet     text not null,
  amount     numeric not null,                 -- in ETH, 6 decimals
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  matched_tx text,
  used_at    timestamptz
);
create index if not exists vq_pairs_open on vq_pairs (amount) where matched_tx is null;
grant select, insert, update, delete on vq_pairs to vq_app;
grant select on vv_trades, vv_dex to vq_app;
