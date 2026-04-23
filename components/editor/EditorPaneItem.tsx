"use client";

import { useState } from "react";
import { X, FileText, SplitSquareHorizontal } from "lucide-react";

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
import { FileViewer } from "@/components/editor/FileViewer";
import { useEditorStore } from "@/lib/stores/editor";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 PM-924 (2026-04-20): 1 pane 分の editor コンテナ。
 *
 * EditorPane（従来 1 pane 実装）を pane id 対応に分離したもの。各 pane は
 * `useEditorStore` の `editorPanes[paneId]` を参照し、独立した openFileIds /
 * activeFileId を持つ。openFiles プール（content）は全 pane で共有されるため、
 * 両 pane に同じ file を開いた場合は片方の編集が他方にも反映される。
 *
 * ## 責務
 * - pane の tab bar（openFileIds を並べる）
 * - activeFileId の FileEditor（Monaco）表示
 * - pane が empty なら「ファイルを選んでください」空状態
 * - pane header（複数 pane 時のみ表示）: pane 閉じボタン
 */
export function EditorPaneItem({
  paneId,
  showHeader,
  canClose,
}: {
  paneId: string;
  showHeader: boolean;
  canClose: boolean;
}) {
  const pane = useEditorStore((s) => s.editorPanes[paneId]);
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeEditorPaneId = useEditorStore((s) => s.activeEditorPaneId);
  const setActiveEditorPane = useEditorStore((s) => s.setActiveEditorPane);
  const removeEditorPane = useEditorStore((s) => s.removeEditorPane);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const saveFile = useEditorStore((s) => s.saveFile);

  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  if (!pane) {
    return null;
  }

  const paneFiles = pane.openFileIds
    .map((id) => openFiles.find((f) => f.id === id))
    .filter((f): f is (typeof openFiles)[number] => Boolean(f));
  const activeFile =
    paneFiles.find((f) => f.id === pane.activeFileId) ?? paneFiles[0] ?? null;

  const confirmTarget = paneFiles.find((f) => f.id === confirmCloseId) ?? null;

  function handleCloseRequest(id: string) {
    const target = paneFiles.find((f) => f.id === id);
    if (!target) return;
    if (target.dirty) {
      setConfirmCloseId(id);
      return;
    }
    closeFile(id, paneId);
  }

  async function handleDiscardAndClose() {
    if (!confirmCloseId) return;
    closeFile(confirmCloseId, paneId);
    setConfirmCloseId(null);
  }

  async function handleSaveAndClose() {
    if (!confirmCloseId) return;
    try {
      await saveFile(confirmCloseId);
      closeFile(confirmCloseId, paneId);
    } catch {
      // 保存失敗時は tab を残す
    } finally {
      setConfirmCloseId(null);
    }
  }

  const isActivePane = paneId === activeEditorPaneId;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        showHeader && !isActivePane && "opacity-90"
      )}
      onMouseDown={() => {
        if (!isActivePane) setActiveEditorPane(paneId);
      }}
    >
      {showHeader && (
        <div className="flex h-6 shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-2 text-[10px] text-muted-foreground">
          <span className={cn(isActivePane && "text-foreground")}>
            {isActivePane ? "このペインにフォーカス中" : "クリックでフォーカス"}
          </span>
          {canClose && (
            <button
              type="button"
              onClick={() => removeEditorPane(paneId)}
              className="flex h-4 w-4 items-center justify-center rounded hover:bg-accent/60"
              aria-label="このエディタペインを閉じる"
              title="ペインを閉じる"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      )}

      {paneFiles.length === 0 ? (
        <EmptyPaneState />
      ) : (
        <>
          <div
            role="tablist"
            aria-label={`開いているファイル (${paneId})`}
            className="flex h-9 shrink-0 items-stretch gap-0 overflow-x-auto border-b bg-muted/20"
          >
            {paneFiles.map((f) => {
              const isActive = f.id === pane.activeFileId;
              return (
                <div
                  key={f.id}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={cn(
                    "group flex h-full min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r pl-3 pr-1 text-[12px] transition-colors",
                    isActive
                      ? "bg-background text-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-accent/50"
                  )}
                  // 左クリック: タブ切替。
                  // PM-964 hotfix: 旧版は DropdownMenuTrigger asChild で包んだため
                  // 全クリックがメニュー起動を奪い、タブ切替不能だった。Dropdown
                  // は削除し、閉じる導線は X ボタンと middle-click に統一する。
                  onClick={() => setActiveFile(f.id, paneId)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      handleCloseRequest(f.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveFile(f.id, paneId);
                    }
                  }}
                  title={f.path}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
              );
            })}
          </div>

          <div className="min-h-0 flex-1">
            {activeFile && <FileViewer openFileId={activeFile.id} />}
          </div>
        </>
      )}

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

function EmptyPaneState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <SplitSquareHorizontal
          className="h-5 w-5 text-muted-foreground"
          aria-hidden
        />
      </div>
      <p className="text-xs font-medium">このペインは空です</p>
      <p className="max-w-xs text-[11px] text-muted-foreground">
        左サイドバーのプロジェクトツリーからファイルをクリックすると、このペインにエディタが開きます。
      </p>
    </div>
  );
}
