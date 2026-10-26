/**
 * MUT-437: in-process ordering for the agent write lock. `KeyedQueue` runs one job per key at a time (a promise chain
 * per key, dropped once idle); `Semaphore` caps how many jobs run at once. Neither holds anything but promises, so a
 * waiting job holds no database connection (review: waiters holding pooled connections starved the lock's holder).
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(job);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

export class Semaphore {
  private readonly waiting: Array<() => void> = [];

  constructor(private free: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    }
  }
}
