import Link from "next/link";
import { Logo, Wordmark } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-sumi-ash/60 bg-sumi-ink py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2 text-sumi-paper">
              <Logo size={22} className="text-sumi-paper" />
              <Wordmark height={16} className="text-sumi-paper" />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-sumi-mist">
              Claude Code を、墨でしたためる。
              <br />
              日本語話者のための、静謐で濃密なデスクトップクライアント。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div>
              <h4 className="font-medium text-sumi-paper">Product</h4>
              <ul className="mt-3 space-y-2 text-sumi-mist">
                <li>
                  <Link href="/" className="hover:text-sumi-paper">
                    Home
                  </Link>
                </li>
                <li>
                  <Link href="/docs" className="hover:text-sumi-paper">
                    Docs
                  </Link>
                </li>
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide/releases/latest"
                    className="hover:text-sumi-paper"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Releases
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-sumi-paper">Community</h4>
              <ul className="mt-3 space-y-2 text-sumi-mist">
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide"
                    className="hover:text-sumi-paper"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/hironori-oi/ccmux-ide/issues"
                    className="hover:text-sumi-paper"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Issues
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-sumi-paper">Legal</h4>
              <ul className="mt-3 space-y-2 text-sumi-mist">
                <li>MIT License</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-sumi-ash/60 pt-6 text-xs text-sumi-ash">
          <p>
            Claude and Anthropic are trademarks of Anthropic, PBC. Sumi is an
            unofficial community project and is not affiliated with, endorsed
            by, or sponsored by Anthropic.
          </p>
          <p className="mt-2">
            © {new Date().getFullYear()} Sumi contributors. Released under the
            MIT License.
          </p>
        </div>
      </div>
    </footer>
  );
}
