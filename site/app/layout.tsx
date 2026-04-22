import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const SITE_URL = "https://hironori-oi.github.io/ccmux-ide/";
const OG_URL = `${SITE_URL}brand/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sumi — Claude Code を、墨でしたためる。",
    template: "%s | Sumi",
  },
  description:
    "Tauri 2 で構築された、日本語話者のための汎用 Claude Code デスクトップクライアント。墨の哲学で仕上げた、静謐で濃密な開発環境。",
  applicationName: "Sumi",
  authors: [{ name: "hironori-oi" }],
  keywords: [
    "Sumi",
    "墨",
    "Claude Code",
    "Claude",
    "ccmux",
    "ccmux-ide",
    "Tauri",
    "Desktop",
    "日本語",
    "IDE",
  ],
  icons: {
    icon: [
      { url: "favicon.ico", sizes: "any" },
      { url: "icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "brand/app-icon-256.png", sizes: "256x256" }],
  },
  openGraph: {
    title: "Sumi — Claude Code を、墨でしたためる。",
    description:
      "Tauri 2 で構築された、日本語話者のための汎用 Claude Code デスクトップクライアント。墨の哲学で仕上げた、静謐で濃密な開発環境。",
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: OG_URL,
        width: 1200,
        height: 630,
        alt: "Sumi — Claude Code を、墨でしたためる。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sumi",
    description:
      "Claude Code を、墨でしたためる。日本語話者のための静謐で濃密なデスクトップクライアント。",
    images: [OG_URL],
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
      <body className="min-h-screen bg-sumi-ink text-sumi-paper antialiased">
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
