import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hironori-oi.github.io/ccmux-ide/"),
  title: {
    default: "ccmux-ide — Claude Code を、デスクトップで、美しく。",
    template: "%s | ccmux-ide",
  },
  description:
    "Tauri 2 で構築された、日本語話者向けの汎用 Claude Code デスクトップクライアント。おしゃれな UI、ローカル永続化、ゼロ設定。",
  applicationName: "ccmux-ide",
  authors: [{ name: "hironori-oi" }],
  keywords: [
    "Claude Code",
    "Claude",
    "ccmux",
    "ccmux-ide",
    "Tauri",
    "Desktop",
    "日本語",
    "IDE",
  ],
  openGraph: {
    title: "ccmux-ide — Claude Code を、デスクトップで、美しく。",
    description:
      "Tauri 2 で構築された、日本語話者向けの汎用 Claude Code デスクトップクライアント。",
    type: "website",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "ccmux-ide",
    description: "日本語話者のための、おしゃれな Claude Code デスクトップクライアント。",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <ThemeProvider>
          <a href="#main" className="skip-nav">
            本文にスキップ
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
