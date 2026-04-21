"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Gauge } from "lucide-react";

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
import { EFFORT_CHOICES, type EffortLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.5.18 PM-840 派生: `/effort` で開かれる推論工数 (thinking tokens) 選択ダイアログ。
 *
 * `ModelPickerDialog` と同構造（DEC-028 / v3.5.17 PM-840）を踏襲し、`/effort`
 * から開いて 5 段階（低 / 中 / 高 / 超高 / 最大）を radio 風 button で選択する。
 *
 * - 確定で `useDialogStore.setSelectedEffort` に保存（localStorage 永続化）
 * - active project が running なら `restartSidecarWithModel(id, runningModel ?? selectedModel, draftEffort)`
 *   で sidecar を即再起動 (PM-830 resume で会話 context は継続)
 * - 停止中 / 未選択は dialog default のみ更新し toast で「次回起動から反映」案内
 *
 * 既存 StatusBar 上の `EffortPickerPopover` と同じ実態追従ロジックを共有する。
 */
export function EffortPickerDialog() {
  const open = useDialogStore((s) => s.effortPickerOpen);
  const close = useDialogStore((s) => s.closeEffortPicker);
  const dialogDefault = useDialogStore((s) => s.selectedEffort);
  const selectedModel = useDialogStore((s) => s.selectedModel);
  const setSelectedEffort = useDialogStore((s) => s.setSelectedEffort);

  // active project の runningEffort を最優先表示（Popover と同じ実態追従 UX）
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const runningEffort = activeProject?.runningEffort ?? null;
  const runningModel = activeProject?.runningModel ?? null;
  const sidecarStatus = useProjectStore((s) =>
    activeProject ? s.sidecarStatus[activeProject.id] ?? "stopped" : "stopped"
  );
  const restartSidecarWithModel = useProjectStore(
    (s) => s.restartSidecarWithModel
  );

  const current: EffortLevel = runningEffort ?? dialogDefault;

  // dialog 開閉のたびに draft をリセット
  const [draft, setDraft] = useState<EffortLevel>(current);

  async function handleConfirm() {
    if (draft === current) {
      toast.message("推論工数は変更されていません");
      close();
      return;
    }

    // active project が running なら sidecar を再起動（PM-830 resume で context 継続）
    const isRestartable =
      activeProject && (sidecarStatus === "running" || sidecarStatus === "error");
    if (isRestartable) {
      close();
      try {
        await restartSidecarWithModel(
          activeProject.id,
          runningModel ?? selectedModel,
          draft
        );
        // 成功 toast は restartSidecarWithModel 内で発火、dialog default も sticky 更新
        setSelectedEffort(draft);
      } catch (e) {
        toast.error(
          `推論工数の切替に失敗: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    }

    // active project が未起動 or 未選択 → default 変更のみ
    const meta = EFFORT_CHOICES.find((c) => c.id === draft);
    setSelectedEffort(draft);
    toast.success(
      activeProject
        ? `推論工数を「${meta?.label ?? draft}」に切替えました（次回 Claude 起動時から反映）`
        : `推論工数を「${meta?.label ?? draft}」に切替えました（プロジェクト選択後から反映）`
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
            <Gauge className="h-4 w-4 text-primary" aria-hidden />
            推論工数 (thinking tokens) 選択
          </DialogTitle>
          <DialogDescription>
            {activeProject ? (
              <>
                <span className="block">
                  プロジェクト <strong>{activeProject.title}</strong> の推論工数
                </span>
                <span className="mt-1 block">
                  現在:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {EFFORT_CHOICES.find((c) => c.id === current)?.label ?? current}
                  </code>
                </span>
              </>
            ) : (
              <>
                プロジェクト未選択のため、デフォルトのみ更新します。現在:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {EFFORT_CHOICES.find((c) => c.id === current)?.label ?? current}
                </code>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <ul role="radiogroup" aria-label="推論工数一覧" className="space-y-2">
          {EFFORT_CHOICES.map((e) => {
            const selected = e.id === draft;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDraft(e.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{e.label}</span>
                    {selected && (
                      <Check className="h-4 w-4 text-primary" aria-hidden />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.description}
                  </span>
                  <span className="tabular-nums text-[11px] font-mono text-muted-foreground/80">
                    推論トークン {e.thinkingTokens.toLocaleString()}
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
