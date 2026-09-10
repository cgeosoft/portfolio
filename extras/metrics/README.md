# Portfolio metrics

A metric is a small WebAssembly module plus a YAML manifest. The application runs it in a sandbox against the portfolio data it was granted and shows the result on the Metrics tab and, when slotted, on the Overview dashboard.

This directory is the metric repository. Every metric here is reviewed by pull request, compiled by `bun run build:metrics`, and bundled into the application. Users can also install a metric from any URL; those are never reviewed and stay marked **UNVERIFIED** in the application.

## Why WebAssembly

Portfolio Desktop is an offline-first application that holds a private financial ledger. A metric module is instantiated with no I/O imports: it cannot read the SQLite file, touch the filesystem, open a socket, or read the clock. It receives a copy of the data its manifest requests, returns a number and a label, and nothing else. Each run gets fresh memory with a hard ceiling, a time budget enforced by killing the engine process, and an integrity check of the module bytes before instantiation.

## Layout

```
extras/metrics/
  repository.yml           registry of every metric (id, path, bundled)
  manifest.example.yml     annotated manifest
  _sdk/portfolio.ts        generated AssemblyScript SDK (accessors + result builder)
  _template/               starter to copy
  <metric-id>/
    manifest.yml
    assembly/index.ts
```

The `.wasm` files are not committed. `bun run build:metrics` compiles them to `build/metrics/<id>.wasm` and embeds the bundled ones in `src/bun/services/metrics/builtin-modules.generated.ts`.

## Write a metric

1. Copy `_template/` to `extras/metrics/<your-id>/`. The id is kebab-case and must be unique.
2. Edit `manifest.yml`. `manifest.example.yml` documents every field. Request only the scopes you read.
3. Edit `assembly/index.ts`. The SDK gives you typed accessors for the input and a `Result` builder for the output:

```ts
import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalFees, Format.Currency)      // main figure
    .text("Lifetime transaction costs")       // sub-line parts, in order
    .neutral()                                // color: auto | positive | negative | neutral
    .finish();
}
```

   Other scopes: `new Holdings(ptr, len)`, `new Transactions(ptr, len)`, `new History(ptr, len)`. Each has `count`, `present`, and `at(i)`. A block the manifest did not request has `present == false` and `count == 0`.

4. Add the metric to `repository.yml`.
5. Run `bun run build:metrics`. It validates the manifest, compiles the module, and prints its size and hash.
6. Run `bun test`. Add a case to `src/bun/services/__tests__/metric-runtime.test.ts` if your metric needs one.
7. Open a pull request. CI (`.github/workflows/metrics.yml`) validates every manifest, builds every module, and runs each one against a fixture portfolio.

## The contract (ABI v1)

The host writes a binary payload into guest memory and calls `metric_run(ptr, len)`. The module returns a pointer to `[u32 length][UTF-8 JSON]`. The input layout is documented in `src/shared/metric-abi.ts` and mirrored by the generated SDK, so you never touch offsets. The output is:

```jsonc
{
  "value":  { "amount": 1234.56, "format": "currency", "sign": "auto" },
  "sub":    [ { "text": "Dividends " }, { "amount": 100, "format": "currency" } ],
  "sentiment": "auto"      // auto | positive | negative | neutral
}
```

`format` is `currency`, `percent`, `number`, or `none`. `sign: "always"` prefixes `+` to non-negative amounts. Formatting, currency symbols, and the privacy mask are applied by the application, so a module never learns whether values are hidden.

Required exports: `metric_abi_version()`, `metric_alloc(size)`, `metric_run(ptr, len)`. Allowed imports: `env.memory`, `env.abort`, `env.seed`, `env.trace`. Anything else is rejected at load.

## Build your own outside this repository

Any language that targets WebAssembly works. With AssemblyScript, copy `_sdk/portfolio.ts` next to your source and compile with:

```
asc index.ts -o my-metric.wasm --runtime stub --optimize --importMemory --noExportMemory \
    --initialMemory 2 --maximumMemory 16
```

`--maximumMemory` should match `runtime.memoryPages` in your manifest. Publish the `.wasm` and a `manifest.yml` with a `module` block (`url`, `sha256`, `size`), then use **Install from URL** on the Metrics tab. The application checks the size and hash, rejects forbidden imports, and shows the requested scopes before anything is installed.

## Limits

| Limit | Value |
|---|---|
| Guest memory | `runtime.memoryPages` x 64 KiB, at most 4 MiB |
| Time per run | `runtime.timeoutMs`, at most 2000 ms, then the engine is killed and the module disabled for the session |
| Output | 4 KiB of JSON, at most 16 sub-line parts |
| Module size (URL install) | 2 MiB |
