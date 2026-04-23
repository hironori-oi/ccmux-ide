import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AppearanceInit } from "@/components/theme/AppearanceInit";
import { PermissionProvider } from "@/components/providers/PermissionProvider";
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
          {/* PRJ-012 v1.13.0 (DEC-059 案B): 未許可ツール実行の承認ダイアログ。
              sidecar → Rust → `sumi://permission-request` event を listen し、
              session-preferences の allowedTools / deniedTools と突合して
              auto-resolve または dialog 表示で捌く。ルートに 1 箇所のみマウント。 */}
          <PermissionProvider />
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
