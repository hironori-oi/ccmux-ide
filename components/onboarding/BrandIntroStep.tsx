"use client";

import { MessageSquare, Users, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Step 1: ブランド紹介。
 *
 * PRJ-012 の差別化軸（DEC-021）を 3 カードで静かに提示する。
 * - 軸 A: 日本語 UI（カードのキャッチ自体が日本語ネイティブ）
 * - 軸 B: おしゃれ（shadcn Card + Claude オレンジ primary）
 * - 軸 C: 組織運営統合（マルチエージェント並列の価値訴求）
 */
export function BrandIntroStep() {
  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          ccmux-ide でできること
        </h2>
        <p className="text-sm text-muted-foreground">
          日本語で、静かに、Claude と一緒に開発する。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={<MessageSquare className="h-5 w-5" aria-hidden />}
          title="日本語で対話"
          desc="Claude とそのまま日本語で会話できます。"
        />
        <FeatureCard
          icon={<Users className="h-5 w-5" aria-hidden />}
          title="並列エージェント"
          desc="複数のエージェントで開発を加速します。"
        />
        <FeatureCard
          icon={<ImageIcon className="h-5 w-5" aria-hidden />}
          title="画像貼付と差分"
          desc="画像を貼り、差分を見ながら編集できます。"
        />
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </Card>
  );
}
