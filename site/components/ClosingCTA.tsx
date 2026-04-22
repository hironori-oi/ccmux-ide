import { ArrowUpRight, Star } from "lucide-react";

export function ClosingCTA() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-800/60 py-24 sm:py-32">
      <div className="hero-glow absolute inset-0 -z-10 opacity-70" aria-hidden />
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl md:text-5xl">
          そろそろ、日本語でおしゃれに
          <br />
          Claude Code を動かしませんか？
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-zinc-400">
          OSS、無料、MIT ライセンス。GitHub で ⭐ を押して続報を追いかけてください。
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://github.com/hironori-oi/ccmux-ide"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_32px_-8px_theme(colors.brand.glow)] transition hover:bg-brand/90"
          >
            <Star className="h-4 w-4" />
            GitHub で Star する
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <a
            href="https://github.com/hironori-oi/ccmux-ide/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900"
          >
            Releases を見る
          </a>
        </div>
      </div>
    </section>
  );
}
