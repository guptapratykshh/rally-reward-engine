import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  algebraWinsInWindow,
  consecutiveWinsAtEnd,
  dayKey,
  evaluateAlgebraCombo,
  evaluateDailyLoot,
  evaluateWinStreak,
  sortMatches,
} from '../domain/rules.js';
import { COMBO_WINDOW_MS, MS_PER_DAY, type StoredMatch } from '../domain/types.js';

function m(partial: Partial<StoredMatch> & Pick<StoredMatch, 'matchId' | 'result'>): StoredMatch {
  return {
    userId: '123',
    gameType: 'math',
    timeInterval: 0,
    ...partial,
  };
}

describe('rule 1 streak', () => {
  it('grants 50 coins on the 3rd consecutive win, any game type', () => {
    const ordered = [
      m({ matchId: '1', result: 'win', gameType: 'memory', timeInterval: 1 }),
      m({ matchId: '2', result: 'win', gameType: 'math', timeInterval: 2 }),
      m({ matchId: '3', result: 'win', gameType: 'algebra', timeInterval: 3 }),
    ];
    const grant = evaluateWinStreak({
      userId: '123',
      triggering: ordered[2]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant?.amount, 50);
    assert.equal(grant?.ruleId, 'win_3_in_a_row');
  });

  it('does not grant when the last match is a loss', () => {
    const ordered = [
      m({ matchId: '1', result: 'win', timeInterval: 1 }),
      m({ matchId: '2', result: 'win', timeInterval: 2 }),
      m({ matchId: '3', result: 'lost', timeInterval: 3 }),
    ];
    const grant = evaluateWinStreak({
      userId: '123',
      triggering: ordered[2]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant, null);
    assert.equal(consecutiveWinsAtEnd(ordered), 0);
  });

  it('still grants when a later loss is already in the log — streak is counted at the triggering win', () => {
    const ordered = [
      m({ matchId: 'h1', result: 'lost', timeInterval: 1 }),
      m({ matchId: 'h2', result: 'win', timeInterval: 2 }),
      m({ matchId: 'h3', result: 'win', timeInterval: 3 }),
      m({ matchId: '111', result: 'win', timeInterval: 1235 }),
      m({ matchId: '2', result: 'lost', timeInterval: 1236 }),
    ];
    const grant = evaluateWinStreak({
      userId: '123',
      triggering: ordered[3]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant?.amount, 50);
    assert.equal(consecutiveWinsAtEnd(ordered), 0);
  });

  it('orders by timeInterval, not array position', () => {
    const unordered = [
      m({ matchId: '2', result: 'lost', timeInterval: 1236 }),
      m({ matchId: '111', result: 'win', timeInterval: 1235 }),
    ];
    const ordered = sortMatches(unordered);
    assert.equal(ordered[0]?.matchId, '111');
    assert.equal(consecutiveWinsAtEnd(ordered), 0);
  });
});

describe('rule 2 daily loot', () => {
  it('grants a loot box on the 5th match of the day only', () => {
    const day = 5 * MS_PER_DAY;
    const ordered = [1, 2, 3, 4, 5].map((i) =>
      m({ matchId: String(i), result: 'lost', timeInterval: day + i }),
    );
    const grant = evaluateDailyLoot({
      userId: '123',
      triggering: ordered[4]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant?.kind, 'LOOT_BOX');
    assert.equal(grant?.dayKey, dayKey(day + 5));
  });

  it('does not grant on the 6th match the same day', () => {
    const day = 5 * MS_PER_DAY;
    const ordered = [1, 2, 3, 4, 5, 6].map((i) =>
      m({ matchId: String(i), result: 'win', timeInterval: day + i }),
    );
    const grant = evaluateDailyLoot({
      userId: '123',
      triggering: ordered[5]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant, null);
  });
});

describe('rule 3 algebra combo', () => {
  it('activates when two algebra wins land inside one hour', () => {
    const ordered = [
      m({ matchId: 'a', result: 'win', gameType: 'algebra', timeInterval: 1000 }),
      m({ matchId: 'b', result: 'win', gameType: 'algebra', timeInterval: 1000 + COMBO_WINDOW_MS - 1 }),
    ];
    const grant = evaluateAlgebraCombo({
      userId: '123',
      triggering: ordered[1]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant?.kind, 'COMBO');
    assert.equal(algebraWinsInWindow(ordered, ordered[1]!.timeInterval).length, 2);
  });

  it('does not activate when the second win is outside the hour', () => {
    const ordered = [
      m({ matchId: 'a', result: 'win', gameType: 'algebra', timeInterval: 1000 }),
      m({ matchId: 'b', result: 'win', gameType: 'algebra', timeInterval: 1000 + COMBO_WINDOW_MS + 1 }),
    ];
    const grant = evaluateAlgebraCombo({
      userId: '123',
      triggering: ordered[1]!,
      orderedMatches: ordered,
      comboExpiresAt: null,
    });
    assert.equal(grant, null);
  });
});
