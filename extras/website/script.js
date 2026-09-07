/**
 * Portfolio Desktop - Marketing Website Logic
 * Handles OS Detection, Download Links, App UI Preview Tabs, and Clipboard Utility
 */

(function () {
  'use strict';

  // ===========================================================================
  // Download Configuration
  // Modify these URLs when publishing new releases
  // ===========================================================================
  const GITHUB_REPO_URL = "https://github.com/cgeosoft/portfolio";
  const APP_VERSION = "0.1.0";
  const RELEASE_BASE = `${GITHUB_REPO_URL}/releases/download/v${APP_VERSION}`;

  const DOWNLOAD_CONFIG = {
    version: APP_VERSION,
    releaseBase: RELEASE_BASE,
    windows: {
      key: "windows",
      name: "Windows",
      title: "Download for Windows (.exe)",
      caption: "Recommended for Windows (64-bit)",
      badge: "Windows 10, 11 (64-bit)",
      installerFile: `portfolio_${APP_VERSION}_x64_setup.exe`,
      installerUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_x64_setup.exe`,
      portableUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_windows-x64_portable.zip`,
      terminalCmd: "winget install --id Portfolio.Desktop -s winget",
      iconSvg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.802"/>
      </svg>`
    },
    macos: {
      key: "macos",
      name: "macOS",
      title: "Download for macOS (.dmg)",
      caption: "Recommended for macOS (Universal)",
      badge: "Apple Silicon & Intel (macOS 12+)",
      installerFile: `portfolio_${APP_VERSION}_universal.dmg`,
      installerUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_universal.dmg`,
      portableUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_macos-universal.zip`,
      terminalCmd: "brew install --cask portfolio-desktop",
      iconSvg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.72-.94 2.74 1 .08 2.03-.49 2.65-1.24z"/>
      </svg>`
    },
    linux: {
      key: "linux",
      name: "Linux",
      title: "Download for Linux (.deb)",
      caption: "Recommended for Debian / Ubuntu (x64)",
      badge: "Debian, Ubuntu, Mint & distros",
      installerFile: `portfolio_${APP_VERSION}_amd64.deb`,
      installerUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_amd64.deb`,
      portableUrl: `${RELEASE_BASE}/portfolio_${APP_VERSION}_linux-x64.tar.gz`,
      terminalCmd: `sudo dpkg -i portfolio_${APP_VERSION}_amd64.deb`,
      iconSvg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12.003 2c-3.15 0-5.71 2.56-5.71 5.71 0 1.24.4 2.39 1.08 3.32-.4.76-.87 1.83-.87 3.03 0 1.21.36 2.32.97 3.24-1.03.62-1.74 1.74-1.74 3.03 0 .76.25 1.47.67 2.05.3.41.77.62 1.27.62h8.66c.5 0 .97-.21 1.27-.62.42-.58.67-1.29.67-2.05 0-1.29-.71-2.41-1.74-3.03.61-.92.97-2.03.97-3.24 0-1.2-.47-2.27-.87-3.03.68-.93 1.08-2.08 1.08-3.32 0-3.15-2.56-5.71-5.71-5.71z"/>
      </svg>`
    }
  };

  // ===========================================================================
  // OS Detection Heuristics
  // ===========================================================================
  function detectOS() {
    // 1. Try modern Client Hints (User-Agent Client Hints)
    const nav = window.navigator;
    if (nav.userAgentData && nav.userAgentData.platform) {
      const p = nav.userAgentData.platform.toLowerCase();
      if (p.includes('win')) return 'windows';
      if (p.includes('mac')) return 'macos';
      if (p.includes('linux')) return 'linux';
    }

    // 2. Try platform string
    const platform = (nav.platform || '').toLowerCase();
    if (platform.includes('win')) return 'windows';
    if (platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad')) return 'macos';
    if (platform.includes('linux') || platform.includes('x11')) return 'linux';

    // 3. Fallback to userAgent string
    const userAgent = (nav.userAgent || '').toLowerCase();
    if (userAgent.includes('windows') || userAgent.includes('win32') || userAgent.includes('win64')) return 'windows';
    if (userAgent.includes('macintosh') || userAgent.includes('mac os x')) return 'macos';
    if (userAgent.includes('linux') || userAgent.includes('x11')) return 'linux';

    // Default fallback: Linux (or could be Windows, defaults cleanly to Linux)
    return 'linux';
  }

  // ===========================================================================
  // UI State & Binding
  // ===========================================================================
  let activeOS = detectOS();

  function renderHeroDownload(osKey) {
    const config = DOWNLOAD_CONFIG[osKey];
    if (!config) return;

    const primaryBtn = document.getElementById('primary-download-btn');
    const osIcon = document.getElementById('primary-os-icon');
    const titleEl = document.getElementById('download-title');
    const captionEl = document.getElementById('download-caption');
    const terminalEl = document.getElementById('terminal-command');

    if (primaryBtn) {
      primaryBtn.href = config.installerUrl;
      primaryBtn.setAttribute('data-target-os', osKey);
    }
    if (osIcon) {
      osIcon.innerHTML = config.iconSvg;
    }
    if (titleEl) {
      titleEl.textContent = config.title;
    }
    if (captionEl) {
      captionEl.textContent = config.caption;
    }
    if (terminalEl) {
      terminalEl.textContent = config.terminalCmd;
    }

    // Update switcher chips active state
    document.querySelectorAll('.chip-btn').forEach(chip => {
      const target = chip.getAttribute('data-target-os');
      chip.classList.toggle('active', target === osKey);
    });

    // Update matrix cards recommended highlighting
    document.querySelectorAll('.platform-download-card').forEach(card => {
      card.classList.remove('is-detected');
    });
    const detectedCard = document.getElementById(`card-${osKey}`);
    if (detectedCard) {
      detectedCard.classList.add('is-detected');
    }
  }

  function bindAllDownloadLinks() {
    // Populate hrefs for Windows
    document.querySelectorAll('.download-link-win').forEach(el => {
      el.href = DOWNLOAD_CONFIG.windows.installerUrl;
    });
    document.querySelectorAll('.download-link-win-portable').forEach(el => {
      el.href = DOWNLOAD_CONFIG.windows.portableUrl;
    });

    // Populate hrefs for macOS
    document.querySelectorAll('.download-link-mac').forEach(el => {
      el.href = DOWNLOAD_CONFIG.macos.installerUrl;
    });
    document.querySelectorAll('.download-link-mac-zip').forEach(el => {
      el.href = DOWNLOAD_CONFIG.macos.portableUrl;
    });

    // Populate hrefs for Linux
    document.querySelectorAll('.download-link-linux').forEach(el => {
      el.href = DOWNLOAD_CONFIG.linux.installerUrl;
    });
    document.querySelectorAll('.download-link-linux-tar').forEach(el => {
      el.href = DOWNLOAD_CONFIG.linux.portableUrl;
    });
  }

  function initPlatformSwitcher() {
    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetOs = btn.getAttribute('data-target-os');
        if (targetOs && DOWNLOAD_CONFIG[targetOs]) {
          activeOS = targetOs;
          renderHeroDownload(activeOS);
        }
      });
    });
  }

  function initCopyButton() {
    const copyBtn = document.getElementById('btn-copy-term');
    const termCommand = document.getElementById('terminal-command');

    if (copyBtn && termCommand) {
      copyBtn.addEventListener('click', async () => {
        const text = termCommand.textContent.trim();
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
          } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
          }

          copyBtn.classList.add('copied');
          const copyText = copyBtn.querySelector('.copy-text');
          if (copyText) copyText.textContent = 'Copied!';

          setTimeout(() => {
            copyBtn.classList.remove('copied');
            if (copyText) copyText.textContent = 'Copy';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy to clipboard:', err);
        }
      });
    }
  }

  // ===========================================================================
  // Interactive Mockup Tab Switching
  // ===========================================================================
  function initMockupTabs() {
    const tabs = document.querySelectorAll('.mockup-tab');
    const panels = document.querySelectorAll('.mockup-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabTarget = tab.getAttribute('data-tab');

        // Update tabs active class & aria-selected
        tabs.forEach(t => {
          const isActive = t === tab;
          t.classList.toggle('active', isActive);
          t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        // Show target panel
        panels.forEach(panel => {
          const isTarget = panel.id === `tab-panel-${tabTarget}`;
          panel.classList.toggle('active', isTarget);
        });
      });
    });
  }

  // ===========================================================================
  // Year & Initialization
  // ===========================================================================
  function initYear() {
    const yearEl = document.getElementById('current-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  // DOM Content Loaded Handler
  document.addEventListener('DOMContentLoaded', () => {
    renderHeroDownload(activeOS);
    bindAllDownloadLinks();
    initPlatformSwitcher();
    initCopyButton();
    initMockupTabs();
    initYear();
  });
})();
