import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A near-black glass base. High contrast text on low-alpha panels is what
        // keeps the overlay readable over an arbitrary desktop background.
        glass: {
          DEFAULT: "rgba(12,14,20,0.72)",
          strong: "rgba(12,14,20,0.90)",
          edge: "rgba(255,255,255,0.09)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          muted: "rgb(var(--color-accent-muted) / <alpha-value>)",
          deep: "rgb(var(--color-accent-deep) / <alpha-value>)",
        },
        warn: "#fbbf24",
        danger: "#f87171",
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Text", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Consolas", "monospace"],
      },
      animation: {
        "fade-up": "fadeUp 160ms cubic-bezier(0.16,1,0.3,1)",
        "pulse-soft": "pulseSoft 1.8s ease-in-out infinite",
        "typewriter-cursor": "typewriterBlink 0.6s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        pulseSoft: {
          "0%,100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
        typewriterBlink: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
} satisfies Config;
