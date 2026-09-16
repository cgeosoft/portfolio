#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Portfolio - Debian (.deb) Package Builder
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${APP_DIR}/modules/desktop"
ASSETS_DIR="${DESKTOP_DIR}/assets"
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

TAR_ZST="${DESKTOP_DIR}/artifacts/stable-${ELECTROBUN_ARCH}-Portfolio.tar.zst"

# Build if requested or if artifacts missing
if [[ "${SKIP_BUILD}" != "true" || ! -f "${TAR_ZST}" ]]; then
  echo "[DEB BUILD] Running desktop build..."
  (cd "${DESKTOP_DIR}" && bun run build)
fi

if [[ ! -f "${TAR_ZST}" ]]; then
  echo "Error: Electrobun artifact not found: ${TAR_ZST}" >&2
  exit 1
fi

# Create staging tree
mkdir -p "${APP_DIR}/.tmp"
STAGE_DIR="$(mktemp -d -p "${APP_DIR}/.tmp" deb-pkg.XXXXXX)"
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
Comment=Track your stocks, ETFs and crypto privately. Your data never leaves your computer
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
  <summary>Personal investment tracker that keeps your data on your computer</summary>
  <description>
    <p>
      Portfolio is a free, open source desktop app for keeping track of your investments
      without handing your net worth to a website. Everything you enter is stored in a
      single file on your own computer. There is no account to create, no cloud sync and
      no subscription.
    </p>
    <p>
      Import your transaction history from your broker, see what your holdings are worth
      right now with live market prices, and understand where your money actually is: how
      much you have invested, what you have realised, what you have earned in dividends and
      what you have paid in fees and taxes.
    </p>
    <ul>
      <li>Live prices and currency conversion for stocks, ETFs and crypto, updated from Yahoo Finance</li>
      <li>Import exported statements from Trade Republic, Scalable Capital, Interactive Brokers and Degiro, with automatic format detection and a preview before anything is saved</li>
      <li>Performance history, asset allocation breakdown, 52-week ranges and simple trend indicators for every holding</li>
      <li>A dashboard you build yourself from a catalogue of metric cards, arranged per portfolio</li>
      <li>Optional AI-written portfolio briefings, using a model running on your own machine or a cloud provider with your own key. Nothing is generated unless you ask for it</li>
      <li>Multiple portfolios, multiple currencies, and a demo portfolio to explore before adding your own data</li>
    </ul>
    <p>
      Portfolio does not phone home. Anonymous usage statistics are off by default and only
      ever switched on by you. Your holdings, balances and transactions are never sent
      anywhere.
    </p>
  </description>
  <developer id="com.cgeosoft">
    <name>Christos Georgiou</name>
  </developer>
  <url type="homepage">https://github.com/cgeosoft/portfolio</url>
  <url type="bugtracker">https://github.com/cgeosoft/portfolio/issues</url>
  <content_rating type="oars-1.1" />
  <launchable type="desktop-id">portfolio.desktop</launchable>
  <provides>
    <binary>portfolio</binary>
  </provides>
</component>
EOF
chmod 644 "${STAGE_DIR}/usr/share/metainfo/portfolio.appdata.xml"

# Icons
if [[ -f "${ASSETS_DIR}/app-icon.svg" ]]; then
  cp "${ASSETS_DIR}/app-icon.svg" "${STAGE_DIR}/usr/share/icons/hicolor/scalable/apps/portfolio.svg"
  cp "${ASSETS_DIR}/app-icon.svg" "${STAGE_DIR}/usr/share/pixmaps/portfolio.svg"
fi

for sz in 16 24 32 48 64 128 256 512; do
  if [[ -f "${ASSETS_DIR}/app-icon-${sz}x${sz}.png" ]]; then
    mkdir -p "${STAGE_DIR}/usr/share/icons/hicolor/${sz}x${sz}/apps"
    cp "${ASSETS_DIR}/app-icon-${sz}x${sz}.png" "${STAGE_DIR}/usr/share/icons/hicolor/${sz}x${sz}/apps/portfolio.png"
  fi
done

if [[ -f "${ASSETS_DIR}/app-icon-256x256.png" ]]; then
  cp "${ASSETS_DIR}/app-icon-256x256.png" "${STAGE_DIR}/usr/share/pixmaps/portfolio.png"
elif [[ -f "${ASSETS_DIR}/app-icon.png" ]]; then
  cp "${ASSETS_DIR}/app-icon.png" "${STAGE_DIR}/usr/share/pixmaps/portfolio.png"
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
Description: Personal investment tracker that keeps your data on your PC
 Portfolio is a free, open source desktop app for keeping track of your
 stocks, ETFs and crypto without handing your net worth to a website.
 Everything you enter is stored in a single file on your own computer.
 There is no account to create, no cloud sync and no subscription.
 .
 Import your transaction history from Trade Republic, Scalable Capital,
 Interactive Brokers or Degiro, see what your holdings are worth right now
 with live prices from Yahoo Finance, and understand where your money
 actually is: invested capital, realised gains, dividends, fees and taxes.
 .
 Build your own dashboard from a catalogue of metric cards, follow
 performance history and asset allocation, and optionally ask for an
 AI-written briefing using a model on your own machine or a cloud provider
 with your own key. Anonymous usage statistics are off by default, and your
 holdings and transactions are never sent anywhere.
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
