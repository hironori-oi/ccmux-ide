"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/docs", label: "ドキュメント" },
  { href: "/docs/getting-started", label: "クイックスタート" },
  { href: "/docs/features", label: "機能カタログ" },
  { href: "/docs/keybindings", label: "キーバインド" },
  { href: "/docs/architecture", label: "アーキテクチャ" },
];

export function DocsSidebar() {
  const pathname = usePathname();
  const normalized = pathname?.replace(/\/$/, "") || "/docs";

  return (
    <nav aria-label="Docs navigation" className="sticky top-20">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        ガイド
      </p>
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive =
            normalized === item.href ||
            (item.href !== "/docs" && normalized.startsWith(item.href));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={
                  "block rounded-md px-3 py-2 text-sm transition " +
                  (isActive
                    ? "bg-brand/10 font-medium text-brand-fg"
                    : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-100")
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
