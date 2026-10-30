/** RequestThrottle concurrency and window limits, pause, and the OfflineBreaker. */
import { describe, it, expect, beforeEach, afterEach, jest } from "bun:test";
import { RequestThrottle } from "../providers/throttle";
import { OfflineBreaker } from "../providers/offline";

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("RequestThrottle", () => {
  it("limits concurrency and requests per window, in FIFO order", async () => {
    const throttle = new RequestThrottle({ maxConcurrent: 2, maxPerWindow: 3, windowMs: 1000 });
    const started: number[] = [];
    const resolvers: ((v: number) => void)[] = [];
    const runs = [0, 1, 2, 3, 4].map((i) =>
      throttle.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(i);
            resolvers[i] = resolve;
          }),
      ),
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(throttle.stats()).toEqual({ active: 2, queued: 3, inWindow: 2 });

    resolvers[0]!(0);
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(throttle.stats()).toEqual({ active: 2, queued: 2, inWindow: 3 });

    resolvers[1]!(1);
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(throttle.stats()).toEqual({ active: 1, queued: 2, inWindow: 3 });

    jest.advanceTimersByTime(999);
    await flush();
    expect(started).toEqual([0, 1, 2]);
    jest.advanceTimersByTime(1);
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(throttle.stats()).toEqual({ active: 2, queued: 1, inWindow: 1 });

    resolvers[2]!(2);
    resolvers[3]!(3);
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(throttle.stats()).toEqual({ active: 1, queued: 0, inWindow: 2 });

    resolvers[4]!(4);
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4]);
  });

  it("holds queued calls during a pause", async () => {
    const throttle = new RequestThrottle({ maxConcurrent: 5, maxPerWindow: 100, windowMs: 1000 });
    throttle.pause(500);
    let started = false;
    const run = throttle.run(async () => {
      started = true;
      return 1;
    });
    jest.advanceTimersByTime(499);
    await flush();
    expect(started).toBe(false);
    jest.advanceTimersByTime(1);
    await flush();
    expect(started).toBe(true);
    expect(await run).toBe(1);
  });

  it("passes a rejection through and frees the slot", async () => {
    const throttle = new RequestThrottle({ maxConcurrent: 1, maxPerWindow: 100, windowMs: 1000 });
    const first = throttle.run(async () => {
      throw new Error("boom");
    });
    const second = throttle.run(async () => 7);
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe(7);
    expect(throttle.stats().active).toBe(0);
  });
});

describe("OfflineBreaker", () => {
  it("opens on the threshold failure only", () => {
    const b = new OfflineBreaker({ threshold: 3, pauseMs: 1000 });
    expect(b.failure()).toBe(false);
    expect(b.failure()).toBe(false);
    expect(b.isOpen()).toBe(false);
    expect(b.failure()).toBe(true);
    expect(b.isOpen()).toBe(true);
    expect(b.failure()).toBe(false);
  });

  it("closes after the pause", () => {
    const b = new OfflineBreaker({ threshold: 3, pauseMs: 1000 });
    b.failure();
    b.failure();
    b.failure();
    expect(b.isOpen()).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(b.isOpen()).toBe(false);
  });

  it("resets the count on success and closes on reset", () => {
    const b = new OfflineBreaker({ threshold: 3, pauseMs: 1000 });
    b.failure();
    b.success();
    b.failure();
    b.failure();
    expect(b.isOpen()).toBe(false);
    b.failure();
    expect(b.isOpen()).toBe(true);
    b.reset();
    expect(b.isOpen()).toBe(false);
  });
});
