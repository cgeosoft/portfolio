#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Release orchestrator.
#
#   scripts/release.sh tag [patch|minor|major|<version>] [--dry-run] [--no-push]
#       Bump every package.json, write the changelog, commit, tag and push.
#
#   scripts/release.sh build [linux|windows|macos ...] [--native] [--version=X]
#       Produce the release packages into dist/<version>/.
#       linux    runs inside the Docker image scripts/docker/Dockerfile.linux
#                (or natively with --native); emits .deb and .tar.gz
#       windows  Electrobun builds only for its host OS, so the Windows and
#       macos    macOS packages are built on such a machine: either this one
#                (--native) or a builder reached over SSH, set with
#                RELEASE_BUILDER_WINDOWS=user@host and RELEASE_BUILDER_MACOS.
#
#   scripts/release.sh publish [--version=X] [--skip-deploy]
#       Copy dist/<version>/* and a releases/latest.json manifest into
#       extras/website/releases/ and deploy the website to Cloudflare Pages.
#
# Environment (never committed; put it in .env or export it):
#   POSTHOG_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
#   CLOUDFLARE_PAGES_PROJECT, RELEASE_BUILDER_WINDOWS, RELEASE_BUILDER_MACOS
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ID="portfolio"
APP_NAME="Portfolio"
WEBSITE_URL="https://portfolio.cgeosoft.com"
DOCKER_IMAGE="${APP_ID}-linux-builder"
MANIFESTS=(package.json modules/shared/package.json modules/service/package.json modules/gui/package.json modules/desktop/package.json)
PAGES_MAX_FILE_BYTES=$((25 * 1024 * 1024))

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

usage() { sed -n '4,26p' "$0"; }

for arg in "$@"; do
  case "${arg}" in
    tag|build|publish) ACTION="${arg}" ;;
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
[[ -z "${ACTION}" ]] && ACTION="tag"

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
  else next="$(bump_semver "${current}" patch)"; fi
  [[ "${next}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "error: '${next}' is not a semver version" >&2; exit 1; }
  git rev-parse "v${next}" >/dev/null 2>&1 && { echo "error: tag v${next} already exists" >&2; exit 1; }
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
  elif bun scripts/gen-changelog.ts --version="${next}" >/dev/null 2>&1; then
    git add CHANGELOG.md
  else
    log "changelog entry not generated (OPENAI_* not configured); continuing"
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
  log "tagged v${next}; next: scripts/release.sh build && scripts/release.sh publish"
}

# ── build ────────────────────────────────────────────────────────────────────

host_target() {
  case "$(uname -s)" in
    Darwin*) echo macos ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo linux ;;
  esac
}

# Runs on the machine that builds: bundles the desktop app for its own OS and
# copies the renamed packages into $1 (dist/<version>).
native_build() {
  local out="$1" version="$2" target
  target="$(host_target)"
  mkdir -p "${out}"
  cd "${ROOT}"
  log "building ${APP_NAME} ${version} for ${target} (native)"
  bun install --frozen-lockfile
  (cd modules/desktop && bun run build)
  local artifacts="${ROOT}/modules/desktop/artifacts"
  case "${target}" in
    linux)
      bash "${SCRIPT_DIR}/build-deb.sh" --skip-build --version="${version}" --dist-dir="${out}"
      local tarball
      tarball="$(ls "${artifacts}"/*-linux-x64-*-Setup.tar.gz 2>/dev/null | head -n1 || true)"
      [[ -n "${tarball}" ]] && cp -f "${tarball}" "${out}/${APP_ID}_${version}_linux-x64.tar.gz"
      ;;
    windows)
      local setup
      setup="$(ls "${artifacts}"/*Setup*.exe 2>/dev/null | head -n1 || true)"
      [[ -n "${setup}" ]] && cp -f "${setup}" "${out}/${APP_ID}_${version}_x64_setup.exe"
      local build_dir="${ROOT}/modules/desktop/build/stable-windows-x64"
      if [[ -d "${build_dir}" ]]; then
        (cd "${build_dir}" && { command -v 7z >/dev/null && 7z a -tzip -mx=6 "${out}/${APP_ID}_${version}_windows-x64_portable.zip" ./* >/dev/null || zip -qr "${out}/${APP_ID}_${version}_windows-x64_portable.zip" .; })
      fi
      ;;
    macos)
      local dmg app
      dmg="$(ls "${artifacts}"/*.dmg 2>/dev/null | head -n1 || true)"
      [[ -n "${dmg}" ]] && cp -f "${dmg}" "${out}/${APP_ID}_${version}_universal.dmg"
      app="$(ls -d "${ROOT}"/modules/desktop/build/stable-macos-*/*.app 2>/dev/null | head -n1 || true)"
      [[ -n "${app}" ]] && ditto -c -k --keepParent "${app}" "${out}/${APP_ID}_${version}_macos-universal.zip"
      ;;
  esac
  log "packages for ${target}:"; ls -la "${out}"
}

docker_linux_build() {
  local out="$1" version="$2"
  command -v docker >/dev/null || { echo "error: docker is required for the linux build (or pass --native)" >&2; exit 1; }
  log "building Docker image ${DOCKER_IMAGE}"
  docker build -q -t "${DOCKER_IMAGE}" -f "${SCRIPT_DIR}/docker/Dockerfile.linux" "${SCRIPT_DIR}/docker" >/dev/null
  mkdir -p "${out}"
  log "building ${APP_NAME} ${version} for linux in Docker"
  docker run --rm \
    -v "${ROOT}:/work" \
    -v "${DOCKER_IMAGE}-hutch:/root/.hutch" \
    -e POSTHOG_API_KEY="${POSTHOG_API_KEY:-}" \
    -e HOME=/root \
    "${DOCKER_IMAGE}" \
    bash -lc "cd /work && bash scripts/release.sh build linux --native --version=${version} && chown -R $(id -u):$(id -g) /work/dist /work/modules/desktop/build /work/modules/desktop/artifacts /work/modules/desktop/stage /work/modules/service/dist-bundle /work/modules/gui/dist /work/build 2>/dev/null || true"
}

remote_build() {
  local target="$1" out="$2" version="$3" var="RELEASE_BUILDER_$(echo "${target}" | tr '[:lower:]' '[:upper:]')" host
  host="${!var:-}"
  if [[ -z "${host}" ]]; then
    cat >&2 <<EOM
error: the ${target} package can only be built on a ${target} machine (Electrobun has no cross-compiler).
       Either run "scripts/release.sh build ${target} --native" there, or set ${var}=user@host
       (a machine with git, bun and the toolchain) and run this command again.
EOM
    exit 1
  fi
  local remote_dir="~/.cache/${APP_ID}-release"
  local ref
  ref="$(git -C "${ROOT}" rev-parse HEAD)"
  log "building ${target} on ${host} (commit ${ref:0:8})"
  ssh "${host}" "mkdir -p ${remote_dir} && cd ${remote_dir} && { [ -d repo ] || git clone -q $(git -C "${ROOT}" remote get-url github 2>/dev/null || git -C "${ROOT}" remote get-url origin) repo; } && cd repo && git fetch -q --all --tags && git checkout -q ${ref} && POSTHOG_API_KEY='${POSTHOG_API_KEY:-}' bash scripts/release.sh build ${target} --native --version=${version}"
  mkdir -p "${out}"
  scp -q "${host}:${remote_dir}/repo/dist/${version}/*" "${out}/"
}

run_build() {
  local version out
  version="${CUSTOM_VERSION:-$(current_version)}"
  out="${ROOT}/dist/${version}"
  [[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(linux windows macos)
  for target in "${TARGETS[@]}"; do
    if ${NATIVE}; then
      [[ "$(host_target)" == "${target}" ]] || { echo "error: --native can only build ${target} on a ${target} host" >&2; exit 1; }
      native_build "${out}" "${version}"
    elif [[ "${target}" == "linux" ]]; then
      docker_linux_build "${out}" "${version}"
    elif [[ "$(host_target)" == "${target}" ]]; then
      native_build "${out}" "${version}"
    else
      remote_build "${target}" "${out}" "${version}"
    fi
  done
  log "done: ${out}"
}

# ── publish ──────────────────────────────────────────────────────────────────

run_publish() {
  local version out site
  version="${CUSTOM_VERSION:-$(current_version)}"
  out="${ROOT}/dist/${version}"
  site="${ROOT}/extras/website"
  [[ -d "${out}" ]] || { echo "error: ${out} does not exist; run scripts/release.sh build first" >&2; exit 1; }

  local oversized
  oversized="$(find "${out}" -type f -size +${PAGES_MAX_FILE_BYTES}c -printf '%f (%s bytes)\n' || true)"
  if [[ -n "${oversized}" ]]; then
    echo "error: Cloudflare Pages rejects files above 25 MiB:" >&2
    echo "${oversized}" >&2
    exit 1
  fi

  rm -rf "${site}/releases"
  mkdir -p "${site}/releases/${version}"
  cp -f "${out}"/* "${site}/releases/${version}/"
  bun "${SCRIPT_DIR}/write-release-manifest.ts" --app="${APP_ID}" --name="${APP_NAME}" --version="${version}" --site="${WEBSITE_URL}" --dir="${site}/releases" --changelog="${ROOT}/CHANGELOG.md"
  log "manifest: $(cat "${site}/releases/latest.json" | head -c 400)"
  if ${SKIP_DEPLOY}; then
    log "skipping deploy (--skip-deploy)"
  else
    run bash "${site}/deploy.sh"
  fi
}

case "${ACTION}" in
  tag) run_tag ;;
  build) run_build ;;
  publish) run_publish ;;
esac
