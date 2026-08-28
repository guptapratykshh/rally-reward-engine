import { RewardService } from './application/rewardService.js';
import { COMBO_WINDOW_MS, MS_PER_DAY, type IngestResult, type MatchEvent, type StoredMatch } from './domain/types.js';
import { SystemClock } from './infra/clock.js';
import { InMemoryStore } from './infra/store.js';

function grantsOf(result: IngestResult) {
  return result.kind === 'REJECTED' ? [] : result.grants;
}

function makeService(lockGrain: 'user' | 'match', raceYieldMs: number): RewardService {
  return new RewardService({
    store: new InMemoryStore(),
    clock: new SystemClock(),
    lockGrain,
    raceYieldMs,
  });
}

function seed(service: RewardService, userId: string, rows: Array<Pick<StoredMatch, 'matchId' | 'result' | 'gameType' | 'timeInterval'>>): void {
  for (const row of rows) {
    service.seedMatch({ userId, ...row });
  }
}

async function runScenario(title: string, fn: () => Promise<void>): Promise<void> {
  console.log('\n============================================================');
  console.log(title);
  console.log('============================================================');
  await fn();
}

async function main(): Promise<void> {
  await runScenario('Rule 1 — three wins in a row grants 50 coins', async () => {
    const service = makeService('user', 0);
    await service.ingest({ userId: '123', matchId: 'm1', gameType: 'memory', result: 'win', timeInterval: 1 });
    await service.ingest({ userId: '123', matchId: 'm2', gameType: 'math', result: 'win', timeInterval: 2 });
    const third = await service.ingest({ userId: '123', matchId: 'm3', gameType: 'algebra', result: 'win', timeInterval: 3 });
    console.log('third match result:', third);
    console.log('state:', service.snapshot('123').player);
  });

  await runScenario('Rule 1 T0 race — DB is Lost, Win, Win; exactly two APIs at T0', async () => {
    const service = makeService('user', 25);
    const t0Win = 10 * MS_PER_DAY + 1235;
    const t0Lost = 10 * MS_PER_DAY + 1236;
    seed(service, '123', [
      { matchId: 'h1', result: 'lost', gameType: 'math', timeInterval: 1 },
      { matchId: 'h2', result: 'win', gameType: 'math', timeInterval: 2 },
      { matchId: 'h3', result: 'win', gameType: 'math', timeInterval: 3 },
    ]);

    const winAtT0: MatchEvent = {
      userId: '123',
      gameType: 'memory',
      result: 'win',
      matchId: '111',
      timeInterval: t0Win,
    };

    const lostAtT0: MatchEvent = {
      userId: '123',
      gameType: 'math',
      result: 'lost',
      matchId: '2',
      timeInterval: t0Lost,
    };

    const [a, b] = await Promise.all([service.ingest(winAtT0), service.ingest(lostAtT0)]);
    console.log('two T0 threads:', a.kind, b.kind);
    const snap = service.snapshot('123');
    console.log(
      'stored match ids:',
      snap.matches.map((m) => `${m.matchId}:${m.result}:${m.timeInterval}`),
    );
    console.log('coins:', snap.player.coins, '(50 — win 111 is the 3rd consecutive win in time order)');
    console.log('current streak:', snap.progress.currentStreak, '(0 — the later T0 loss breaks the live streak)');
    console.log('lock grain is userId, so the win and the loss never evaluate in parallel.');
    console.log('order used for the streak is timeInterval 1235 then 1236, not which thread ran first.');
  });

  await runScenario('Wrong grain — lock matchId, two concurrent wins, double grant', async () => {
    const broken = makeService('match', 40);
    seed(broken, 'u1', [
      { matchId: 'a', result: 'win', gameType: 'math', timeInterval: 1 },
      { matchId: 'b', result: 'win', gameType: 'math', timeInterval: 2 },
    ]);
    const [left, right] = await Promise.all([
      broken.ingest({ userId: 'u1', matchId: 'c', gameType: 'math', result: 'win', timeInterval: 3 }),
      broken.ingest({ userId: 'u1', matchId: 'd', gameType: 'math', result: 'win', timeInterval: 4 }),
    ]);
    console.log('broken lock (matchId) grants:', grantsOf(left), grantsOf(right));
    console.log('broken coins:', broken.snapshot('u1').player.coins, '(100 = both thought they were the 3rd win)');

    const correct = makeService('user', 40);
    seed(correct, 'u1', [
      { matchId: 'a', result: 'win', gameType: 'math', timeInterval: 1 },
      { matchId: 'b', result: 'win', gameType: 'math', timeInterval: 2 },
    ]);
    await Promise.all([
      correct.ingest({ userId: 'u1', matchId: 'c', gameType: 'math', result: 'win', timeInterval: 3 }),
      correct.ingest({ userId: 'u1', matchId: 'd', gameType: 'math', result: 'win', timeInterval: 4 }),
    ]);
    console.log('user lock coins:', correct.snapshot('u1').player.coins, '(50 = only the 3rd win pays)');
  });

  await runScenario('Rule 2 — five matches in one day grant a loot box, sixth does not', async () => {
    const service = makeService('user', 0);
    const day = 10 * MS_PER_DAY;
    for (let i = 1; i <= 6; i++) {
      const result = await service.ingest({
        userId: '123',
        matchId: `d${i}`,
        gameType: 'memory',
        result: i % 2 === 0 ? 'lost' : 'win',
        timeInterval: day + i,
      });
      console.log(`match ${i}:`, result.kind, grantsOf(result));
    }
    console.log('loot boxes:', service.snapshot('123').player.lootBoxes, '(1, granted at match 5)');
  });

  await runScenario('Rule 3 — two algebra wins inside 1 hour activate combo; far apart does not', async () => {
    const service = makeService('user', 0);
    const t = 1_000_000;
    await service.ingest({ userId: '123', matchId: 'alg1', gameType: 'algebra', result: 'win', timeInterval: t });
    const inside = await service.ingest({
      userId: '123',
      matchId: 'alg2',
      gameType: 'algebra',
      result: 'win',
      timeInterval: t + COMBO_WINDOW_MS - 1,
    });
    console.log('second algebra win inside the hour:', inside);
    console.log('combo:', service.snapshot('123').player);

    const late = makeService('user', 0);
    await late.ingest({ userId: '123', matchId: 'alg1', gameType: 'algebra', result: 'win', timeInterval: t });
    const missed = await late.ingest({
      userId: '123',
      matchId: 'alg2',
      gameType: 'algebra',
      result: 'win',
      timeInterval: t + COMBO_WINDOW_MS + 1,
    });
    console.log('second algebra win after the hour:', grantsOf(missed));
    console.log('combo stays off:', late.snapshot('123').player.comboMultiplier);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
