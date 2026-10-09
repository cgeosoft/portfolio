/**
 * A request throttle: at most `maxConcurrent` calls in flight and at most
 * `maxPerWindow` calls started in any `windowMs` window. Calls queue in FIFO
 * order. One instance guards every call to one provider.
 */

export interface ThrottleOptions {
  maxConcurrent: number;
  maxPerWindow: number;
  windowMs: number;
}

export class RequestThrottle {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  /** Start times of the calls inside the current window, oldest first. */
  private readonly starts: number[] = [];
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ThrottleOptions) {}

  /** Runs `fn` once a slot is free. */
  public async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
    try {
      return await fn();
    } finally {
      this.active--;
      this.drain();
    }
  }

  /** Holds every queued call for `ms` (after a 429 from the provider). */
  public pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  /** Calls in flight, calls waiting and calls started in the current window. */
  public stats(): { active: number; queued: number; inWindow: number } {
    this.prune(Date.now());
    return { active: this.active, queued: this.queue.length, inWindow: this.starts.length };
  }

  private prune(now: number): void {
    while (this.starts.length > 0 && now - this.starts[0]! >= this.options.windowMs) this.starts.shift();
  }

  private drain(): void {
    while (this.queue.length > 0) {
      if (this.active >= this.options.maxConcurrent) return;
      const now = Date.now();
      this.prune(now);
      let waitMs = 0;
      if (now < this.pausedUntil) waitMs = this.pausedUntil - now;
      else if (this.starts.length >= this.options.maxPerWindow) waitMs = this.starts[0]! + this.options.windowMs - now;
      if (waitMs > 0) {
        this.wake(waitMs);
        return;
      }
      this.active++;
      this.starts.push(now);
      this.queue.shift()!();
    }
  }

  private wake(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, Math.max(1, ms));
  }
}
