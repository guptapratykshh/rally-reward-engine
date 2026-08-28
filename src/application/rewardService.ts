import { evaluateAll, sortMatches } from '../domain/rules.js';
import {
  RULE_CONFIG,
  type IngestResult,
  type MatchEvent,
  type PlayerSnapshot,
  type RewardGrant,
  type StoredMatch,
} from '../domain/types.js';
import { KeyedLock } from '../domain/userLock.js';
import type { Clock } from '../infra/clock.js';
import { sleep } from '../infra/clock.js';
import { newMatchId } from '../infra/ids.js';
import type { RewardStore } from '../infra/store.js';

export interface RewardServiceDeps {
  store: RewardStore;
  clock: Clock;
  lockGrain: 'user' | 'match';
  raceYieldMs: number;
}

export class RewardService {
  private readonly store: RewardStore;
  private readonly clock: Clock;
  private readonly lockGrain: 'user' | 'match';
  private readonly raceYieldMs: number;
  private readonly locks = new KeyedLock();

  constructor(deps: RewardServiceDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.lockGrain = deps.lockGrain;
    this.raceYieldMs = deps.raceYieldMs;
  }

  seedMatch(match: StoredMatch): void {
    this.store.insertMatch(match);
  }

  ingest(raw: MatchEvent): Promise<IngestResult> {
    const event: MatchEvent = {
      ...raw,
      matchId: raw.matchId || newMatchId(),
      timeInterval: raw.timeInterval || this.clock.now(),
    };
    const key = this.lockGrain === 'user' ? event.userId : event.matchId;
    return this.locks.run(key, () => this.applyLocked(event));
  }

  snapshot(userId: string): PlayerSnapshot {
    return this.store.snapshot(userId, this.clock.now());
  }

  listPlayers(): Array<{ userId: string; player: PlayerSnapshot['player']; progress: PlayerSnapshot['progress'] }> {
    const now = this.clock.now();
    return this.store.listPlayerIds().map((userId) => {
      const snap = this.store.snapshot(userId, now);
      return { userId, player: snap.player, progress: snap.progress };
    });
  }

  feed(limit = 40): RewardGrant[] {
    return this.store.listAllGrants().slice(0, limit);
  }

  rules() {
    return {
      lockGrain: this.lockGrain,
      rules: RULE_CONFIG,
    };
  }

  async reset(): Promise<{ ok: true }> {
    await this.store.reset();
    return { ok: true };
  }

  async labT0(userId: string): Promise<{
    history: string[];
    concurrentRequests: 2;
    lock: { grain: string; key: string; how: string };
    requests: Array<{ matchId: string; result: 'win' | 'lost'; timeInterval: number }>;
    outcomes: IngestResult[];
    snapshot: PlayerSnapshot;
  }> {
    const now = this.clock.now();
    const run = `t0_${now}`;
    this.seedMatch({
      userId,
      matchId: `${run}_h1`,
      gameType: 'math',
      result: 'lost',
      timeInterval: now - 60_000,
    });
    this.seedMatch({
      userId,
      matchId: `${run}_h2`,
      gameType: 'math',
      result: 'win',
      timeInterval: now - 40_000,
    });
    this.seedMatch({
      userId,
      matchId: `${run}_h3`,
      gameType: 'math',
      result: 'win',
      timeInterval: now - 20_000,
    });

    const win = {
      userId,
      matchId: `${run}_111`,
      gameType: 'memory' as const,
      result: 'win' as const,
      timeInterval: now + 1235,
    };
    const lost = {
      userId,
      matchId: `${run}_2`,
      gameType: 'math' as const,
      result: 'lost' as const,
      timeInterval: now + 1236,
    };

    const outcomes = await Promise.all([this.ingest(win), this.ingest(lost)]);
    await this.store.persist();
    return {
      history: ['lost', 'win', 'win'],
      concurrentRequests: 2,
      lock: {
        grain: 'userId',
        key: userId,
        how: 'Both threads take mutex(userId). One runs applyLocked; the other waits. After both commit, streak is counted in timeInterval order: win 111 (1235) then loss 2 (1236).',
      },
      requests: [
        { matchId: win.matchId, result: 'win', timeInterval: win.timeInterval },
        { matchId: lost.matchId, result: 'lost', timeInterval: lost.timeInterval },
      ],
      outcomes,
      snapshot: this.snapshot(userId),
    };
  }

  private async applyLocked(event: MatchEvent): Promise<IngestResult> {
    if (this.store.getMatch(event.matchId)) {
      return { kind: 'DUPLICATE', matchId: event.matchId, grants: [] };
    }

    const snapshot = this.store.matchesForUser(event.userId);
    if (this.raceYieldMs > 0) await sleep(this.raceYieldMs);

    const stored: StoredMatch = {
      matchId: event.matchId,
      userId: event.userId,
      gameType: event.gameType,
      result: event.result,
      timeInterval: event.timeInterval,
    };
    this.store.insertMatch(stored);

    const player = this.store.getPlayer(event.userId);
    const ordered = sortMatches([...snapshot, stored]);
    const grants = evaluateAll({
      userId: event.userId,
      triggering: stored,
      orderedMatches: ordered,
      comboExpiresAt: player.comboExpiresAt,
    });

    const applied: RewardGrant[] = [];
    for (const grant of grants) {
      const accepted = this.store.applyGrant(grant, stored.timeInterval);
      if (accepted) applied.push(grant);
    }

    await this.store.persist();
    return { kind: 'APPLIED', matchId: event.matchId, grants: applied };
  }
}
