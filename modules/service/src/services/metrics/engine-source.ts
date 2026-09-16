/**
 * Source of the metric engine process. The runtime writes it to disk and
 * spawns it with the application's own runtime binary, so it is embedded here
 * as a string rather than bundled as a separate entry point.
 *
 * The engine speaks newline-delimited JSON over stdin/stdout:
 *   -> { id, op: "load",   moduleId, base64 }
 *   -> { id, op: "run",    moduleId, base64, memoryPages }
 *   -> { id, op: "unload", moduleId }
 *   -> { id, op: "ping" }
 *   <- { id, ok: true, ... } | { id, ok: false, error }
 *
 * A module is instantiated with a fresh, host-owned memory for every run, so
 * runs never share state and the bump allocator cannot exhaust memory over
 * time. The only imports supplied are the three AssemblyScript runtime hooks;
 * none of them can reach outside the sandbox.
 */

export const METRIC_ENGINE_SOURCE = String.raw`
"use strict";
const MAX_OUTPUT_BYTES = 4096;
const MIN_PAGES = 2;
const MAX_PAGES = 64;
const ALLOWED_IMPORTS = new Set(["env.memory", "env.abort", "env.seed", "env.trace"]);
const REQUIRED_EXPORTS = ["metric_abi_version", "metric_alloc", "metric_run"];

const modules = new Map();
const decoder = new TextDecoder();

function readLeb(bytes, pos) {
  let result = 0, shift = 0, byte;
  do {
    byte = bytes[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, pos];
}

/** Read the limits of the imported memory from the binary import section. */
function importedMemoryLimits(bytes) {
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size;
    [size, pos] = readLeb(bytes, pos);
    const end = pos + size;
    if (id === 2) {
      let count;
      [count, pos] = readLeb(bytes, pos);
      for (let i = 0; i < count; i++) {
        let len;
        [len, pos] = readLeb(bytes, pos);
        pos += len;
        [len, pos] = readLeb(bytes, pos);
        pos += len;
        const kind = bytes[pos++];
        if (kind === 0) {
          [, pos] = readLeb(bytes, pos);
        } else if (kind === 1 || kind === 2) {
          if (kind === 1) pos++;
          const flags = bytes[pos++];
          let min, max = null;
          [min, pos] = readLeb(bytes, pos);
          if (flags & 1) [max, pos] = readLeb(bytes, pos);
          if (kind === 2) return { min, max };
        } else if (kind === 3) {
          pos += 2;
        } else {
          throw new Error("unsupported import kind " + kind);
        }
      }
    }
    pos = end;
  }
  return null;
}

function abortMessage(memory, msgPtr) {
  try {
    if (!msgPtr) return "abort";
    const view = new DataView(memory.buffer);
    const len = Math.min(view.getUint32(msgPtr - 4, true), 400);
    const chars = new Uint16Array(memory.buffer, msgPtr, len >> 1);
    return "abort: " + String.fromCharCode.apply(null, Array.from(chars));
  } catch {
    return "abort";
  }
}

async function load(req) {
  const bytes = Buffer.from(req.base64, "base64");
  const module = await WebAssembly.compile(bytes);
  for (const imp of WebAssembly.Module.imports(module)) {
    const name = imp.module + "." + imp.name;
    if (!ALLOWED_IMPORTS.has(name)) throw new Error("module requests forbidden import " + name);
    if (name === "env.memory" && imp.kind !== "memory") throw new Error("env.memory must be a memory import");
    if (name !== "env.memory" && imp.kind !== "function") throw new Error(name + " must be a function import");
  }
  const exportNames = new Set(WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name));
  for (const name of REQUIRED_EXPORTS) {
    if (!exportNames.has(name)) throw new Error("module does not export " + name);
  }
  const limits = importedMemoryLimits(new Uint8Array(bytes));
  if (!limits) throw new Error("module must import env.memory (compile with --importMemory)");
  if (limits.min > MAX_PAGES) throw new Error("module requires more than " + MAX_PAGES + " memory pages");
  modules.set(req.moduleId, { module, limits });
  const probe = instantiate(req.moduleId, MAX_PAGES);
  const abi = probe.exports.metric_abi_version() | 0;
  return { abi, imports: WebAssembly.Module.imports(module).map((i) => i.module + "." + i.name) };
}

function instantiate(moduleId, memoryPages) {
  const entry = modules.get(moduleId);
  if (!entry) throw new Error("module not loaded");
  const cap = Math.max(MIN_PAGES, Math.min(memoryPages | 0 || MAX_PAGES, MAX_PAGES));
  const initial = Math.max(MIN_PAGES, entry.limits.min);
  let maximum = entry.limits.max === null ? cap : Math.min(entry.limits.max, cap);
  if (maximum < initial) maximum = initial;
  const memory = new WebAssembly.Memory({ initial, maximum });
  const imports = {
    env: {
      memory,
      abort: (msg) => { throw new Error(abortMessage(memory, msg)); },
      seed: () => 0,
      trace: () => {},
    },
  };
  const instance = new WebAssembly.Instance(entry.module, imports);
  return { memory, exports: instance.exports };
}

function run(req) {
  const input = Buffer.from(req.base64, "base64");
  const { memory, exports } = instantiate(req.moduleId, req.memoryPages);
  const started = performance.now();
  const ptr = exports.metric_alloc(input.length) >>> 0;
  if (ptr === 0 || ptr + input.length > memory.buffer.byteLength) throw new Error("metric_alloc returned an invalid pointer");
  new Uint8Array(memory.buffer).set(input, ptr);
  const out = exports.metric_run(ptr, input.length) >>> 0;
  const buffer = memory.buffer;
  if (out === 0 || out + 4 > buffer.byteLength) throw new Error("metric_run returned an invalid pointer");
  const len = new DataView(buffer).getUint32(out, true);
  if (len > MAX_OUTPUT_BYTES) throw new Error("result exceeds " + MAX_OUTPUT_BYTES + " bytes");
  if (out + 4 + len > buffer.byteLength) throw new Error("result exceeds guest memory");
  const output = decoder.decode(new Uint8Array(buffer, out + 4, len));
  return { output, elapsedMs: performance.now() - started };
}

async function handle(req) {
  switch (req.op) {
    case "ping":
      return { pid: process.pid };
    case "load":
      return await load(req);
    case "run":
      return run(req);
    case "unload":
      modules.delete(req.moduleId);
      return {};
    default:
      throw new Error("unknown op " + req.op);
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function main() {
  let pending = "";
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        const result = await handle(req);
        send({ id: req.id, ok: true, ...result });
      } catch (err) {
        send({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  process.exit(0);
}

main();
`;
