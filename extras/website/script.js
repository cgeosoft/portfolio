/**
 * Marketing site script: OS detection, download links from the latest
 * release and opt-in PostHog analytics. The screenshot tour is tour.js, the
 * evidence graph is graph.js.
 */
(function () {
  "use strict";

  const SLUG = "portfolio";
  const REPO = "cgeosoft/portfolio";
  const CACHE_KEY = `${SLUG}_latest_release_v3`;
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const OLD_CONSENT_KEY = `${SLUG}_cookie_consent_v1`;
  const CONSENT_KEY = `${SLUG}_consent_v2`;
  // Raise this with PRIVACY_NOTICE_VERSION in modules/shared/src/brand.ts. Add an
  // event or a property only with a change to privacy/index.html.
  const NOTICE_VERSION = 1;
  const ANALYTICS_EVENTS = ["page_view", "download_clicked", "screenshot_zoomed"];
  const ANALYTICS_PROPERTIES = [
    "token", "distinct_id", "$lib", "$lib_version", "$insert_id", "$time", "$process_person_profile",
    "$geoip_disable", "site", "consent_version", "os", "type",
  ];

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

  // Analytics: PostHog loads only after the visitor accepts. Before that, the
  // page makes no request to it. deploy.sh writes the key into the meta tag.
  const POSTHOG_SCRIPT = "https://eu-assets.i.posthog.com/static/array.js";
  let posthogLoading = null;
  let consentChoice = null;

  function posthogKey() {
    const meta = $('meta[name="posthog-key"]');
    const key = meta ? meta.content : "";
    return /^phc_/.test(key) && key !== "phc_PLACEHOLDER" ? key : "";
  }

  function loadPostHog() {
    if (posthogLoading) return posthogLoading;
    posthogLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = POSTHOG_SCRIPT;
      script.async = true;
      script.onload = () => {
        window.posthog.init(posthogKey(), {
          api_host: "https://eu.i.posthog.com",
          persistence: "localStorage",
          person_profiles: "identified_only",
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          rageclick: false,
          capture_dead_clicks: false,
          capture_heatmaps: false,
          capture_exceptions: false,
          capture_performance: false,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_feature_flags: true,
          disable_external_dependency_loading: true,
          before_send: allowEvent,
        });
        window.posthog.register({ site: SLUG, consent_version: NOTICE_VERSION, $geoip_disable: true });
        resolve();
      };
      script.onerror = reject;
      document.head.append(script);
    });
    posthogLoading.catch(() => {
      posthogLoading = null;
    });
    return posthogLoading;
  }

  /** The last step before a send. Events and fields that are not listed go. */
  function allowEvent(event) {
    if (!event || !ANALYTICS_EVENTS.includes(event.event)) return null;
    const properties = {};
    ANALYTICS_PROPERTIES.forEach((key) => {
      if (key in event.properties) properties[key] = event.properties[key];
    });
    const { $set, $set_once, ...rest } = event;
    return { ...rest, properties };
  }

  /** A choice for an older notice does not count, so the banner shows again. */
  function readConsent() {
    try {
      localStorage.removeItem(OLD_CONSENT_KEY);
      const saved = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
      if (saved && saved.version === NOTICE_VERSION) return saved.value;
    } catch (err) {}
    return null;
  }

  function saveConsent(value, source) {
    consentChoice = value;
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: new Date().toISOString(), source, version: NOTICE_VERSION }));
    } catch (err) {}
  }

  /** Removes the PostHog ID, also from the cookie that earlier versions set. */
  function clearPostHogData() {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("ph_") || key.startsWith("__ph_"))
        .forEach((key) => localStorage.removeItem(key));
      document.cookie
        .split("; ")
        .map((cookie) => cookie.split("=")[0])
        .filter((name) => name.startsWith(`ph_${posthogKey()}`))
        .forEach((name) => {
          document.cookie = `${name}=; max-age=0; path=/`;
          document.cookie = `${name}=; max-age=0; path=/; domain=.${location.hostname.split(".").slice(-2).join(".")}`;
        });
    } catch (err) {}
  }

  function track(name, props) {
    if (!posthogLoading || consentChoice !== "accepted") return;
    posthogLoading.then(() => window.posthog.capture(name, props || {})).catch(() => {});
  }

  function setAnalytics(value, source) {
    saveConsent(value, source);
    if (value === "accepted") {
      loadPostHog()
        .then(() => {
          window.posthog.opt_in_capturing();
          track("page_view");
        })
        .catch(() => {});
    } else {
      if (window.posthog && window.posthog.opt_out_capturing) window.posthog.opt_out_capturing();
      clearPostHogData();
    }
  }

  function openBanner(source) {
    if ($(".cookie-banner")) return;
    const banner = document.createElement("div");
    banner.className = "cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Analytics choice");
    const state = consentChoice === "accepted" ? "Analytics are on. " : consentChoice === "declined" ? "Analytics are off. " : "";
    banner.innerHTML =
      '<div class="cookie-banner-title">Analytics?</div>' +
      `<p>${state}With your OK, PostHog records page views, download clicks and screenshot zooms with a random ID. ` +
      '<a href="/privacy/">Privacy Notice</a>.</p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn" data-choice="declined">Decline</button>' +
      '<button type="button" class="btn" data-choice="accepted">Accept</button>' +
      "</div>";
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("visible"));
    banner.addEventListener("click", (event) => {
      const choice = event.target instanceof Element && event.target.getAttribute("data-choice");
      if (!choice) return;
      setAnalytics(choice, source);
      banner.classList.remove("visible");
      setTimeout(() => banner.remove(), 300);
    });
  }

  function initAnalytics() {
    // The app shows the Terms in a frame. Its privacy choices are in the app, not here.
    if (!posthogKey() || window.self !== window.top) return;
    $$("[data-analytics-choice]").forEach((el) => {
      el.hidden = false;
      el.addEventListener("click", () => openBanner("settings"));
    });
    consentChoice = readConsent();
    if (consentChoice === "accepted") loadPostHog().then(() => track("page_view")).catch(() => {});
    else if (!consentChoice) openBanner("setup");
  }

  window.portfolioAnalytics = { track };

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
    initAnalytics();
    loadRelease();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
