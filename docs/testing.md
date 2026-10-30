# Testing

All tests use `bun:test`. `bun run test` runs the metric suite first, then every workspace.

| Suite | Location | Run |
|---|---|---|
| Metrics | `extras/metrics/<id>/<id>.test.ts`, `extras/metrics/_test/` | `bun run test:metrics` |
| Shared | `modules/shared/src/__tests__/` | `bun --filter portfolio-shared test` |
| Service | `modules/service/src/services/__tests__/` | `cd modules/service && bun test` |
| GUI | colocated `*.test.ts` in `modules/gui/src` | `cd modules/gui && bun test` |
| Desktop | colocated `*.test.ts` in `modules/desktop/src/bun` | `cd modules/desktop && bun test` |

## Metrics

Every metric in `repository.yml` has its own test file next to its manifest. `_test/repository.test.ts` fails when one is missing. `_test/harness.ts` compiles the metric source in-process with AssemblyScript (same flags as `scripts/build-metrics.ts`), so the tests never read a stale `build/metrics/*.wasm`. It encodes the payload with the service encoder and runs the module with the manifest's memory limit. Each file runs four contract cases (exports, ABI 2, ABI 1 refused, output within limits) and its own formula cases.

Service-side metric code (manifest validator, output parser, payload layout, evaluator, registry, installer, runtime sandbox) is tested in `modules/service/src/services/__tests__/metric-*.test.ts`.

## Isolation

- The service preloads `src/test-setup.ts`, which points the data directory at a temp dir. All service test files share one process, one database and the module singletons. Use unique ids and symbols, and restore every config key, PIN and listener you change.
- A file that needs an empty database calls `setDataDirForTests(dir)`, `closeDatabase()` and `saveConfig({})`, and restores them the same way afterwards.
- Code that reads `homedir()` or runs once per process (config import, bootstrap, autostart, Linux `.desktop` files) runs in a child `bun` process with `HOME` set to a temp dir. Never call `updateConfig({ startWithBoot })` in a test process: it writes the real autostart entry.
- Stub `globalThis.fetch` and restore it after each test. No test reaches the network.

## Known bugs

A test for a confirmed bug asserts the correct behaviour and is written as `it.failing`, with a `// Suspected bug: <file:line>` comment. The suite stays green while the bug exists. When the fix lands, bun reports the case as passing unexpectedly; change it to `it`.

List them with `grep -rn "Suspected bug:" modules extras --include=*.test.ts`.
