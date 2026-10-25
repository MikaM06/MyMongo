interface Bucket {
  failures: number;
  windowStart: number;
}

export interface LimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}

export class FailureLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: LimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  retryAfterSeconds(key: string): number {
    const bucket = this.current(key);
    if (!bucket || bucket.failures < this.options.maxFailures) {
      return 0;
    }
    return Math.ceil(
      (bucket.windowStart + this.options.windowMs - this.now()) / 1000,
    );
  }

  fail(key: string): void {
    const bucket = this.current(key);
    if (bucket) {
      bucket.failures++;
      return;
    }
    if (this.buckets.size > 50_000) {
      this.sweep();
    }
    this.buckets.set(key, {failures: 1, windowStart: this.now()});
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  sweep(): void {
    for (const key of [...this.buckets.keys()]) {
      this.current(key);
    }
  }

  private current(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && this.now() - bucket.windowStart >= this.options.windowMs) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }
}
