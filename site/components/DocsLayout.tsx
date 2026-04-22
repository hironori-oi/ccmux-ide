import type { ReactNode } from "react";
import { DocsSidebar } from "./DocsSidebar";

type TOCItem = { id: string; label: string };

export function DocsLayout({
  children,
  toc,
}: {
  children: ReactNode;
  toc?: TOCItem[];
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        <aside className="hidden lg:block">
          <DocsSidebar />
        </aside>

        <main className="min-w-0">
          <article className="docs-article">{children}</article>
        </main>

        <aside className="hidden lg:block">
          {toc && toc.length > 0 && (
            <nav aria-label="On this page" className="sticky top-20 text-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                このページ
              </p>
              <ul className="space-y-1.5 border-l border-zinc-800 pl-4">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block text-zinc-500 transition hover:text-zinc-200"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      </div>

      <div className="mt-10 lg:hidden">
        <DocsSidebar />
      </div>
    </div>
  );
}
