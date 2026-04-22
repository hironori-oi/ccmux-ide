import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-zinc-800/60 bg-zinc-950 py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2 text-zinc-100">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand to-brand-muted text-xs text-white">
                ◆
              </span>
              <span className="font-semibold">
                ccmux<span className="text-brand-fg">-ide</span>
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              日本語話者のための、おしゃれな Claude Code デスクトップクライアント。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div>
              <h4 className="font-medium text-zinc-300">Product</h4>
              <ul className="mt-3 space-y-2 text-zinc-500">
                <li>
                  <Link href="/" className="hover:text-zinc-200">
                    Home
                  </Link>
                </li>
                <li>
                  <Link href="/docs" className="hover:text-zinc-200">
                    Docs
                  </Link>
                </li>
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide/releases/latest"
                    className="hover:text-zinc-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Releases
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-zinc-300">Community</h4>
              <ul className="mt-3 space-y-2 text-zinc-500">
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide"
                    className="hover:text-zinc-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide/issues"
                    className="hover:text-zinc-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Issues
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-zinc-300">Legal</h4>
              <ul className="mt-3 space-y-2 text-zinc-500">
                <li>MIT License</li>
                <li>
                  Based on{" "}
                  <a
                    href="https://github.com/Shin-sibainu/ccmux"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-zinc-200"
                  >
                    ccmux by @Shin-sibainu
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-zinc-800/60 pt-6 text-xs text-zinc-600">
          <p>
            Claude and Anthropic are trademarks of Anthropic, PBC. ccmux-ide is an
            unofficial community project and is not affiliated with, endorsed by, or
            sponsored by Anthropic.
          </p>
          <p className="mt-2">
            © {new Date().getFullYear()} ccmux-ide contributors. Released under the MIT
            License.
          </p>
        </div>
      </div>
    </footer>
  );
}
