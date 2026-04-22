import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "@/components/Hero";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { CompareTable } from "@/components/CompareTable";
import { WhyPillars } from "@/components/WhyPillars";
import { InstallGrid } from "@/components/InstallGrid";
import { ClosingCTA } from "@/components/ClosingCTA";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <FeaturesGrid />
        <CompareTable />
        <WhyPillars />
        <InstallGrid />
        <ClosingCTA />
      </main>
      <Footer />
    </>
  );
}
