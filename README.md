# Rally

Post-match reward engine with a live player console. Three rules, per-user locking, file-backed state.

## Run locally

```bash
npm install
npm test
npm start
```

Open http://localhost:3000

- Record wins/losses for a player id
- Quests update live: 3-win streak, 5 matches/day, algebra combo
- **Run both APIs at T0** — two threads only (one win, one loss) after Lost, Win, Win already in the DB
- **Refresh** wipes the store back to empty. If you do not click it, matches and rewards stay in `data/store.json` across reloads and restarts.

## Deploy (one box)

```bash
docker build -t rally .
docker run -p 3000:3000 -v rally-data:/data rally
```

Or: `npm run build && DATA_DIR=/var/lib/rally node dist/server.js`

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | JSON store directory |
| `LOCK_GRAIN` | `user` | Set `match` only to demo the broken lock |
| `RATE_LIMIT_DISABLED` | unset | `1` in tests |

## Honest limits for a next-day launch

This is a **single-process** service. Put it behind your match server, not on the public internet as a “post a win” API — there is no player auth. The lock is in-process; two pods will race. Scale-out is: sticky `userId` to one instance, or Postgres `SELECT FOR UPDATE` on the player row.
