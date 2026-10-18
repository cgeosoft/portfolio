/**
 * An offline breaker for one provider. After `threshold` network failures in
 * a row (no response at all: DNS, refused connection, timeout) the provider
 * counts as offline for `pauseMs`, so callers get their cached copies at once
 * instead of waiting for one timeout per symbol. Any response, whatever its
 * HTTP status, shows the network works and resets the count.
 */

export interface OfflineBreakerOptions {
  threshold: number;
  pauseMs: number;
}

export class OfflineBreaker {
  private failures = 0;
  private until = 0;

  constructor(private readonly options: OfflineBreakerOptions) {}

  /** True while the provider counts as offline. */
  public isOpen(): boolean {
    return Date.now() < this.until;
  }

  /** A response came back. */
  public success(): void {
    this.failures = 0;
  }

  /** A request got no response. True when this failure opened the breaker, so the caller logs once. */
  public failure(): boolean {
    if (this.isOpen()) return false;
    this.failures++;
    if (this.failures < this.options.threshold) return false;
    this.failures = 0;
    this.until = Date.now() + this.options.pauseMs;
    return true;
  }

  public reset(): void {
    this.failures = 0;
    this.until = 0;
  }
}
