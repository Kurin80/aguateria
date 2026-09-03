/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6f7",
          100: "#d4e8eb",
          700: "#1b6b93",
          800: "#0f4c5c",
          900: "#0a3340",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
