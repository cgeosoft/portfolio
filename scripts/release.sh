#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Portfolio Desktop - Release Packaging Script
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${DIST_DIR:-${APP_DIR}/dist}"

CLEAN=false
SKIP_BUILD=false
CUSTOM_VERSION=""
TARGETS=()

detect_host_target() {
  case "$(uname -s)" in
    Linux*)   echo "debian" ;;
    Darwin*)  echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)        echo "debian" ;;
  esac
}

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
    -h|--help)
      cat << 'EOF'
Portfolio Desktop Release Script

Usage:
  ./release.sh [targets...] [options]

Targets:
  all            Build release package for current platform [Default]
  debian|deb     Build Debian package (.deb)
  windows|win    Stage Windows installer / portable package
  macos|mac      Stage macOS DMG and .app archive

Options:
  --clean               Clean dist directory before packaging
  --skip-build          Skip Electrobun compilation if already built
  --version=<version>   Override package version
  --dist-dir=<path>     Output directory
  -h, --help            Show this help message
EOF
      exit 0
      ;;
    debian|deb)
      TARGETS+=("debian")
      shift
      ;;
    windows|win)
      TARGETS+=("windows")
      shift
      ;;
    macos|mac)
      TARGETS+=("macos")
      shift
      ;;
    all)
      TARGETS+=("$(detect_host_target)")
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("$(detect_host_target)")
fi

if [[ -n "${CUSTOM_VERSION}" ]]; then
  VERSION="${CUSTOM_VERSION}"
else
  VERSION="$(bun -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"
fi

echo "================================================================="
echo " Portfolio Desktop Release Orchestrator"
echo " Version:  ${VERSION}"
echo " Targets:  ${TARGETS[*]}"
echo " Output:   ${DIST_DIR}"
echo "================================================================="

if [[ "${CLEAN}" == "true" ]]; then
  echo "[// RELEASE] Cleaning ${DIST_DIR}..."
  rm -rf "${DIST_DIR}"
fi
mkdir -p "${DIST_DIR}"

# 1. Electrobun Compilation (stable production build)
if [[ "${SKIP_BUILD}" != "true" ]]; then
  echo "[// RELEASE] Building Tailwind CSS..."
  (cd "${APP_DIR}" && bun run build:css)
  echo "[// RELEASE] Compiling Electrobun application (--env=stable)..."
  (cd "${APP_DIR}" && bunx electrobun build --env=stable)
else
  echo "[// RELEASE] Skipping compilation (--skip-build specified)."
fi

# 2. Execute target packagers
for target in "${TARGETS[@]}"; do
  case "${target}" in
    debian|deb)
      echo "[// RELEASE] Dispatching Debian packager..."
      bash "${SCRIPT_DIR}/build-deb.sh" \
        --skip-build \
        --version="${VERSION}" \
        --dist-dir="${DIST_DIR}"
      ;;
    windows|win)
      echo "[// RELEASE] Packaging Windows artifacts..."
      mkdir -p "${DIST_DIR}"
      for f in "${APP_DIR}/artifacts"/*Setup*.exe "${APP_DIR}/artifacts"/*.exe; do
        if [[ -f "$f" ]]; then
          cp -v "$f" "${DIST_DIR}/"
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
      fi
      ;;
    macos|mac)
      echo "[// RELEASE] Packaging macOS artifacts..."
      mkdir -p "${DIST_DIR}"
      for f in "${APP_DIR}/artifacts"/*.dmg; do
        if [[ -f "$f" ]]; then
          cp -v "$f" "${DIST_DIR}/"
        fi
      done
      APP_BUNDLE="$(find "${APP_DIR}/build" -maxdepth 3 -name "*.app" -type d 2>/dev/null | head -n 1)"
      if [[ -n "${APP_BUNDLE}" && -d "${APP_BUNDLE}" ]]; then
        APP_PARENT="$(dirname "${APP_BUNDLE}")"
        APP_NAME="$(basename "${APP_BUNDLE}")"
        ARCH_NAME="$(uname -m)"
        if command -v ditto >/dev/null 2>&1; then
          (cd "${APP_PARENT}" && ditto -c -k --keepParent "${APP_NAME}" "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip")
        elif command -v zip >/dev/null 2>&1; then
          (cd "${APP_PARENT}" && zip -r "${DIST_DIR}/portfolio_${VERSION}_macos-${ARCH_NAME}.zip" "${APP_NAME}")
        fi
      fi
      ;;
  esac
done

echo "================================================================="
echo " Release build complete. Artifacts in ${DIST_DIR}:"
ls -lh "${DIST_DIR}"
echo "================================================================="
