# Rally

Post-match reward engine. A completed match is ingested once; the server decides coins, loot boxes, and combo. The browser is a demo client and does not compute rules. Order is `timeInterval`, never HTTP arrival. Settlement is idempotent.

- **Live:** https://rally-reward-engine.onrender.com
- **Repo:** https://github.com/guptapratykshh/rally-reward-engine
- **Walkthrough:** https://drive.google.com/file/d/1yYZHX5S7BZyoBREHRCRZIt3Ggn1QhwR5/view?usp=sharing

## The three rules

| Rule | When it fires | Grant |
|---|---|---|
| `win_3_in_a_row` | 3 / 6 / 9… consecutive wins, any of `memory` · `math` · `algebra` · `logic` | +50 coins |
| `play_5_in_a_day` | 5th match of the UTC day (`floor(timeInterval / 86400000)`) | 1 loot box, once that day |
| `algebra_combo_1h` | 2 algebra wins inside 1 hour | ×2 combo for the next hour |

Streak is counted **at the triggering match**, so a later loss in the log cannot claw back a grant that already belonged to an earlier win. Combo does not multiply the coin grant on the same match that activated it.

## Run locally

Node 20+.

```bash
npm install
npm test
npm start
```

Open http://localhost:3000

- Enter a player id, record win / loss. Modes and quest bars update from `/api/state/:userId`.
- **Run both APIs at T0** — history Lost → Win → Win is already in the store; then exactly two concurrent ingest calls (win + loss). Lock is `userId`. Expect +50 coins, live streak 0.
- **Refresh** wipes `data/store.json`. If you do not click it, matches and grants survive reload and restart.

Other scripts: `npm run dev` (watch), `npm run demo` (CLI scenarios), `npm run talk` (spoken notes).

## Ingest path

```
POST /api/matches { userId, gameType, result }
  → parseMatchEvent          src/protocol/validate.ts
  → RewardService.ingest     lock userId
  → applyLocked
       duplicate matchId  → DUPLICATE
       insert + sort by timeInterval
       evaluateAll         src/domain/rules.ts
       applyGrant          grantKey in src/infra/store.ts
       persist             data/store.json
  → APPLIED | DUPLICATE | REJECTED
GET /api/state/:userId
```

Lock grain must be `userId`. Streak, daily count, and combo all mutate the same player log. Locking `matchId` lets two third-wins both grant 50 (`LOCK_GRAIN=match` is only for that demo).

Grant keys:

- streak / combo: `userId|ruleId|triggeringMatchId`
- daily: `userId|play_5_in_a_day|dayKey`

## Layout

```
src/domain/types.ts            entities, RULE_CONFIG
src/domain/rules.ts            three pure evaluators
src/domain/userLock.ts         per-key mutex
src/application/rewardService.ts   ingest, applyLocked, labT0
src/infra/store.ts             matches, grant ledger, file persist
src/protocol/validate.ts       only place raw JSON is trusted
src/transport/http.ts          routes + static web/
src/server.ts                  boot
web/                           demo console
userschema.js                  interview-board sketch (not imported)
```

## HTTP

| Method | Path | Role |
|---|---|---|
| `GET` | `/health` | liveness |
| `POST` | `/api/matches` | ingest one match (`matchId` / `timeInterval` optional; server fills them) |
| `GET` | `/api/state/:userId` | snapshot: wallet, log, grants, quest progress |
| `GET` | `/api/rules` | `RULE_CONFIG` + lock grain |
| `GET` | `/api/players` | all players |
| `GET` | `/api/feed` | recent grants |
| `POST` | `/api/lab/t0` | `{ userId }` — two concurrent ingests after Lost, Win, Win |
| `POST` | `/api/reset` | empty the store |

Example:

```bash
curl -s -X POST http://localhost:3000/api/matches \
  -H 'content-type: application/json' \
  -d '{"userId":"123","gameType":"math","result":"win"}'
```

## Env

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` | JSON store directory |
| `LOCK_GRAIN` | `user` | set `match` only to demo the broken lock |
| `RACE_YIELD_MS` | `0` | test-only yield inside `applyLocked` |
| `RATE_LIMIT_DISABLED` | unset | `1` in tests (limit is 40 POSTs / 10s per IP) |

## Deploy

**Render** — `render.yaml` (health `/health`, `DATA_DIR=./data`). Live box: https://rally-reward-engine.onrender.com

**Docker**

```bash
docker build -t rally .
docker run -p 3000:3000 -v rally-data:/data rally
```

Or: `npm run build && DATA_DIR=/var/lib/rally node dist/server.js`

## Limits

Single process, in-memory lock, file store. No player auth — put this behind the match server, not on the public internet as a “post a win” API. Two pods will race; scale-out is sticky `userId` or Postgres `SELECT FOR UPDATE` on the player row. The three functions in `src/domain/rules.ts` do not change. Day is UTC floor, not player timezone. Combo duration is assumed 1 hour.
