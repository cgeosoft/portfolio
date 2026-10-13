/**
 * Interactive screenshot tour. Mounts on every [data-tour] element and reads
 * /assets/tour/tour.json, which `bun run website:screenshots` writes from the
 * running app. Each screen shows numbered markers; clicking one spotlights its
 * region and opens a popover with a sharp crop and a short description.
 * Clicking it again, clicking the screenshot or pressing Escape closes it.
 *
 * Options on the element: data-tour-hash (follow and set location.hash, for
 * the /tour/ page).
 */
(function () {
  "use strict";

  const DATA_URL = "/assets/tour/tour.json";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = window.matchMedia("(max-width: 760px)");

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") Object.assign(node.style, value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const ICONS = {
    expand: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  function iconButton(cls, icon, label) {
    const button = h("button", { type: "button", class: cls, "aria-label": label, title: label });
    button.innerHTML = ICONS[icon];
    return button;
  }

  class Tour {
    constructor(root, data) {
      this.root = root;
      this.screens = data.screens;
      this.aspect = data.width / data.height;
      this.useHash = root.hasAttribute("data-tour-hash");
      this.screen = -1;
      this.spot = -1;
      this.shots = new Map();
      this.build();
      this.bind();
      const fromHash = this.useHash ? this.screens.findIndex((s) => `#${s.id}` === window.location.hash) : -1;
      this.show(Math.max(0, fromHash), { instant: true });
      root.classList.add("is-ready");
    }

    build() {
      const root = this.root;
      root.querySelectorAll(".tour-fallback").forEach((el) => el.remove());

      this.tabs = h("div", { class: "tour-tabs", role: "tablist", "aria-label": "Screens" });
      this.tabButtons = this.screens.map((screen, i) =>
        this.tabs.appendChild(
          h("button", { type: "button", class: "tour-tab", role: "tab", id: `tour-tab-${screen.id}`, "aria-selected": "false", tabindex: "-1", "data-index": i }, [
            h("span", { class: "tour-tab-num mono", text: pad2(i + 1) }),
            h("span", { text: screen.label }),
            h("span", { class: "tour-tab-bar", "aria-hidden": "true" }),
          ])
        )
      );
      this.ink = this.tabs.appendChild(h("span", { class: "tour-tab-ink", "aria-hidden": "true" }));

      this.canvas = h("div", { class: "tour-canvas" });
      this.spotlight = this.canvas.appendChild(h("div", { class: "tour-spotlight", "aria-hidden": "true" }));
      this.markers = this.canvas.appendChild(h("div", { class: "tour-markers" }));
      this.glow = h("div", { class: "tour-glow", "aria-hidden": "true" });

      this.prevButton = iconButton("tour-ctrl", "prev", "Previous");
      this.nextButton = iconButton("tour-ctrl", "next", "Next");
      this.expandButton = iconButton("tour-ctrl", "expand", "View this screen full size");
      this.hint = h("p", { class: "tour-hint mono", "aria-hidden": "true", text: "Click a marker" });

      this.frame = h("div", { class: "tour-frame", style: { aspectRatio: String(this.aspect) } }, [
        this.canvas,
        this.hint,
        h("div", { class: "tour-ctrls" }, [this.prevButton, this.nextButton, this.expandButton]),
      ]);

      this.popImage = h("img", { alt: "", decoding: "async" });
      this.popStep = h("p", { class: "tour-pop-step mono" });
      this.popTitle = h("h3", { class: "tour-pop-title" });
      this.popText = h("p", { class: "tour-pop-text" });
      this.popClose = iconButton("tour-pop-close", "close", "Close");
      this.pop = h("div", { class: "tour-pop", role: "dialog", "aria-modal": "false", "aria-label": "Feature detail" }, [
        h("div", { class: "tour-pop-media" }, [this.popImage]),
        h("div", { class: "tour-pop-body" }, [this.popStep, this.popTitle, this.popText]),
        this.popClose,
      ]);

      this.stage = h("div", { class: "tour-stage", role: "tabpanel" }, [this.glow, this.frame, this.pop]);

      this.title = h("h3", { class: "tour-title" });
      this.text = h("p", { class: "tour-text" });
      this.list = h("ol", { class: "tour-list" });
      this.info = h("div", { class: "tour-info" }, [h("div", { class: "tour-info-copy" }, [this.title, this.text]), this.list]);

      root.append(this.tabs, this.stage, this.info);

      this.lightbox = h("dialog", { class: "lightbox", "aria-label": "Screenshot, full size" }, [h("img", { alt: "" })]);
      document.body.appendChild(this.lightbox);
    }

    bind() {
      this.tabs.addEventListener("click", (event) => {
        const tab = event.target.closest(".tour-tab");
        if (tab) this.show(Number(tab.dataset.index));
      });
      this.tabs.addEventListener("keydown", (event) => {
        const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (event.key === "Home" || event.key === "End" || delta) {
          event.preventDefault();
          const n = this.screens.length;
          const next = event.key === "Home" ? 0 : event.key === "End" ? n - 1 : (this.screen + delta + n) % n;
          this.show(next);
          this.tabButtons[next].focus({ preventScroll: true });
        }
      });

      // A marker opens its detail; the same marker or the screenshot closes it.
      this.canvas.addEventListener("click", (event) => {
        const marker = event.target.closest(".tour-marker");
        if (!marker) return this.close();
        const index = Number(marker.dataset.index);
        if (index === this.spot) this.close();
        else this.setSpot(index);
      });
      this.list.addEventListener("click", (event) => {
        const item = event.target.closest("button");
        if (!item) return;
        const index = Number(item.dataset.index);
        if (index === this.spot) this.close();
        else this.setSpot(index);
      });
      this.popClose.addEventListener("click", () => this.close());

      this.root.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.spot >= 0) {
          event.preventDefault();
          this.close();
          return;
        }
        const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!delta || event.target.closest(".tour-tabs")) return;
        event.preventDefault();
        this.step(delta);
      });

      this.prevButton.addEventListener("click", () => this.step(-1));
      this.nextButton.addEventListener("click", () => this.step(1));
      this.expandButton.addEventListener("click", () => this.openLightbox());
      this.lightbox.addEventListener("click", () => this.lightbox.close());

      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            this.root.classList.add("is-revealed");
            observer.disconnect();
          },
          { threshold: 0.25 }
        );
        observer.observe(this.stage);
      } else {
        this.root.classList.add("is-revealed");
      }

      let resizeFrame = 0;
      window.addEventListener("resize", () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          this.moveInk();
          this.placePop();
        });
      });
      if (this.useHash) {
        window.addEventListener("hashchange", () => {
          const index = this.screens.findIndex((s) => `#${s.id}` === window.location.hash);
          if (index >= 0 && index !== this.screen) this.show(index);
        });
      }
    }

    /** Next or previous hotspot, across screens. */
    step(delta) {
      const spots = this.screens[this.screen].hotspots.length;
      const next = this.spot < 0 ? (delta > 0 ? 0 : spots - 1) : this.spot + delta;
      if (next >= 0 && next < spots) return this.setSpot(next);
      const n = this.screens.length;
      const screen = (this.screen + (delta > 0 ? 1 : -1) + n) % n;
      this.show(screen, { spot: delta > 0 ? 0 : this.screens[screen].hotspots.length - 1 });
    }

    shotFor(index) {
      let img = this.shots.get(index);
      if (!img) {
        const screen = this.screens[index];
        img = h("img", { class: "tour-shot", src: screen.image, alt: `${screen.label}: ${screen.title}`, decoding: "async", draggable: "false" });
        this.canvas.insertBefore(img, this.spotlight);
        this.shots.set(index, img);
      }
      return img;
    }

    show(index, options) {
      const opts = options || {};
      const screen = this.screens[index];
      const previous = this.shots.get(this.screen);
      const changed = index !== this.screen;
      this.close();
      this.screen = index;

      this.tabButtons.forEach((tab, i) => {
        const active = i === index;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.classList.toggle("is-active", active);
      });
      this.stage.setAttribute("aria-labelledby", this.tabButtons[index].id);
      this.moveInk();

      const shot = this.shotFor(index);
      if (changed) {
        this.shots.forEach((img) => img.classList.remove("is-active", "is-leaving"));
        if (previous && previous !== shot && !opts.instant) previous.classList.add("is-leaving");
        shot.classList.add("is-active");
      }
      // The next screen loads in the background.
      this.shotFor((index + 1) % this.screens.length);

      this.markers.replaceChildren(
        ...screen.hotspots.map((spot, i) =>
          h(
            "button",
            {
              type: "button",
              class: "tour-marker",
              "data-index": i,
              "aria-label": `${pad2(i + 1)} ${spot.title}`,
              "aria-expanded": "false",
              style: { left: `${spot.x}%`, top: `${spot.y}%`, animationDelay: `${opts.instant ? 0 : 200 + i * 70}ms` },
            },
            [h("span", { text: String(i + 1) })]
          )
        )
      );
      this.list.replaceChildren(
        ...screen.hotspots.map((spot, i) =>
          h("li", {}, [h("button", { type: "button", "data-index": i }, [h("span", { class: "mono", text: pad2(i + 1) }), h("span", { text: spot.title })])])
        )
      );

      this.title.textContent = screen.title;
      this.text.textContent = screen.text;
      this.info.classList.remove("is-swapping");
      void this.info.offsetWidth;
      this.info.classList.add("is-swapping");

      screen.hotspots.forEach((spot) => {
        const preload = new Image();
        preload.src = spot.image;
      });

      if (this.useHash && !opts.instant && window.location.hash !== `#${screen.id}`) {
        window.history.replaceState(null, "", `#${screen.id}`);
      }

      if (opts.spot !== undefined) {
        clearTimeout(this.switchTimer);
        this.switchTimer = setTimeout(() => this.screen === index && this.setSpot(opts.spot), reducedMotion ? 0 : 380);
      }
    }

    setSpot(index) {
      const screen = this.screens[this.screen];
      const spot = screen.hotspots[index];
      if (!spot) return;
      this.spot = index;
      this.root.classList.add("has-spot");

      this.markers.querySelectorAll(".tour-marker").forEach((m, i) => {
        m.classList.toggle("is-active", i === index);
        m.setAttribute("aria-expanded", String(i === index));
      });
      this.list.querySelectorAll("button").forEach((b, i) => b.classList.toggle("is-active", i === index));
      this.tabButtons[this.screen].style.setProperty("--fill", String((index + 1) / screen.hotspots.length));

      const box = spot.box;
      Object.assign(this.spotlight.style, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` });
      this.spotlight.classList.add("is-on");
      this.glow.style.left = `${box.x + box.w / 2}%`;
      this.glow.style.top = `${box.y + box.h / 2}%`;

      this.pop.classList.remove("is-in");
      void this.pop.offsetWidth;
      this.popImage.src = spot.image;
      this.popImage.width = spot.width;
      this.popImage.height = spot.height;
      this.popImage.alt = `${spot.title}, close up`;
      this.popStep.textContent = `${pad2(index + 1)} / ${pad2(screen.hotspots.length)}`;
      this.popTitle.textContent = spot.title;
      this.popText.textContent = spot.text;
      this.pop.classList.toggle("is-wide", spot.width / spot.height > 2.6);
      this.pop.classList.toggle("is-tall", spot.width / spot.height < 0.9);
      this.placePop();
      this.pop.classList.add("is-in");
    }

    close() {
      if (this.spot < 0) return;
      this.spot = -1;
      this.root.classList.remove("has-spot");
      this.pop.classList.remove("is-in");
      this.spotlight.classList.remove("is-on");
      this.markers.querySelectorAll(".tour-marker").forEach((m) => {
        m.classList.remove("is-active");
        m.setAttribute("aria-expanded", "false");
      });
      this.list.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      const tab = this.tabButtons[this.screen];
      if (tab) tab.style.setProperty("--fill", "0");
    }

    /** Puts the popover beside the highlighted region, inside the frame. On narrow screens CSS places it. */
    placePop() {
      const spot = this.spot >= 0 && this.screens[this.screen].hotspots[this.spot];
      if (!spot) return;
      if (narrow.matches) {
        this.pop.style.left = "";
        this.pop.style.top = "";
        this.pop.dataset.side = "below";
        return;
      }
      const W = this.frame.clientWidth;
      const H = this.frame.clientHeight;
      const box = spot.box;
      const left = (box.x / 100) * W;
      const right = ((box.x + box.w) / 100) * W;
      const top = (box.y / 100) * H;
      const bottom = ((box.y + box.h) / 100) * H;
      const pw = this.pop.offsetWidth;
      const ph = this.pop.offsetHeight;
      const gap = 18;
      const edge = 12;

      let x;
      let y;
      let side;
      if (right + gap + pw <= W - edge) {
        x = right + gap;
        side = "right";
      } else if (left - gap - pw >= edge) {
        x = left - gap - pw;
        side = "left";
      }
      if (side) {
        y = clamp(top, edge, H - ph - edge);
      } else {
        x = clamp((left + right) / 2 - pw / 2, edge, W - pw - edge);
        if (bottom + gap + ph <= H - edge) {
          y = bottom + gap;
          side = "below";
        } else if (top - gap - ph >= edge) {
          y = top - gap - ph;
          side = "above";
        } else {
          y = H - ph - edge;
          side = "over";
        }
      }
      this.pop.style.left = `${Math.round(x)}px`;
      this.pop.style.top = `${Math.round(y)}px`;
      this.pop.dataset.side = side;
    }

    moveInk() {
      const tab = this.tabButtons[this.screen];
      if (!tab) return;
      this.ink.style.width = `${tab.offsetWidth}px`;
      this.ink.style.transform = `translateX(${tab.offsetLeft}px)`;
      // Keep the active tab in view when the tab row scrolls sideways (narrow screens).
      const row = this.tabs;
      if (row.scrollWidth > row.clientWidth) row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    }

    openLightbox() {
      const screen = this.screens[this.screen];
      if (typeof this.lightbox.showModal !== "function") return window.open(screen.image, "_blank", "noopener");
      const img = this.lightbox.querySelector("img");
      img.src = screen.image;
      img.alt = `${screen.label} screen, full size.`;
      this.lightbox.showModal();
      try {
        if (window.posthog && localStorage.getItem("portfolio_cookie_consent_v1") === "accepted") window.posthog.capture("screenshot_zoomed");
      } catch (err) {}
    }
  }

  async function init() {
    const roots = Array.from(document.querySelectorAll("[data-tour]"));
    if (roots.length === 0) return;
    let data;
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) return;
      data = await res.json();
    } catch (err) {
      return; // The fallback screenshot stays.
    }
    if (!data || !Array.isArray(data.screens) || data.screens.length === 0) return;
    roots.forEach((root) => new Tour(root, data));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
