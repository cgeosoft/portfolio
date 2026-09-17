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
        mono: ['"JetBrains Mono"', "monospace", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas"],
      },
    },
  },
  plugins: [],
};
