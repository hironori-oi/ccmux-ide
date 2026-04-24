import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // 日本語 glyph fallback: Linux は fonts-noto-cjk、Windows 11 は Yu Gothic UI、
        // macOS は Hiragino Sans でカバー。豆腐化防止（WSLg WebKitGTK 対応）。
        sans: [
          "var(--font-geist-sans)",
          "Noto Sans CJK JP",
          "Noto Sans JP",
          "Yu Gothic UI",
          "Hiragino Sans",
          "Meiryo",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "Cascadia Code",
          "SF Mono",
          "Noto Sans Mono CJK JP",
          "ui-monospace",
          "monospace",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      // PRJ-012 v1.15.0 (DEC-061): Chat Markdown の prose スタイル微調整。
      // @tailwindcss/typography の `prose` class を AssistantMessage に適用し、
      // table / code / blockquote を Cursor 相当の密度・色に統一する。
      typography: ({ theme }: { theme: (path: string) => string }) => ({
        DEFAULT: {
          css: {
            // リンク: 下線 + primary 色 (外部ブラウザは shell.open 経由で開く)
            a: {
              color: "hsl(var(--primary))",
              textDecoration: "underline",
              textUnderlineOffset: "4px",
              fontWeight: "500",
            },
            // inline code: `foo` のような短い識別子を muted background で強調。
            // before/after のバッククォートは邪魔なので除去。
            "code::before": { content: '""' },
            "code::after": { content: '""' },
            "code:not(pre code)": {
              backgroundColor: "hsl(var(--muted))",
              color: "hsl(var(--foreground))",
              padding: "0.15rem 0.35rem",
              borderRadius: "0.25rem",
              fontWeight: "400",
              fontSize: "0.85em",
            },
            // pre: コードブロックは独自 CodeBlock コンポーネントが描画するため
            // デフォルトの余計な padding / background を抑止して CodeBlock に任せる。
            pre: {
              backgroundColor: "transparent",
              color: "inherit",
              padding: "0",
              margin: "0.5em 0",
              borderRadius: "0",
              overflowX: "auto",
            },
            // blockquote: 左ボーダーのみのシンプルなスタイル
            blockquote: {
              borderLeftColor: "hsl(var(--muted-foreground) / 0.4)",
              color: "hsl(var(--muted-foreground))",
              fontStyle: "normal",
              fontWeight: "400",
              paddingLeft: "0.9rem",
              margin: "0.6em 0",
            },
            "blockquote p:first-of-type::before": { content: '""' },
            "blockquote p:last-of-type::after": { content: '""' },
            // table: GFM parse で生成された th/td を境界線付きで表示。
            // wrapper 側で overflow-x-auto を付与するため table 自体は full-width。
            table: {
              width: "100%",
              fontSize: "0.9em",
              margin: "0.6em 0",
              borderCollapse: "collapse",
            },
            "thead": {
              borderBottomColor: "hsl(var(--border))",
            },
            "thead th": {
              backgroundColor: "hsl(var(--muted) / 0.6)",
              color: "hsl(var(--foreground))",
              fontWeight: "600",
              padding: "0.4rem 0.6rem",
              borderBottom: `1px solid hsl(var(--border))`,
            },
            "tbody tr": {
              borderBottomColor: "hsl(var(--border) / 0.5)",
            },
            "tbody td": {
              padding: "0.35rem 0.6rem",
              borderBottom: `1px solid hsl(var(--border) / 0.4)`,
            },
            // heading: margin を詰めて chat UI に馴染ませる
            "h1, h2, h3, h4": {
              color: "hsl(var(--foreground))",
              marginTop: "0.9em",
              marginBottom: "0.4em",
            },
            h1: { fontSize: "1.3em" },
            h2: { fontSize: "1.18em" },
            h3: { fontSize: "1.08em" },
            h4: { fontSize: "1em" },
            // ul / ol: pl を詰める
            "ul, ol": {
              paddingLeft: "1.3rem",
              margin: "0.4em 0",
            },
            // task list (GFM) のチェックボックスは disabled で描画される。
            // prose デフォルトの list-style を抑止して GFM の rendering を尊重。
            "li > input[type='checkbox']": {
              marginRight: "0.4rem",
            },
            // 段落の上下 margin を詰める
            p: {
              marginTop: "0.4em",
              marginBottom: "0.4em",
              lineHeight: "1.6",
            },
            // hr
            hr: {
              borderColor: "hsl(var(--border))",
              margin: "0.8em 0",
            },
            // img: max-width 100% で吹き出し外に溢れさせない
            img: {
              marginTop: "0.4em",
              marginBottom: "0.4em",
              borderRadius: "0.375rem",
            },
          },
        },
        invert: {
          css: {
            "--tw-prose-body": "hsl(var(--foreground))",
            "--tw-prose-headings": "hsl(var(--foreground))",
            "--tw-prose-links": "hsl(var(--primary))",
            "--tw-prose-bold": "hsl(var(--foreground))",
            "--tw-prose-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-quote-borders": "hsl(var(--muted-foreground) / 0.4)",
            "--tw-prose-code": "hsl(var(--foreground))",
            "--tw-prose-hr": "hsl(var(--border))",
            "--tw-prose-th-borders": "hsl(var(--border))",
            "--tw-prose-td-borders": "hsl(var(--border) / 0.5)",
          },
        },
      }),
    },
  },
  plugins: [tailwindcssAnimate, typography],
};

export default config;
