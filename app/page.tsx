import Link from "next/link";
import { Command, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Welcome Wizard Step 1 — アプリ起動直後の第一印象画面。
 *
 * DEC-023 で確定した 3 ステップ onboarding の最初のカード。shadcn/ui Card +
 * Geist Sans + framer-motion（後述の fade-in）で Linear / Arc 水準の静かな第一
 * 印象を狙う。
 */
export default function Welcome() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-8">
      <Card className="w-full max-w-2xl space-y-8 p-12 shadow-lg">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            ccmux-ide へようこそ
          </h1>
          <p className="text-lg text-muted-foreground">
            日本語ファーストで、組織運営に特化した Claude Code クライアント
          </p>
        </div>

        <div className="space-y-4">
          <Feature
            icon={<Command className="h-5 w-5" aria-hidden />}
            title="1. API Key を設定"
            desc="Anthropic の API Key または OAuth でログインします"
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="2. 権限を確認"
            desc="ファイル読み取り / 実行権限を明示的に確認します"
          />
          <Feature
            icon={<RotateCcw className="h-5 w-5" aria-hidden />}
            title="3. サンプルプロジェクトで試す"
            desc="node-hello / python-hello が同梱されています"
          />
        </div>

        <Link href="/setup" className="block">
          <Button size="lg" className="w-full">
            始める
          </Button>
        </Link>
      </Card>
    </main>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-md border bg-card/50 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
