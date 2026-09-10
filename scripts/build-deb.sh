#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Portfolio Desktop - Debian (.deb) Package Builder
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${DIST_DIR:-${APP_DIR}/dist}"

# Configurable options
SKIP_BUILD=false
CUSTOM_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
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
      echo "Usage: $0 [--skip-build] [--version=<version>] [--dist-dir=<path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Resolve version
if [[ -n "${CUSTOM_VERSION}" ]]; then
  VERSION="${CUSTOM_VERSION}"
else
  VERSION="$(bun -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"
fi

# Detect architecture
UNAME_M="$(uname -m)"
case "${UNAME_M}" in
  x86_64)
    DEB_ARCH="amd64"
    ELECTROBUN_ARCH="linux-x64"
    ;;
  aarch64|arm64)
    DEB_ARCH="arm64"
    ELECTROBUN_ARCH="linux-arm64"
    ;;
  *)
    DEB_ARCH="${UNAME_M}"
    ELECTROBUN_ARCH="linux-${UNAME_M}"
    ;;
esac

echo "[DEB BUILD] Packaging Portfolio v${VERSION} (${DEB_ARCH})..."

# Check required tools
if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "Error: dpkg-deb is required to build Debian packages. Install it via 'sudo apt-get install dpkg'." >&2
  exit 1
fi

TAR_ZST="${APP_DIR}/artifacts/stable-${ELECTROBUN_ARCH}-Portfolio.tar.zst"

# Build if requested or if artifacts missing
if [[ "${SKIP_BUILD}" != "true" || ! -f "${TAR_ZST}" ]]; then
  echo "[DEB BUILD] Building Tailwind CSS..."
  (cd "${APP_DIR}" && bun run build:css)
  echo "[DEB BUILD] Running electrobun build..."
  (cd "${APP_DIR}" && bunx electrobun build --env=stable)
fi

if [[ ! -f "${TAR_ZST}" ]]; then
  echo "Error: Electrobun artifact not found: ${TAR_ZST}" >&2
  exit 1
fi

# Create staging tree
STAGE_DIR="$(mktemp -d -t portfolio-deb-staging.XXXXXX)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

echo "[DEB BUILD] Staging tree: ${STAGE_DIR}"

mkdir -p "${STAGE_DIR}/opt/portfolio"
mkdir -p "${STAGE_DIR}/usr/bin"
mkdir -p "${STAGE_DIR}/usr/share/applications"
mkdir -p "${STAGE_DIR}/usr/share/metainfo"
mkdir -p "${STAGE_DIR}/usr/share/icons/hicolor/scalable/apps"
mkdir -p "${STAGE_DIR}/usr/share/icons/hicolor/48x48/apps"
mkdir -p "${STAGE_DIR}/usr/share/pixmaps"
mkdir -p "${STAGE_DIR}/DEBIAN"

echo "[DEB BUILD] Extracting desktop bundle to staging tree..."
tar --zstd -xf "${TAR_ZST}" -C "${STAGE_DIR}/opt/portfolio" --strip-components=1

# Clean up redundant root desktop file inside /opt/portfolio
rm -f "${STAGE_DIR}/opt/portfolio/Portfolio.desktop"

# Ensure executable permissions on binaries
if [[ -d "${STAGE_DIR}/opt/portfolio/bin" ]]; then
  find "${STAGE_DIR}/opt/portfolio/bin" -type f -exec chmod 755 {} +
fi

# Link launcher into /usr/bin
ln -sf /opt/portfolio/bin/launcher "${STAGE_DIR}/usr/bin/portfolio"

# Desktop Entry
cat << 'EOF' > "${STAGE_DIR}/usr/share/applications/portfolio.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio
GenericName=Portfolio Tracker
Comment=Offline-first financial portfolio tracker with SQLite and LLM analysis
Exec=portfolio %U
Icon=portfolio
Terminal=false
StartupWMClass=Portfolio
Categories=Office;Finance;
Keywords=finance;portfolio;stocks;crypto;investing;tracker;
EOF
chmod 644 "${STAGE_DIR}/usr/share/applications/portfolio.desktop"

# AppStream Metadata
cat << EOF > "${STAGE_DIR}/usr/share/metainfo/portfolio.appdata.xml"
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>cgeosoft.portfolio.desktop</id>
  <metadata_license>MIT</metadata_license>
  <project_license>MIT</project_license>
  <name>Portfolio</name>
  <summary>Offline-first financial portfolio tracker</summary>
  <description>
    <p>Portfolio is a high-performance, offline-first personal portfolio tracker built with Electrobun and SQLite.</p>
  </description>
  <launchable type="desktop-id">portfolio.desktop</launchable>
  <provides>
    <binary>portfolio</binary>
  </provides>
</component>
EOF
chmod 644 "${STAGE_DIR}/usr/share/metainfo/portfolio.appdata.xml"

# Icons
if [[ -f "${APP_DIR}/src/assets/app-icon.svg" ]]; then
  cp "${APP_DIR}/src/assets/app-icon.svg" "${STAGE_DIR}/usr/share/icons/hicolor/scalable/apps/portfolio.svg"
  cp "${APP_DIR}/src/assets/app-icon.svg" "${STAGE_DIR}/usr/share/pixmaps/portfolio.svg"
fi

for sz in 16 24 32 48 64 128 256 512; do
  if [[ -f "${APP_DIR}/src/assets/app-icon-${sz}x${sz}.png" ]]; then
    mkdir -p "${STAGE_DIR}/usr/share/icons/hicolor/${sz}x${sz}/apps"
    cp "${APP_DIR}/src/assets/app-icon-${sz}x${sz}.png" "${STAGE_DIR}/usr/share/icons/hicolor/${sz}x${sz}/apps/portfolio.png"
  fi
done

if [[ -f "${APP_DIR}/src/assets/app-icon-256x256.png" ]]; then
  cp "${APP_DIR}/src/assets/app-icon-256x256.png" "${STAGE_DIR}/usr/share/pixmaps/portfolio.png"
elif [[ -f "${APP_DIR}/src/assets/app-icon.png" ]]; then
  cp "${APP_DIR}/src/assets/app-icon.png" "${STAGE_DIR}/usr/share/pixmaps/portfolio.png"
fi

# Installed size in KB
INSTALLED_SIZE="$(du -sk "${STAGE_DIR}" | cut -f1)"

# Debian control file
cat << EOF > "${STAGE_DIR}/DEBIAN/control"
Package: portfolio
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${DEB_ARCH}
Maintainer: Portfolio Team <support@portfolio.desktop>
Installed-Size: ${INSTALLED_SIZE}
Depends: libc6, libstdc++6
Recommends: libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37
Homepage: https://github.com/cgeosoft/portfolio
Description: Offline-First Portfolio Tracker
 Portfolio is a high-performance personal portfolio tracker built with Electrobun,
 SQLite, and Bun. Supports CSV imports and on-demand LLM reporting.
EOF
chmod 644 "${STAGE_DIR}/DEBIAN/control"

mkdir -p "${DIST_DIR}"
OUTPUT_DEB="${DIST_DIR}/portfolio_${VERSION}_${DEB_ARCH}.deb"

echo "[DEB BUILD] Building package: ${OUTPUT_DEB}..."
dpkg-deb --build --root-owner-group "${STAGE_DIR}" "${OUTPUT_DEB}"

echo "[DEB BUILD] Verifying package contents..."
dpkg-deb --info "${OUTPUT_DEB}"

echo "================================================================="
echo " Debian package built successfully: ${OUTPUT_DEB}"
echo " Install with: sudo dpkg -i ${OUTPUT_DEB}"
echo "================================================================="
