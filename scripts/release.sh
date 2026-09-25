#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Release orchestrator.
#
#   scripts/release.sh [release] [minor|patch|major|<version>] [options]
#       End-to-end release flow: bump version (defaults to minor), write changelog,
#       commit, tag, git push, build 3 OS artifacts in local Docker, and create
#       GitHub release with uploaded artifacts.
#
#   scripts/release.sh tag [minor|patch|major|<version>] [--dry-run] [--no-push]
#       Bump every package.json, write changelog, commit, tag and push.
#
#   scripts/release.sh build [linux|windows|macos ...] [--native] [--version=X]
#       Produce release packages into dist/<version>/.
#       Builds all 3 OS artifacts locally in Docker (or natively with --native):
#       - Linux:   .deb and .tar.gz
#       - Windows: .exe (NSIS setup) and .zip (portable)
#       - macOS:   .dmg and .zip (universal)
#
#   scripts/release.sh publish-website [--version=X] [--skip-deploy]
#       Copy dist/<version>/* and releases/latest.json manifest into
#       extras/website/releases/ and deploy website to Cloudflare Pages.
#
# Environment (never committed; put it in .env or export it):
#   POSTHOG_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
#   CLOUDFLARE_PAGES_PROJECT, GH_TOKEN / GITHUB_TOKEN
# The changelog comes from the local Claude Code CLI (`claude -p`), signed in
# with `claude auth login`; it needs no API variables.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ID="portfolio"
APP_NAME="Portfolio"
WEBSITE_URL="https://portfolio.cgeosoft.com"
GITHUB_REPO="cgeosoft/portfolio"
GITHUB_URL="https://github.com/${GITHUB_REPO}"
DOCKER_IMAGE="${APP_ID}-linux-builder"
MANIFESTS=(package.json modules/shared/package.json modules/service/package.json modules/gui/package.json modules/desktop/package.json)

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

ACTION=""
TARGETS=()
BUMP=""
CUSTOM_VERSION=""
DRY_RUN=false
NO_PUSH=false
ALLOW_DIRTY=false
NATIVE=false
SKIP_DEPLOY=false

usage() { sed -n '4,30p' "$0"; }

for arg in "$@"; do
  case "${arg}" in
    release|tag|build|publish|publish-website) ACTION="${arg}" ;;
    linux|windows|macos) TARGETS+=("${arg}") ;;
    patch|minor|major) BUMP="${arg}" ;;
    --version=*) CUSTOM_VERSION="${arg#*=}" ;;
    --dry-run) DRY_RUN=true ;;
    --no-push) NO_PUSH=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    --native) NATIVE=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    -h|--help) usage; exit 0 ;;
    v[0-9]*.[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*) CUSTOM_VERSION="${arg#v}" ;;
    *) echo "unknown argument: ${arg}" >&2; usage >&2; exit 1 ;;
  esac
done
[[ -z "${ACTION}" ]] && ACTION="release"
[[ "${ACTION}" == "publish" ]] && ACTION="publish-website"

log() { echo "[release] $*"; }
run() { if ${DRY_RUN}; then echo "[dry-run] $*"; else "$@"; fi; }

current_version() { bun -e "console.log(require('${ROOT}/package.json').version)"; }

bump_semver() {
  local version="$1" bump="$2" major minor patch
  IFS=. read -r major minor patch <<< "${version%%-*}"
  case "${bump}" in
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    major) echo "$((major + 1)).0.0" ;;
    *) echo "${version}" ;;
  esac
}

# ── tag ──────────────────────────────────────────────────────────────────────

run_tag() {
  cd "${ROOT}"
  if ! ${ALLOW_DIRTY} && [[ -n "$(git status --porcelain)" ]]; then
    echo "error: working tree is not clean (use --allow-dirty to override)" >&2
    exit 1
  fi
  local current next
  current="$(current_version)"
  if [[ -n "${CUSTOM_VERSION}" ]]; then next="${CUSTOM_VERSION}"
  elif [[ -n "${BUMP}" ]]; then next="$(bump_semver "${current}" "${BUMP}")"
  else next="$(bump_semver "${current}" minor)"; fi
  [[ "${next}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "error: '${next}' is not a semver version" >&2; exit 1; }
  if git rev-parse "v${next}" >/dev/null 2>&1; then
    local tag_commit head_commit
    tag_commit="$(git rev-list -n 1 "v${next}")"
    head_commit="$(git rev-parse HEAD)"
    if [[ "${tag_commit}" == "${head_commit}" ]]; then
      log "tag v${next} already points to HEAD; skipping tag step"
      return 0
    else
      echo "error: tag v${next} already exists" >&2
      exit 1
    fi
  fi
  log "release: ${current} -> ${next}"

  for file in "${MANIFESTS[@]}"; do
    run bun -e '
const fs = require("fs");
const [file, version] = process.argv.slice(1);
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"version": "[^"]*"/, `"version": "${version}"`));
' "${file}" "${next}"
  done
  run git add "${MANIFESTS[@]}"
  if ${DRY_RUN}; then
    echo "[dry-run] bun scripts/gen-changelog.ts --version=${next}"
  elif bun scripts/gen-changelog.ts --version="${next}" >/dev/null; then
    git add CHANGELOG.md
  else
    log "changelog entry not generated (Claude CLI skipped or failed); continuing"
  fi
  run git commit -m "chore(release): v${next}"
  run git tag -a "v${next}" -m "Release v${next}"
  if ! ${NO_PUSH}; then
    local branch remote
    branch="$(git branch --show-current)"
    remote="$(git remote | grep -qx github && echo github || echo origin)"
    run git push "${remote}" "${branch}"
    run git push "${remote}" "v${next}"
    if [[ "${remote}" != "origin" ]] && git remote | grep -qx origin; then
      run git push origin "${branch}" || true
      run git push origin "v${next}" || true
    fi
  fi
  log "tagged v${next}"
}

# ── build ────────────────────────────────────────────────────────────────────

native_build_target() {
  local target="$1" out="$2" version="$3"
  mkdir -p "${out}"
  cd "${ROOT}"
  log "packaging ${APP_NAME} ${version} for ${target}"
  case "${target}" in
    linux)
      bash "${SCRIPT_DIR}/build-deb.sh" --version="${version}" --dist-dir="${out}"
      local tarball
      tarball="$(ls "${ROOT}/modules/desktop/artifacts"/*linux-x64*Setup.tar.gz 2>/dev/null | head -n1 || true)"
      if [[ -n "${tarball}" && -f "${tarball}" ]]; then
        cp -f "${tarball}" "${out}/${APP_ID}_${version}_linux-x64.tar.gz"
      fi
      ;;
    windows)
      bash "${SCRIPT_DIR}/build-windows.sh" --version="${version}" --dist-dir="${out}"
      ;;
    macos)
      bash "${SCRIPT_DIR}/build-macos.sh" --version="${version}" --dist-dir="${out}"
      ;;
  esac
}

docker_build() {
  local out="$1" version="$2"
  shift 2
  local targets=("$@")
  [[ ${#targets[@]} -eq 0 ]] && targets=(linux windows macos)
  command -v docker >/dev/null || { echo "error: docker is required for the build (or pass --native)" >&2; exit 1; }
  log "ensuring Docker builder image ${DOCKER_IMAGE}"
  docker build -q -t "${DOCKER_IMAGE}" -f "${SCRIPT_DIR}/docker/Dockerfile.linux" "${SCRIPT_DIR}/docker" >/dev/null
  mkdir -p "${out}"
  log "building ${APP_NAME} ${version} for [${targets[*]}] in Docker"
  docker run --rm \
    -v "${ROOT}:/work" \
    -v "${DOCKER_IMAGE}-hutch:/root/.hutch" \
    -e POSTHOG_API_KEY="${POSTHOG_API_KEY:-}" \
    -e HOME=/root \
    "${DOCKER_IMAGE}" \
    bash -c '
      cleanup() {
        owner="$(stat -c "%u:%g" /work 2>/dev/null || echo "0:0")"
        chown -R "${owner}" /work/dist /work/modules/desktop/build /work/modules/desktop/artifacts /work/modules/desktop/stage /work/modules/service/dist-bundle /work/modules/gui/dist /work/build /work/.cache 2>/dev/null || true
        chmod -R u+rwX,g+rwX /work/dist 2>/dev/null || true
      }
      trap cleanup EXIT
      cd /work
      bash scripts/release.sh build '"${targets[*]}"' --native --version='"${version}"'
    '
}

run_build() {
  local version out
  version="${CUSTOM_VERSION:-$(current_version)}"
  out="${ROOT}/dist/${version}"
  [[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(linux windows macos)

  if ${DRY_RUN}; then
    log "[dry-run] would build [${TARGETS[*]}] for version ${version} into ${out}"
    return 0
  fi

  if ${NATIVE}; then
    for target in "${TARGETS[@]}"; do
      native_build_target "${target}" "${out}" "${version}"
    done
  else
    docker_build "${out}" "${version}" "${TARGETS[@]}"
  fi
  log "build complete for [${TARGETS[*]}]:"
  ls -la "${out}"
}

# ── github release ───────────────────────────────────────────────────────────

run_github_release() {
  local version="$1" out="$2"
  command -v gh >/dev/null || { echo "error: gh CLI is required to create GitHub release" >&2; exit 1; }
  local tag="v${version}"
  local notes=""
  if [[ -f "${ROOT}/CHANGELOG.md" ]]; then
    notes="$(bun -e "
const fs = require('fs');
const text = fs.readFileSync('${ROOT}/CHANGELOG.md', 'utf-8');
const m = text.match(new RegExp('## \\\[' + '${version}'.replace(/\\./g, '\\\\.') + '\\\][^\\\\n]*\\\\n([\\\\s\\\\S]*?)(?=\\\\n## \\\[|$)'));
console.log(m ? m[1].trim() : '');
")"
  fi
  [[ -z "${notes}" ]] && notes="Release ${tag}"

  if ${DRY_RUN}; then
    log "[dry-run] gh release create \"${tag}\" \"${out}/*\" --title \"${tag}\" --notes \"${notes}\""
    return 0
  fi

  local files=()
  for f in "${out}"/*; do
    [[ -f "$f" ]] && files+=("$f")
  done
  [[ ${#files[@]} -eq 0 ]] && { echo "error: no release artifacts found in ${out}" >&2; exit 1; }

  log "publishing ${#files[@]} artifact(s) to GitHub release ${tag}"
  if gh release view "${tag}" >/dev/null 2>&1; then
    log "release ${tag} exists on GitHub; uploading/updating assets"
    gh release upload "${tag}" "${files[@]}" --clobber
    gh release edit "${tag}" --notes "${notes}"
  else
    gh release create "${tag}" "${files[@]}" --title "${tag}" --notes "${notes}"
  fi
}

# ── publish-website ──────────────────────────────────────────────────────────

run_publish_website() {
  local version out site
  version="${CUSTOM_VERSION:-$(current_version)}"
  out="${ROOT}/dist/${version}"
  site="${ROOT}/extras/website"
  [[ -d "${out}" ]] || { echo "error: ${out} does not exist; run build first" >&2; exit 1; }

  rm -rf "${site}/releases"
  mkdir -p "${site}/releases"
  touch "${site}/releases/.gitkeep"
  bun "${SCRIPT_DIR}/write-release-manifest.ts" \
    --app="${APP_ID}" \
    --name="${APP_NAME}" \
    --version="${version}" \
    --site="${WEBSITE_URL}" \
    --github="${GITHUB_URL}" \
    --artifacts="${out}" \
    --dir="${site}/releases" \
    --changelog="${ROOT}/CHANGELOG.md"
  log "manifest: $(head -c 400 "${site}/releases/latest.json")"
  if ${SKIP_DEPLOY}; then
    log "skipping deploy (--skip-deploy)"
  else
    run bash "${site}/deploy.sh"
  fi
}

# ── full release flow ────────────────────────────────────────────────────────

run_release() {
  local current next
  current="$(current_version)"
  if [[ -n "${CUSTOM_VERSION}" ]]; then
    next="${CUSTOM_VERSION}"
  elif git rev-parse "v${current}" >/dev/null 2>&1 && [[ "$(git rev-list -n 1 "v${current}")" == "$(git rev-parse HEAD)" ]]; then
    next="${current}"
  elif [[ -n "${BUMP}" ]]; then
    next="$(bump_semver "${current}" "${BUMP}")"
  else
    next="$(bump_semver "${current}" minor)"
  fi
  CUSTOM_VERSION="${next}"
  run_tag
  local out="${ROOT}/dist/${CUSTOM_VERSION}"
  TARGETS=(linux windows macos)
  run_build
  run_github_release "${CUSTOM_VERSION}" "${out}"
  log "release v${CUSTOM_VERSION} complete!"
}

case "${ACTION}" in
  release) run_release ;;
  tag) run_tag ;;
  build) run_build ;;
  publish-website) run_publish_website ;;
esac
