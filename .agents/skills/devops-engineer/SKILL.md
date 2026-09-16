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

- Lifecycle: `bun run typecheck && bun run test`; `bun run build:metrics && bun run build:metrics-site` (asc-compile `extras/metrics`, regenerate the website page); `bun run desktop:build` (stage GUI + service, `electrobun build` in `modules/desktop`); `scripts/release.sh build [linux|windows|macos]` (Linux inside `scripts/docker/Dockerfile.linux`; Windows and macOS natively on such a machine or over SSH with `RELEASE_BUILDER_*`). Packages land in `dist/<version>/`.
- `scripts/release.sh tag [patch|minor|major|X.Y.Z] [--dry-run] [--allow-dirty] [--no-push]` bumps every package.json, writes the changelog, commits, tags and pushes. `scripts/release.sh publish` copies `dist/<version>` and `releases/latest.json` into `extras/website/releases/` and deploys to Cloudflare Pages (`extras/website/deploy.sh`, files above 25 MiB are refused). No GitHub Actions; the app and the website read `latest.json`. See `docs/architecture.md`.
- `metrics.yml` runs on PRs touching `extras/metrics/**`: validates manifests, compiles modules, runs sandbox tests, checks generated files are committed.
- Release checklist: typecheck and tests pass; `bun run build` exits clean; `release:deb` or `release:local` produces an artifact; `release.sh tag --dry-run`, then the real tag.
- `--no-push` keeps the bump local. On Windows the script prefers native bsdtar over Git GNU tar; keep that logic.
