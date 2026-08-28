import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  algebraWinsInWindow,
  consecutiveWinsAtEnd,
  dayKey,
  matchesOnSameDay,
} from '../domain/rules.js';
import {
  COMBO_WINDOW_MS,
  WINS_NEEDED_FOR_STREAK,
  type PlayerRewardState,
  type PlayerSnapshot,
  type RewardGrant,
  type StoredMatch,
} from '../domain/types.js';

export interface RewardStore {
  getMatch(matchId: string): StoredMatch | undefined;
  insertMatch(match: StoredMatch): boolean;
  matchesForUser(userId: string): StoredMatch[];
  getPlayer(userId: string): PlayerRewardState;
  applyGrant(grant: RewardGrant, now: number): boolean;
  listGrants(userId: string): RewardGrant[];
  listAllGrants(): RewardGrant[];
  listPlayerIds(): string[];
  snapshot(userId: string, now: number): PlayerSnapshot;
  persist(): Promise<void>;
  reset(): Promise<void>;
}

function grantKey(grant: RewardGrant): string {
  if (grant.ruleId === 'play_5_in_a_day') {
    return `${grant.userId}|${grant.ruleId}|${grant.dayKey ?? ''}`;
  }
  return `${grant.userId}|${grant.ruleId}|${grant.triggeringMatchId}`;
}

function emptyPlayer(userId: string): PlayerRewardState {
  return {
    userId,
    coins: 0,
    lootBoxes: 0,
    comboMultiplier: 1,
    comboExpiresAt: null,
  };
}

export class InMemoryStore implements RewardStore {
  private readonly matches = new Map<string, StoredMatch>();
  private readonly grants = new Map<string, RewardGrant>();
  private readonly players = new Map<string, PlayerRewardState>();

  getMatch(matchId: string): StoredMatch | undefined {
    return this.matches.get(matchId);
  }

  insertMatch(match: StoredMatch): boolean {
    if (this.matches.has(match.matchId)) return false;
    this.matches.set(match.matchId, match);
    return true;
  }

  matchesForUser(userId: string): StoredMatch[] {
    const rows: StoredMatch[] = [];
    for (const match of this.matches.values()) {
      if (match.userId === userId) rows.push(match);
    }
    return rows.sort((a, b) => {
      if (a.timeInterval !== b.timeInterval) return a.timeInterval - b.timeInterval;
      return a.matchId.localeCompare(b.matchId);
    });
  }

  getPlayer(userId: string): PlayerRewardState {
    const existing = this.players.get(userId);
    if (existing) return { ...existing };
    return emptyPlayer(userId);
  }

  applyGrant(grant: RewardGrant, now: number): boolean {
    const key = grantKey(grant);
    if (this.grants.has(key)) return false;
    const stamped: RewardGrant = { ...grant, grantedAt: now };
    this.grants.set(key, stamped);

    const player = this.getPlayer(grant.userId);
    if (grant.kind === 'COINS') player.coins += grant.amount;
    if (grant.kind === 'LOOT_BOX') player.lootBoxes += grant.amount;
    if (grant.kind === 'COMBO') {
      player.comboMultiplier = grant.amount;
      player.comboExpiresAt = now + COMBO_WINDOW_MS;
    }
    this.players.set(grant.userId, player);
    return true;
  }

  listGrants(userId: string): RewardGrant[] {
    return this.listAllGrants().filter((g) => g.userId === userId);
  }

  listAllGrants(): RewardGrant[] {
    return [...this.grants.values()].sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
  }

  listPlayerIds(): string[] {
    const ids = new Set<string>();
    for (const match of this.matches.values()) ids.add(match.userId);
    for (const player of this.players.values()) ids.add(player.userId);
    return [...ids].sort();
  }

  snapshot(userId: string, now: number): PlayerSnapshot {
    const matches = this.matchesForUser(userId);
    const player = this.livePlayer(userId, now);
    const grants = this.listGrants(userId);
    const currentStreak = consecutiveWinsAtEnd(matches);
    const matchesToday = matchesOnSameDay(matches, now).length;
    const algebraWinsLastHour = algebraWinsInWindow(matches, now).length;
    const comboActive = player.comboExpiresAt !== null && now <= player.comboExpiresAt;
    const dailyClaimed = grants.some(
      (g) => g.ruleId === 'play_5_in_a_day' && g.dayKey === dayKey(now),
    );
    return {
      matches,
      player,
      grants,
      progress: {
        currentStreak,
        matchesToday,
        algebraWinsLastHour,
        comboActive,
        streakInCycle: currentStreak % WINS_NEEDED_FOR_STREAK,
        dailyClaimed,
      },
    };
  }

  async persist(): Promise<void> {
    // in-memory: nothing to flush
  }

  async reset(): Promise<void> {
    this.hydrate({});
  }

  serialize(): {
    matches: StoredMatch[];
    grants: RewardGrant[];
    players: PlayerRewardState[];
  } {
    return {
      matches: [...this.matches.values()],
      grants: [...this.grants.values()],
      players: [...this.players.values()],
    };
  }

  hydrate(data: {
    matches?: StoredMatch[];
    grants?: RewardGrant[];
    players?: PlayerRewardState[];
  }): void {
    this.matches.clear();
    this.grants.clear();
    this.players.clear();
    for (const match of data.matches ?? []) this.matches.set(match.matchId, match);
    for (const grant of data.grants ?? []) this.grants.set(grantKey(grant), grant);
    for (const player of data.players ?? []) this.players.set(player.userId, player);
  }

  private livePlayer(userId: string, now: number): PlayerRewardState {
    const player = this.getPlayer(userId);
    if (player.comboExpiresAt !== null && now > player.comboExpiresAt) {
      player.comboMultiplier = 1;
      player.comboExpiresAt = null;
    }
    return player;
  }
}

export class FileStore implements RewardStore {
  private readonly inner = new InMemoryStore();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.inner.hydrate(JSON.parse(raw) as {
        matches?: StoredMatch[];
        grants?: RewardGrant[];
        players?: PlayerRewardState[];
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  getMatch(matchId: string) {
    return this.inner.getMatch(matchId);
  }
  insertMatch(match: StoredMatch) {
    return this.inner.insertMatch(match);
  }
  matchesForUser(userId: string) {
    return this.inner.matchesForUser(userId);
  }
  getPlayer(userId: string) {
    return this.inner.getPlayer(userId);
  }
  applyGrant(grant: RewardGrant, now: number) {
    return this.inner.applyGrant(grant, now);
  }
  listGrants(userId: string) {
    return this.inner.listGrants(userId);
  }
  listAllGrants() {
    return this.inner.listAllGrants();
  }
  listPlayerIds() {
    return this.inner.listPlayerIds();
  }
  snapshot(userId: string, now: number) {
    return this.inner.snapshot(userId, now);
  }

  persist(): Promise<void> {
    this.chain = this.chain.then(() => this.flush()).catch((err: unknown) => {
      console.error('store persist failed', err);
    });
    return this.chain;
  }

  async reset(): Promise<void> {
    this.inner.hydrate({});
    await this.persist();
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.inner.serialize(), null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
