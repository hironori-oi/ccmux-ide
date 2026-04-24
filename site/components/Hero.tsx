"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, ExternalLink, Github } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-sumi-ash/60">
      <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" aria-hidden />

      {/* v1.19.0 移行バナー（DEC-065）
          v1.20.1: 文言 + CTA を刷新。既存ユーザーが Releases に直接飛べる
          Button を追加（同梱の自動更新は v1.18.2 以前では動かないため、
          LP からの手動 DL を主導線にする）。 */}
      <div
        role="status"
        className="border-b border-amber-500/30 bg-amber-500/10 text-amber-100"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:px-6">
          <div className="flex flex-1 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden />
            <p className="leading-relaxed">
              <span className="font-medium text-amber-100">既存ユーザーの方へ: </span>
              v1.18.2 以前をお使いの場合、最新版への自動更新は行われません。下のボタンから installer を手動ダウンロードして上書きインストールしてください。以降は自動更新が正常動作します。
            </p>
          </div>
          <a
            href="https://github.com/hironori-oi/ccmux-ide/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-none items-center justify-center gap-2 self-start rounded-md border border-amber-300/60 bg-amber-500/20 px-4 py-1.5 text-xs font-medium text-amber-50 transition hover:bg-amber-500/30 sm:self-auto"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            GitHub Releases を開く
          </a>
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
