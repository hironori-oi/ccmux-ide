"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Github } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-800/60">
      <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" aria-hidden />

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

          <h1 className="text-balance text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl md:text-6xl">
            Claude Code を、
            <br className="hidden sm:inline" />
            デスクトップで、
            <span className="text-brand-fg">美しく。</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg font-light leading-relaxed text-zinc-400 sm:text-xl">
            Tauri 2 で構築された、日本語話者向けの汎用 Claude Code デスクトップクライアント。
            <br className="hidden sm:inline" />
            おしゃれな UI、ローカル永続化、ゼロ設定。ただ起動するだけ。
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
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <Github className="h-4 w-4" />
              GitHub を見る
            </a>
          </div>

          <p className="mt-8 font-mono text-xs text-zinc-500">
            <span className="inline-code">Windows · macOS · Linux</span>{" "}
            <span className="ml-2 text-zinc-600">MIT License</span>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
