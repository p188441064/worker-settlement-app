import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef4f8",
          100: "#d8e6ef",
          700: "#17405c",
          800: "#12334a",
          900: "#0b2537"
        },
        mint: {
          50: "#effcf8",
          100: "#d8f6ee",
          500: "#24b99a",
          600: "#18947d"
        }
      },
      boxShadow: {
        ledger: "0 8px 24px rgba(11, 37, 55, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
