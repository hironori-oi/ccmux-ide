"use client";

import { useCallback, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorktreeStore } from "@/lib/stores/worktree";

/**
 * Week 7 Chunk 3 / PM-261: 新規 worktree 作成ダイアログ。
 *
 * ## 仕様
 * - shadcn `Dialog` の制御コンポーネント（open / onOpenChange は親で管理）。
 * - 入力:
 *   - ブランチ名 (id): `^[a-zA-Z0-9/_-]+$` でバリデーション。予約語
 *     （HEAD / main / master）は警告バナー表示、作成自体はブロックしない。
 *   - cwd / 親ディレクトリ: `@tauri-apps/plugin-dialog::open({ directory: true })`
 *     で選択。ただし現行 Rust `add_worktree` は `repo_root` 直下の
 *     `.claude-ide/worktrees/<id>` にしか生やせないため、このフィールドは
 *     **プレビュー専用**（= repo root の表示）として扱い、入力は disabled。
 *     将来 `add_worktree` を拡張する際の UI 先行実装として残す。
 *   - 「既存ブランチから」/「新規ブランチ作成」ラジオ: 現行 Rust は
 *     `-b agent/<id>` 固定（新規ブランチ）なので、既存ブランチは disabled 表示。
 *     UI のみ先行実装（PM-261 の spec を満たす形）。
 * - 作成ボタン: `useWorktreeStore.addWorktree(id)` を呼ぶ。成功時は
 *   store 側で toast + 一覧再読込を行うので、本コンポーネントは
 *   `onOpenChange(false)` で閉じるだけ。
 *
 * ## 排他観点
 * 本 Dialog は `components/inspector/` 配下に置き、Chunk 2 の MemoryEditor
 * とは別ディレクトリ / 別ファイル。`useWorktreeStore` 経由で Rust command を
 * 呼ぶので、`src-tauri/` には触れない。
 */

interface WorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 許可文字セット（Rust `is_safe_id` より少し広く、`/` も許可） */
const ID_RE = /^[a-zA-Z0-9/_-]+$/;
const RESERVED = new Set(["HEAD", "main", "master"]);

export function WorktreeDialog({ open, onOpenChange }: WorktreeDialogProps) {
  const repoRoot = useWorktreeStore((s) => s.repoRoot);
  const addWorktree = useWorktreeStore((s) => s.addWorktree);
  const isLoading = useWorktreeStore((s) => s.isLoading);

  const [id, setId] = useState("");
  // 入力モード: 新規ブランチ作成 (固定)。UI は既存ブランチ選択の体を残す。
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [cwdPreview, setCwdPreview] = useState<string | null>(null);

  // バリデーション
  const trimmed = id.trim();
  const isEmpty = trimmed.length === 0;
  const isValidChar = !isEmpty && ID_RE.test(trimmed);
  // Rust の `is_safe_id` は `/` 不可なので、UI 側で追加チェック
  // （`/` が含まれるとサブディレクトリ構造になってしまい、現行 Rust では通らない）
  const hasSlash = trimmed.includes("/");
  const isReserved = RESERVED.has(trimmed);

  const errorMessage = useMemo(() => {
    if (isEmpty) return null;
    if (!isValidChar) {
      return "半角英数字 / `/` / `_` / `-` のみ使用できます";
    }
    if (hasSlash) {
      return "現状は `/` を含まない英数字のみ対応しています（Rust 側バリデーション）";
    }
    return null;
  }, [isEmpty, isValidChar, hasSlash]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "worktree を作成する親ディレクトリを選択",
      });
      if (typeof selected === "string") {
        setCwdPreview(selected);
      }
    } catch (e) {
      console.warn("[worktree-dialog] dialog open failed:", e);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isEmpty || !isValidChar || hasSlash) return;
    try {
      await addWorktree(trimmed);
      // 成功時のみ閉じる + 入力リセット
      onOpenChange(false);
      setId("");
      setCwdPreview(null);
    } catch {
      // store 側で toast 済、dialog は開いたまま（再試行できるように）
    }
  }, [addWorktree, trimmed, isEmpty, isValidChar, hasSlash, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>新しい worktree を作成</DialogTitle>
          <DialogDescription>
            既存リポジトリ配下に `.claude-ide/worktrees/&lt;ID&gt;` として
            git worktree を作成します（ブランチ `agent/&lt;ID&gt;` が自動生成されます）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* ID 入力 */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">worktree 名 / ブランチ suffix</span>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="例: feat-login"
              autoFocus
              aria-invalid={Boolean(errorMessage)}
              disabled={isLoading}
            />
            {errorMessage ? (
              <span className="text-xs text-destructive">{errorMessage}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                半角英数字 / `_` / `-` のみ。ブランチ名は `agent/{trimmed || "<ID>"}` になります。
              </span>
            )}
          </label>

          {/* 予約語警告（作成はブロックしない） */}
          {isReserved && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                `{trimmed}` は git 予約語に近いため、ブランチ `agent/{trimmed}` の
                作成自体は可能ですが、混乱を避けるため別の名前を推奨します。
              </span>
            </div>
          )}

          {/* モード切替（UI プレースホルダ、現行 Rust は new 固定） */}
          <fieldset className="flex flex-col gap-2 text-sm" disabled={isLoading}>
            <legend className="font-medium">ブランチ生成モード</legend>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="worktree-mode"
                value="new"
                checked={mode === "new"}
                onChange={() => setMode("new")}
              />
              <span>新規ブランチを作成（`git worktree add -b agent/&lt;ID&gt;`）</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="radio"
                name="worktree-mode"
                value="existing"
                disabled
                checked={mode === "existing"}
                onChange={() => setMode("existing")}
              />
              <span>既存ブランチから（将来対応予定）</span>
            </label>
          </fieldset>

          {/* cwd 選択 UI（プレビュー専用） */}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">作成先 repo root</span>
            <div className="flex items-center gap-2">
              <Input
                value={cwdPreview ?? repoRoot ?? ""}
                readOnly
                placeholder="repo root が未設定です"
                className="flex-1 text-xs text-muted-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBrowse}
                disabled={isLoading}
                aria-label="ディレクトリを選択"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              実際の作成先は `repo root + .claude-ide/worktrees/&lt;ID&gt;` に固定されます。
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isEmpty ||
              !isValidChar ||
              hasSlash ||
              !repoRoot ||
              isLoading
            }
          >
            {isLoading && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
            作成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
