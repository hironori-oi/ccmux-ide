"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDialogStore } from "@/lib/stores/dialog";

/**
 * PRJ-012 v4 / Chunk C / DEC-028: `/help` で開かれるコマンド一覧ダイアログ。
 *
 * Claude Code の組込 slash 7 件 + ユーザー定義 slash（`.claude/commands/`）の
 * 配置と発見ルールを日本語で解説する。素人〜中級者の「何が叩けるか分からない」
 * を最初に解消するためのリファレンスで、UI からは `/help` 入力のみで開く。
 */

interface BuiltinDoc {
  name: string;
  description: string;
}

const BUILTIN_DOCS: readonly BuiltinDoc[] = [
  { name: "/mcp", description: "MCP サーバ設定（Global / Project の .mcp.json）を GUI で編集します。" },
  { name: "/clear", description: "現在のチャットセッションを消去します（履歴 DB は残ります）。" },
  { name: "/model", description: "使用するモデル（Opus / Sonnet / Haiku）を切替えます。" },
  { name: "/init", description: "現在のワークスペースに CLAUDE.md 雛形を生成します（既存ファイルがあれば警告）。" },
  { name: "/help", description: "このヘルプを開きます。" },
  { name: "/compact", description: "会話履歴の圧縮（Agent SDK 側 API 待ち、v4 で対応予定）。" },
  { name: "/config", description: "アプリの設定画面（外観 / API Key / キーバインド / MCP）を開きます。" },
];

export function HelpDialog() {
  const open = useDialogStore((s) => s.helpOpen);
  const close = useDialogStore((s) => s.closeHelp);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>コマンドヘルプ</DialogTitle>
          <DialogDescription>
            入力欄で <code className="rounded bg-muted px-1 py-0.5 text-xs">/</code> を打つとパレットが開きます。
            Ctrl/Cmd+Enter で送信。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">組込コマンド</h3>
            <ul className="space-y-2">
              {BUILTIN_DOCS.map((d) => (
                <li
                  key={d.name}
                  className="flex flex-col gap-0.5 rounded border border-border/40 bg-muted/30 px-3 py-2"
                >
                  <code className="text-xs font-semibold text-primary">{d.name}</code>
                  <span className="text-xs text-muted-foreground">{d.description}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">ユーザー定義コマンド</h3>
            <p className="text-xs text-muted-foreground">
              次のいずれかのフォルダに <code className="rounded bg-muted px-1 py-0.5">name.md</code>{" "}
              を置くと、入力欄の <code className="rounded bg-muted px-1 py-0.5">/</code> パレットで{" "}
              <code className="rounded bg-muted px-1 py-0.5">/name</code> として現れます。優先度は近いスコープが上です。
            </p>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-start gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">Cwd</span>
                <span className="text-muted-foreground">
                  作業中のフォルダから上方向（最大 5 階層）の{" "}
                  <code className="rounded bg-muted px-1 py-0.5">.claude/commands/*.md</code>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">Project</span>
                <span className="text-muted-foreground">
                  選択中プロジェクトの{" "}
                  <code className="rounded bg-muted px-1 py-0.5">.claude/commands/*.md</code>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">Global</span>
                <span className="text-muted-foreground">
                  ホームの{" "}
                  <code className="rounded bg-muted px-1 py-0.5">~/.claude/commands/*.md</code>
                </span>
              </li>
            </ul>
            <p className="text-[11px] text-muted-foreground">
              ファイル冒頭に YAML frontmatter（<code className="rounded bg-muted px-1 py-0.5">description</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5">argument-hint</code>）を書くと、パレットでの説明と引数 placeholder を制御できます。
            </p>
          </section>

          <section className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">主なショートカット</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Ctrl/Cmd + Enter</kbd>{" "}
                送信
              </li>
              <li>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">/</kbd>{" "}
                コマンドパレットを開く
              </li>
              <li>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Ctrl/Cmd + V</kbd>{" "}
                クリップボードの画像を添付
              </li>
              <li>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Esc</kbd>{" "}
                パレットを閉じる
              </li>
            </ul>
          </section>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
