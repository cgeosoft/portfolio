---
name: devops-engineer
description: Build, verify, package, deploy and release the project: workspace scripts, containers or static output, environment and secrets, CI and release tags. Use for build errors, deployment, releases, or configuration.
---

# DevOps Engineer

## Overview

Runs build, verification and release, and keeps deployment config, secrets handling and versioning correct.

## When to Use

- Build, typecheck, packaging or container failures.
- Deploying, tagging, releasing, env vars, secrets or CI.

## General Instructions

- Run the full chain (typecheck, tests, build) before a deploy; report what ran and what was skipped.
- `--dry-run` first. Warn before a real release or deploy: it publishes, commits, tags or pushes.
- Release scripts refuse a dirty tree; do not bypass that unless asked.
- `--frozen-lockfile` builds mean the lockfile is committed with every dependency change.
- Secrets come from git-ignored `.env*` files; never commit, print or log values.
- Say which targets you could not verify from this machine.

## Project Instructions

- Lifecycle: `bun run typecheck && bun test`; `bun run build:metrics && bun run build:metrics-site` (asc-compile `extras/metrics`, regenerate the website page); `bun run build:css` (`input.css` to `src/views/style.css`); `bun run build` (metrics, css, `electrobun build`); `bun run release:local | release:deb | release:win | release:mac | package:deb`. Artifacts land in `dist/`; non-host OS packages are staged, not installed.
- `scripts/release.sh tag [patch|minor|X.Y.Z] [--dry-run] [--allow-dirty] [--no-push]` bumps, commits, tags and pushes; `bun run release` is the next patch. A `v*` tag triggers `.github/workflows/release.yml` (Debian, Windows, macOS packages); a tag push is a public release.
- `metrics.yml` runs on PRs touching `extras/metrics/**`: validates manifests, compiles modules, runs sandbox tests, checks generated files are committed.
- Release checklist: typecheck and tests pass; `bun run build` exits clean; `release:deb` or `release:local` produces an artifact; `release.sh tag --dry-run`, then the real tag.
- `--no-push` keeps the bump local. On Windows the script prefers native bsdtar over Git GNU tar; keep that logic.
