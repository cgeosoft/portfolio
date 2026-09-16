#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Portfolio - macOS Package Builder
# Assembles the macOS Portfolio.app bundle using precompiled Electrobun
# v2.0.1 darwin-arm64 core, packages zip archive and builds DMG via genisoimage.
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${APP_DIR}/modules/desktop"
ASSETS_DIR="${DESKTOP_DIR}/assets"
APP_ID="portfolio"
ELECTROBUN_VERSION="2.0.1"
MAC_CORE_URL="https://github.com/blackboardsh/electrobun/releases/download/v${ELECTROBUN_VERSION}/electrobun-core-darwin-arm64.tar.gz"
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

echo "[MAC BUILD] Building Portfolio v${VERSION} (macos-universal)..."

# Ensure stage exists and matches target version
if [[ ! -d "${DESKTOP_DIR}/stage" || ! -f "${DESKTOP_DIR}/stage/version.txt" || "$(< "${DESKTOP_DIR}/stage/version.txt")" != "${VERSION}" ]]; then
  echo "[MAC BUILD] Staging service and GUI for v${VERSION}..."
  (cd "${DESKTOP_DIR}" && bun run stage)
fi

mkdir -p "${CACHE_DIR}" "${DIST_DIR}"
MAC_CORE_TAR="${CACHE_DIR}/electrobun-core-darwin-arm64-v${ELECTROBUN_VERSION}.tar.gz"

if [[ ! -f "${MAC_CORE_TAR}" ]]; then
  echo "[MAC BUILD] Downloading Electrobun macOS runtime..."
  curl -fsSL -o "${MAC_CORE_TAR}" "${MAC_CORE_URL}"
fi

mkdir -p "${APP_DIR}/.tmp"
TMP_WORK="$(mktemp -d -p "${APP_DIR}/.tmp" mac-pkg.XXXXXX)"
trap 'rm -rf "${TMP_WORK}"' EXIT

BUNDLE_DIR="${TMP_WORK}/Portfolio.app"
mkdir -p "${BUNDLE_DIR}/Contents/MacOS" "${BUNDLE_DIR}/Contents/Resources/app"

echo "[MAC BUILD] Extracting macOS runtime binaries..."
TMP_EXTRACT="${TMP_WORK}/extract"
mkdir -p "${TMP_EXTRACT}"
tar -xzf "${MAC_CORE_TAR}" -C "${TMP_EXTRACT}"

# Copy runtime binaries to Contents/MacOS/
cp -f "${TMP_EXTRACT}/launcher" "${TMP_EXTRACT}/extractor" "${TMP_EXTRACT}/process_helper" "${TMP_EXTRACT}/zig-asar" "${TMP_EXTRACT}/zig-zstd" "${TMP_EXTRACT}/bsdiff" "${TMP_EXTRACT}/bspatch" "${BUNDLE_DIR}/Contents/MacOS/" 2>/dev/null || true
cp -f "${TMP_EXTRACT}"/*.dylib "${BUNDLE_DIR}/Contents/MacOS/"
chmod +x "${BUNDLE_DIR}/Contents/MacOS"/*

# Info.plist
cat << EOF > "${BUNDLE_DIR}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleName</key>
    <string>Portfolio</string>
    <key>CFBundleDisplayName</key>
    <string>Portfolio</string>
    <key>CFBundleIdentifier</key>
    <string>cgeosoft.portfolio.desktop</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
EOF

# Copy Resources
cp -f "${TMP_EXTRACT}/preload-full.js" "${TMP_EXTRACT}/preload-sandboxed.js" "${BUNDLE_DIR}/Contents/Resources/"
echo 'import "./app/bun/index.js";' > "${BUNDLE_DIR}/Contents/Resources/main.js"
cp -f "${ASSETS_DIR}/app-icon.png" "${BUNDLE_DIR}/Contents/Resources/appIcon.png"

# AppIcon.icns
if command -v png2icns >/dev/null 2>&1 && [[ -d "${ASSETS_DIR}/AppIcon.iconset" ]]; then
  png2icns "${BUNDLE_DIR}/Contents/Resources/AppIcon.icns" \
    "${ASSETS_DIR}/AppIcon.iconset/icon_16x16.png" \
    "${ASSETS_DIR}/AppIcon.iconset/icon_32x32.png" \
    "${ASSETS_DIR}/AppIcon.iconset/icon_128x128.png" \
    "${ASSETS_DIR}/AppIcon.iconset/icon_256x256.png" \
    "${ASSETS_DIR}/AppIcon.iconset/icon_512x512.png" >/dev/null 2>&1 || true
fi

# Write metadata and version JSON
cat << EOF > "${BUNDLE_DIR}/Contents/Resources/version.json"
{"version":"${VERSION}","channel":"stable","name":"Portfolio","identifier":"cgeosoft.portfolio.desktop"}
EOF

cat << EOF > "${BUNDLE_DIR}/Contents/Resources/build.json"
{"mainProcess":"cottontail","electrobunVersion":"${ELECTROBUN_VERSION}","runtimeVersions":{"cottontail":"0.5.0"},"defaultRenderer":"native","availableRenderers":["native"],"buildEnvironment":"stable","runtime":{"exitOnLastWindowClosed":true}}
EOF

# Copy staged service and gui
cp -r "${DESKTOP_DIR}/stage/service" "${BUNDLE_DIR}/Contents/Resources/app/"
cp -r "${DESKTOP_DIR}/stage/gui" "${BUNDLE_DIR}/Contents/Resources/app/"
cp -f "${ASSETS_DIR}/app-icon.png" "${BUNDLE_DIR}/Contents/Resources/app/app-icon.png"
if [[ -f "${DESKTOP_DIR}/stage/service/sponsor.html" ]]; then
  cp -f "${DESKTOP_DIR}/stage/service/sponsor.html" "${BUNDLE_DIR}/Contents/Resources/app/sponsor.html"
fi

# Bundle desktop main process entrypoint
echo "[MAC BUILD] Bundling main process entrypoint..."
(cd "${DESKTOP_DIR}" && bun build src/bun/index.ts --target=bun --outfile "${BUNDLE_DIR}/Contents/Resources/app/bun/index.js")

# Create zip archive
echo "[MAC BUILD] Creating macOS zip archive..."
ZIP_FILE="${DIST_DIR}/${APP_ID}_${VERSION}_macos-universal.zip"
(cd "${TMP_WORK}" && zip -qyr "${ZIP_FILE}" Portfolio.app)

# Create DMG
DMG_FILE="${DIST_DIR}/${APP_ID}_${VERSION}_universal.dmg"
if command -v genisoimage >/dev/null 2>&1; then
  echo "[MAC BUILD] Creating DMG disk image: ${DMG_FILE}..."
  DMG_STAGE="${TMP_WORK}/dmg-stage"
  mkdir -p "${DMG_STAGE}"
  cp -r "${BUNDLE_DIR}" "${DMG_STAGE}/Portfolio.app"
  ln -s /Applications "${DMG_STAGE}/Applications"
  genisoimage -V "Portfolio" -D -R -apple -no-pad -quiet -o "${DMG_FILE}" "${DMG_STAGE}"
else
  echo "Warning: genisoimage not found, skipping DMG build" >&2
fi

echo "[MAC BUILD] Done:"
ls -la "${DIST_DIR}/${APP_ID}_${VERSION}_"*mac* "${DIST_DIR}/${APP_ID}_${VERSION}_universal.dmg" 2>/dev/null || true
