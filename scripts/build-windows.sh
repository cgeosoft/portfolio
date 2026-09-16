#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Portfolio - Windows Package Builder
# Assembles the Windows bundle using precompiled Electrobun v2.0.1 win-x64 core,
# packages portable zip and builds setup installer via NSIS.
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${APP_DIR}/modules/desktop"
ASSETS_DIR="${DESKTOP_DIR}/assets"
APP_ID="portfolio"
ELECTROBUN_VERSION="2.0.1"
WIN_CORE_URL="https://github.com/blackboardsh/electrobun/releases/download/v${ELECTROBUN_VERSION}/electrobun-core-win-x64.tar.gz"
CACHE_DIR="${APP_DIR}/.tmp/cache"
DIST_DIR="${DIST_DIR:-${APP_DIR}/dist}"
CUSTOM_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
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
      echo "Usage: $0 [--version=<version>] [--dist-dir=<path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${CUSTOM_VERSION}" ]]; then
  VERSION="${CUSTOM_VERSION}"
else
  VERSION="$(bun -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "0.3.1")"
fi

echo "[WIN BUILD] Building Portfolio v${VERSION} (windows-x64)..."

# Ensure stage exists and matches target version
if [[ ! -d "${DESKTOP_DIR}/stage" || ! -f "${DESKTOP_DIR}/stage/version.txt" || "$(< "${DESKTOP_DIR}/stage/version.txt")" != "${VERSION}" ]]; then
  echo "[WIN BUILD] Staging service and GUI for v${VERSION}..."
  (cd "${DESKTOP_DIR}" && bun run stage)
fi

mkdir -p "${CACHE_DIR}" "${DIST_DIR}"
WIN_CORE_TAR="${CACHE_DIR}/electrobun-core-win-x64-v${ELECTROBUN_VERSION}.tar.gz"

if [[ ! -f "${WIN_CORE_TAR}" ]]; then
  echo "[WIN BUILD] Downloading Electrobun Windows runtime..."
  curl -fsSL -o "${WIN_CORE_TAR}" "${WIN_CORE_URL}"
fi

mkdir -p "${APP_DIR}/.tmp"
TMP_WORK="$(mktemp -d -p "${APP_DIR}/.tmp" win-pkg.XXXXXX)"
trap 'rm -rf "${TMP_WORK}"' EXIT

BUILD_DIR="${TMP_WORK}/Portfolio"
mkdir -p "${BUILD_DIR}/bin" "${BUILD_DIR}/Resources/app"

echo "[WIN BUILD] Extracting Windows runtime binaries..."
TMP_EXTRACT="${TMP_WORK}/extract"
mkdir -p "${TMP_EXTRACT}"
tar -xzf "${WIN_CORE_TAR}" -C "${TMP_EXTRACT}"

# Copy runtime binaries to bin/
cp -f "${TMP_EXTRACT}"/*.exe "${TMP_EXTRACT}"/*.dll "${BUILD_DIR}/bin/"
cp -f "${TMP_EXTRACT}/preload-full.js" "${TMP_EXTRACT}/preload-sandboxed.js" "${BUILD_DIR}/Resources/"
echo 'import "./app/bun/index.js";' > "${BUILD_DIR}/Resources/main.js"

# Generate or copy icons
cp -f "${ASSETS_DIR}/app-icon-256x256.png" "${BUILD_DIR}/Resources/appIcon.png"
if command -v icotool >/dev/null 2>&1; then
  icotool -c -o "${BUILD_DIR}/Resources/app-icon.ico" "${ASSETS_DIR}/app-icon-256x256.png"
elif [[ -f "${ASSETS_DIR}/app-icon.ico" ]]; then
  cp -f "${ASSETS_DIR}/app-icon.ico" "${BUILD_DIR}/Resources/app-icon.ico"
else
  # Fallback: create empty or copy png if tool missing
  cp -f "${ASSETS_DIR}/app-icon-256x256.png" "${BUILD_DIR}/Resources/app-icon.ico"
fi

# Write metadata and version JSON
cat << EOF > "${BUILD_DIR}/Resources/version.json"
{"version":"${VERSION}","channel":"stable","name":"Portfolio","identifier":"cgeosoft.portfolio.desktop"}
EOF

cat << EOF > "${BUILD_DIR}/Resources/metadata.json"
{"identifier":"cgeosoft.portfolio.desktop","name":"Portfolio","channel":"stable"}
EOF

cat << EOF > "${BUILD_DIR}/Resources/build.json"
{"mainProcess":"cottontail","electrobunVersion":"${ELECTROBUN_VERSION}","runtimeVersions":{"cottontail":"0.5.0"},"defaultRenderer":"native","availableRenderers":["native"],"buildEnvironment":"stable","runtime":{"exitOnLastWindowClosed":true}}
EOF

# Copy staged service and gui
cp -r "${DESKTOP_DIR}/stage/service" "${BUILD_DIR}/Resources/app/"
cp -r "${DESKTOP_DIR}/stage/gui" "${BUILD_DIR}/Resources/app/"
cp -f "${ASSETS_DIR}/app-icon.png" "${BUILD_DIR}/Resources/app/app-icon.png"
if [[ -f "${DESKTOP_DIR}/stage/service/sponsor.html" ]]; then
  cp -f "${DESKTOP_DIR}/stage/service/sponsor.html" "${BUILD_DIR}/Resources/app/sponsor.html"
fi

# Bundle desktop main process entrypoint
echo "[WIN BUILD] Bundling main process entrypoint..."
(cd "${DESKTOP_DIR}" && bun build src/bun/index.ts --target=bun --outfile "${BUILD_DIR}/Resources/app/bun/index.js")

# Create portable zip
echo "[WIN BUILD] Creating portable zip..."
PORTABLE_ZIP="${DIST_DIR}/${APP_ID}_${VERSION}_windows-x64_portable.zip"
(cd "${TMP_WORK}" && zip -qr "${PORTABLE_ZIP}" Portfolio)

# Create NSIS setup exe
SETUP_EXE="${DIST_DIR}/${APP_ID}_${VERSION}_x64_setup.exe"
if command -v makensis >/dev/null 2>&1; then
  echo "[WIN BUILD] Building NSIS installer: ${SETUP_EXE}..."
  makensis \
    -DVERSION="${VERSION}" \
    -DSOURCE_DIR="${BUILD_DIR}" \
    -DOUTPUT_FILE="${SETUP_EXE}" \
    -DICON_FILE="${BUILD_DIR}/Resources/app-icon.ico" \
    "${SCRIPT_DIR}/docker/windows-installer.nsi" >/dev/null
else
  echo "Warning: makensis not found, skipping setup exe build" >&2
fi

echo "[WIN BUILD] Done:"
ls -la "${DIST_DIR}/${APP_ID}_${VERSION}_"*win* "${DIST_DIR}/${APP_ID}_${VERSION}_x64_setup.exe" 2>/dev/null || true
