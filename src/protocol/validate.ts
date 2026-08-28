import type { GameType, MatchEvent, MatchResult } from '../domain/types.js';
import { isUserId } from '../infra/ids.js';

const GAME_TYPES = new Set<GameType>(['memory', 'math', 'algebra', 'logic']);
const RESULTS = new Set<MatchResult>(['win', 'lost']);

export function parseMatchEvent(body: unknown): { ok: true; event: MatchEvent } | { ok: false; code: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, code: 'INVALID_JSON' };
  const row = body as Record<string, unknown>;
  const userId = str(row['userId'] ?? row['Userid']);
  const gameType = str(row['gameType'] ?? row['Gametype']).toLowerCase();
  const result = str(row['result'] ?? row['Result']).toLowerCase();
  const matchId = str(row['matchId'] ?? row['matchid']);
  const timeRaw = row['timeInterval'];
  const timeInterval = timeRaw === undefined || timeRaw === null || timeRaw === '' ? 0 : num(timeRaw);
  if (!isUserId(userId)) return { ok: false, code: 'INVALID_USER' };
  if (!GAME_TYPES.has(gameType as GameType)) return { ok: false, code: 'INVALID_GAMETYPE' };
  if (!RESULTS.has(result as MatchResult)) return { ok: false, code: 'INVALID_RESULT' };
  if (timeInterval === null) return { ok: false, code: 'INVALID_TIME' };
  return {
    ok: true,
    event: {
      userId,
      gameType: gameType as GameType,
      result: result as MatchResult,
      matchId,
      timeInterval,
    },
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
