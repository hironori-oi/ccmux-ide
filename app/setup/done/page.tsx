import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Welcome Wizard Step 3 — 完了画面（stub）。
 *
 * M1 以降はここで「サンプルプロジェクトを開く」「既存フォルダを開く」を選ぶ。
 */
export default function Done() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-8">
      <Card className="w-full max-w-2xl space-y-8 p-12 text-center shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="h-8 w-8" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">セットアップ完了</h1>
          <p className="text-muted-foreground">
            さあ、チャットを始めましょう。
          </p>
        </div>
        <Link href="/workspace" className="block">
          <Button size="lg" className="w-full">
            ワークスペースを開く
          </Button>
        </Link>
      </Card>
    </main>
  );
}
