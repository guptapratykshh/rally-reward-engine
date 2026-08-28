import { randomBytes } from 'node:crypto';

export function newMatchId(): string {
  return `m_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function isUserId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(value);
}
