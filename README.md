# Viberquest

**Your wallet is your character. Your trades are your quests.**

A pixel RPG on top of [vibe/vibe](https://testnet.vibevibe.fun) on Robinhood Chain testnet. Play at **[viberquest.fun](https://viberquest.fun)** · guide at **[viberquest.fun/guide](https://viberquest.fun/guide)** · by [@0xHaileyy](https://x.com/0xHaileyy)

![Viberquest](brand/viberquest-banner.png)

## What it is

- **Quests verified on chain.** Daily, weekly, story and hard-mode quests complete on their own when you trade on vibe/vibe. A quest engine re-reads your trades from chain data seconds after they land. Nothing is self-reported.
- **A live town.** A top-down pixel plaza where everyone who is playing walks around with their own hero and gear. Trades pop up as bubbles over people's heads, and players wave with emotes.
- **Gear and crafting.** Quests and chests drop materials. Forge them into gear (common to mythic) that shows on your hero and boosts quest XP.
- **Guild seasons.** The real vibe/vibe guilds compete in weekly leagues (bronze to diamond), with a per-member cap and a guild volume goal that opens chests.
- **Arena.** A free fantasy launchpad league: pick 5 tokens, score what they do after you pick.
- **$VQUEST economy.** Burn VQUEST from your own wallet (transfer to `0x…dEaD`) at the Furnace and get the same amount of Embers, the in-game spend unit. The game never mints tokens and never holds anyone's tokens. Season rewards only come from the token's trading fees, bought back on the market. Embers switch on once the token graduates on vibe/vibe (tokens can't be transferred before that).

Testnet alpha: nothing here has monetary value.

## Layout

```
app/                 the site (static files + one API router)
  index.html         the game: canvas town, windows, live updates
  guide.html         the player guide
  items.js           gear templates, recipes, sprite drawing (shared by server and browser)
  viber.js           wallet -> 32x32 pixel character
  api/[...route].js  API: sign-in, quests, forge, guilds, arena, town, economy, share cards
engine/
  engine.mjs         quest engine, fantasy scoring, guild goals, season archive, VQUEST burn indexer
  schema*.sql        database schema in order (schema.sql first), quests.sql = quest catalogue
scripts/
  record2.js         records the promo video by playing the game in headless Chrome
  audit.js           opens every window of the live game and reports errors
brand/               logo, banner, and the page that renders them
```

## How it works

- **Sign-in** is a plain-text message signed with the wallet over a one-time nonce (no transaction, no approval). The session is an HMAC-signed cookie.
- **Chain data** comes from the vibercheck indexers (tables `vv_launches`, `vv_trades`, `vv_dex`, `vv_grads`, `vv_wallets`, `vv_guild_members`, `vv_guilds` in Postgres), which index vibe/vibe curves, pools and router trades on Robinhood Chain testnet. Those indexers live in a separate project; this repo reads their tables.
- **The engine** listens for new trades (`LISTEN vv_trade`), recomputes each open quest from chain data and pushes progress to the browser over server-sent events. It also indexes VQUEST `Transfer` events to `0x…dEaD` (credited as Embers) and from the treasury (payouts).
- **Economy switch:** set `vq_config.token` and `vq_config.treasury`; prices live in `vq_prices` and can be tuned without a deploy.

## Running it

Requirements: Node 22+, Postgres with the vibercheck tables, and a static/API host that maps `/api/*` to `app/api/[...route].js` (the live site uses a small Vercel-style server).

```
cd app && npm install pg viem @napi-rs/canvas
# .env
VQ_PG_URL=postgres://vq_app:...@localhost/bureau
SESSION_SECRET=<64 random hex chars>
SITE_HOST=viberquest.fun
```

Apply `engine/schema.sql`, `schema2.sql` … `schema5.sql` and `quests.sql`, then run `node engine/engine.mjs` next to the app. Fonts are not included: the UI uses Press Start 2P, Instrument Sans and JetBrains Mono (Google Fonts) and Clash Display (Fontshare); the share card expects them in `app/fonts/`.

## Fair play

Trades under 0.002 ETH don't count, your own launches never count, quick in-and-out trades are filtered from volume quests, free chests need recent trading, guild points are capped per member, Arena picks only score other wallets' real buys, and every reward claim is locked and one-time in the database.

Not affiliated with vibe/vibe.
