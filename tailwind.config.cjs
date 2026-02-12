/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/renderer/**/*.{vue,ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "Apple Color Emoji",
          "Segoe UI Emoji",
          "Segoe UI Symbol",
        ],
      },
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#2d8cf0",
          600: "#1d74d9",
          700: "#155bb1",
          800: "#134b8a",
          900: "#123e6f",
        },
      },
      boxShadow: {
        soft: "var(--rs-shadow-soft)",
        glass: "var(--rs-shadow-glass)",
      },
      keyframes: {
        floatIn: {
          "0%": { opacity: "0", transform: "translateY(6px) scale(.99)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        floatIn: "floatIn 180ms ease-out",
      },
    },
  },
  plugins: [],
};
