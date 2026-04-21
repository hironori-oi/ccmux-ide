"use client";

import { useState } from "react";
import { X, Save, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/stores/editor";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.4 Chunk A (DEC-034 Must 1): エディタタブバー。
 *
 * - 全 openFiles をタブ化、activeFileId を反映（click で activate）
 * - dirty なら title 先頭に `●` を表示
 * - タブ中央クリック / `×` ボタンで close（dirty 時は確認 dialog）
 * - 右クリック（onContextMenu）で DropdownMenu:
 *     「閉じる」「他のタブを閉じる」「保存」
 * - ドラッグ並替は Could（未実装）
 *
 * ## UX 決定
 * - **dirty のまま close** → AlertDialog で「破棄 / 保存して閉じる / キャンセル」
 * - **close 確認 cancel 時** は close 処理を中止
 */

export function EditorTabs() {
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const closeOtherFiles = useEditorStore((s) => s.closeOtherFiles);
  const saveFile = useEditorStore((s) => s.saveFile);

  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  if (openFiles.length === 0) return null;

  const confirmTarget = openFiles.find((f) => f.id === confirmCloseId) ?? null;

  function handleCloseRequest(id: string) {
    const target = openFiles.find((f) => f.id === id);
    if (!target) return;
    if (target.dirty) {
      setConfirmCloseId(id);
      return;
    }
    closeFile(id);
  }

  async function handleDiscardAndClose() {
    if (!confirmCloseId) return;
    closeFile(confirmCloseId);
    setConfirmCloseId(null);
  }

  async function handleSaveAndClose() {
    if (!confirmCloseId) return;
    try {
      await saveFile(confirmCloseId);
      closeFile(confirmCloseId);
    } catch {
      // 保存失敗時は tab を残す（store の error でユーザーに通知）
    } finally {
      setConfirmCloseId(null);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="開いているファイル"
      className="flex h-9 shrink-0 items-stretch gap-0 overflow-x-auto border-b bg-muted/20"
    >
      {openFiles.map((f) => {
        const isActive = f.id === activeFileId;
        return (
          <DropdownMenu key={f.id}>
            <DropdownMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                className={cn(
                  "group flex h-full min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r pl-3 pr-1 text-[12px] transition-colors",
                  isActive
                    ? "bg-background text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() => setActiveFile(f.id)}
                onMouseDown={(e) => {
                  // 中央クリック → close
                  if (e.button === 1) {
                    e.preventDefault();
                    handleCloseRequest(f.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveFile(f.id);
                  }
                }}
                title={f.path}
              >
                <FileText
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                <span className="truncate">
                  {f.dirty && (
                    <span
                      className="mr-1 text-amber-500"
                      aria-label="未保存"
                      title="未保存の変更あり"
                    >
                      ●
                    </span>
                  )}
                  {f.title}
                </span>
                <button
                  type="button"
                  aria-label={`${f.title} を閉じる`}
                  className={cn(
                    "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 transition-opacity hover:bg-accent hover:opacity-100",
                    isActive && "opacity-80"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseRequest(f.id);
                  }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
              <DropdownMenuItem
                onClick={() => void saveFile(f.id)}
                disabled={!f.dirty || f.loading}
              >
                <Save className="mr-2 h-3.5 w-3.5" aria-hidden />
                保存
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Ctrl+S
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleCloseRequest(f.id)}>
                <X className="mr-2 h-3.5 w-3.5" aria-hidden />
                閉じる
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => closeOtherFiles(f.id)}
                disabled={openFiles.length <= 1}
              >
                他のタブを閉じる
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCloseId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>未保存の変更があります</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.title ?? ""} には保存されていない変更があります。閉じる前に保存しますか？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2">
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <Button variant="outline" onClick={() => void handleDiscardAndClose()}>
              破棄して閉じる
            </Button>
            <AlertDialogAction onClick={() => void handleSaveAndClose()}>
              保存して閉じる
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
