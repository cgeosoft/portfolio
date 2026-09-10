/**
 * Portfolio - Marketing Website Logic
 * Handles OS Detection, Download Links, App UI Preview Tabs, and Clipboard Utility
 */

(function () {
  'use strict';

  // ===========================================================================
  // Download Configuration
  // Modify these URLs when publishing new releases or let fetchLatestRelease auto-update
  // ===========================================================================
  const GITHUB_REPO_URL = "https://github.com/cgeosoft/portfolio";
  const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
  const GITHUB_API_LATEST_RELEASE = "https://api.github.com/repos/cgeosoft/portfolio/releases/latest";
  const CACHE_KEY = "portfolio_latest_release_v1";
  const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache to prevent GitHub API rate limits
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
  // Real Screenshot Showcase
  // Scroll reveal, annotated hotspots (hover / focus / click to pin), and a
  // full-size lightbox. Everything degrades to a plain screenshot without JS.
  // ===========================================================================
  function initScreenshotShowcase() {
    const frame = document.getElementById('shot-frame');
    if (!frame) return;

    const list = document.getElementById('shot-hotspots');
    const img = document.getElementById('shot-img');
    const tourToggle = document.getElementById('shot-tour-toggle');
    const zoomBtn = document.getElementById('shot-zoom-btn');
    const lightbox = document.getElementById('shot-lightbox');
    const lightboxClose = document.getElementById('shot-lightbox-close');

    // --- Reveal the frame as it scrolls into view ---
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12 });
      observer.observe(frame);
    } else {
      frame.classList.add('is-revealed');
    }

    // --- Annotated hotspots ---
    const compact = window.matchMedia('(max-width: 860px)');
    const hotspots = list ? Array.from(list.querySelectorAll('.shot-hotspot')) : [];
    let pinnedSpot = null;

    function setOpen(spot, open) {
      spot.classList.toggle('is-open', open);
      const pin = spot.querySelector('.hotspot-pin');
      if (pin) pin.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function openOnly(spot) {
      hotspots.forEach((other) => setOpen(other, other === spot));
    }

    function closeAll() {
      hotspots.forEach((spot) => setOpen(spot, false));
      pinnedSpot = null;
    }

    // Below the breakpoint every annotation is rendered as a plain list, so the
    // markers become decorative labels instead of interactive controls.
    function syncCompactState() {
      const isCompact = compact.matches;
      if (isCompact) closeAll();
      hotspots.forEach((spot) => {
        const pin = spot.querySelector('.hotspot-pin');
        if (!pin) return;
        if (isCompact) {
          pin.setAttribute('tabindex', '-1');
          pin.setAttribute('aria-hidden', 'true');
          pin.removeAttribute('aria-expanded');
        } else {
          pin.removeAttribute('tabindex');
          pin.removeAttribute('aria-hidden');
          pin.setAttribute('aria-expanded', 'false');
        }
      });
    }

    hotspots.forEach((spot, index) => {
      const pin = spot.querySelector('.hotspot-pin');
      if (!pin) return;

      spot.addEventListener('mouseenter', () => {
        if (!compact.matches && !pinnedSpot) openOnly(spot);
      });
      spot.addEventListener('mouseleave', () => {
        if (!compact.matches && !pinnedSpot) setOpen(spot, false);
      });
      pin.addEventListener('focus', () => {
        if (!compact.matches) openOnly(spot);
      });
      pin.addEventListener('blur', () => {
        if (!compact.matches && pinnedSpot !== spot) setOpen(spot, false);
      });
      pin.addEventListener('click', (event) => {
        if (compact.matches) return;
        event.stopPropagation();
        if (pinnedSpot === spot) {
          closeAll();
          return;
        }
        pinnedSpot = spot;
        openOnly(spot);
        trackEvent('screenshot_hotspot_opened', { hotspot: index + 1 });
      });
    });

    if (hotspots.length) {
      syncCompactState();
      if (typeof compact.addEventListener === 'function') {
        compact.addEventListener('change', syncCompactState);
      }

      document.addEventListener('click', (event) => {
        if (!pinnedSpot) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.shot-hotspot')) return;
        closeAll();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pinnedSpot) closeAll();
      });
    }

    if (tourToggle && list) {
      tourToggle.addEventListener('click', () => {
        const showing = tourToggle.getAttribute('aria-pressed') === 'true';
        const next = !showing;
        tourToggle.setAttribute('aria-pressed', next ? 'true' : 'false');
        tourToggle.classList.toggle('is-on', next);
        list.hidden = !next;
        if (!next) closeAll();
      });
    }

    // --- Full-size lightbox ---
    function openLightbox() {
      if (lightbox && typeof lightbox.showModal === 'function') {
        lightbox.showModal();
        trackEvent('screenshot_zoomed', {});
        return;
      }
      window.open('assets/screenshot.png', '_blank', 'noopener');
    }

    if (img) {
      img.addEventListener('click', openLightbox);
    }
    if (zoomBtn) {
      zoomBtn.addEventListener('click', openLightbox);
    }
    if (lightbox) {
      if (lightboxClose) {
        lightboxClose.addEventListener('click', () => lightbox.close());
      }
      // Clicking anywhere, image or backdrop, dismisses the full-size view.
      lightbox.addEventListener('click', () => lightbox.close());
    }
  }

  // ===========================================================================
  // Dynamic GitHub Release Resolution
  // Ensures download links always point to the latest release assets
  // ===========================================================================
  function matchReleaseAssets(assets) {
    const result = {};
    if (!Array.isArray(assets)) return result;

    for (const asset of assets) {
      const name = (asset.name || '').toLowerCase();
      const url = asset.browser_download_url;
      if (!url) continue;

      // Linux Debian (.deb)
      if (name.endsWith('.deb')) {
        result.linuxDeb = { url, name: asset.name };
      }
      // Linux tarball (.tar.gz)
      else if (name.endsWith('.tar.gz') && (name.includes('linux') || name.includes('setup'))) {
        result.linuxTar = { url, name: asset.name };
      }
      // Windows Installer (.exe)
      else if (name.endsWith('.exe')) {
        result.winInstaller = { url, name: asset.name };
      }
      // Windows Portable (.zip)
      else if (name.endsWith('.zip') && (name.includes('win') || name.includes('windows'))) {
        result.winPortable = { url, name: asset.name };
      }
      // macOS Disk Image (.dmg)
      else if (name.endsWith('.dmg')) {
        result.macDmg = { url, name: asset.name };
      }
      // macOS zip archive (.zip)
      else if (name.endsWith('.zip') && (name.includes('mac') || name.includes('macos') || name.includes('darwin'))) {
        result.macZip = { url, name: asset.name };
      }
    }
    return result;
  }

  function applyReleaseData(releaseData) {
    if (!releaseData) return;

    const rawTag = releaseData.tag_name || '';
    const cleanVersion = rawTag.replace(/^v/, '') || DOWNLOAD_CONFIG.version;
    const releaseBase = `${GITHUB_REPO_URL}/releases/download/${rawTag || ('v' + cleanVersion)}`;

    DOWNLOAD_CONFIG.version = cleanVersion;
    DOWNLOAD_CONFIG.releaseBase = releaseBase;

    const matched = matchReleaseAssets(releaseData.assets || []);

    if (matched.winInstaller) {
      DOWNLOAD_CONFIG.windows.installerUrl = matched.winInstaller.url;
      DOWNLOAD_CONFIG.windows.installerFile = matched.winInstaller.name;
    } else {
      DOWNLOAD_CONFIG.windows.installerUrl = `${releaseBase}/portfolio_${cleanVersion}_x64_setup.exe`;
    }

    if (matched.winPortable) {
      DOWNLOAD_CONFIG.windows.portableUrl = matched.winPortable.url;
    } else {
      DOWNLOAD_CONFIG.windows.portableUrl = `${releaseBase}/portfolio_${cleanVersion}_windows-x64_portable.zip`;
    }

    if (matched.macDmg) {
      DOWNLOAD_CONFIG.macos.installerUrl = matched.macDmg.url;
      DOWNLOAD_CONFIG.macos.installerFile = matched.macDmg.name;
    } else {
      DOWNLOAD_CONFIG.macos.installerUrl = `${releaseBase}/portfolio_${cleanVersion}_universal.dmg`;
    }

    if (matched.macZip) {
      DOWNLOAD_CONFIG.macos.portableUrl = matched.macZip.url;
    } else {
      DOWNLOAD_CONFIG.macos.portableUrl = `${releaseBase}/portfolio_${cleanVersion}_macos-universal.zip`;
    }

    if (matched.linuxDeb) {
      DOWNLOAD_CONFIG.linux.installerUrl = matched.linuxDeb.url;
      DOWNLOAD_CONFIG.linux.installerFile = matched.linuxDeb.name;
      DOWNLOAD_CONFIG.linux.terminalCmd = `sudo dpkg -i ${matched.linuxDeb.name}`;
    } else {
      DOWNLOAD_CONFIG.linux.installerUrl = `${releaseBase}/portfolio_${cleanVersion}_amd64.deb`;
      DOWNLOAD_CONFIG.linux.installerFile = `portfolio_${cleanVersion}_amd64.deb`;
      DOWNLOAD_CONFIG.linux.terminalCmd = `sudo dpkg -i portfolio_${cleanVersion}_amd64.deb`;
    }

    if (matched.linuxTar) {
      DOWNLOAD_CONFIG.linux.portableUrl = matched.linuxTar.url;
    } else {
      DOWNLOAD_CONFIG.linux.portableUrl = `${releaseBase}/portfolio_${cleanVersion}_linux-x64.tar.gz`;
    }

    // Update version badge and meta labels in DOM
    document.querySelectorAll('.latest-version-text').forEach(el => {
      el.textContent = `v${cleanVersion}`;
    });

    const metaVersionEl = document.getElementById('meta-version-text');
    if (metaVersionEl) {
      metaVersionEl.textContent = `• Version ${cleanVersion} Latest`;
    }

    // Update active hero button & matrix links
    renderHeroDownload(activeOS);
    bindAllDownloadLinks();
  }

  async function fetchLatestRelease() {
    // 1. Try reading valid cache first
    try {
      const cachedItem = localStorage.getItem(CACHE_KEY);
      if (cachedItem) {
        const parsed = JSON.parse(cachedItem);
        if (parsed && typeof parsed.timestamp === 'number' && (Date.now() - parsed.timestamp < CACHE_TTL_MS)) {
          if (parsed.data) {
            applyReleaseData(parsed.data);
          }
        }
      }
    } catch (err) {
      // Ignore cache access error
    }

    // 2. Fetch latest release from GitHub API
    try {
      const response = await fetch(GITHUB_API_LATEST_RELEASE, {
        headers: { Accept: 'application/vnd.github.v3+json' }
      });
      if (response.ok) {
        const data = await response.json();
        applyReleaseData(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: data
          }));
        } catch (e) {
          // Ignore cache write error
        }
      }
    } catch (err) {
      console.warn('Could not retrieve latest release from GitHub API. Using fallback configuration.', err);
    }
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

  // ===========================================================================
  // Analytics & Cookie Consent
  // PostHog tracking is opt-in. Nothing is captured until the visitor accepts.
  // ===========================================================================
  const CONSENT_KEY = 'portfolio_cookie_consent_v1';

  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* storage unavailable */ }
  }

  function trackEvent(name, properties) {
    try {
      if (window.posthog) {
        window.posthog.capture(name, properties || {});
      }
    } catch (e) { /* ignore tracking errors */ }
  }

  function enableAnalytics() {
    writeConsent('accepted');
    try {
      if (window.posthog) {
        window.posthog.opt_in_capturing();
        window.posthog.capture('$pageview');
      }
    } catch (e) {
      // Ignore; consent is still recorded locally
    }
  }

  function disableAnalytics() {
    writeConsent('declined');
    try {
      if (window.posthog) window.posthog.opt_out_capturing();
    } catch (e) { /* ignore */ }
  }

  function initCookieBanner() {
    const consent = readConsent();

    // Already decided: apply the stored choice without showing the banner.
    if (consent === 'accepted') {
      enableAnalytics();
      return;
    }
    if (consent === 'declined') {
      disableAnalytics();
      return;
    }

    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<div class="cookie-banner-copy">' +
          '<div class="cookie-banner-title">Your privacy</div>' +
          '<p>This site uses PostHog for anonymous, aggregated analytics ' +
          '(for example page views and download clicks) to improve the website. ' +
          'No financial or personal data is collected. ' +
          '<a href="/terms#cookie-policy">Read the Cookie Policy</a>.</p>' +
        '</div>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-ghost cookie-decline">Decline</button>' +
          '<button type="button" class="btn btn-primary cookie-accept">Accept</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('visible'));

    banner.querySelector('.cookie-accept').addEventListener('click', () => {
      enableAnalytics();
      dismissBanner(banner);
    });
    banner.querySelector('.cookie-decline').addEventListener('click', () => {
      disableAnalytics();
      dismissBanner(banner);
    });
  }

  function dismissBanner(banner) {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 300);
  }

  function trackDownloadClick(el) {
    const os = el.getAttribute('data-os') || activeOS;
    const type = el.getAttribute('data-type') || 'installer';
    trackEvent('download_clicked', { os: os, type: type });
  }

  // DOM Content Loaded Handler
  document.addEventListener('DOMContentLoaded', () => {
    renderHeroDownload(activeOS);
    bindAllDownloadLinks();
    initPlatformSwitcher();
    initCopyButton();
    initMockupTabs();
    initScreenshotShowcase();
    initYear();
    initCookieBanner();
    fetchLatestRelease();

    // Track download link clicks (respects the visitor's consent choice)
    document.querySelectorAll('.download-link-win, .download-link-mac, .download-link-linux').forEach(el => {
      el.addEventListener('click', () => trackDownloadClick(el));
    });
  });
})();
