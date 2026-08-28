import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RewardService } from '../application/rewardService.js';
import { SystemClock } from '../infra/clock.js';
import { FileStore } from '../infra/store.js';

describe('file store', () => {
  it('survives reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rally-'));
    const path = join(dir, 'store.json');
    try {
      const first = new FileStore(path);
      await first.load();
      const service = new RewardService({
        store: first,
        clock: new SystemClock(),
        lockGrain: 'user',
        raceYieldMs: 0,
      });
      await service.ingest({
        userId: 'p1',
        matchId: 'persist-1',
        gameType: 'math',
        result: 'win',
        timeInterval: 10,
      });

      const second = new FileStore(path);
      await second.load();
      const match = second.getMatch('persist-1');
      assert.equal(match?.userId, 'p1');
      assert.equal(second.snapshot('p1', 10).progress.currentStreak, 1);

      await first.reset();
      const third = new FileStore(path);
      await third.load();
      assert.equal(third.getMatch('persist-1'), undefined);
      assert.equal(third.snapshot('p1', 10).player.coins, 0);
      assert.equal(third.listPlayerIds().length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
