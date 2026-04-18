import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tauri は file:// で frontend を読み込むため static export が必須
  output: "export",
  // Tauri webview では next/image の最適化サーバが動かない
  images: { unoptimized: true },
  trailingSlash: true,
  // 不要な fs-event モジュールを除外 (WebView2 / WebKit で動かない)
  webpack: (config) => {
    config.externals = [...(config.externals || []), "fsevents"];
    return config;
  },
};

export default nextConfig;
