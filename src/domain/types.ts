export const COINS_FOR_WIN_STREAK = 50;
export const WINS_NEEDED_FOR_STREAK = 3;
export const MATCHES_NEEDED_FOR_DAILY_LOOT = 5;
export const ALGEBRA_WINS_FOR_COMBO = 2;
export const COMBO_WINDOW_MS = 60 * 60 * 1000;
export const COMBO_MULTIPLIER = 2;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type GameType = 'memory' | 'math' | 'algebra' | 'logic';
export type MatchResult = 'win' | 'lost';
export type RuleId = 'win_3_in_a_row' | 'play_5_in_a_day' | 'algebra_combo_1h';
export type GrantKind = 'COINS' | 'LOOT_BOX' | 'COMBO';
export type LockGrain = 'user' | 'match';

export interface MatchEvent {
  userId: string;
  gameType: GameType;
  result: MatchResult;
  matchId: string;
  timeInterval: number;
}

export interface StoredMatch {
  matchId: string;
  userId: string;
  gameType: GameType;
  result: MatchResult;
  timeInterval: number;
}

export interface PlayerRewardState {
  userId: string;
  coins: number;
  lootBoxes: number;
  comboMultiplier: number;
  comboExpiresAt: number | null;
}

export interface RewardGrant {
  userId: string;
  ruleId: RuleId;
  triggeringMatchId: string;
  kind: GrantKind;
  amount: number;
  dayKey?: string;
  grantedAt?: number;
}

export interface QuestProgress {
  currentStreak: number;
  matchesToday: number;
  algebraWinsLastHour: number;
  comboActive: boolean;
  streakInCycle: number;
  dailyClaimed: boolean;
}

export interface PlayerSnapshot {
  matches: StoredMatch[];
  player: PlayerRewardState;
  grants: RewardGrant[];
  progress: QuestProgress;
}

export type IngestResult =
  | { kind: 'APPLIED'; matchId: string; grants: RewardGrant[] }
  | { kind: 'DUPLICATE'; matchId: string; grants: RewardGrant[] }
  | { kind: 'REJECTED'; code: string };

export interface EvaluateContext {
  userId: string;
  triggering: StoredMatch;
  orderedMatches: StoredMatch[];
  comboExpiresAt: number | null;
}

export const RULE_CONFIG = {
  win_3_in_a_row: {
    ruleId: 'win_3_in_a_row' as const,
    type: 'STREAK',
    consecutiveWins: WINS_NEEDED_FOR_STREAK,
    award: { kind: 'COINS' as const, amount: COINS_FOR_WIN_STREAK },
  },
  play_5_in_a_day: {
    ruleId: 'play_5_in_a_day' as const,
    type: 'DAILY_COUNT',
    matchesInDay: MATCHES_NEEDED_FOR_DAILY_LOOT,
    award: { kind: 'LOOT_BOX' as const, amount: 1 },
  },
  algebra_combo_1h: {
    ruleId: 'algebra_combo_1h' as const,
    type: 'SLIDING_WINDOW',
    gameType: 'algebra' as const,
    result: 'win' as const,
    count: ALGEBRA_WINS_FOR_COMBO,
    windowMs: COMBO_WINDOW_MS,
    award: { kind: 'COMBO' as const, amount: COMBO_MULTIPLIER },
  },
} as const;
