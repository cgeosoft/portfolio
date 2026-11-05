---
name: ui-engineer
description: "Styling and design system: Tailwind setup, colour tokens, fonts, shared surface classes, light and dark themes, responsive layout. Use it for CSS issues, visual styling, theme or token changes."
trimmedAt: 2026-11-05
---

# UI Engineer

## Setup

- Tailwind CSS 4 through `@tailwindcss/postcss`. Vite compiles the CSS. There is no separate CSS build and no `tailwind.config.js`.
- `modules/gui/src/index.css` is the only stylesheet entry. It has the `@theme inline` block, the tokens in `@layer base` and the shared classes.
- Tokens are CSS custom properties. Dark is the default. `html.light` and the system light preference select the light palette.
- The accent is Cyber Pink `#DD3C73` (`--accent`, `--accent-rgb`). Read all other values in `index.css`. `docs/theme.md` is older than `index.css`.
- Fonts: `Plus Jakarta Sans` for text, `JetBrains Mono` for numbers, tickers and tables.
- Shared classes: `.cx-card`, `.custom-scrollbar`, `.glass-panel`, `.app-menubar`, `.app-menu*`, the footer styles.

## Rules

- Use the tokens. A new colour needs a token, not an inline hex. Add an `-rgb` token too when `rgba()` uses it.
- Write utility classes in the `.tsx` file. Write CSS rules in `index.css` only for repeated patterns, custom properties, keyframes, pseudo-elements or media queries.
- Put custom component classes in `@layer utilities`, so they keep the Tailwind 3 order. A `hover:` or `sm:` variant that must win over one of them needs the `!` suffix.
- Do not use `backdrop-filter` on surfaces that scroll. WebKitGTK renders them in software.
- Keep dark and light surfaces legible: selects, scrollbars, focus states, breakpoints.
- When you change a token value, search for the old value and change each copy.
- Do not edit compiled CSS.
