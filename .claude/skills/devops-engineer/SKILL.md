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

- Lifecycle: `bun run typecheck && bun run test`; `bun run build:metrics && bun run website:metrics` (asc-compile `extras/metrics`, regenerate the website page); `bun run build` (stage GUI + service, `electrobun build` in `modules/desktop`); `bun run release:build` (builds Linux, Windows and macOS packages locally inside Docker). Packages land in `dist/<version>/`.
- `bun run release [minor|patch|major|X.Y.Z] [--dry-run] [--allow-dirty] [--no-push]` bumps version (minor by default), commits, tags, pushes, builds all 3 OS packages locally in Docker, and uploads artifacts to GitHub Releases via `gh release create`.
- `bun run website:publish` writes `releases/latest.json` into `extras/website/releases/` and deploys to Cloudflare Pages (`extras/website/deploy.sh`). Binaries are hosted on GitHub Releases.
- Release checklist: typecheck and tests pass; `bun run release:build` produces all 6 packages in `dist/<version>/`; `bun run release --dry-run`, then the real release.
