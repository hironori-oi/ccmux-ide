import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="min-h-[calc(100vh-3.5rem-1px)]">
        {children}
      </main>
      <Footer />
    </>
  );
}
