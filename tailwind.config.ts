import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--brand) / <alpha-value>)",
        // Colors are CSS variables so a store's checkout can re-theme them (see lib/theme.ts)
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", soft: "rgb(var(--ink-soft) / <alpha-value>)", faint: "rgb(var(--ink-faint) / <alpha-value>)" },
        paper: { DEFAULT: "rgb(var(--paper) / <alpha-value>)", raised: "rgb(var(--surface) / <alpha-value>)", sunk: "rgb(var(--paper-sunk) / <alpha-value>)" },
        surface: "rgb(var(--surface) / <alpha-value>)",
        rule: { DEFAULT: "rgb(var(--rule) / <alpha-value>)", strong: "rgb(var(--rule-strong) / <alpha-value>)" },
        btn: { DEFAULT: "rgb(var(--btn, var(--brand)) / <alpha-value>)", fg: "rgb(var(--btn-fg, 255 255 255) / <alpha-value>)" },
        night: { DEFAULT: "#0E1714", soft: "#15211D", line: "#22312C", text: "#C9D3CF", faint: "#7F8F89" },
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
