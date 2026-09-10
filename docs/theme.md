# Portfolio Theme & Design System Specification

## Overview

Portfolio uses a **Tactical Cyberpunk / Dark Mode Financial Terminal** design system. The interface balances high data density with visual hierarchy, using a dark navy canvas (`#0b0f19`), a high-contrast Cyber Pink primary accent (`#DD3C73`), and semantic status colors anchored by Mint (`#A7E2C0`) and Royal Blue (`#243C8F`).

This document defines the canonical color tokens, semantic usage, asset category palettes, typography, and chart rendering guidelines across the desktop application (`src/views/`) and the marketing website (`extras/website/`).

---

## 1. Core Color Tokens

### Surface & Background Tokens

| CSS Variable | Hex | RGB | Purpose |
| :--- | :--- | :--- | :--- |
| `--background` | `#0b0f19` | `11, 15, 25` | Base window canvas & deep background |
| `--background-widget` | `#111726` | `17, 23, 38` | Primary widget panels, modal containers, and section wrappers |
| `--background-card` | `#151d30` | `21, 29, 48` | Elevated cards, stat boxes, table rows, and nested containers |
| `--border` | `#1e293b` | `30, 41, 59` | Subtle structural borders and dividing lines |
| `--border-accent` | `#DD3C73` | `221, 60, 115` | High-emphasis borders, active tabs, dropzone focus rings |

### Brand & Accent Tokens

| CSS Variable | Hex | RGB | Purpose |
| :--- | :--- | :--- | :--- |
| `--accent` | `#DD3C73` | `221, 60, 115` | **Primary brand accent**: primary buttons, hero highlights, active states |
| `--accent-rgb` | `221, 60, 115` | — | RGB tuple for alpha channels (e.g. `rgba(var(--accent-rgb), 0.12)`) |
| `--border-accent` | `#DD3C73` | `221, 60, 115` | Active focus rings and highlighted card borders |

### Semantic Status Tokens

| CSS Variable | Hex | RGB | Semantic Role |
| :--- | :--- | :--- | :--- |
| `--status-success` | `#A7E2C0` | `167, 226, 192` | Positive P&L gains, total portfolio valuation curve, cash balances |
| `--status-error` | `#DD3C73` | `221, 60, 115` | Negative returns, critical alerts, destructive actions |
| `--status-warning` | `#E3EACD` | `227, 234, 205` | Cautions, unallocated cash notices, neutral alerts |
| `--status-info` | `#243C8F` | `36, 60, 143` | Informational badges, neutral status indicators |

### Text Tokens

| CSS Variable | Hex | Purpose |
| :--- | :--- | :--- |
| `--text-main` | `#f8fafc` | High-contrast primary text, headers, and currency values |
| `--text-muted` | `#94a3b8` | Secondary labels, descriptions, and table headers |
| `--text-dim` | `#64748b` | Muted timestamps, subtle borders, and cost basis baselines |

---

## 2. Tactical 5-Color Asset & Allocation Palette

Used in the asset allocation doughnut chart (`AllocationCard.tsx`) and category badges:

| Asset Class | Token Name | Base Hex | Palette Shades (Dark to Light) |
| :--- | :--- | :--- | :--- |
| **Stocks** | `--palette-blue` | `#243C8F` | `#1b2e6e`, `#243C8F`, `#324ca8`, `#3b5fc7`, `#4e6bd4`, `#597dec`, `#6582e8`, `#7898f5` |
| **ETFs** | `--palette-purple` | `#341B83` | `#24135e`, `#341B83`, `#41219e`, `#4e29c2`, `#5a32cc`, `#673be0`, `#7c55e8`, `#865ef5` |
| **Crypto** | `--palette-pink` | `#DD3C73` | `#b32053`, `#c72d65`, `#da4b81`, `#DD3C73`, `#e65f8e`, `#ee84aa`, `#f5abc5` |
| **Cash** | `--palette-mint` | `#A7E2C0` | `#3fa56c`, `#55b87f`, `#6ecf97`, `#8ad9ab`, `#A7E2C0`, `#bdebd2` |
| **Other** | `--palette-cream` | `#E3EACD` | `#9cb16b`, `#b0c283`, `#c4d39e`, `#d5dfb8`, `#E3EACD`, `#edf2de` |

---

## 3. Chart Visual Language (`PortfolioChartCard.tsx`)

When rendering historical performance curves:

- **Total Value (including Cash)**: `#A7E2C0` (Mint, 2px dashed line: `borderDash: [5, 4]`). Represents the total consolidated equity of the investor.
- **Invested Value**: `#DD3C73` (Cyber Pink, 2px solid line with `rgba(221, 60, 115, 0.12)` area fill). Represents market value of invested holdings.
- **Cost Basis**: `#64748b` (Slate Gray, 1.5px dashed line: `borderDash: [4, 4]`). Represents total capital deposited/purchased.
- **Return % Curve**: `#6d8bf7` (Royal Blue tint, 1.5px solid line on right Y-axis). Zero return line drawn at `#6d8bf7` with `0.45` opacity.

---

## 4. Typography

### Primary Monospace: `JetBrains Mono`
Used for all quantitative metrics, currency formatting, ticker symbols, table data, terminal logs, and system badges.

```css
font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

### UI Body Font: `Inter`
Used for landing page prose, navigation items, explanatory text, and dialog bodies.

```css
font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

---

## 5. Glow, Gradient, and Card Effects

### Ambient Hero Glow
Combines the Cyber Pink accent with deep indigo and royal blue:
```css
background: radial-gradient(
  circle at 50% 12%,
  rgba(221, 60, 115, 0.16) 0%,
  rgba(52, 27, 131, 0.14) 35%,
  rgba(36, 60, 143, 0.08) 55%,
  transparent 75%
);
```

### Primary Button Glow (`--accent-glow`)
```css
box-shadow: 0 0 20px rgba(221, 60, 115, 0.32);
```

### Cyberpunk Glassmorphic Card (`.cx-card`)
```css
.cx-card {
  background-color: var(--background-widget);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.5);
  transition: all 0.2s ease-in-out;
}

.cx-card:hover {
  border-color: rgba(var(--accent-rgb), 0.4);
}
```
