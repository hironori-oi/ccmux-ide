import Link from "next/link";
import { Github } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-zinc-100 transition hover:text-brand-fg"
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand to-brand-muted text-sm text-white shadow-[0_0_20px_-6px_theme(colors.brand.glow)]"
          >
            ◆
          </span>
          <span className="text-base">
            ccmux<span className="text-brand-fg">-ide</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="hidden rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:text-zinc-100 sm:inline-block"
          >
            Home
          </Link>
          <Link
            href="/docs"
            className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:text-zinc-100"
          >
            Docs
          </Link>
          <a
            href="https://github.com/hironori-oi/ccmux-ide"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:text-zinc-100"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
