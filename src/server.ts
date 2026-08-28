import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RewardService } from './application/rewardService.js';
import { SystemClock } from './infra/clock.js';
import { FileStore } from './infra/store.js';
import { createRewardServer } from './transport/http.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const webRoot = join(root, 'web');
const dataDir = process.env['DATA_DIR'] ?? join(root, 'data');
const port = Number(process.env['PORT'] ?? 3000);
const lockGrain = process.env['LOCK_GRAIN'] === 'match' ? 'match' : 'user';
const raceYieldMs = Number(process.env['RACE_YIELD_MS'] ?? 0);

const store = new FileStore(join(dataDir, 'store.json'));
await store.load();

const service = new RewardService({
  store,
  clock: new SystemClock(),
  lockGrain,
  raceYieldMs,
});

const host = process.env['HOST'] ?? '0.0.0.0';
const server = createRewardServer(service, webRoot);
server.listen(port, host, () => {
  console.log(`Rally listening on http://${host}:${port}`);
  console.log(`lock grain: ${lockGrain}; data: ${join(dataDir, 'store.json')}`);
});
