---
name: devops-engineer
description: "Build, package, release and deploy Portfolio: workspace scripts, release.sh, Docker builds of the OS packages, GitHub releases, the website deploy and secrets. Use it for build errors, packages, releases, CI or deploys."
trimmedAt: 2026-11-05
---

# DevOps Engineer

## Commands

- `bun run typecheck` and `bun run test`: the checks.
- `bun run build:metrics`: compiles `extras/metrics` with AssemblyScript. Then `bun run website:metrics` makes the metrics page of the website again.
- `bun run build`: stages the GUI and the service, then runs `electrobun build` in `modules/desktop`. The output goes to `modules/desktop/artifacts`.
- `bun run release:build [linux|windows|macos]`: builds the OS packages in Docker (`scripts/docker/Dockerfile.linux`). The output goes to `dist/<version>/`, 2 packages for each OS.
- `bun run release [minor|patch|major|X.Y.Z] [--dry-run] [--allow-dirty] [--no-push]`: increases the version (minor is the default), writes the changelog entry, commits, tags `vX.Y.Z` and pushes. Then it builds the 3 OS packages in Docker and uploads them to GitHub Releases with `gh`.
- `bun run website:screenshots [--llm claude-cli]`: makes the website tour screenshots from the app with demo data.
- `bun run website:publish`: writes `extras/website/releases/latest.json` and deploys the website to Cloudflare Pages (`extras/website/deploy.sh`). GitHub Releases keeps the binaries. The website does not keep them.

## Release procedure

A release request from the user is also a request to run the checks.

1. Run `bun run typecheck` and `bun run test`. Make sure that they pass.
2. Run `bun run release:build`. Make sure that `dist/<version>/` has all 6 packages.
3. Run `bun run release --dry-run`.
4. Tell the user that the real release commits, tags, pushes and publishes. Run `bun run release` only after the user agrees.

## Rules

- `release.sh` stops when the working tree is not clean. Do not use `--allow-dirty` unless the user tells you to.
- The secrets are in the git-ignored `.env*` files. Do not commit, print or log their values. The Docker build cannot read these files.
- Tell the user which packages you could not test on this computer.
