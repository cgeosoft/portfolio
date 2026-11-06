/** Error reports: the allowlist, the canary, the send filter, the rate limit, the recursion guard and the off state. */
import { describe, it, expect, afterAll } from "bun:test";
import { loadConfig, updateConfig } from "../../config.js";
import { buildReport, ErrorReportingService, filterReportEvent, safeError } from "../error-reporting.js";

const CANARIES = ["AAPL", "1234.56", "/home/alice", "C:\\Users\\alice", "https://secret.example", "sk-abcdefghijklmnopqrstuvwxyz", "My Retirement Fund"];

function canaryError(): Error {
  const message = `Failed ${CANARIES.join(" ")}`;
  const error = new TypeError(message);
  error.stack = [
    `TypeError: ${message}`,
    "    at load (/home/alice/app/service/main.js:10:20)",
    "    at async run (/home/alice/app/service/main.js:30:40)",
    "    at helper (/home/alice/.bun/install/node_modules/x/index.js:1:2)",
    "    at C:\\Users\\alice\\metrics\\My Retirement Fund.js:5:6",
    "    at https://secret.example/x.js:7:8",
  ].join("\n");
  return error;
}

function fakeClient() {
  const sent: { error: Error; id: unknown; props: Record<string, unknown> }[] = [];
  return {
    sent,
    client: {
      captureException: (error: Error, id: unknown, props: Record<string, unknown>) => void sent.push({ error, id, props }),
      shutdown: async () => {},
    },
  };
}

function serviceWith(client: unknown): ErrorReportingService {
  const service = new ErrorReportingService();
  (service as unknown as { client: unknown }).client = client;
  return service;
}

describe("buildReport", () => {
  it("keeps only app frames and the error type", () => {
    const report = buildReport(canaryError(), "service:uncaught");
    expect(report.type).toBe("TypeError");
    expect(report.code).toBe("service:uncaught");
    expect(report.frames).toEqual([
      { fn: "load", file: "service/main.js", line: 10, column: 20 },
      { fn: "run", file: "service/main.js", line: 30, column: 40 },
      "[external]",
    ]);
  });

  it("reads a WebKit stack and a bundle file of the GUI", () => {
    const report = buildReport({ name: "RangeError", stack: "render@http://127.0.0.1:5000/assets/index-a1B2.js:1:99\nglobal code@http://x/y.js:1:1" }, "gui:window");
    expect(report.frames).toEqual([{ fn: "render", file: "assets/index-a1B2.js", line: 1, column: 99 }, "[external]"]);
  });

  it("refuses an unsafe type and an unsafe function name", () => {
    const report = buildReport({ name: "AAPL 1234", stack: "    at weird name!(x) (/opt/service/main.js:1:2)" }, "service:unhandled");
    expect(report.type).toBe("Error");
    expect(report.frames).toEqual([{ fn: "<anonymous>", file: "service/main.js", line: 1, column: 2 }]);
  });

  it("copes with a value that is not an error", () => {
    expect(buildReport("AAPL", "service:unhandled")).toMatchObject({ type: "Error", frames: [] });
    expect(buildReport(null, "service:unhandled").frames).toEqual([]);
  });

  it("gives the same fingerprint to the same crash", () => {
    expect(buildReport(canaryError(), "gui:window").fingerprint).toBe(buildReport(canaryError(), "gui:window").fingerprint);
    expect(buildReport(canaryError(), "gui:window").fingerprint).not.toBe(buildReport(canaryError(), "gui:boundary").fingerprint);
  });
});

describe("canary", () => {
  it("sends nothing private", () => {
    const { sent, client } = fakeClient();
    serviceWith(client).report(canaryError(), "service:uncaught");
    expect(sent).toHaveLength(1);
    const { error, id, props } = sent[0]!;
    const payload = JSON.stringify({ name: error.name, message: error.message, stack: error.stack, props });
    for (const canary of CANARIES) expect(payload).not.toContain(canary);
    expect(id).toBeUndefined();
    expect(Object.keys(props).sort()).toEqual(["$exception_fingerprint", "app_version", "arch", "capture_code", "channel", "consent_version", "os", "process"]);
    expect(props.process).toBe("service");
  });

  it("builds an error from the safe fields only", () => {
    const report = buildReport(canaryError(), "service:uncaught");
    const error = safeError(report);
    expect(error.message).toBe("service:uncaught");
    expect(error.stack).toContain("at load (service/main.js:10:20)");
  });
});

describe("filterReportEvent", () => {
  it("drops every property and frame field outside the allowlist", () => {
    const filtered = filterReportEvent({
      event: "$exception",
      properties: {
        capture_code: "gui:window",
        $session_id: "x",
        extra: "AAPL",
        $exception_list: [
          {
            type: "Error",
            value: "gui:window",
            secret: "AAPL",
            stacktrace: {
              type: "raw",
              frames: [{ filename: "service/main.js", lineno: 1, context_line: "const a = 1", pre_context: ["x"], post_context: ["y"], vars: { a: 1 }, abs_path: "/home/alice" }],
            },
          },
        ],
      },
    });
    expect(filtered?.properties?.extra).toBeUndefined();
    expect(filtered?.properties?.$session_id).toBeUndefined();
    expect(filtered?.properties?.capture_code).toBe("gui:window");
    const text = JSON.stringify(filtered);
    for (const word of ["context_line", "pre_context", "post_context", "vars", "abs_path", "secret"]) expect(text).not.toContain(word);
    expect(text).toContain("service/main.js");
  });

  it("drops any other event", () => {
    expect(filterReportEvent({ event: "app_launched", properties: {} })).toBeNull();
  });
});

describe("ErrorReportingService", () => {
  const saved = loadConfig().errorReportingEnabled;
  afterAll(() => updateConfig({ errorReportingEnabled: saved }));

  it("sends nothing without a client", () => {
    updateConfig({ errorReportingEnabled: true });
    const service = new ErrorReportingService();
    service.initialize(); // A checkout has no key.
    expect((service as unknown as { client: unknown }).client).toBeNull();
    expect(() => service.report(canaryError(), "service:uncaught")).not.toThrow();
  });

  it("reports one crash once", () => {
    const { sent, client } = fakeClient();
    const service = serviceWith(client);
    service.report(canaryError(), "service:uncaught");
    service.report(canaryError(), "service:uncaught");
    expect(sent).toHaveLength(1);
  });

  it("stops after the limit of a run", () => {
    const { sent, client } = fakeClient();
    const service = serviceWith(client);
    for (let line = 1; line <= 40; line++) service.report({ name: "Error", stack: `    at f (/opt/service/main.js:${line}:1)` }, "service:uncaught");
    expect(sent).toHaveLength(20);
  });

  it("never reports its own failure", () => {
    const { sent, client } = fakeClient();
    const service = serviceWith(client);
    service.report({ name: "Error", stack: "    at capture (/opt/node_modules/posthog-node/client.js:1:1)" }, "service:unhandled");
    service.report({ name: "Error", stack: "    at report (/opt/error-reporting.ts:1:1)" }, "service:unhandled");
    expect(sent).toHaveLength(0);
  });

  it("survives a client that throws", () => {
    const service = serviceWith({
      captureException: () => {
        throw new Error("boom");
      },
    });
    expect(() => service.report(canaryError(), "service:uncaught")).not.toThrow();
  });
});
