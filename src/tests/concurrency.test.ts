import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RewardService } from '../application/rewardService.js';
import { MS_PER_DAY } from '../domain/types.js';
import { SystemClock } from '../infra/clock.js';
import { InMemoryStore } from '../infra/store.js';

function service(lockGrain: 'user' | 'match', raceYieldMs: number): RewardService {
  return new RewardService({
    store: new InMemoryStore(),
    clock: new SystemClock(),
    lockGrain,
    raceYieldMs,
  });
}

describe('T0 ingest', () => {
  it('runs exactly two T0 threads after Lost, Win, Win and grants on the win', async () => {
    const s = service('user', 20);
    s.seedMatch({ userId: '123', matchId: 'h1', gameType: 'math', result: 'lost', timeInterval: 1 });
    s.seedMatch({ userId: '123', matchId: 'h2', gameType: 'math', result: 'win', timeInterval: 2 });
    s.seedMatch({ userId: '123', matchId: 'h3', gameType: 'math', result: 'win', timeInterval: 3 });

    const t0Win = 10 * MS_PER_DAY + 1235;
    const t0Lost = 10 * MS_PER_DAY + 1236;

    const [win, lost] = await Promise.all([
      s.ingest({ userId: '123', matchId: '111', gameType: 'memory', result: 'win', timeInterval: t0Win }),
      s.ingest({ userId: '123', matchId: '2', gameType: 'math', result: 'lost', timeInterval: t0Lost }),
    ]);

    assert.equal(win.kind, 'APPLIED');
    assert.equal(lost.kind, 'APPLIED');
    const snap = s.snapshot('123');
    assert.equal(snap.player.coins, 50);
    assert.equal(snap.progress.currentStreak, 0);
    assert.equal(snap.matches.filter((m) => m.matchId === '111' || m.matchId === '2').length, 2);
  });

  it('matchId lock double-grants; userId lock does not', async () => {
    const broken = service('match', 30);
    broken.seedMatch({ userId: 'u1', matchId: 'a', gameType: 'math', result: 'win', timeInterval: 1 });
    broken.seedMatch({ userId: 'u1', matchId: 'b', gameType: 'math', result: 'win', timeInterval: 2 });
    await Promise.all([
      broken.ingest({ userId: 'u1', matchId: 'c', gameType: 'math', result: 'win', timeInterval: 3 }),
      broken.ingest({ userId: 'u1', matchId: 'd', gameType: 'math', result: 'win', timeInterval: 4 }),
    ]);
    assert.equal(broken.snapshot('u1').player.coins, 100);

    const correct = service('user', 30);
    correct.seedMatch({ userId: 'u1', matchId: 'a', gameType: 'math', result: 'win', timeInterval: 1 });
    correct.seedMatch({ userId: 'u1', matchId: 'b', gameType: 'math', result: 'win', timeInterval: 2 });
    await Promise.all([
      correct.ingest({ userId: 'u1', matchId: 'c', gameType: 'math', result: 'win', timeInterval: 3 }),
      correct.ingest({ userId: 'u1', matchId: 'd', gameType: 'math', result: 'win', timeInterval: 4 }),
    ]);
    assert.equal(correct.snapshot('u1').player.coins, 50);
  });
});
