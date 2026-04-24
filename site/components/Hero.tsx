"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Github } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-sumi-ash/60">
      <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" aria-hidden />

      {/* v1.19.0 移行バナー（DEC-065）: v1.20.0 で撤去予定 */}
      <div
        role="status"
        className="border-b border-amber-500/30 bg-amber-500/10 text-amber-100"
      >
        <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 text-sm sm:px-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden />
          <p className="leading-relaxed">
            <span className="font-medium text-amber-100">既存ユーザーの方へ: </span>
            v1.18.2 以前をお使いの場合、v1.19.0 への自動更新は行われません。
            <a
              href="https://github.com/hironori-oi/ccmux-ide/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="ml-1 underline underline-offset-2 hover:text-amber-50"
            >
              GitHub Release ページ
            </a>
            から installer を手動ダウンロードして上書きインストールしてください。v1.19.0 以降は自動更新が正常動作します。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:py-40">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand-fg">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-fg" aria-hidden />
            Tauri 2 + Next.js 15 + shadcn/ui
          </div>

          <h1 className="text-balance text-4xl font-bold tracking-tight text-sumi-paper sm:text-5xl md:text-6xl">
            Claude Code を、
            <br className="hidden sm:inline" />
            墨でしたためる。
          </h1>

          <p className="mt-6 max-w-2xl text-lg font-light leading-relaxed text-sumi-mist sm:text-xl">
            Tauri 2 で構築された、日本語話者のための汎用 Claude Code デスクトップクライアント。
            <br className="hidden sm:inline" />
            墨の哲学で仕上げた、静謐で濃密な開発環境。
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/getting-started"
              className="group inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_32px_-8px_theme(colors.brand.glow)] transition hover:bg-brand/90"
            >
              はじめる
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="https://github.com/hironori-oi/ccmux-ide"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-sumi-ash bg-sumi-charcoal/60 px-5 py-2.5 text-sm font-medium text-sumi-paper transition hover:border-sumi-mist/40 hover:bg-sumi-charcoal"
            >
              <Github className="h-4 w-4" />
              GitHub を見る
            </a>
          </div>

          <p className="mt-8 font-mono text-xs text-sumi-mist/70">
            <span className="inline-code">Windows · macOS · Linux</span>{" "}
            <span className="ml-2 text-sumi-ash">MIT License</span>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
