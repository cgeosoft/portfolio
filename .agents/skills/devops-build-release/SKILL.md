---
name: devops-build-release
description: Build and package the desktop application, run typechecks and tests, orchestrate releases, and debug the GitHub Actions build pipeline. Use for build errors, packaging, release tags, or CI troubleshooting.
---

# DevOps / Build & Release

## Build pipeline overview

The app is an Electrobun desktop application. The webview CSS is compiled with Tailwind, then the whole app is bundled with Electrobun.

Core lifecycle:

```bash
bun install                       # install dependencies (bun.lock)
bun run typecheck                 # typecheck main process and webview
bun test                          # run bun test suite
bun run build:metrics             # compile extras/metrics/* with asc, embed bundled modules
bun run build:metrics-site        # regenerate extras/website/metrics/index.html
bun run build:css                 # compile src/views/src/input.css -> src/views/style.css
bun run build                     # build:metrics, build:css, then electrobun build
bun run dev                       # setup dev icon, build CSS, start Electrobun dev
```

## Packaging commands

```bash
bun run release:local             # stage current host package (scripts/release.sh local)
bun run release:deb               # build Debian package (scripts/release.sh debian)
bun run release:win               # stage Windows package (scripts/release.sh windows)
bun run release:mac               # stage macOS package (scripts/release.sh macos)
bun run package:deb               # build .deb via scripts/build-deb.sh
```

Artifacts land in `dist/` (for example `dist/portfolio_<version>_amd64.deb`). Windows and macOS packaging on a non-host OS is staged, not installed.

## Automated release tags

`scripts/release.sh` orchestrates version bumping, tagged commits, and pushes that trigger GitHub Actions:

```bash
bun run release                   # bump and release next patch
bash scripts/release.sh tag patch
bash scripts/release.sh tag minor
bash scripts/release.sh tag 0.2.0
bash scripts/release.sh tag --dry-run    # preview without changes or pushes
```

### Safety rules for releases

1. `scripts/release.sh tag` refuses to run with uncommitted changes unless `--allow-dirty` is given.
2. Prefer `--dry-run` first to preview what the script will commit, tag, and push.
3. A tag push triggers the GitHub Actions workflow. Tagged pushes are destructive to release history, so warn the user before the first real push.
4. Use `--no-push` to create the commit and tag locally without pushing when you only want the version bump.

## GitHub Actions

- `.github/workflows/release.yml` builds Debian, Windows, and macOS packages on a tag push (`v*`) and attaches artifacts to the release.
- `.github/workflows/metrics.yml` runs on pull requests that touch `extras/metrics/**` or the metric runtime: it validates manifests (`build-metrics.ts --check --force`), compiles every module, runs the sandbox tests, checks the generated SDK and website page are committed, and prints module sizes.
- Environment secrets used by CI are `POSTHOG_API_KEY` and `WEBPAGE_URL`. They are passed as empty by default in the workflow.
- Workflow jobs install system dependencies (for example `libwebkit2gtk-4.1-dev`, `dpkg`, `zstd`) before building.

## Release checklist

1. Run `bun run typecheck` and `bun test` and confirm they pass.
2. Run `bun run build` and confirm the build exits clean.
3. Verify the package with `bun run release:deb` or `bun run release:local` and confirm the artifact appears in `dist/`.
4. For a full release, run `bash scripts/release.sh tag --dry-run` first, then the real tag.

## Gotchas and pitfalls

- The release script on Windows avoids Git GNU tar conflicts by preferring Windows native bsdtar. Do not remove that logic.
- You cannot verify all target platform packages from one host. State which targets you validated and which you did not.
- Commit and push your changes per the release workflow. Commit only your changes; other agents may work in the repo at the same time.