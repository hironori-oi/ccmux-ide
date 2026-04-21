"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { EffortLevel, ModelId } from "@/lib/types";

/**
 * PRJ-012 v4 / Chunk C: 組込 slash 用の軽量 dialog store。
 *
 * ## 役割
 * - HelpDialog / ClearSessionDialog / ModelPickerDialog / EffortPickerDialog の
 *   open/close フラグ
 * - `/model` の選択状態（ModelId）を localStorage に persist
 * - v3.4.9: StatusBar の EffortPickerPopover 向け `selectedEffort` を persist
 * - v3.5.18 (PM-840 派生): `/effort` slash で開く EffortPickerDialog の open/close
 *
 * `lib/builtin-slash.ts` の dispatcher と各 dialog コンポーネントを疎結合に
 * 保つためのバス。Zustand を採用しているのは既存 store と一貫した API にする
 * ためで、UI 状態本体（messages 等）には触らない。
 *
 * ## 永続化
 * - `selectedModel` / `selectedEffort` を partialize して
 *   `ccmux-ide-gui:dialog` key に保存。ダイアログの開閉状態は session 限定で
 *   永続化しない。
 *
 * ## v4 / v3.4.9 申し送り
 * - sidecar への model / effort 反映は M3 後 (v4) 候補。現状は `selectedModel` /
 *   `selectedEffort` を保持し `start_agent_sidecar` 引数拡張時に参照する設計
 *   （ChatPanel が `getState`）。v3.4.9 の StatusBar picker は UI 上の保持 +
 *   toast のみで、実際の Claude query への反映は PM-760 候補で別途実装。
 */
interface DialogState {
  /** /help 用 */
  helpOpen: boolean;
  /** /clear 用 */
  clearOpen: boolean;
  /** /model 用 */
  modelPickerOpen: boolean;
  /** /effort 用（v3.5.18 PM-840 派生） */
  effortPickerOpen: boolean;
  /** 現在選択中のモデル（既定 Opus 4.7 1M） */
  selectedModel: ModelId;
  /**
   * v3.4.9: 現在選択中の推論工数（既定 medium）。
   * StatusBar の EffortPickerPopover および `/effort` の EffortPickerDialog から操作する。
   */
  selectedEffort: EffortLevel;

  openHelp: () => void;
  closeHelp: () => void;

  openClear: () => void;
  closeClear: () => void;

  openModelPicker: () => void;
  closeModelPicker: () => void;

  openEffortPicker: () => void;
  closeEffortPicker: () => void;

  setSelectedModel: (id: ModelId) => void;
  setSelectedEffort: (level: EffortLevel) => void;
}

const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return window.localStorage;
});

export const useDialogStore = create<DialogState>()(
  persist(
    (set) => ({
      helpOpen: false,
      clearOpen: false,
      modelPickerOpen: false,
      effortPickerOpen: false,
      selectedModel: "claude-opus-4-7[1m]",
      selectedEffort: "medium",

      openHelp: () => set({ helpOpen: true }),
      closeHelp: () => set({ helpOpen: false }),

      openClear: () => set({ clearOpen: true }),
      closeClear: () => set({ clearOpen: false }),

      openModelPicker: () => set({ modelPickerOpen: true }),
      closeModelPicker: () => set({ modelPickerOpen: false }),

      openEffortPicker: () => set({ effortPickerOpen: true }),
      closeEffortPicker: () => set({ effortPickerOpen: false }),

      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setSelectedEffort: (selectedEffort) => set({ selectedEffort }),
    }),
    {
      name: "ccmux-ide-gui:dialog",
      storage: safeStorage,
      // selectedModel / selectedEffort を永続化（ダイアログ open 状態は session 限定）
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        selectedEffort: state.selectedEffort,
      }),
    }
  )
);
