"use client";

import { motion } from "framer-motion";
import { Feather, KeyRound, Zap } from "lucide-react";

const pillars = [
  {
    icon: Feather,
    title: "Tauri 2 による軽量・ネイティブ",
    body: "Electron ではなく Tauri 2。Rust バックエンドと OS ネイティブ WebView で、起動は速く、メモリは軽く、バイナリは小さい。",
  },
  {
    icon: KeyRound,
    title: "OS keyring で API Key を安全保管",
    body: "Windows Credential Manager / macOS Keychain / Linux Secret Service に暗号化保存。プレーンテキストの設定ファイルに書き出しません。",
  },
  {
    icon: Zap,
    title: "設定ファイル不要、起動即使える",
    body: "Welcome Wizard が 4 ステップで完了。Claude Max / Pro プランの認証情報は自動検出。API Key 派も OK。",
  },
];

export function WhyPillars() {
  return (
    <section className="border-b border-zinc-800/60 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            なぜ Sumi なのか。
          </h2>
          <p className="mt-4 text-zinc-400">
            速さ、安全性、ゼロ設定。毎日使う道具だから、細部に妥協しない。
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {pillars.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.06 }}
                className="relative rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-900/20 p-7"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand-fg">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-100">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{p.body}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
