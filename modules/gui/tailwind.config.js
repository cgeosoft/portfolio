/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Brand pink ramp from docs/theme.md.
        accent: {
          DEFAULT: "#DD3C73",
          rgb: "221, 60, 115",
          200: "#f5abc5",
          300: "#ee84aa",
          400: "#e65f8e",
          500: "#DD3C73",
          600: "#c72d65",
          700: "#b32053",
          // Pink for text on the current canvas: lighter in dark, deeper in light.
          bright: "rgb(var(--accent-bright-rgb, 245 171 197) / <alpha-value>)",
        },
        // Surfaces and palette from index.css tokens; each follows the theme,
        // so components never need a hardcoded dark hex.
        canvas: "rgb(var(--bg-canvas-rgb, 7 9 14) / <alpha-value>)",
        widget: "rgb(var(--bg-widget-rgb, 19 23 34) / <alpha-value>)",
        card: "rgb(var(--bg-card-rgb, 24 29 43) / <alpha-value>)",
        line: "rgb(var(--border-rgb, 30 41 59) / <alpha-value>)",
        mint: "rgb(var(--palette-mint-rgb, 167 226 192) / <alpha-value>)",
        cream: "rgb(var(--palette-cream-rgb, 227 234 205) / <alpha-value>)",
        royal: {
          DEFAULT: "rgb(var(--palette-blue-rgb, 36 60 143) / <alpha-value>)",
          bright: "rgb(var(--palette-blue-bright-rgb, 109 139 247) / <alpha-value>)",
        },
        plum: {
          DEFAULT: "rgb(var(--palette-purple-rgb, 139 92 246) / <alpha-value>)",
          bright: "rgb(var(--palette-purple-bright-rgb, 168 85 247) / <alpha-value>)",
        },
        slate: {
          50: "rgb(var(--color-slate-50) / <alpha-value>)",
          100: "rgb(var(--color-slate-100) / <alpha-value>)",
          200: "rgb(var(--color-slate-200) / <alpha-value>)",
          300: "rgb(var(--color-slate-300) / <alpha-value>)",
          400: "rgb(var(--color-slate-400) / <alpha-value>)",
          500: "rgb(var(--color-slate-500) / <alpha-value>)",
          600: "rgb(var(--color-slate-600) / <alpha-value>)",
          700: "rgb(var(--color-slate-700) / <alpha-value>)",
          800: "rgb(var(--color-slate-800) / <alpha-value>)",
          900: "rgb(var(--color-slate-900) / <alpha-value>)",
          950: "rgb(var(--color-slate-950) / <alpha-value>)",
        },
        emerald: {
          400: "rgb(var(--color-emerald-400) / <alpha-value>)",
          500: "rgb(var(--color-emerald-500) / <alpha-value>)",
          600: "rgb(var(--color-emerald-600) / <alpha-value>)",
          800: "rgb(var(--color-emerald-800) / <alpha-value>)",
          950: "rgb(var(--color-emerald-950) / <alpha-value>)",
        },
        rose: {
          400: "rgb(var(--color-rose-400) / <alpha-value>)",
          500: "rgb(var(--color-rose-500) / <alpha-value>)",
          600: "rgb(var(--color-rose-600) / <alpha-value>)",
          800: "rgb(var(--color-rose-800) / <alpha-value>)",
          950: "rgb(var(--color-rose-950) / <alpha-value>)",
        },
        status: {
          success: "var(--status-success)",
          error: "var(--status-error)",
          warning: "var(--status-warning)",
          info: "var(--status-info)",
        },
      },
      fontFamily: {
        // `font-sans` on <body> must resolve to the bundled Plus Jakarta Sans;
        // otherwise the utility beats the @layer base rule and the app falls
        // back to the system font (DejaVu Sans on Linux).
        sans: ['"Plus Jakarta Sans"', "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas"],
      },
    },
  },
  plugins: [],
};
