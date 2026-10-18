import { describe, it, expect, afterEach } from "bun:test";
import { loadConfig, saveConfig, updateConfig } from "../../config.js";
import { blockedRemoteTargets, isInternalAddress, isInternalTarget } from "../outbound-target.js";

const original = loadConfig();
afterEach(() => saveConfig({ ...original }));

describe("isInternalAddress", () => {
  it("flags loopback, private, link-local and unspecified addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::1]"]) {
      expect(isInternalAddress(ip)).toBe(true);
    }
  });

  it("passes public addresses", () => {
    for (const ip of ["1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:101:101"]) {
      expect(isInternalAddress(ip)).toBe(false);
    }
  });
});

describe("isInternalTarget", () => {
  it("reads the host of a URL, in any notation", async () => {
    expect(await isInternalTarget("http://127.0.0.1:8080/x")).toBe(true);
    expect(await isInternalTarget("http://2130706433/")).toBe(true);
    expect(await isInternalTarget("http://[::ffff:127.0.0.1]:9000")).toBe(true);
    expect(await isInternalTarget("http://localhost:3000")).toBe(true);
    expect(await isInternalTarget("https://1.1.1.1/")).toBe(false);
    expect(await isInternalTarget("not a url")).toBe(false);
  });
});

describe("blockedRemoteTargets", () => {
  it("blocks a new internal server and allows a saved one", async () => {
    updateConfig({ gotifyUrl: "http://192.168.1.5:8080", ntfyUrl: "https://ntfy.sh", llmBaseUrl: "", llmBaseUrls: {} });
    expect(await blockedRemoteTargets(["http://127.0.0.1:6379"])).toEqual(["http://127.0.0.1:6379"]);
    expect(await blockedRemoteTargets(["http://192.168.1.5:8080/"])).toEqual([]);
    expect(await blockedRemoteTargets(["http://127.0.0.1:1234/v1"])).toEqual([]);
    expect(await blockedRemoteTargets(["", undefined, "https://1.1.1.1"])).toEqual([]);
  });
});
