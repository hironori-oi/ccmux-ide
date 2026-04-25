"use client";

import { useEffect, useState } from "react";
import {
  X,
  FileText,
  SplitSquareHorizontal,
  Pencil,
  Eye,
  Columns2,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

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
import { FileEditor } from "@/components/editor/FileEditor";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { useEditorStore } from "@/lib/stores/editor";
import { cn } from "@/lib/utils";
import { isMarkdownPath } from "@/lib/utils/file";

/**
 * v1.25.1: Markdown ファイル表示時の 3 モード。
 * - edit:    Monaco エディタのみ（既定）
 * - preview: MarkdownPreview のみ
 * - split:   左 Monaco + 右 MarkdownPreview を react-resizable-panels で水平分割
 */
// v1.25.6: SlotContainer (Workspace) からも参照するため export 化
export type MarkdownViewMode = "edit" | "preview" | "split";

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

  // v1.25.1: pane 単位の Markdown view mode（edit / preview / split）。
  // 永続化は不要（リロードで edit に戻る）。pane volatile state。
  const [mdViewMode, setMdViewMode] = useState<MarkdownViewMode>("edit");

  // v1.25.2 / v1.25.3: pane.activeFileId が paneFiles に含まれない場合の自己修復。
  //
  // 旧実装は `find(...) ?? paneFiles[0] ?? null` で fallback していたが、その時
  // `pane.activeFileId` は古い id を指したまま残るため、tab UI でどのタブも active
  // 強調されない。さらに後段の `<MarkdownEditorArea openFileId={activeFile.id}>` が
  // 「視覚的 active タブ」と「実 activeFileId」の不整合を起こし、toolbar の判定で
  // 意図したファイル以外が評価されるケースが生まれる（複数 pane / 異種混在 open 時に再現）。
  //
  // ここでは active 候補が paneFiles に居ない場合、effect で 1 回だけ
  // `setActiveFile(paneFiles[0].id, paneId)` を発火して store 側を本物の id に書き戻す。
  // 描画自体は `paneFiles[0]` を使うので画面はちらつかない。
  //
  // v1.25.3: Rules of Hooks 違反 (early return より前に hook 呼び出しが必要) を回避し、
  // pane が null の時は paneFiles を空配列にした上で hook を unconditional に評価する。
  const paneFiles = pane
    ? pane.openFileIds
        .map((id) => openFiles.find((f) => f.id === id))
        .filter((f): f is (typeof openFiles)[number] => Boolean(f))
    : [];
  const resolvedActiveFile =
    paneFiles.find((f) => f.id === pane?.activeFileId) ??
    paneFiles[0] ??
    null;
  const activeFileIdMatches =
    resolvedActiveFile !== null &&
    pane?.activeFileId === resolvedActiveFile.id;
  const resolvedActiveFileId = resolvedActiveFile?.id ?? null;

  useEffect(() => {
    if (
      pane &&
      paneFiles.length > 0 &&
      resolvedActiveFile !== null &&
      !activeFileIdMatches
    ) {
      // activeFileId が stale（paneFiles に存在しない id）なら paneFiles[0] に再同期。
      setActiveFile(resolvedActiveFile.id, paneId);
    }
    // resolvedActiveFile は object で render 毎に新規だが、id が同じなら再発火しない
    // よう resolvedActiveFileId を依存に使う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paneId,
    pane?.activeFileId,
    activeFileIdMatches,
    resolvedActiveFileId,
    paneFiles.length,
    setActiveFile,
  ]);

  if (!pane) {
    return null;
  }

  const activeFile = resolvedActiveFile;

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

          {/*
           * v1.25.1: Markdown ファイルなら toolbar + 3 モード切替 + Split を有効化。
           * それ以外は従来通り FileViewer を素通し。
           */}
          {activeFile && isMarkdownPath(activeFile.path) ? (
            <MarkdownEditorArea
              openFileId={activeFile.id}
              viewMode={mdViewMode}
              onViewModeChange={setMdViewMode}
            />
          ) : (
            <div className="min-h-0 flex-1">
              {activeFile && <FileViewer openFileId={activeFile.id} />}
            </div>
          )}
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

/**
 * v1.25.1: Markdown 専用 editor area。toolbar + mode 別レンダリングを担当。
 *
 * - toolbar: Pencil（編集）/ Eye（プレビュー）/ Columns2（分割）の 3 アイコンボタン
 * - edit:    FileEditor（Monaco）のみ
 * - preview: MarkdownPreview のみ（Monaco の現在 buffer を 200ms debounce して描画）
 * - split:   左 FileEditor + 右 MarkdownPreview を react-resizable-panels で水平分割
 *
 * Monaco の buffer は openFiles[id].content（zustand store）から購読。
 * MarkdownPreview への入力は 200ms debounce で過剰再レンダリングを抑制する。
 */
/**
 * v1.25.6: SlotContainer (Workspace 4 分割等) からも再利用するため export 化。
 * 旧仕様では EditorPaneItem 内 private function だったため、Workspace mode で
 * editor を slot に配置すると FileViewer 直接呼びとなり MarkdownToolbar が
 * スキップされていた。
 */
export function MarkdownEditorArea({
  openFileId,
  viewMode,
  onViewModeChange,
}: {
  openFileId: string;
  viewMode: MarkdownViewMode;
  onViewModeChange: (mode: MarkdownViewMode) => void;
}) {
  // store の content を直接 select。Monaco の onChange → updateContent が
  // store を更新するため、preview / split mode はここで自動追従する。
  const content = useEditorStore(
    (s) => s.openFiles.find((f) => f.id === openFileId)?.content ?? ""
  );

  // 200ms debounce: 連打 typing 中の preview 再描画コストを抑える
  const debouncedContent = useDebouncedValue(content, 200);

  return (
    <>
      <MarkdownToolbar viewMode={viewMode} onViewModeChange={onViewModeChange} />
      <div className="min-h-0 flex-1">
        {viewMode === "edit" && <FileEditor openFileId={openFileId} />}
        {viewMode === "preview" && <MarkdownPreview source={debouncedContent} />}
        {viewMode === "split" && (
          <PanelGroup
            direction="horizontal"
            autoSaveId="ccmux-ide-gui:markdown-split"
            className="flex h-full min-h-0"
          >
            <Panel
              id="markdown-edit"
              order={0}
              defaultSize={50}
              minSize={20}
              className="flex min-h-0 flex-col"
            >
              <FileEditor openFileId={openFileId} />
            </Panel>
            <PanelResizeHandle
              className={cn(
                "relative w-1 bg-border transition-colors",
                "hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60",
                "after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']"
              )}
              aria-label="編集とプレビューの境界をドラッグして幅を変更"
            />
            <Panel
              id="markdown-preview"
              order={1}
              defaultSize={50}
              minSize={20}
              className="flex min-h-0 flex-col"
            >
              <MarkdownPreview source={debouncedContent} />
            </Panel>
          </PanelGroup>
        )}
      </div>
    </>
  );
}

/**
 * v1.25.1: Markdown 表示モード切替 toolbar。3 アイコンボタンを横並び。
 *
 * 現在モードのボタンは ring + accent 背景でハイライト。
 */
function MarkdownToolbar({
  viewMode,
  onViewModeChange,
}: {
  viewMode: MarkdownViewMode;
  onViewModeChange: (mode: MarkdownViewMode) => void;
}) {
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/10 px-2 text-[11px]"
      role="toolbar"
      aria-label="Markdown 表示モード"
    >
      <span className="mr-1 text-muted-foreground">表示:</span>
      <ModeButton
        active={viewMode === "edit"}
        onClick={() => onViewModeChange("edit")}
        label="編集"
        title="編集モード（Monaco エディタのみ）"
        icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
      />
      <ModeButton
        active={viewMode === "preview"}
        onClick={() => onViewModeChange("preview")}
        label="プレビュー"
        title="プレビューモード（レンダリング表示のみ）"
        icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
      />
      <ModeButton
        active={viewMode === "split"}
        onClick={() => onViewModeChange("split")}
        label="分割"
        title="分割モード（編集とプレビューを横に並べて表示）"
        icon={<Columns2 className="h-3.5 w-3.5" aria-hidden />}
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  title,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
        active
          ? "bg-accent text-accent-foreground ring-1 ring-primary/40"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * 値を debounce する小さな hook。preview への過剰再レンダリング抑制用。
 * 入力 value が連続変化しても、最後の変化から `delay` ms 経過するまで
 * 出力値は更新されない。
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
