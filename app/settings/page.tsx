"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Keyboard, Palette, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { ApiKeySettings } from "@/components/settings/ApiKeySettings";
import { KeybindingsSettings } from "@/components/settings/KeybindingsSettings";

/**
 * Week 6 Chunk 3 / PM-210: 設定画面の親ページ。
 *
 * ## 構成
 * - 上部: 戻るボタン（`router.back()`、ワークスペースから遷移した場合の原ページへ）
 * - 本体: shadcn `Tabs` を縦方向の sidebar レイアウトで配置
 *   - Appearance: テーマ / アクセント / フォントサイズ（PM-211）
 *   - API Key: Anthropic キー管理（PM-212）
 *   - Keybindings: ショートカット一覧（PM-213、read-only）
 *
 * ## static export 互換
 * - `"use client"`
 * - `useRouter` は `next/navigation` から
 * - Tauri webview 配下で動くことを前提（Next.js build は static export）
 */
export default function SettingsPage() {
  const router = useRouter();

  return (
    // PM-870: 背景画像 html::before を見せるため bg-background → bg-transparent。
    <div className="flex h-screen flex-col bg-transparent">
      {/* ヘッダ */}
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // 直前の履歴が無い場合（設定を直接開いた時）は /workspace に fallback
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/workspace");
            }
          }}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          戻る
        </Button>
        <h1 className="text-base font-semibold">設定</h1>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Tabs
          defaultValue="appearance"
          orientation="vertical"
          className="flex h-full w-full"
        >
          {/* 左タブ（縦並び） */}
          <TabsList
            className="flex h-full w-56 shrink-0 flex-col items-stretch gap-1 rounded-none border-r bg-muted/30 p-3"
          >
            <TabsTrigger
              value="appearance"
              className="justify-start gap-2 data-[state=active]:bg-background"
            >
              <Palette className="h-4 w-4" aria-hidden />
              外観
            </TabsTrigger>
            <TabsTrigger
              value="api-key"
              className="justify-start gap-2 data-[state=active]:bg-background"
            >
              <KeyRound className="h-4 w-4" aria-hidden />
              API Key
            </TabsTrigger>
            <TabsTrigger
              value="keybindings"
              className="justify-start gap-2 data-[state=active]:bg-background"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              キーバインド
            </TabsTrigger>
            {/* PRJ-012 v4 / Chunk C / DEC-028: MCP サーバ設定への導線。
                Tabs の TabsContent ではなく専用ルート (/settings/mcp) を持たせている
                のは、Monaco Editor を含む重い画面を遅延 load させるため。 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/settings/mcp")}
              className="mt-1 justify-start gap-2 px-3 text-sm font-medium"
            >
              <Plug className="h-4 w-4" aria-hidden />
              MCP
            </Button>
          </TabsList>

          {/* 右コンテンツ */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-8 py-6">
              <TabsContent value="appearance" className="mt-0">
                <SectionHeading
                  title="外観"
                  description="テーマ、アクセントカラー、フォントサイズを調整します。"
                />
                <AppearanceSettings />
              </TabsContent>
              <TabsContent value="api-key" className="mt-0">
                <SectionHeading
                  title="API Key"
                  description="Anthropic API Key の管理（OS の資格情報ストアに保存）。"
                />
                <ApiKeySettings />
              </TabsContent>
              <TabsContent value="keybindings" className="mt-0">
                <SectionHeading
                  title="キーバインド"
                  description="現在のキーボードショートカット（読み取り専用）。"
                />
                <KeybindingsSettings />
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
