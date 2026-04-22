import type { Config } from "tailwindcss";

/**
 * Sumi (墨) design tokens.
 *
 * The full color system is documented in `public/brand/BRAND.md`.
 * The 70/20/10 rule applies: 70% sumi / 20% paper / 10% orange.
 * Orange is CTA + focus only, never decoration.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ===== Sumi core (墨色 / grayscale, warm-leaning) =====
        sumi: {
          ink: "hsl(220 8% 6%)",        // #0c0e12 - 背景基調
          charcoal: "hsl(220 6% 12%)",   // #191c21 - 1段上の面
          ash: "hsl(220 5% 22%)",        // #33363d - ボーダー / かすれ
          mist: "hsl(30 8% 70%)",        // #b2aca2 - 文字 secondary
          paper: "hsl(30 15% 94%)",      // #f3eee7 - 和紙ベージュ
        },

        // ===== Claude Orange accent (LOCKED — unchanged across modes) =====
        brand: {
          DEFAULT: "hsl(18 55% 50%)",
          fg: "hsl(18 80% 60%)",
          muted: "hsl(18 40% 40%)",
          glow: "hsl(18 80% 55% / 0.35)",
        },

        // ===== Status =====
        enso: "hsl(45 70% 55%)",         // 成功 / 完了 (gold-leaning)
        chigiri: "hsl(0 60% 50%)",       // 破壊 / エラー
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        // Used for Japanese display headings where a "more Japanese" feel
        // is wanted. Per BRAND.md, solve with tracking, never with serif.
        wabi: "0.2em",
      },
      boxShadow: {
        // Max-allowed elevation per brand rule
        sumi: "0 4px 12px rgba(0, 0, 0, 0.3)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
