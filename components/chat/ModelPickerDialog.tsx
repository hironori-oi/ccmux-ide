"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDialogStore } from "@/lib/stores/dialog";
import { useProjectStore } from "@/lib/stores/project";
import { MODEL_CHOICES, type ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v4 / Chunk C / DEC-028: `/model` で開かれるモデル選択ダイアログ。
 *
 * - 3 モデル（Opus 4.7 / Sonnet 4.6 / Haiku 4.5）から radio 風に選択
 * - 確定で `useDialogStore.setSelectedModel` に保存（localStorage 永続化）
 * - sidecar 側へのモデル反映は M3 後 (v4) 候補のため、現状は toast で
 *   「次回 sidecar 起動時から反映」相当の案内を出して透明性を担保する。
 *   将来 ChatPanel が `start_agent_sidecar` 引数に model を渡すようになったら、
 *   本 dialog から sidecar 再起動 prompt を追加する（review 側で確認）。
 */
export function ModelPickerDialog() {
  const open = useDialogStore((s) => s.modelPickerOpen);
  const close = useDialogStore((s) => s.closeModelPicker);
  const dialogDefault = useDialogStore((s) => s.selectedModel);
  const selectedEffort = useDialogStore((s) => s.selectedEffort);
  const setSelected = useDialogStore((s) => s.setSelectedModel);

  // v3.5.17 (2026-04-20): Popover と同じく active project の runningModel を
  // 最優先表示、切替時は restartSidecarWithModel を発火する Claude Desktop 同等 UX。
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const runningModel = activeProject?.runningModel ?? null;
  const sidecarStatus = useProjectStore((s) =>
    activeProject ? s.sidecarStatus[activeProject.id] ?? "stopped" : "stopped"
  );
  const restartSidecarWithModel = useProjectStore(
    (s) => s.restartSidecarWithModel
  );

  const current: ModelId = runningModel ?? dialogDefault;

  // dialog 開閉のたびに draft をリセット
  const [draft, setDraft] = useState<ModelId>(current);

  async function handleConfirm() {
    if (draft === current) {
      toast.message("モデルは変更されていません");
      close();
      return;
    }

    // v3.5.17: active project が running なら sidecar を再起動（PM-830 resume で context 継続）
    const isRestartable =
      activeProject && (sidecarStatus === "running" || sidecarStatus === "error");
    if (isRestartable) {
      close();
      try {
        await restartSidecarWithModel(activeProject.id, draft, selectedEffort);
        // 成功 toast は restartSidecarWithModel 内で発火、dialog default も sticky 更新
        setSelected(draft);
      } catch (e) {
        toast.error(
          `モデル切替に失敗: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    }

    // active project が未起動 or 未選択 → default 変更のみ
    setSelected(draft);
    toast.success(
      activeProject
        ? `モデルを ${draft} に切替えました（次回 Claude 起動時から反映）`
        : `モデルを ${draft} に切替えました（プロジェクト選択後から反映）`
    );
    close();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(current);
        } else {
          close();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            モデル選択
          </DialogTitle>
          <DialogDescription>
            {activeProject ? (
              <>
                <span className="block">
                  プロジェクト <strong>{activeProject.title}</strong> の動作モデル
                </span>
                <span className="mt-1 block">
                  現在: <code className="rounded bg-muted px-1 py-0.5 text-xs">{current}</code>
                </span>
              </>
            ) : (
              <>
                プロジェクト未選択のため、デフォルトのみ更新します。現在:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{current}</code>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <ul role="radiogroup" aria-label="モデル一覧" className="space-y-2">
          {MODEL_CHOICES.map((m) => {
            const selected = m.id === draft;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDraft(m.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{m.label}</span>
                    {selected && (
                      <Check className="h-4 w-4 text-primary" aria-hidden />
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {m.id}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {m.description}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            キャンセル
          </Button>
          <Button onClick={handleConfirm}>確定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
