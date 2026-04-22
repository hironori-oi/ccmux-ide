import { Apple, Download, Monitor, Computer } from "lucide-react";

const releasesUrl = "https://github.com/hironori-oi/ccmux-ide/releases/latest";

const targets = [
  {
    os: "Windows",
    icon: Computer,
    formats: [".exe", ".msi"],
    note: "SmartScreen が表示されたら「詳細情報 → 実行」で続行。",
  },
  {
    os: "macOS",
    icon: Apple,
    formats: [".dmg"],
    note: "Gatekeeper 警告は「システム設定 → プライバシーとセキュリティ」から許可。",
  },
  {
    os: "Linux",
    icon: Monitor,
    formats: [".AppImage", ".deb"],
    note: "AppImage は `chmod +x` してから実行。deb は `sudo dpkg -i`。",
  },
];

export function InstallGrid() {
  return (
    <section id="install" className="border-b border-zinc-800/60 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            ダウンロード
          </h2>
          <p className="mt-4 text-zinc-400">
            GitHub Releases から OS 別バイナリを取得できます。現時点では未署名配布です。
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {targets.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.os}
                className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-7 transition hover:border-brand/40"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950/60 text-zinc-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold text-zinc-100">{t.os}</h3>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {t.formats.join(" / ")}
                </p>

                <a
                  href={releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90"
                >
                  <Download className="h-4 w-4" />
                  最新版をダウンロード
                </a>

                <p className="mt-4 text-xs leading-relaxed text-zinc-500">
                  SHA256: <span className="inline-code text-xs">TBD</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t.note}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
