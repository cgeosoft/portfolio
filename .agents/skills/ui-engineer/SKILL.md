---
name: ui-engineer
description: Styling and design system: CSS or Tailwind setup, colour tokens, typography, shared surface classes, responsive layout and theme consistency. Use for CSS issues, visual styling, theme or token changes.
---

# UI Engineer

## Overview

Keeps the visual layer consistent: stylesheet entry point, design tokens, typography, shared surfaces and the CSS build.

## When to Use

- CSS or Tailwind changes, new utilities or shared surfaces.
- Palette, token, font, theme, layout or responsive issues.

## General Instructions

- Reuse tokens; a new colour needs a token, not an inline hex, plus an `-rgb` sibling where `rgba()` consumes it.
- Utilities in the template or component; CSS rules only for repeated patterns, custom properties, keyframes, pseudo-elements or media queries.
- One stylesheet entry per project. Never edit compiled CSS.
- After a class or token change run the CSS build (when one exists) and confirm the output changed; a class without a rule does nothing.
- Keep dark surfaces legible: selects, scrollbars, focus states, breakpoints.
- Grep the old value when changing a token so every copy moves.

## Project Instructions

- Tailwind CSS 3.4 with `modules/gui/tailwind.config.js`; tokens are CSS custom properties in `modules/gui/src/index.css`, shared with Assistant (dark navy canvas, indigo accent `#6366f1`, `Plus Jakarta Sans` body, `JetBrains Mono` numbers). Vite compiles the CSS; no separate build step.
- `JetBrains Mono` for numbers, tickers and tables; `Inter` for prose. Dark default (`color-scheme: dark`).
- Tokens: canvas `#0b0f19` (`--background`), widget `#111726`, card `#151d30`; border `#1e293b`; primary accent Cyber Pink `#DD3C73` (`--accent`, `--accent-rgb`); status mint `#A7E2C0` success, `#DD3C73` error, `#E3EACD` warning, `#243C8F` info; text `#f8fafc` main, `#94a3b8` muted.
- `input.css`: `@tailwind` directives, `@layer base` with color-scheme, custom properties, font stack, scrollbar; shared surfaces `.cx-card`, `.custom-scrollbar`.
- Utility classes in `.tsx`, CSS in `index.css`. Keep `.app-menubar`, `.app-menu*` and the footer identical to Assistant; no `backdrop-filter` on scrolling surfaces (software-rendered WebKitGTK).
