import Link from "next/link";
import { Github } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Logo, Wordmark } from "./Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-sumi-ash/60 bg-sumi-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Sumi home"
          className="flex items-center gap-2.5 text-sumi-paper transition hover:text-brand-fg"
        >
          <Logo size={26} className="text-sumi-paper" />
          <Wordmark height={18} className="text-sumi-paper" />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="hidden rounded-md px-3 py-1.5 text-sm text-sumi-mist transition hover:text-sumi-paper sm:inline-block"
          >
            Home
          </Link>
          <Link
            href="/docs"
            className="rounded-md px-3 py-1.5 text-sm text-sumi-mist transition hover:text-sumi-paper"
          >
            Docs
          </Link>
          <a
            href="https://github.com/hironori-oi/ccmux-ide"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-sumi-mist transition hover:text-sumi-paper"
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
