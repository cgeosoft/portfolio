/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/views/**/*.{html,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#DD3C73",
          rgb: "221, 60, 115",
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
