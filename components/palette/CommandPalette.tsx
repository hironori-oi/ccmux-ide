"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import {
  FileSearch,
  ImagePlus,
  MessageSquarePlus,
  Moon,
  Settings,
  Sun,
  History,
} from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";
import { useProjectStore } from "@/lib/stores/project";

/**
 * PM-171: Command Palette（Ctrl+K / Cmd+K で起動）。
 *
 * shadcn `Command`（cmdk）を Radix `Dialog` に乗せた、公式の CommandDialog と
 * 同等の合成実装。`components/ui/command.tsx` には `CommandDialog` export が
 * 無いため、ここで最低限の Dialog + Command で代替する（Chunk 3 の担当範囲は
 * `components/ui/**` の新規追加が禁止のため、呼び出し側で合成）。
 *
 * グループ:
 *  - セッション: 新規 / 最近 5 件（`useSessionStore`）
 *  - チャット: 画像を添付（`save_clipboard_image`）
 *  - 表示: テーマ切替 / 設定を開く（Settings は Week6 実装のため placeholder）
 *  - 検索: 会話検索（Week7 PM-231 で SearchPalette を起動）
 *
 * 日本語 UI。ショートカットヒントは ⌘ 表記で統一（Windows でも同じ文字を表示）。
 *
 * Week7 PM-231: `onOpenSearch` コールバックで兄弟 `SearchPalette` を open する。
 * 未指定なら従来どおりの placeholder トーストを表示する（Chunk 1 範囲外の
 * 呼び出し箇所での後方互換）。
 */
export interface CommandPaletteProps {
  onOpenSearch?: () => void;
}

export function CommandPalette({ onOpenSearch }: CommandPaletteProps = {}) {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const sessions = useSessionStore((s) => s.sessions);
  const appendAttachment = useChatStore((s) => s.appendAttachment);
  // PM-939 (v3.5.22): プロジェクト未選択時は「新規セッション」項目を disabled にする。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // mod+k = Cmd+K on Mac / Ctrl+K on Win/Linux（react-hotkeys-hook）
  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      setOpen((v) => !v);
    },
    { enableOnFormTags: true, enableOnContentEditable: true }
  );

  // 項目実行時の共通 close ラッパー（コマンド実行後に必ずダイアログを閉じる）。
  const run = useCallback((fn: () => void | Promise<void>) => {
    return async () => {
      try {
        await fn();
      } finally {
        setOpen(false);
      }
    };
  }, []);

  // ----------------------- セッション -----------------------

  const handleNewSession = run(async () => {
    // PM-939 (v3.5.22): プロジェクト未選択時はセッション作成不可。
    // CommandItem を disabled にしているが、Ctrl+K 入力後 Enter で select が
    // 飛ぶケース等の安全網として明示的に reject する。
    if (!activeProjectId) {
      toast.error(
        "プロジェクトが選択されていません。左のレールからプロジェクトを作成/選択してください。"
      );
      return;
    }
    try {
      await useSessionStore.getState().createNewSession();
      toast.success("新規セッションを開始しました");
    } catch (e) {
      toast.error(`セッション作成に失敗: ${String(e)}`);
    }
  });

  const handleLoadSession = (id: string) =>
    run(async () => {
      try {
        await useSessionStore.getState().loadSession(id);
      } catch (e) {
        toast.error(`セッションの読込に失敗: ${String(e)}`);
      }
    });

  // ----------------------- チャット -----------------------

  const handlePasteImage = run(async () => {
    try {
      const savedPath = await callTauri<string | null>("save_clipboard_image");
      if (!savedPath) {
        toast.info("クリップボードに画像がありません");
        return;
      }
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      appendAttachment({ id, path: savedPath });
      toast.success("画像を添付しました");
    } catch (e) {
      toast.error(
        `画像の取り込みに失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  });

  // ----------------------- 表示 -----------------------

  const current = resolvedTheme ?? theme;
  const isDark = current === "dark";

  const handleToggleTheme = run(() => {
    setTheme(isDark ? "light" : "dark");
  });

  const handleOpenSettings = run(() => {
    // Week 6 Chunk 3 で `app/settings/page.tsx` を実装済。
    // Next.js App Router の client side navigation で遷移する
    // （static export でも webview 内では機能する）。
    router.push("/settings");
  });

  // ----------------------- 検索 -----------------------

  const handleSearch = run(() => {
    if (onOpenSearch) {
      onOpenSearch();
    } else {
      // SearchPalette が未接続の環境（従来呼び出し）では placeholder に戻る。
      toast.info("会話検索パレットが接続されていません");
    }
  });

  // v3.5.3 (2026-04-20): Git / worktree UI は撤去済。CommandPalette の
  // 「新規 worktree」placeholder も合わせて削除（PM-770 dead code removal）。

  // --- 最近のセッション 5 件（updatedAt 降順で slice）---
  const recentSessions = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  // ダイアログが閉じるタイミングで初期化しておくと、再オープン時に選択位置が
  // 上に戻って UX が安定する（cmdk は内部で value を保持）。
  useEffect(() => {
    if (!open) return;
    // Esc で自動で open=false になるので特別な処理は不要。
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[520px]">
        {/* a11y: Dialog には Title / Description が必要（Radix の要件）。
            視覚的には見せないので sr-only で隠す。 */}
        <DialogTitle className="sr-only">コマンドパレット</DialogTitle>
        <DialogDescription className="sr-only">
          ⌘K でコマンドパレットを開閉。キーワードで操作を検索できます。
        </DialogDescription>
        <Command
          loop
          className="[&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            placeholder="操作を検索...（例: 新規セッション, 画像, テーマ）"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>一致する項目がありません</CommandEmpty>

            {/* セッション */}
            <CommandGroup heading="セッション">
              <CommandItem
                value="new-session 新規セッション new session"
                onSelect={handleNewSession}
                disabled={!activeProjectId}
              >
                <MessageSquarePlus aria-hidden />
                <span>
                  新規セッション
                  {!activeProjectId && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      （プロジェクトを先に選択）
                    </span>
                  )}
                </span>
                <CommandShortcut>⌘⇧N</CommandShortcut>
              </CommandItem>
              {recentSessions.map((s) => {
                const title = s.title?.trim() || "（無題のセッション）";
                return (
                  <CommandItem
                    key={s.id}
                    value={`session ${s.id} ${title}`}
                    onSelect={handleLoadSession(s.id)}
                  >
                    <History aria-hidden />
                    <span className="line-clamp-1">{title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>

            <CommandSeparator />

            {/* チャット */}
            <CommandGroup heading="チャット">
              <CommandItem
                value="paste-image 画像を添付 paste image"
                onSelect={handlePasteImage}
              >
                <ImagePlus aria-hidden />
                <span>画像を添付（クリップボードから）</span>
                <CommandShortcut>⌘V</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* 表示 */}
            <CommandGroup heading="表示">
              <CommandItem
                value="toggle-theme テーマ切替 theme dark light"
                onSelect={handleToggleTheme}
              >
                {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
                <span>
                  テーマを{isDark ? "ライト" : "ダーク"}に切替
                </span>
              </CommandItem>
              <CommandItem
                value="open-settings 設定 settings"
                onSelect={handleOpenSettings}
              >
                <Settings aria-hidden />
                <span>設定を開く</span>
                <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* 検索 */}
            <CommandGroup heading="検索">
              <CommandItem
                value="search-conversations 会話検索 search"
                onSelect={handleSearch}
              >
                <FileSearch aria-hidden />
                <span>会話を検索</span>
                <CommandShortcut>⌘⇧F</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            {/* v3.5.3: Git / worktree グループは撤去済（PM-770） */}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
