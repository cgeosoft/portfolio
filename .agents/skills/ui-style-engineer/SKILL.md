---
name: ui-style-engineer
description: Maintain the Tailwind CSS styling, the tactical cyberpunk design system, color tokens, typography, responsive layout, and compiled stylesheet. Use for CSS issues, theme changes, color palette updates, or Tailwind configuration changes.
---

# UI Style Engineer

## Stack and rules

- Tailwind CSS 3.4 (`tailwindcss` 3.4). There is no `tailwind.config.js` content split; the theme uses CSS custom properties defined in `src/views/src/input.css`.
- Monospace identity using `JetBrains Mono` for numbers, tickers, and tables. `Inter` is used for prose.
- Design tokens live as CSS variables in `input.css` and are referenced by utility surfaces such as `.cx-card`.
- The compiled stylesheet is `src/views/style.css`. Regenerate it with `bun run build:css` (or `bun run watch:css` while developing).

## Design system tokens

- **Backgrounds**: `#0b0f19` (Canvas / `--background`), `#111726` (Widget / `--background-widget`), `#151d30` (Card / `--background-card`).
- **Borders**: `#1e293b` (`--border`); accent border `#DD3C73` (`--border-accent`).
- **Primary Accent**: `#DD3C73` Cyber Pink (`--accent`, `--accent-rgb`).
- **Status Colors**: `#A7E2C0` Positive/Mint (`--status-success`), `#DD3C73` Negative/Error (`--status-error`), `#E3EACD` Warning (`--status-warning`), `#243C8F` Info Blue (`--status-info`).
- **Text**: `#f8fafc` (`--text-main`), `#94a3b8` (`--text-muted`).
- **Palette**: `--palette-purple #341B83`, `--palette-pink #DD3C73`, `--palette-cream #E3EACD`, `--palette-mint #A7E2C0`, `--palette-blue #243C8F`.

## Repo layout

- `src/views/src/input.css` - Source Tailwind stylesheet:
  - `@tailwind base; @tailwind components; @tailwind utilities;` directives.
  - `@layer base` with color-scheme, CSS custom properties, font stack, and custom scrollbar styling.
  - Shared surface classes such as `.cx-card` and `.custom-scrollbar`.
- `src/views/style.css` - Compiled output generated from `input.css`. Do not hand-edit it.
- `tailwind.config.js` - Tailwind configuration.
- `src/views/` - The webview UI that consumes these styles.

## Conventions

- Add or change Tailwind utility classes only in `.tsx` files and CSS in `input.css`.
- Reuse existing design tokens instead of hardcoding new hex values where possible.
- After changing Tailwind classes or CSS, run `bun run build:css` and confirm the compiled `src/views/style.css` updates.

## Gotchas and pitfalls

- Never hand-edit the compiled `src/views/style.css`; edit `input.css` and rebuild.
- Keep dark mode as the default (`color-scheme: dark`). Ensure select, option, and scrollbar styling stays legible on dark surfaces.
- Verify responsive behavior because the app is a desktop webview with a maximizable window.
- Run `bun run typecheck` if you touch `.tsx` files and commit your change per the release workflow.