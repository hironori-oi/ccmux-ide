"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Sparkles } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDialogStore } from "@/lib/stores/dialog";
import { useProjectStore } from "@/lib/stores/project";
import { MODEL_CHOICES, type ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.4.9: StatusBar 向け Claude Desktop 風 **compact モデル picker**。
 *
 * 既存 `ModelPickerDialog` は `/model` slash から開く大きなダイアログで、
 * ユーザーが明示的にモデルを切替えたいシーン向け。本 Popover は StatusBar
 * 右側に常時表示する軽量 trigger（`Opus 4.7 (1M) ▾`）で、**1 クリック &
 * 選択だけで即切替**できる。
 *
 * - trigger: `h-6` text-xs の icon + 短縮ラベル、dropdown caret（Claude Desktop 風）
 * - content: 3 モデル（Opus / Sonnet / Haiku）を radiogroup 相当の button list
 *
 * ## v3.5.16 PM-840 (Claude Desktop 風 Live 切替)
 *
 * - **表示値**: active project があれば `runningModel`（= 実起動 sidecar の
 *   model）を表示、無ければ dialog store の `selectedModel` を default として
 *   表示する。これにより「StatusBar に見えている model = 実際に応答している
 *   Claude の model」が常に一致する（旧: dialog store 固定表示で乖離していた）。
 * - **選択時の挙動**:
 *   - active project あり → `restartSidecarWithModel(id, newModel, curEffort)`
 *     で sidecar を即再起動。session の sdkSessionId は保持されており、
 *     次回送信時に resume が自動付与されるため **会話 context は継続** する
 *     （Claude Desktop と同等）。dialog default も同時に更新し、次の新規
 *     project でも同じ選択が効くようにする。
 *   - active project なし（未選択 or 登録なし）→ default 変更のみ
 *     （`setSelectedModel`）。次回起動する project の初期 model になる。
 */
export function ModelPickerPopover() {
  // dialog store: 「default (次回新規起動時の初期値)」として読む
  const dialogModel = useDialogStore((s) => s.selectedModel);
  const setDialogModel = useDialogStore((s) => s.setSelectedModel);
  const dialogEffort = useDialogStore((s) => s.selectedEffort);

  // project store: active project の実起動 model を引く（あれば優先表示）
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const restartSidecarWithModel = useProjectStore(
    (s) => s.restartSidecarWithModel
  );
  const getSidecarStatus = useProjectStore((s) => s.getSidecarStatus);

  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId) ?? null
    : null;

  // v3.5.16: 実態追従 — project.runningModel が null / undefined なら dialog default。
  const current: ModelId = activeProject?.runningModel ?? dialogModel;
  const effortForRestart = activeProject?.runningEffort ?? dialogEffort;

  const [open, setOpen] = useState(false);

  const currentMeta =
    MODEL_CHOICES.find((m) => m.id === current) ?? MODEL_CHOICES[0];

  async function handleSelect(id: ModelId) {
    if (id === current) {
      setOpen(false);
      return;
    }
    const meta = MODEL_CHOICES.find((m) => m.id === id);
    setOpen(false);

    // 次回新規起動時の default も同時に更新（Claude Desktop の sticky 挙動）
    setDialogModel(id);

    if (activeProject) {
      // v3.5.16 PM-840: active project の sidecar を即再起動（resume で会話継続）。
      // 再起動中は status=starting になり、InputArea の送信 polling で 15s まで待つ。
      // ここでは toast は restartSidecarWithModel 内部で発火するため発火しない。
      const status = getSidecarStatus(activeProject.id);
      if (status === "stopped") {
        // stopped 状態では sidecar が走っていないので restart する必要はない。
        // default だけ更新し、次回 TitleBar「起動」ボタンで新 model が反映される。
        toast.success(
          `モデルを ${meta?.label ?? id} に変更しました（次回 Claude 起動時から反映されます）`
        );
        return;
      }
      void restartSidecarWithModel(activeProject.id, id, effortForRestart);
      return;
    }

    // active project が無い（未選択）場合: default 変更のみ
    toast.success(
      `モデル default を ${meta?.label ?? id} に変更しました（次回 sidecar 起動時から反映）`
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`モデル: ${currentMeta.label}`}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open && "bg-muted"
          )}
        >
          <Sparkles
            className="h-3 w-3 text-primary"
            aria-hidden
          />
          <span className="hidden tabular-nums font-medium text-foreground/80 md:inline">
            {currentMeta.label}
          </span>
          <span className="sr-only md:hidden">{currentMeta.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-64 p-1"
        aria-label="モデル選択"
      >
        <div
          role="radiogroup"
          aria-label="Claude モデル"
          className="flex flex-col gap-0.5"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            モデル
            {activeProject ? (
              <span className="ml-1 font-normal normal-case text-muted-foreground/70">
                （{activeProject.title}）
              </span>
            ) : null}
          </div>
          {MODEL_CHOICES.map((m) => {
            const selected = m.id === current;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void handleSelect(m.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/70 text-foreground/90"
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{m.label}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                  )}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
