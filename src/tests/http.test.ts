import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { RewardService } from '../application/rewardService.js';
import { SystemClock } from '../infra/clock.js';
import { InMemoryStore } from '../infra/store.js';
import { createRewardServer } from '../transport/http.js';

const webRoot = join(fileURLToPath(new URL('../../web/', import.meta.url)));

describe('http product', () => {
  let server: ReturnType<typeof createServer>;
  let base = '';

  before(async () => {
    process.env['RATE_LIMIT_DISABLED'] = '1';
    const service = new RewardService({
      store: new InMemoryStore(),
      clock: new SystemClock(),
      lockGrain: 'user',
      raceYieldMs: 0,
    });
    server = createRewardServer(service, webRoot);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('serves the frontend', async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Rally/);
    assert.match(html, /Record a match/);
    assert.match(html, /id="reset-btn"/);
    assert.match(html, /id="load-btn"/);
  });

  it('records a match without client time and exposes quest progress', async () => {
    const posted = await fetch(`${base}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'aria', gameType: 'algebra', result: 'win' }),
    });
    const body = (await posted.json()) as { kind: string; matchId: string };
    assert.equal(posted.status, 200);
    assert.equal(body.kind, 'APPLIED');
    assert.ok(body.matchId);

    const stateRes = await fetch(`${base}/api/state/aria`);
    const state = (await stateRes.json()) as {
      progress: { currentStreak: number; algebraWinsLastHour: number };
      player: { coins: number };
    };
    assert.equal(state.progress.currentStreak, 1);
    assert.equal(state.progress.algebraWinsLastHour, 1);
    assert.equal(state.player.coins, 0);
  });

  it('reset returns every player to the empty default and keeps that empty save', async () => {
    await fetch(`${base}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'aria', gameType: 'math', result: 'win' }),
    });
    const wiped = await fetch(`${base}/api/reset`, { method: 'POST' });
    assert.equal(wiped.status, 200);
    const stateRes = await fetch(`${base}/api/state/aria`);
    const state = (await stateRes.json()) as {
      matches: unknown[];
      grants: unknown[];
      player: { coins: number; lootBoxes: number; comboMultiplier: number };
      progress: { currentStreak: number };
    };
    assert.equal(state.matches.length, 0);
    assert.equal(state.grants.length, 0);
    assert.equal(state.player.coins, 0);
    assert.equal(state.player.lootBoxes, 0);
    assert.equal(state.player.comboMultiplier, 1);
    assert.equal(state.progress.currentStreak, 0);
  });

  it('T0 lab fires exactly two concurrent requests after Lost, Win, Win', async () => {
    const res = await fetch(`${base}/api/lab/t0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 't0user' }),
    });
    const body = (await res.json()) as {
      history: string[];
      concurrentRequests: number;
      outcomes: Array<{ kind: string }>;
      snapshot: { player: { coins: number }; progress: { currentStreak: number } };
    };
    assert.equal(res.status, 200);
    assert.deepEqual(body.history, ['lost', 'win', 'win']);
    assert.equal(body.concurrentRequests, 2);
    assert.equal(body.outcomes.length, 2);
    assert.equal(body.outcomes.every((o) => o.kind === 'APPLIED'), true);
    assert.equal(body.snapshot.player.coins, 50);
    assert.equal(body.snapshot.progress.currentStreak, 0);
  });

  it('rejects a bad user id', async () => {
    const res = await fetch(`${base}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'bad user', gameType: 'math', result: 'win' }),
    });
    assert.equal(res.status, 400);
  });
});
