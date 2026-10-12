/**
 * Source of the metric engine process. The runtime writes it to disk and
 * spawns it with the application's own runtime binary, so it is embedded here
 * as a string rather than bundled as a separate entry point.
 *
 * The engine speaks newline-delimited JSON over stdin/stdout and handles one
 * request at a time:
 *   -> { id, op: "compile", moduleId, base64 }
 *   -> { id, op: "probe",   moduleId }
 *   -> { id, op: "run",     moduleId, base64, memoryPages }
 *   -> { id, op: "unload",  moduleId }
 *   -> { id, op: "ping" }
 *   <- { id, ok: true, ... } | { id, ok: false, error }
 *
 * "compile" validates the binary and runs no guest code. "probe" instantiates
 * the module once (its start function runs) and reads its ABI version; only a
 * module that passes the probe can run. The runtime gives the probe the same
 * time budget as a run.
 *
 * A module is instantiated with a fresh, host-owned memory for every run, so
 * runs never share state and the bump allocator cannot exhaust memory over
 * time. The only imports supplied are the three AssemblyScript runtime hooks;
 * none of them can reach outside the sandbox. A module may not define a
 * memory of its own, declare GC types, or declare more than one small table,
 * so the memory ceiling also bounds what an instance allocates.
 */

export const METRIC_ENGINE_SOURCE = String.raw`
"use strict";
const MAX_OUTPUT_BYTES = 4096;
const MAX_ERROR_LENGTH = 300;
const MAX_NAME_LENGTH = 64;
const MIN_PAGES = 2;
const MAX_PAGES = 64;
const MAX_TABLE_ENTRIES = 65536;
const ALLOWED_IMPORTS = new Set(["env.memory", "env.abort", "env.seed", "env.trace"]);
const REQUIRED_EXPORTS = ["metric_abi_version", "metric_alloc", "metric_run"];
// i32, i64, f32, f64, v128, funcref, externref: value types that cannot allocate.
const VALUE_TYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]);

/** Compiled and validated, not probed yet. */
const compiled = new Map();
/** Probed and ready to run. */
const modules = new Map();
const inputDecoder = new TextDecoder();
const outputDecoder = new TextDecoder();

function clip(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** A name from the module binary, quoted and cut for an error message. */
function quoteName(name) {
  return JSON.stringify(clip(name, MAX_NAME_LENGTH));
}

function readLeb(bytes, pos) {
  let result = 0, shift = 0, byte;
  do {
    if (pos >= bytes.length || shift > 28) throw new Error("module binary is malformed");
    byte = bytes[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, pos];
}

/** Every type must be a function type over value types that cannot allocate (no GC structs or arrays). */
function checkTypes(bytes, pos) {
  let count;
  [count, pos] = readLeb(bytes, pos);
  for (let i = 0; i < count; i++) {
    if (bytes[pos++] !== 0x60) throw new Error("module declares a type that is not a function type");
    for (let list = 0; list < 2; list++) {
      let length;
      [length, pos] = readLeb(bytes, pos);
      for (let j = 0; j < length; j++) {
        if (!VALUE_TYPES.has(bytes[pos++])) throw new Error("module uses a value type the sandbox does not support");
      }
    }
  }
}

/** At most one table, and it must declare a small maximum so table.grow stays bounded. */
function checkTables(bytes, pos) {
  let count;
  [count, pos] = readLeb(bytes, pos);
  if (count > 1) throw new Error("module declares more than one table");
  for (let i = 0; i < count; i++) {
    const type = bytes[pos++];
    if (type !== 0x70 && type !== 0x6f) throw new Error("module declares an unsupported table");
    const flags = bytes[pos++];
    if (flags !== 1) throw new Error("module table must declare a maximum size");
    let max;
    [, pos] = readLeb(bytes, pos);
    [max, pos] = readLeb(bytes, pos);
    if (max > MAX_TABLE_ENTRIES) throw new Error("module table exceeds " + MAX_TABLE_ENTRIES + " entries");
  }
}

/** Read the limits of the imported memory from the binary import section. */
function importedMemoryLimits(bytes, pos) {
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
    } else if (kind === 2) {
      const flags = bytes[pos++];
      let min, max = null;
      [min, pos] = readLeb(bytes, pos);
      if (flags & 1) [max, pos] = readLeb(bytes, pos);
      return { min, max };
    } else {
      // The import check already allows only functions and env.memory.
      throw new Error("unsupported import kind " + kind);
    }
  }
  return null;
}

/**
 * Walk the binary sections the WebAssembly API does not expose and return the
 * limits of the imported memory. Rejects a memory section (multi-memory would
 * escape the page cap), GC types, and tables beyond one small one.
 */
function inspectSections(bytes) {
  let memory = null;
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size;
    [size, pos] = readLeb(bytes, pos);
    const end = pos + size;
    if (id === 1) checkTypes(bytes, pos);
    else if (id === 2) memory = importedMemoryLimits(bytes, pos);
    else if (id === 4) checkTables(bytes, pos);
    else if (id === 5) throw new Error("module must not define a memory of its own (compile with --importMemory)");
    pos = end;
  }
  return memory;
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

async function compile(req) {
  const bytes = Buffer.from(req.base64, "base64");
  const module = await WebAssembly.compile(bytes);
  for (const imp of WebAssembly.Module.imports(module)) {
    const name = imp.module + "." + imp.name;
    if (!ALLOWED_IMPORTS.has(name)) throw new Error("module requests forbidden import " + quoteName(name));
    if (name === "env.memory" && imp.kind !== "memory") throw new Error("env.memory must be a memory import");
    if (name !== "env.memory" && imp.kind !== "function") throw new Error(quoteName(name) + " must be a function import");
  }
  const exportNames = new Set(WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name));
  for (const name of REQUIRED_EXPORTS) {
    if (!exportNames.has(name)) throw new Error("module does not export " + name);
  }
  const limits = inspectSections(bytes);
  if (!limits) throw new Error("module must import env.memory (compile with --importMemory)");
  if (limits.min > MAX_PAGES) throw new Error("module requires more than " + MAX_PAGES + " memory pages");
  modules.delete(req.moduleId);
  compiled.set(req.moduleId, { module, limits });
  return {};
}

/** Instantiate once and read the ABI. The module becomes runnable only when this succeeds. */
function probe(req) {
  const entry = compiled.get(req.moduleId);
  compiled.delete(req.moduleId);
  if (!entry) throw new Error("module not compiled");
  const { exports } = instantiate(entry, MAX_PAGES);
  const abi = exports.metric_abi_version() | 0;
  modules.set(req.moduleId, entry);
  return { abi };
}

function instantiate(entry, memoryPages) {
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
  const entry = modules.get(req.moduleId);
  if (!entry) throw new Error("module not loaded");
  const input = Buffer.from(req.base64, "base64");
  const { memory, exports } = instantiate(entry, req.memoryPages);
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
  const output = outputDecoder.decode(new Uint8Array(buffer, out + 4, len));
  return { output, elapsedMs: performance.now() - started };
}

async function handle(req) {
  switch (req.op) {
    case "ping":
      return { pid: process.pid };
    case "compile":
      return await compile(req);
    case "probe":
      return probe(req);
    case "run":
      return run(req);
    case "unload":
      compiled.delete(req.moduleId);
      modules.delete(req.moduleId);
      return {};
    default:
      throw new Error("unknown op " + quoteName(String(req.op)));
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function main() {
  const reader = Bun.stdin.stream().getReader();
  // Text of the current line from earlier chunks; each chunk is scanned once.
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    let text = inputDecoder.decode(value, { stream: true });
    let newline;
    while ((newline = text.indexOf("\n")) >= 0) {
      parts.push(text.slice(0, newline));
      text = text.slice(newline + 1);
      const line = parts.join("");
      parts.length = 0;
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
        send({ id: req.id, ok: false, error: clip(err instanceof Error ? err.message : String(err), MAX_ERROR_LENGTH) });
      }
    }
    if (text) parts.push(text);
  }
  process.exit(0);
}

main();
`;
