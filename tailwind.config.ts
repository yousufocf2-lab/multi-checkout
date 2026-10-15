import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--brand) / <alpha-value>)",
        ink: { DEFAULT: "#1C2430", soft: "#475467", faint: "#7A8494" },
        paper: { DEFAULT: "#F4F5F2", raised: "#FFFFFF", sunk: "#ECEEEA" },
        rule: { DEFAULT: "#E2E5E0", strong: "#CDD2CB" },
        pine: { DEFAULT: "#0B5D4B", dark: "#08473A", tint: "#E3F0EB" },
        series: { prepaid: "#2a78d6", cod: "#eb6834", ads: "#1baf7a" },
        good: "#1A7F37",
        warn: "#B54708",
        bad: "#C4320A",
      },
      fontFamily: {
        sans: ['"Instrument Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        lift: "0 1px 2px rgba(28,36,48,.06), 0 8px 24px -12px rgba(28,36,48,.18)",
      },
      keyframes: {
        bar: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(250%)" } },
        fadein: { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        bar: "bar 1.1s cubic-bezier(.4,0,.2,1) infinite",
        fadein: "fadein .2s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
