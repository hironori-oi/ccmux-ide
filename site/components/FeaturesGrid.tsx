"use client";

import { motion } from "framer-motion";
import {
  Languages,
  Sparkles,
  Boxes,
  Lock,
  Command,
  GitBranch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const features: Feature[] = [
  {
    icon: Languages,
    title: "日本語ファースト",
    body: "全 UI 日本語化。Windows ネイティブビルドで MS-IME / Google 日本語入力が透過動作。ドキュメントも日本語優先。",
  },
  {
    icon: Sparkles,
    title: "おしゃれな UI",
    body: "shadcn/ui + framer-motion + Geist + lucide-react。Linear / Arc / Raycast 水準の洗練。5 テーマプリセット + 壁紙背景。",
  },
  {
    icon: Boxes,
    title: "Claude Code エコシステム完全対応",
    body: "Slash コマンド（project / global）、Skills、Plugins、MCP（5 スコープ）を自動検出。`.claude/` をそのまま尊重。",
  },
  {
    icon: Lock,
    title: "ローカル永続化 + プライバシー",
    body: "会話履歴は SQLite + FTS5 で端末ローカルのみ。外部送信ゼロ。API Key は OS keyring（Credential Manager / Keychain / Secret Service）。",
  },
  {
    icon: Command,
    title: "コマンドパレット中心の操作",
    body: "Ctrl+K でコマンドパレット、`/` で Slash パレット、Ctrl+Shift+F で FTS5 横断検索。キーボードだけで完結。",
  },
  {
    icon: GitBranch,
    title: "Git worktree × 並列セッション",
    body: "worktree 切替 UI 内蔵。sidecar が cwd 連動で再起動し、ブランチごとに独立した Claude セッションを維持。",
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="border-b border-zinc-800/60 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            必要なものが、ぜんぶ入っている。
          </h2>
          <p className="mt-4 text-zinc-400">
            日本語の UI、洗練された見た目、Claude Code のフル機能、そしてプライバシー。
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.04 }}
                className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition hover:-translate-y-0.5 hover:border-brand/40 hover:bg-zinc-900/70"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand-fg">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-100">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
