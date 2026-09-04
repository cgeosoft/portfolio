#!/usr/bin/env bash
set -euo pipefail

# Only configure desktop integration on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ASSETS_DIR="${APP_DIR}/src/assets"

# Standard user data directories
USER_APPS_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
USER_ICONS_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/icons/hicolor"
USER_PIXMAPS_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/pixmaps"

mkdir -p "${USER_APPS_DIR}"
mkdir -p "${USER_PIXMAPS_DIR}"

# 1. Install high-resolution icons
for sz in 16 24 32 48 64 128 256 512; do
  icon_src="${ASSETS_DIR}/app-icon-${sz}x${sz}.png"
  if [[ -f "${icon_src}" ]]; then
    target_dir="${USER_ICONS_DIR}/${sz}x${sz}/apps"
    mkdir -p "${target_dir}"
    cp -f "${icon_src}" "${target_dir}/portfolio-dev.png"
    cp -f "${icon_src}" "${target_dir}/portfolio.png"
  fi
done

if [[ -f "${ASSETS_DIR}/app-icon.svg" ]]; then
  scalable_dir="${USER_ICONS_DIR}/scalable/apps"
  mkdir -p "${scalable_dir}"
  cp -f "${ASSETS_DIR}/app-icon.svg" "${scalable_dir}/portfolio-dev.svg"
  cp -f "${ASSETS_DIR}/app-icon.svg" "${scalable_dir}/portfolio.svg"
fi

if [[ -f "${ASSETS_DIR}/app-icon-256x256.png" ]]; then
  cp -f "${ASSETS_DIR}/app-icon-256x256.png" "${USER_PIXMAPS_DIR}/portfolio-dev.png"
  cp -f "${ASSETS_DIR}/app-icon-256x256.png" "${USER_PIXMAPS_DIR}/portfolio.png"
elif [[ -f "${ASSETS_DIR}/app-icon.png" ]]; then
  cp -f "${ASSETS_DIR}/app-icon.png" "${USER_PIXMAPS_DIR}/portfolio-dev.png"
  cp -f "${ASSETS_DIR}/app-icon.png" "${USER_PIXMAPS_DIR}/portfolio.png"
fi

# 2. Write development desktop file matching runtime WM_CLASS: Portfolio-dev-dev
cat << EOF > "${USER_APPS_DIR}/portfolio-dev.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio (Development)
GenericName=Portfolio Tracker
Comment=Offline-first personal investment portfolio tracker (Development)
Exec=/usr/bin/env bash -c "cd '${APP_DIR}' && bun run dev"
Icon=portfolio-dev
Terminal=false
StartupWMClass=Portfolio-dev-dev
Categories=Office;Finance;Development;
EOF
chmod 644 "${USER_APPS_DIR}/portfolio-dev.desktop"

# 3. Write fallback desktop file for potential Portfolio-dev WM_CLASS
cat << EOF > "${USER_APPS_DIR}/portfolio-dev-alt.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio (Development)
GenericName=Portfolio Tracker
Comment=Offline-first personal investment portfolio tracker (Development)
Exec=/usr/bin/env bash -c "cd '${APP_DIR}' && bun run dev"
Icon=portfolio-dev
Terminal=false
StartupWMClass=Portfolio-dev
NoDisplay=true
Categories=Office;Finance;Development;
EOF
chmod 644 "${USER_APPS_DIR}/portfolio-dev-alt.desktop"

# 4. Refresh icon cache and desktop database if tools are present
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -f -t "${USER_ICONS_DIR}" 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${USER_APPS_DIR}" 2>/dev/null || true
fi
