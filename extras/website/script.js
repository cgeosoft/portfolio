/**
 * Marketing site script: OS detection, download links resolved from the
 * release manifest, copy button, screenshot reveal / hotspots / lightbox,
 * and opt-in PostHog analytics.
 */
(function () {
  "use strict";

  const SITE_SLUG = "portfolio";
  const GITHUB_REPO = "cgeosoft/portfolio";

  // The release script writes /releases/latest.json describing the latest
  // release assets on GitHub Releases (see scripts/release.sh).
  const RELEASE_MANIFEST_URL = "/releases/latest.json";
  const FALLBACK_URL = "#downloads";
  const CACHE_KEY = `${SITE_SLUG}_latest_release_v2`;
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const CONSENT_KEY = `${SITE_SLUG}_cookie_consent_v1`;

  // Release assets follow <slug>_<version>_<platform>.<ext>. The version is
  // read from the manifest at runtime, so a new release needs no redeploy of
  // the site. Adjust here if scripts/release.sh renames artifacts.
  function buildAssetFilenames(version) {
    const p = SITE_SLUG;
    return {
      windows: { installer: `${p}_${version}_x64_setup.exe`, portable: `${p}_${version}_windows-x64_portable.zip` },
      macos: { installer: `${p}_${version}_universal.dmg`, portable: `${p}_${version}_macos-universal.zip` },
      linux: { installer: `${p}_${version}_amd64.deb`, portable: `${p}_${version}_linux-x64.tar.gz` },
    };
  }

  const ICONS = {
    windows: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.802"/></svg>',
    macos: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.72-.94 2.74 1 .08 2.03-.49 2.65-1.24z"/></svg>',
    linux: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12.003 2c-3.15 0-5.71 2.56-5.71 5.71 0 1.24.4 2.39 1.08 3.32-.4.76-.87 1.83-.87 3.03 0 1.21.36 2.32.97 3.24-1.03.62-1.74 1.74-1.74 3.03 0 .76.25 1.47.67 2.05.3.41.77.62 1.27.62h8.66c.5 0 .97-.21 1.27-.62.42-.58.67-1.29.67-2.05 0-1.29-.71-2.41-1.74-3.03.61-.92.97-2.03.97-3.24 0-1.2-.47-2.27-.87-3.03.68-.93 1.08-2.08 1.08-3.32 0-3.15-2.56-5.71-5.71-5.71z"/></svg>',
  };

  // Until the release is known (or when the manifest is unreachable) every
  // link points at the downloads section so visitors always land somewhere valid.
  const initialFiles = buildAssetFilenames("<version>");
  const DOWNLOAD_CONFIG = {
    version: null,
    windows: {
      title: "Download for Windows (.exe)",
      caption: "Recommended for Windows 10 / 11 (64-bit)",
      installerUrl: FALLBACK_URL,
      portableUrl: FALLBACK_URL,
      terminalCmd: initialFiles.windows.installer,
    },
    macos: {
      title: "Download for macOS (.dmg)",
      caption: "Recommended for macOS 12+ (Universal)",
      installerUrl: FALLBACK_URL,
      portableUrl: FALLBACK_URL,
      terminalCmd: `open ${initialFiles.macos.installer}`,
    },
    linux: {
      title: "Download for Linux (.deb)",
      caption: "Recommended for Debian / Ubuntu (x64)",
      installerUrl: FALLBACK_URL,
      portableUrl: FALLBACK_URL,
      terminalCmd: `sudo dpkg -i ${initialFiles.linux.installer}`,
    },
  };

  function detectOS() {
    const nav = window.navigator;
    const hints = nav.userAgentData && nav.userAgentData.platform ? nav.userAgentData.platform.toLowerCase() : "";
    const platform = (nav.platform || "").toLowerCase();
    const ua = (nav.userAgent || "").toLowerCase();
    const probe = `${hints} ${platform} ${ua}`;
    if (probe.includes("win")) return "windows";
    if (probe.includes("mac") || probe.includes("iphone") || probe.includes("ipad")) return "macos";
    return "linux";
  }

  let activeOS = detectOS();

  function renderHeroDownload(osKey) {
    const config = DOWNLOAD_CONFIG[osKey];
    if (!config) return;
    const primaryBtn = document.getElementById("primary-download-btn");
    const osIcon = document.getElementById("primary-os-icon");
    const titleEl = document.getElementById("download-title");
    const captionEl = document.getElementById("download-caption");
    const terminalEl = document.getElementById("terminal-command");

    if (primaryBtn) {
      primaryBtn.href = config.installerUrl;
      primaryBtn.setAttribute("data-os", osKey);
    }
    if (osIcon) osIcon.innerHTML = ICONS[osKey];
    if (titleEl) titleEl.textContent = config.title;
    if (captionEl) captionEl.textContent = config.caption;
    if (terminalEl) terminalEl.textContent = config.terminalCmd;

    document.querySelectorAll(".chip-btn[data-target-os]").forEach((chip) => {
      chip.classList.toggle("active", chip.getAttribute("data-target-os") === osKey);
    });
    document.querySelectorAll(".platform-card").forEach((card) => {
      card.classList.toggle("is-detected", card.id === `card-${osKey}`);
    });
  }

  function bindAllDownloadLinks() {
    const map = {
      ".download-link-win": DOWNLOAD_CONFIG.windows.installerUrl,
      ".download-link-win-portable": DOWNLOAD_CONFIG.windows.portableUrl,
      ".download-link-mac": DOWNLOAD_CONFIG.macos.installerUrl,
      ".download-link-mac-zip": DOWNLOAD_CONFIG.macos.portableUrl,
      ".download-link-linux": DOWNLOAD_CONFIG.linux.installerUrl,
      ".download-link-linux-tar": DOWNLOAD_CONFIG.linux.portableUrl,
    };
    Object.keys(map).forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.href = map[selector];
      });
    });
  }

  function initPlatformSwitcher() {
    document.querySelectorAll(".chip-btn[data-target-os]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target-os");
        if (target && DOWNLOAD_CONFIG[target]) {
          activeOS = target;
          renderHeroDownload(activeOS);
        }
      });
    });
  }

  function initCopyButton() {
    const copyBtn = document.getElementById("btn-copy-term");
    const term = document.getElementById("terminal-command");
    if (!copyBtn || !term) return;
    copyBtn.addEventListener("click", async () => {
      const text = term.textContent.trim();
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        copyBtn.classList.add("copied");
        const label = copyBtn.querySelector(".copy-text");
        if (label) label.textContent = "Copied";
        setTimeout(() => {
          copyBtn.classList.remove("copied");
          if (label) label.textContent = "Copy";
        }, 2000);
      } catch (err) {
        console.error("Copy failed", err);
      }
    });
  }

  // Reveal the screenshot as it scrolls into view, open the annotation
  // tooltips on hover / focus / click, and show the image full size in a
  // <dialog>. Everything degrades to a plain screenshot without JS.
  function initScreenshot() {
    const frame = document.getElementById("shot-frame");
    if (!frame) return;

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.12 }
      );
      observer.observe(frame);
    } else {
      frame.classList.add("is-revealed");
    }

    // Hotspots. Below the breakpoint the list is laid out under the image and
    // the pins are decorative labels instead of controls.
    const compact = window.matchMedia("(max-width: 860px)");
    const hotspots = Array.from(document.querySelectorAll("#shot-hotspots .shot-hotspot"));
    let pinnedSpot = null;

    function setOpen(spot, open) {
      spot.classList.toggle("is-open", open);
      const pin = spot.querySelector(".hotspot-pin");
      if (pin && !compact.matches) pin.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function openOnly(spot) {
      hotspots.forEach((other) => setOpen(other, other === spot));
    }

    function closeAll() {
      hotspots.forEach((spot) => setOpen(spot, false));
      pinnedSpot = null;
    }

    function syncCompactState() {
      const isCompact = compact.matches;
      if (isCompact) closeAll();
      hotspots.forEach((spot) => {
        const pin = spot.querySelector(".hotspot-pin");
        if (!pin) return;
        if (isCompact) {
          pin.setAttribute("tabindex", "-1");
          pin.setAttribute("aria-hidden", "true");
          pin.removeAttribute("aria-expanded");
        } else {
          pin.removeAttribute("tabindex");
          pin.removeAttribute("aria-hidden");
          pin.setAttribute("aria-expanded", "false");
        }
      });
    }

    hotspots.forEach((spot, index) => {
      const pin = spot.querySelector(".hotspot-pin");
      if (!pin) return;
      spot.addEventListener("mouseenter", () => {
        if (!compact.matches && !pinnedSpot) openOnly(spot);
      });
      spot.addEventListener("mouseleave", () => {
        if (!compact.matches && !pinnedSpot) setOpen(spot, false);
      });
      pin.addEventListener("focus", () => {
        if (!compact.matches) openOnly(spot);
      });
      pin.addEventListener("blur", () => {
        if (!compact.matches && pinnedSpot !== spot) setOpen(spot, false);
      });
      pin.addEventListener("click", (event) => {
        if (compact.matches) return;
        event.stopPropagation();
        if (pinnedSpot === spot) {
          closeAll();
          return;
        }
        pinnedSpot = spot;
        openOnly(spot);
        trackEvent("screenshot_hotspot_opened", { hotspot: index + 1 });
      });
    });

    if (hotspots.length) {
      syncCompactState();
      if (typeof compact.addEventListener === "function") compact.addEventListener("change", syncCompactState);
      document.addEventListener("click", (event) => {
        if (!pinnedSpot) return;
        if (event.target instanceof Element && event.target.closest(".shot-hotspot")) return;
        closeAll();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && pinnedSpot) closeAll();
      });
    }

    // Lightbox
    const img = document.getElementById("shot-img");
    const zoomBtn = document.getElementById("shot-zoom-btn");
    const lightbox = document.getElementById("shot-lightbox");
    const lightboxClose = document.getElementById("shot-lightbox-close");

    function openLightbox() {
      if (lightbox && typeof lightbox.showModal === "function") {
        lightbox.showModal();
        trackEvent("screenshot_zoomed", {});
        return;
      }
      if (img) window.open(img.currentSrc || img.src, "_blank", "noopener");
    }

    if (img) img.addEventListener("click", openLightbox);
    if (zoomBtn) zoomBtn.addEventListener("click", openLightbox);
    if (lightbox) {
      if (lightboxClose) lightboxClose.addEventListener("click", () => lightbox.close());
      // Clicking anywhere, image or backdrop, dismisses the full-size view.
      lightbox.addEventListener("click", () => lightbox.close());
    }
  }

  function applyReleaseData(manifest) {
    if (!manifest || !manifest.version || !manifest.files) return;
    const version = String(manifest.version).replace(/^v/, "");
    const files = buildAssetFilenames(version);
    const url = (platform, kind, fallbackName) => {
      const entry = manifest.files[platform] && manifest.files[platform][kind];
      return entry && entry.url ? entry.url : `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${fallbackName}`;
    };

    DOWNLOAD_CONFIG.version = version;
    DOWNLOAD_CONFIG.windows.installerUrl = url("windows", "installer", files.windows.installer);
    DOWNLOAD_CONFIG.windows.portableUrl = url("windows", "portable", files.windows.portable);
    DOWNLOAD_CONFIG.windows.terminalCmd = files.windows.installer;
    DOWNLOAD_CONFIG.macos.installerUrl = url("macos", "installer", files.macos.installer);
    DOWNLOAD_CONFIG.macos.portableUrl = url("macos", "portable", files.macos.portable);
    DOWNLOAD_CONFIG.macos.terminalCmd = `open ${files.macos.installer}`;
    DOWNLOAD_CONFIG.linux.installerUrl = url("linux", "installer", files.linux.installer);
    DOWNLOAD_CONFIG.linux.portableUrl = url("linux", "portable", files.linux.portable);
    DOWNLOAD_CONFIG.linux.terminalCmd = `sudo dpkg -i ${files.linux.installer}`;

    document.querySelectorAll(".latest-version-text").forEach((el) => {
      el.textContent = `Latest release v${version}`;
    });

    renderHeroDownload(activeOS);
    bindAllDownloadLinks();
  }

  const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

  function transformGitHubRelease(gh) {
    if (!gh || !gh.tag_name) return null;
    const version = String(gh.tag_name).replace(/^v/, "");
    const assets = Array.isArray(gh.assets) ? gh.assets : [];
    const find = (re) => {
      const match = assets.find((a) => re.test(a.name));
      return match ? { name: match.name, url: match.browser_download_url, size: match.size } : undefined;
    };
    return {
      app: SITE_SLUG,
      name: gh.name || `Portfolio ${version}`,
      version: version,
      publishedAt: gh.published_at,
      notes: gh.body || "",
      url: gh.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`,
      files: {
        linux: {
          installer: find(/_amd64\.deb$|linux.*\.deb$/i),
          portable: find(/_linux-x64\.tar\.gz$|linux.*\.tar\.gz$/i),
        },
        windows: {
          installer: find(/_x64_setup\.exe$|win.*setup\.(exe|zip)$/i),
          portable: find(/_windows-x64_portable\.zip$|win.*portable\.zip$/i),
        },
        macos: {
          installer: find(/_universal\.dmg$|mac.*\.dmg$/i),
          portable: find(/_macos-universal\.zip$|mac.*\.zip$/i),
        },
      },
    };
  }

  async function fetchLatestRelease() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.data) {
          applyReleaseData(parsed.data);
          return;
        }
      }
    } catch (err) {
      // Cache unavailable; fall through to the network.
    }

    // 1. Fetch directly from GitHub Releases API (no website deploy needed)
    try {
      const res = await fetch(GITHUB_API_URL, {
        headers: { Accept: "application/vnd.github.v3+json" },
        cache: "no-cache",
      });
      if (res.ok) {
        const ghData = await res.json();
        const manifest = transformGitHubRelease(ghData);
        if (manifest) {
          applyReleaseData(manifest);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: manifest }));
          } catch (err) {}
          return;
        }
      }
    } catch (err) {
      console.warn("GitHub release lookup failed; trying local manifest fallback.", err);
    }

    // 2. Fallback to /releases/latest.json if present
    try {
      const response = await fetch(RELEASE_MANIFEST_URL, { headers: { Accept: "application/json" }, cache: "no-cache" });
      if (response.ok) {
        const data = await response.json();
        applyReleaseData(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (err) {}
        return;
      }
    } catch (err) {
      console.warn("Latest release lookup failed; links point at the downloads section.", err);
    }
  }

  function initYear() {
    document.querySelectorAll("#current-year").forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }

  // Analytics. PostHog is loaded by the page with capturing opted out; nothing
  // is sent until the visitor accepts the banner.
  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (err) {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (err) {
      // Storage unavailable; the banner shows again next visit.
    }
  }

  function trackEvent(name, properties) {
    try {
      if (window.posthog && readConsent() === "accepted") window.posthog.capture(name, properties || {});
    } catch (err) {
      // Ignore tracking errors.
    }
  }

  function enableAnalytics() {
    writeConsent("accepted");
    try {
      if (window.posthog) {
        window.posthog.opt_in_capturing();
        window.posthog.capture("$pageview");
      }
    } catch (err) {
      // Consent is still recorded locally.
    }
  }

  function disableAnalytics() {
    writeConsent("declined");
    try {
      if (window.posthog) window.posthog.opt_out_capturing();
    } catch (err) {
      // Ignore.
    }
  }

  function initCookieBanner() {
    const consent = readConsent();
    if (consent === "accepted") {
      enableAnalytics();
      return;
    }
    if (consent === "declined") {
      disableAnalytics();
      return;
    }

    const banner = document.createElement("div");
    banner.className = "cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
      '<div class="cookie-banner-copy">' +
      '<div class="cookie-banner-title">Your privacy</div>' +
      "<p>This site uses PostHog for anonymous, aggregated analytics (page views and download clicks) to improve the website. " +
      "No personal data is collected. " +
      '<a href="/terms/#cookie-policy">Read the cookie policy</a>.</p>' +
      "</div>" +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn btn-ghost cookie-decline">Decline</button>' +
      '<button type="button" class="btn btn-primary cookie-accept">Accept</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("visible"));

    const dismiss = () => {
      banner.classList.remove("visible");
      setTimeout(() => banner.remove(), 300);
    };
    banner.querySelector(".cookie-accept").addEventListener("click", () => {
      enableAnalytics();
      dismiss();
    });
    banner.querySelector(".cookie-decline").addEventListener("click", () => {
      disableAnalytics();
      dismiss();
    });
  }

  function initDownloadTracking() {
    const selectors = "#primary-download-btn, .download-link-win, .download-link-win-portable, .download-link-mac, .download-link-mac-zip, .download-link-linux, .download-link-linux-tar";
    document.querySelectorAll(selectors).forEach((el) => {
      el.addEventListener("click", () => {
        const os = el.getAttribute("data-os") || activeOS;
        const type = el.getAttribute("data-type") || "installer";
        trackEvent("download_clicked", { os, type });
      });
    });
  }

  function init() {
    renderHeroDownload(activeOS);
    bindAllDownloadLinks();
    initPlatformSwitcher();
    initCopyButton();
    initScreenshot();
    initYear();
    initCookieBanner();
    initDownloadTracking();
    fetchLatestRelease();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
