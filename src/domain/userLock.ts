/**
 * Per-key mutex via a promise chain. Grain must be userId for streak/daily/combo
 * state. Locking matchId lets two matches for the same user run together.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => current);
    this.tails.set(key, chained);

    return prev
      .then(() => fn())
      .finally(() => {
        release();
        if (this.tails.get(key) === chained) this.tails.delete(key);
      });
  }
}
