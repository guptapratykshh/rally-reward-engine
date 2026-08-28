export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    const start = now - this.windowMs;
    const next = (this.hits.get(key) ?? []).filter((t) => t > start);
    if (next.length >= this.maxHits) {
      this.hits.set(key, next);
      return false;
    }
    next.push(now);
    this.hits.set(key, next);
    return true;
  }
}
