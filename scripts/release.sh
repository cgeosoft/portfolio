#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Portfolio - Release and Build Automation Orchestrator
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${DIST_DIR:-${APP_DIR}/dist}"

# Ensure Windows native tar (bsdtar in System32) takes precedence over Git GNU tar
# Git GNU tar treats drive letters (such as D:\...) as remote hostnames and fails
if [[ "$(uname -s)" =~ MINGW|MSYS|CYGWIN ]]; then
  mkdir -p "${APP_DIR}/.bin"
  if [[ -f "/c/Windows/System32/tar.exe" ]]; then
    cp -f "/c/Windows/System32/tar.exe" "${APP_DIR}/.bin/tar.exe" 2>/dev/null || true
    export PATH="${APP_DIR}/.bin:${PATH}"
  elif [[ -f "C:/Windows/System32/tar.exe" ]]; then
    cp -f "C:/Windows/System32/tar.exe" "${APP_DIR}/.bin/tar.exe" 2>/dev/null || true
    export PATH="${APP_DIR}/.bin:${PATH}"
  fi
fi

CLEAN=false
SKIP_BUILD=false
DRY_RUN=false
NO_PUSH=false
ALLOW_DIRTY=false
ALLOW_BRANCH=false
CUSTOM_VERSION=""
CUSTOM_REMOTE=""
CUSTOM_MSG=""
BUMP_TYPE=""
ACTION=""
TARGETS=()

detect_host_target() {
  case "$(uname -s)" in
    Linux*)   echo "debian" ;;
    Darwin*)  echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)        echo "debian" ;;
  esac
}

bump_semver() {
  local version="$1"
  local bump="$2"
  local major minor patch
  major="$(echo "${version}" | awk -F. '{print $1}')"
  minor="$(echo "${version}" | awk -F. '{print $2}')"
  patch="$(echo "${version}" | awk -F. '{print $3}' | sed 's/-.*//')"

  case "${bump}" in
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    major) echo "$((major + 1)).0.0" ;;
    *)     echo "${version}" ;;
  esac
}

show_help() {
  cat << 'EOF'
Portfolio Release Script

Usage:
  ./release.sh [command|targets...] [options]

Commands:
  tag [version|bump]    Automate release tag generation and push to trigger GitHub Actions CI builds [Default]
                        Bump options: patch, minor, major, or explicit version (for example: 0.2.0)
  local                 Build release package for current platform locally
  debian|deb            Build Debian package (.deb) locally
  windows|win           Stage Windows installer / portable package locally
  macos|mac             Stage macOS DMG and .app archive locally
  all                   Build release package for current platform locally

Tag Options:
  --dry-run             Show release actions without modifying git or pushing
  --no-push             Create commit and tag locally without pushing to remote
  --allow-dirty         Allow release tag creation with uncommitted changes in working tree
  --allow-branch        Allow release tag creation on non-main branches
  --remote=<name>       Git remote to push to (default: github, origin, or tracked remote)
  -m, --message=<msg>   Custom annotated tag message

Build Options:
  --clean               Clean dist directory before packaging
  --skip-build          Skip Electrobun compilation if already built
  --version=<version>   Override package version
  --dist-dir=<path>     Output directory
  -h, --help            Show this help message
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-push)
      NO_PUSH=true
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    --allow-branch)
      ALLOW_BRANCH=true
      shift
      ;;
    --remote=*)
      CUSTOM_REMOTE="${1#*=}"
      shift
      ;;
    --remote)
      CUSTOM_REMOTE="$2"
      shift 2
      ;;
    -m|--message)
      CUSTOM_MSG="$2"
      shift 2
      ;;
    --message=*)
      CUSTOM_MSG="${1#*=}"
      shift
      ;;
    --version=*)
      CUSTOM_VERSION="${1#*=}"
      shift
      ;;
    --version)
      CUSTOM_VERSION="$2"
      shift 2
      ;;
    --dist-dir=*)
      DIST_DIR="${1#*=}"
      shift
      ;;
    --patch|patch)
      BUMP_TYPE="patch"
      ACTION="tag"
      shift
      ;;
    --minor|minor)
      BUMP_TYPE="minor"
      ACTION="tag"
      shift
      ;;
    --major|major)
      BUMP_TYPE="major"
      ACTION="tag"
      shift
      ;;
    tag|--tag)
      ACTION="tag"
      shift
      ;;
    debian|deb)
      ACTION="build"
      TARGETS+=("debian")
      shift
      ;;
    windows|win)
      ACTION="build"
      TARGETS+=("windows")
      shift
      ;;
    macos|mac)
      ACTION="build"
      TARGETS+=("macos")
      shift
      ;;
    local|all)
      ACTION="build"
      TARGETS+=("$(detect_host_target)")
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    v[0-9]*.[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*)
      CUSTOM_VERSION="${1#v}"
      ACTION="tag"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

if [[ -z "${ACTION}" ]]; then
  if [[ ${#TARGETS[@]} -gt 0 ]]; then
    ACTION="build"
  else
    ACTION="tag"
  fi
fi

run_tag_release() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Error: Directory is not a git repository." >&2
    exit 1
  fi

  local current_branch
  current_branch="$(git branch --show-current 2>/dev/null || echo "")"
  if [[ "${current_branch}" != "main" && "${ALLOW_BRANCH}" != "true" ]]; then
    echo "Notice: Current branch is '${current_branch}', not 'main'."
  fi

  if [[ "${ALLOW_DIRTY}" != "true" ]]; then
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
      echo "Error: Working directory has uncommitted changes." >&2
      echo "Commit or stash changes before you create a release tag, or use --allow-dirty." >&2
      git status --short >&2
      exit 1
    fi
  fi

  local remote
  if [[ -n "${CUSTOM_REMOTE}" ]]; then
    remote="${CUSTOM_REMOTE}"
  elif git remote | grep -qx "github"; then
    remote="github"
  elif git remote | grep -qx "origin"; then
    remote="origin"
  else
    remote="$(git remote | head -n 1)"
  fi

  if [[ -n "${remote}" ]]; then
    echo "[RELEASE] Fetching tags from remote '${remote}'..."
    git fetch "${remote}" --tags --quiet 2>/dev/null || true
  fi

  local pkg_version
  pkg_version="$(bun -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"

  local target_version=""
  if [[ -n "${CUSTOM_VERSION}" ]]; then
    target_version="${CUSTOM_VERSION#v}"
  elif [[ -n "${BUMP_TYPE}" ]]; then
    target_version="$(bump_semver "${pkg_version}" "${BUMP_TYPE}")"
  else
    if git rev-parse "v${pkg_version}" >/dev/null 2>&1; then
      target_version="$(bump_semver "${pkg_version}" "patch")"
      echo "[RELEASE] Tag v${pkg_version} already exists. Incrementing patch to ${target_version}."
    else
      target_version="${pkg_version}"
    fi
  fi

  if [[ ! "${target_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: Target version '${target_version}' is not valid semantic versioning." >&2
    exit 1
  fi

  local tag_name="v${target_version}"

  if git rev-parse "${tag_name}" >/dev/null 2>&1; then
    echo "Error: Git tag '${tag_name}' already exists." >&2
    exit 1
  fi

  local tag_message="${CUSTOM_MSG:-Release ${tag_name}}"

  echo "================================================================="
  echo " Portfolio Release Tag Automation"
  echo " Current Version:  ${pkg_version}"
  echo " Release Version:  ${target_version}"
  echo " Tag Name:         ${tag_name}"
  echo " Branch:           ${current_branch}"
  echo " Remote:           ${remote}"
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo " Mode:             DRY RUN (no modifications will be applied)"
  fi
  echo "================================================================="

  # Update package.json if version has changed
  if [[ "${target_version}" != "${pkg_version}" ]]; then
    if [[ "${DRY_RUN}" == "true" ]]; then
      echo "[DRY RUN] Would update package.json to version ${target_version}"
      echo "[DRY RUN] Would generate changelog entry and commit: \"chore(release): ${tag_name}\""
    else
      echo "[RELEASE] Updating package.json to version ${target_version}..."
      bun -e "const fs=require('fs');const p=require('${APP_DIR}/package.json');p.version='${target_version}';fs.writeFileSync('${APP_DIR}/package.json',JSON.stringify(p,null,2)+'\n');"
      git add "${APP_DIR}/package.json"

      # Generate a changelog entry from the diff vs the previous release using
      # the OPENAI_* compatible model env vars read from .env.
      echo "[RELEASE] Generating changelog entry with release notes generator..."
      if (cd "${APP_DIR}" && bun scripts/gen-changelog.ts --version="${target_version}" >/dev/null); then
        git add "${APP_DIR}/CHANGELOG.md"
      else
        echo "[RELEASE] WARNING: changelog entry not generated; continuing release."
      fi

      git commit -m "chore(release): ${tag_name}"
    fi
  fi

  # Create annotated tag
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY RUN] Would run: git tag -a \"${tag_name}\" -m \"${tag_message}\""
  else
    echo "[RELEASE] Creating annotated tag ${tag_name}..."
    git tag -a "${tag_name}" -m "${tag_message}"
  fi

  # Push commit and tag to remote
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY RUN] Would run: git push \"${remote}\" \"${current_branch}\""
    echo "[DRY RUN] Would run: git push \"${remote}\" \"${tag_name}\""
    if [[ "${remote}" != "origin" ]] && git remote | grep -qx "origin"; then
      echo "[DRY RUN] Would run: git push origin \"${current_branch}\""
      echo "[DRY RUN] Would run: git push origin \"${tag_name}\""
    fi
  elif [[ "${NO_PUSH}" == "true" ]]; then
    echo "[RELEASE] Tag ${tag_name} created locally (--no-push specified)."
  else
    echo "[RELEASE] Pushing branch and tag to remote '${remote}'..."
    git push "${remote}" "${current_branch}"
    git push "${remote}" "${tag_name}"

    if [[ "${remote}" != "origin" ]] && git remote | grep -qx "origin"; then
      echo "[RELEASE] Syncing release branch and tag with origin..."
      git push origin "${current_branch}" 2>/dev/null || true
      git push origin "${tag_name}" 2>/dev/null || true
    fi
  fi

  echo "================================================================="
  echo " Release Tag Process Finished"
  echo " Tag:    ${tag_name}"
  echo " Remote: ${remote}"
  echo "================================================================="
  echo "GitHub Actions triggers build jobs for:"
  echo "  - Debian (.deb, .tar.gz)"
  echo "  - Windows (x64 setup .exe, portable .zip)"
  echo "  - macOS (.dmg, universal .zip)"
  echo ""
  echo "Check GitHub Actions workflow status at:"
  echo "  https://github.com/cgeosoft/portfolio/actions"
  echo "================================================================="
}

run_build_packages() {
  if [[ -n "${CUSTOM_VERSION}" ]]; then
    VERSION="${CUSTOM_VERSION}"
  else
    VERSION="$(bun -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"
  fi

  echo "================================================================="
  echo " Portfolio Build Orchestrator"
  echo " Version:  ${VERSION}"
  echo " Targets:  ${TARGETS[*]}"
  echo " Output:   ${DIST_DIR}"
  echo "================================================================="

  if [[ "${CLEAN}" == "true" ]]; then
    echo "[RELEASE] Cleaning ${DIST_DIR}..."
    rm -rf "${DIST_DIR}"
  fi
  mkdir -p "${DIST_DIR}"

  # 1. Electrobun Compilation (stable production build)
  if [[ "${SKIP_BUILD}" != "true" ]]; then
    echo "[RELEASE] Building Tailwind CSS..."
    (cd "${APP_DIR}" && bun run build:css)
    echo "[RELEASE] Compiling Electrobun application (--env=stable)..."
    (cd "${APP_DIR}" && bunx electrobun build --env=stable)
  else
    echo "[RELEASE] Skipping compilation (--skip-build specified)."
  fi

  # 2. Execute target packagers
  for target in "${TARGETS[@]}"; do
    case "${target}" in
      debian|deb)
        echo "[RELEASE] Dispatching Debian packager..."
        bash "${SCRIPT_DIR}/build-deb.sh" \
          --skip-build \
          --version="${VERSION}" \
          --dist-dir="${DIST_DIR}"
        if [[ -f "${DIST_DIR}/portfolio_${VERSION}_amd64.deb" ]]; then
          cp -v "${DIST_DIR}/portfolio_${VERSION}_amd64.deb" "${DIST_DIR}/portfolio_latest_amd64.deb"
        fi
        for f in "${APP_DIR}/artifacts"/*-Portfolio-Setup.tar.gz "${APP_DIR}/artifacts"/*-Setup.tar.gz; do
          if [[ -f "$f" ]]; then
            cp -v "$f" "${DIST_DIR}/portfolio_${VERSION}_linux-x64.tar.gz"
            cp -v "$f" "${DIST_DIR}/portfolio_latest_linux-x64.tar.gz"
            break
          fi
        done
        ;;
      windows|win)
        echo "[RELEASE] Packaging Windows artifacts..."
        mkdir -p "${DIST_DIR}"
        for f in "${APP_DIR}/artifacts"/*Setup*.exe "${APP_DIR}/artifacts"/*.exe; do
          if [[ -f "$f" ]]; then
            cp -v "$f" "${DIST_DIR}/"
            cp -v "$f" "${DIST_DIR}/portfolio_${VERSION}_x64_setup.exe"
            cp -v "$f" "${DIST_DIR}/portfolio_latest_x64_setup.exe"
          fi
        done
        for f in "${APP_DIR}/artifacts"/*.zip; do
          if [[ -f "$f" ]]; then
            cp -v "$f" "${DIST_DIR}/"
          fi
        done
        if [[ -d "${APP_DIR}/build/stable-windows-x64" ]]; then
          if command -v 7z >/dev/null 2>&1; then
            (cd "${APP_DIR}/build" && 7z a -r "${DIST_DIR}/portfolio_${VERSION}_windows-x64_portable.zip" stable-windows-x64/*)
          elif command -v zip >/dev/null 2>&1; then
            (cd "${APP_DIR}/build" && zip -r "${DIST_DIR}/portfolio_${VERSION}_windows-x64_portable.zip" stable-windows-x64)
          fi
          if [[ -f "${DIST_DIR}/portfolio_${VERSION}_windows-x64_portable.zip" ]]; then
            cp -v "${DIST_DIR}/portfolio_${VERSION}_windows-x64_portable.zip" "${DIST_DIR}/portfolio_latest_windows-x64_portable.zip"
          fi
        fi
        ;;
      macos|mac)
        echo "[RELEASE] Packaging macOS artifacts..."
        mkdir -p "${DIST_DIR}"
        for f in "${APP_DIR}/artifacts"/*.dmg; do
          if [[ -f "$f" ]]; then
            cp -v "$f" "${DIST_DIR}/"
            cp -v "$f" "${DIST_DIR}/portfolio_${VERSION}_universal.dmg"
            cp -v "$f" "${DIST_DIR}/portfolio_latest_universal.dmg"
          fi
        done
        APP_BUNDLE="$(find "${APP_DIR}/build" -maxdepth 3 -name "*.app" -type d 2>/dev/null | head -n 1)"
        if [[ -n "${APP_BUNDLE}" && -d "${APP_BUNDLE}" ]]; then
          APP_PARENT="$(dirname "${APP_BUNDLE}")"
          APP_NAME="$(basename "${APP_BUNDLE}")"
          ARCH_NAME="$(uname -m)"
          if command -v ditto >/dev/null 2>&1; then
            (cd "${APP_PARENT}" && ditto -c -k --keepParent "${APP_NAME}" "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip")
            cp -v "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${DIST_DIR}/portfolio_${VERSION}_macos-universal.zip"
            cp -v "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${DIST_DIR}/portfolio_latest_macos-universal.zip"
          elif command -v zip >/dev/null 2>&1; then
            (cd "${APP_PARENT}" && zip -r "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${APP_NAME}")
            cp -v "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${DIST_DIR}/portfolio_${VERSION}_macos-universal.zip"
            cp -v "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${DIST_DIR}/portfolio_latest_macos-universal.zip"
          fi
        fi
        ;;
    esac
  done

  echo "================================================================="
  echo " Release build complete. Artifacts in ${DIST_DIR}:"
  ls -lh "${DIST_DIR}"
  echo "================================================================="
}

if [[ "${ACTION}" == "tag" ]]; then
  run_tag_release
else
  run_build_packages
fi
