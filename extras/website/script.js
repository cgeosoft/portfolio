/**
 * Marketing site script: OS detection, download links from the latest
 * release, screenshot lightbox and opt-in PostHog analytics.
 */
(function () {
  "use strict";

  const SLUG = "portfolio";
  const REPO = "cgeosoft/portfolio";
  const CACHE_KEY = `${SLUG}_latest_release_v3`;
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const CONSENT_KEY = `${SLUG}_cookie_consent_v1`;

  // Release assets follow <slug>_<version>_<platform>.<ext> (scripts/release.sh).
  const ASSETS = {
    windows: { installer: [/_x64_setup\.exe$/i, (v) => `${SLUG}_${v}_x64_setup.exe`], portable: [/_windows-x64_portable\.zip$/i, (v) => `${SLUG}_${v}_windows-x64_portable.zip`] },
    macos: { installer: [/_universal\.dmg$/i, (v) => `${SLUG}_${v}_universal.dmg`], portable: [/_macos-universal\.zip$/i, (v) => `${SLUG}_${v}_macos-universal.zip`] },
    linux: { installer: [/_amd64\.deb$/i, (v) => `${SLUG}_${v}_amd64.deb`], portable: [/_linux-x64\.tar\.gz$/i, (v) => `${SLUG}_${v}_linux-x64.tar.gz`] },
  };
  const LABELS = {
    windows: { name: "Windows", ext: ".exe" },
    macos: { name: "macOS", ext: ".dmg" },
    linux: { name: "Linux", ext: ".deb" },
  };
  const LINKS = {
    windows: { installer: ".download-link-win", portable: ".download-link-win-portable" },
    macos: { installer: ".download-link-mac", portable: ".download-link-mac-zip" },
    linux: { installer: ".download-link-linux", portable: ".download-link-linux-tar" },
  };

  // Resolved release: { version, files: { os: { installer: {url, size}, portable } } }
  let release = null;

  function detectOS() {
    const nav = window.navigator;
    const probe = `${(nav.userAgentData && nav.userAgentData.platform) || ""} ${nav.platform || ""} ${nav.userAgent || ""}`.toLowerCase();
    if (probe.includes("win")) return "windows";
    if (probe.includes("mac") || probe.includes("iphone") || probe.includes("ipad")) return "macos";
    return "linux";
  }

  let activeOS = detectOS();
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fileFor(os, kind) {
    return release && release.files[os] && release.files[os][kind];
  }

  function render() {
    const label = LABELS[activeOS];
    const file = fileFor(activeOS, "installer");
    const btn = $("#primary-download-btn");
    if (btn) {
      btn.href = file ? file.url : "#downloads";
      btn.dataset.os = activeOS;
    }
    const title = $("#download-title");
    if (title) title.textContent = `Download for ${label.name}`;
    const meta = $("#download-meta");
    if (meta) {
      const parts = [label.ext];
      if (release) parts.unshift(`v${release.version}`);
      if (file && file.size) parts.push(`${Math.round(file.size / 1048576)} MB`);
      meta.textContent = parts.join(" · ");
    }
    $$(".os-switch").forEach((el) => el.classList.toggle("active", el.dataset.targetOs === activeOS));
    $$(".dl-row").forEach((row) => row.classList.toggle("is-detected", row.id === `card-${activeOS}`));
    Object.keys(LINKS).forEach((os) => {
      Object.keys(LINKS[os]).forEach((kind) => {
        const f = fileFor(os, kind);
        $$(LINKS[os][kind]).forEach((el) => (el.href = f ? f.url : "#downloads"));
      });
    });
    if (release) {
      $$(".latest-version-text").forEach((el) => (el.textContent = `Latest: v${release.version}.`));
      $$(".footer-version").forEach((el) => (el.textContent = `v${release.version}`));
    }
  }

  // Normalise either the GitHub API response or /releases/latest.json.
  function normalise(data) {
    if (!data) return null;
    const version = String(data.tag_name || data.version || "").replace(/^v/, "");
    if (!version) return null;
    const assets = Array.isArray(data.assets) ? data.assets : null;
    const files = {};
    Object.keys(ASSETS).forEach((os) => {
      files[os] = {};
      Object.keys(ASSETS[os]).forEach((kind) => {
        const [pattern, fallbackName] = ASSETS[os][kind];
        let entry = null;
        if (assets) {
          const a = assets.find((x) => pattern.test(x.name));
          if (a) entry = { url: a.browser_download_url, size: a.size };
        } else if (data.files && data.files[os] && data.files[os][kind]) {
          entry = data.files[os][kind];
        }
        files[os][kind] = entry && entry.url ? entry : { url: `https://github.com/${REPO}/releases/download/v${version}/${fallbackName(version)}` };
      });
    });
    return { version, files };
  }

  async function loadRelease() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.data && cached.data.files) {
        release = cached.data;
        return render();
      }
    } catch (err) {}

    const sources = [
      [`https://api.github.com/repos/${REPO}/releases/latest`, { Accept: "application/vnd.github.v3+json" }],
      ["/releases/latest.json", { Accept: "application/json" }],
    ];
    for (const [url, headers] of sources) {
      try {
        const res = await fetch(url, { headers, cache: "no-cache" });
        if (!res.ok) continue;
        const data = normalise(await res.json());
        if (!data) continue;
        release = data;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (err) {}
        return render();
      } catch (err) {}
    }
  }

  function initLightbox() {
    const trigger = $("#shot-zoom");
    const box = $("#shot-lightbox");
    if (!trigger || !box || typeof box.showModal !== "function") return;
    trigger.addEventListener("click", () => {
      box.showModal();
      track("screenshot_zoomed");
    });
    box.addEventListener("click", () => box.close());
  }

  // Hero demo: the demo portfolio value counts up while the chart draws, then
  // the assistant card types a rotating set of example suggestions. The
  // figures are made up for the demo; reduced motion shows the final state.
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DEMO_MESSAGES = [
    ["Daily brief 08:00", "Portfolio up 1.2% yesterday, led by NVDA at +3.4%. Cash sits at 8.3% of the total."],
    ["Suggestion", "NVDA is 15.6% of the portfolio, and two of your ETFs hold it too. Real exposure is closer to 19%."],
    ["Upcoming", "AAPL goes ex-dividend on Friday. Expected income this month is 12% above last year."],
    ["Weekly report", "The portfolio beat its benchmark by 0.8% this week. Tech weight rose to 41%."],
  ];

  function initDemo() {
    const valueEl = $("#demo-value");
    const gainEl = $("#demo-gain");
    const tagEl = $("#demo-tag");
    const msgEl = $("#demo-msg");
    if (!valueEl || !msgEl || reducedMotion) return;

    const target = 84449.99;
    const fmt = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
    const start = performance.now() + 300;
    const duration = 2600;
    function count(now) {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      valueEl.textContent = fmt.format(12000 + (target - 12000) * eased);
      if (gainEl) gainEl.textContent = (9.91 * eased).toFixed(2);
      if (t < 1) requestAnimationFrame(count);
    }
    requestAnimationFrame(count);

    let index = 0;
    function type() {
      const [tag, text] = DEMO_MESSAGES[index];
      if (tagEl) tagEl.textContent = tag;
      msgEl.textContent = "";
      msgEl.classList.add("typing");
      let i = 0;
      const timer = setInterval(() => {
        msgEl.textContent = text.slice(0, ++i);
        if (i < text.length) return;
        clearInterval(timer);
        msgEl.classList.remove("typing");
        index = (index + 1) % DEMO_MESSAGES.length;
        setTimeout(type, 4500);
      }, 24);
    }
    setTimeout(type, 2400);
  }

  // Analytics: PostHog loads opted out; nothing is sent until the visitor accepts.
  function consent(value) {
    try {
      if (value) localStorage.setItem(CONSENT_KEY, value);
      return localStorage.getItem(CONSENT_KEY);
    } catch (err) {
      return null;
    }
  }

  function track(name, props) {
    try {
      if (window.posthog && consent() === "accepted") window.posthog.capture(name, props || {});
    } catch (err) {}
  }

  function setAnalytics(on) {
    consent(on ? "accepted" : "declined");
    try {
      if (!window.posthog) return;
      if (on) {
        window.posthog.opt_in_capturing();
        window.posthog.capture("$pageview");
      } else {
        window.posthog.opt_out_capturing();
      }
    } catch (err) {}
  }

  function initCookieBanner() {
    const stored = consent();
    if (stored) return setAnalytics(stored === "accepted");

    const banner = document.createElement("div");
    banner.className = "cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<div class="cookie-banner-title">Analytics?</div>' +
      "<p>With your OK, PostHog counts anonymous page views and download clicks. No personal data. " +
      '<a href="/terms/#cookie-policy">Cookie policy</a>.</p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn" data-choice="no">Decline</button>' +
      '<button type="button" class="btn btn-primary" data-choice="yes">Accept</button>' +
      "</div>";
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("visible"));
    banner.addEventListener("click", (event) => {
      const choice = event.target instanceof Element && event.target.getAttribute("data-choice");
      if (!choice) return;
      setAnalytics(choice === "yes");
      banner.classList.remove("visible");
      setTimeout(() => banner.remove(), 300);
    });
  }

  function init() {
    render();
    $$(".os-switch").forEach((el) =>
      el.addEventListener("click", () => {
        activeOS = el.dataset.targetOs;
        render();
      })
    );
    $$("#primary-download-btn, .dl-row a").forEach((el) =>
      el.addEventListener("click", () => track("download_clicked", { os: el.dataset.os || activeOS, type: el.dataset.type || "installer" }))
    );
    $$("#current-year").forEach((el) => (el.textContent = String(new Date().getFullYear())));
    initLightbox();
    initDemo();
    initCookieBanner();
    loadRelease();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
