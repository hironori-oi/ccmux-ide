"use client";

import { Keyboard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * Week 6 Chunk 3 / PM-213: キーバインド表示（read-only）。
 *
 * shadcn `Table` は `components/ui/` に未導入のため、シンプルな `<table>` +
 * Tailwind で読みやすく整形。編集対応（ユーザーカスタム）は M3 PM-171 の
 * DEC 決定後に実装予定。
 */

interface Binding {
  shortcut: string;
  action: string;
  status?: "available" | "planned";
}

const BINDINGS: Binding[] = [
  { shortcut: "Ctrl+K", action: "コマンドパレットを開く", status: "available" },
  { shortcut: "Ctrl+V", action: "画像を貼り付け", status: "available" },
  { shortcut: "Ctrl+Enter", action: "メッセージを送信", status: "available" },
  { shortcut: "Ctrl+Shift+F", action: "会話を検索", status: "planned" },
  { shortcut: "/", action: "スラッシュコマンド", status: "available" },
];

export function KeybindingsSettings() {
  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">キーボードショートカット</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          現在の割当一覧（読み取り専用）。カスタム編集は M3 以降で対応予定。
        </p>
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  ショートカット
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  動作
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  状態
                </th>
              </tr>
            </thead>
            <tbody>
              {BINDINGS.map((b) => (
                <tr key={b.shortcut} className="border-t">
                  <td className="px-3 py-2">
                    <kbd className="rounded border bg-background px-2 py-0.5 font-mono text-xs shadow-sm">
                      {b.shortcut}
                    </kbd>
                  </td>
                  <td className="px-3 py-2">{b.action}</td>
                  <td className="px-3 py-2">
                    {b.status === "planned" ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Week 7 で実装予定
                      </Badge>
                    ) : (
                      <Badge className="text-[10px]">有効</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
