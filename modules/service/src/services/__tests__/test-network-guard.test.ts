/** The test preload (scripts/test-network-guard.ts) blocks every request that would leave the machine. */
import { describe, it, expect, afterEach } from "bun:test";
import https from "node:https";
import { takeBlockedRequests } from "../../../../../scripts/test-network-guard";

afterEach(() => {
  // The attempts below are on purpose; the guard's afterEach would fail the test otherwise.
  takeBlockedRequests();
});

describe("test network guard", () => {
  it("rejects fetch to FMP and any other remote host, and records the attempt", async () => {
    await expect(fetch("https://financialmodelingprep.com/stable/quote?symbol=AAPL")).rejects.toThrow(/Network request blocked/);
    await expect(fetch(new Request("https://query1.finance.yahoo.com/v8/finance/chart/X"))).rejects.toThrow(/Network request blocked/);
    // The query (where a key or a symbol would be) stays out of the record.
    expect(takeBlockedRequests()).toEqual(["fetch https://financialmodelingprep.com/stable/quote", "fetch https://query1.finance.yahoo.com/v8/finance/chart/X"]);
  });

  it("blocks node:https and WebSocket too", () => {
    expect(() => https.get("https://example.com/")).toThrow(/Network request blocked/);
    expect(() => new WebSocket("wss://example.com/socket")).toThrow(/Network request blocked/);
    expect(takeBlockedRequests().length).toBe(2);
  });

  it("allows loopback servers and data URLs", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
      expect(await (await fetch(`http://localhost:${server.port}/`)).text()).toBe("ok");
    } finally {
      server.stop(true);
    }
    expect(await (await fetch("data:text/plain,hi")).text()).toBe("hi");
    expect(takeBlockedRequests()).toEqual([]);
  });
});
