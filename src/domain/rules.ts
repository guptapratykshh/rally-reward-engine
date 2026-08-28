import {
  ALGEBRA_WINS_FOR_COMBO,
  COINS_FOR_WIN_STREAK,
  COMBO_MULTIPLIER,
  COMBO_WINDOW_MS,
  MATCHES_NEEDED_FOR_DAILY_LOOT,
  MS_PER_DAY,
  WINS_NEEDED_FOR_STREAK,
  type EvaluateContext,
  type RewardGrant,
  type StoredMatch,
} from './types.js';

export function sortMatches(matches: StoredMatch[]): StoredMatch[] {
  return [...matches].sort((a, b) => {
    if (a.timeInterval !== b.timeInterval) return a.timeInterval - b.timeInterval;
    return a.matchId.localeCompare(b.matchId);
  });
}

export function consecutiveWinsAtEnd(ordered: StoredMatch[]): number {
  let count = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const match = ordered[i];
    if (!match || match.result !== 'win') break;
    count++;
  }
  return count;
}

export function consecutiveWinsEndingAt(ordered: StoredMatch[], triggerMatchId: string): number {
  const idx = ordered.findIndex((m) => m.matchId === triggerMatchId);
  if (idx < 0) return 0;
  let count = 0;
  for (let i = idx; i >= 0; i--) {
    const match = ordered[i];
    if (!match || match.result !== 'win') break;
    count++;
  }
  return count;
}

export function dayKey(timeInterval: number): string {
  return String(Math.floor(timeInterval / MS_PER_DAY));
}

export function matchesOnSameDay(ordered: StoredMatch[], timeInterval: number): StoredMatch[] {
  const key = dayKey(timeInterval);
  return ordered.filter((m) => dayKey(m.timeInterval) === key);
}

export function algebraWinsInWindow(ordered: StoredMatch[], endAt: number): StoredMatch[] {
  const startAt = endAt - COMBO_WINDOW_MS;
  return ordered.filter(
    (m) =>
      m.gameType === 'algebra' &&
      m.result === 'win' &&
      m.timeInterval >= startAt &&
      m.timeInterval <= endAt,
  );
}

export function evaluateWinStreak(ctx: EvaluateContext): RewardGrant | null {
  if (ctx.triggering.result !== 'win') return null;
  const streak = consecutiveWinsEndingAt(ctx.orderedMatches, ctx.triggering.matchId);
  if (streak === 0 || streak % WINS_NEEDED_FOR_STREAK !== 0) return null;
  return {
    userId: ctx.userId,
    ruleId: 'win_3_in_a_row',
    triggeringMatchId: ctx.triggering.matchId,
    kind: 'COINS',
    amount: COINS_FOR_WIN_STREAK,
  };
}

export function evaluateDailyLoot(ctx: EvaluateContext): RewardGrant | null {
  const sameDay = matchesOnSameDay(ctx.orderedMatches, ctx.triggering.timeInterval);
  if (sameDay.length !== MATCHES_NEEDED_FOR_DAILY_LOOT) return null;
  return {
    userId: ctx.userId,
    ruleId: 'play_5_in_a_day',
    triggeringMatchId: ctx.triggering.matchId,
    kind: 'LOOT_BOX',
    amount: 1,
    dayKey: dayKey(ctx.triggering.timeInterval),
  };
}

export function evaluateAlgebraCombo(ctx: EvaluateContext): RewardGrant | null {
  if (ctx.triggering.gameType !== 'algebra' || ctx.triggering.result !== 'win') return null;
  const inWindow = algebraWinsInWindow(ctx.orderedMatches, ctx.triggering.timeInterval);
  if (inWindow.length < ALGEBRA_WINS_FOR_COMBO) return null;
  if (ctx.comboExpiresAt !== null && ctx.triggering.timeInterval <= ctx.comboExpiresAt) {
    return null;
  }
  return {
    userId: ctx.userId,
    ruleId: 'algebra_combo_1h',
    triggeringMatchId: ctx.triggering.matchId,
    kind: 'COMBO',
    amount: COMBO_MULTIPLIER,
  };
}

export function evaluateAll(ctx: EvaluateContext): RewardGrant[] {
  const next = { ...ctx, orderedMatches: sortMatches(ctx.orderedMatches) };
  return [evaluateWinStreak(next), evaluateDailyLoot(next), evaluateAlgebraCombo(next)].filter(
    (g): g is RewardGrant => g !== null,
  );
}
