import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AppearanceInit } from "@/components/theme/AppearanceInit";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sumi",
  description: "Claude Code を、墨でしたためる。日本語ファーストの汎用 Claude Code デスクトップクライアント。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* PM-870 (v3.5.16): localStorage の appearance を起動時に DOM へ反映。
              /settings を一度も開かないと背景画像が適用されないバグの修正。 */}
          <AppearanceInit />
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
