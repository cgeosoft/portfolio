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
        // Brand pink ramp from docs/theme.md; the numbered shades replace the
        // indigo-* utilities used by the Assistant look.
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
        status: {
          success: "#A7E2C0",
          error: "#DD3C73",
          warning: "#E3EACD",
          info: "#243C8F",
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas"],
      },
    },
  },
  plugins: [],
};
