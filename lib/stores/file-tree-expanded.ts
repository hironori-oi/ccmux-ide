"use client";

import { create } from "zustand";

/**
 * PRJ-012 v1.25.4: ProjectTree の各 TreeNode の **expanded 状態** を
 * グローバルに保持する store。
 *
 * ## 経緯
 *
 * v1.24.3 では「再読込ボタン押下で全フォルダが閉じる」不具合に対し、
 * `ReloadTickContext` + `useEffect` deps による再 fetch 経路で対処した。
 * しかし `TreeNode` 自体の `expanded` は **local `useState(false)`** で
 * 保持していたため、何らかの要因で TreeNode component が unmount → re-mount
 * されると expanded 値が初期値 `false` にリセットされ、結果として
 * 「再読込で全フォルダが閉じる」状態がオーナー環境で再発していた。
 *
 * 想定される再発シナリオ:
 *  - 親 `RootChildren` が re-render 中に entries を一旦 `null` に戻したり、
 *    array reference 変更 + 内部 child の prop 構造で React が同 key でも
 *    新規 instance を作ってしまうケース
 *  - StrictMode / dev / Tauri WebView2 特有のライフサイクルで unmount が走る
 *
 * ## v1.25.4 アプローチ
 *
 * - expanded 状態を **`Set<string>` (path)** で global 保持
 * - TreeNode は local state を持たず、selector で `isExpanded(path)` を読む
 * - re-mount しても store 側に状態が残るため UI 展開は維持される
 *
 * ## persist 方針
 *
 * 出荷時は **persist 無し**。Sumi 起動毎にリセットされても UX 問題なしと判断。
 * オーナー要望次第で次 patch で localStorage persist を追加する。
 *
 * ## メモリ・性能
 *
 * 数百〜数千フォルダを展開しても `Set<string>` は数 KB オーダー。selector は
 * `isExpanded(path)` の boolean 単位で stable なので、path 単位の re-render
 * のみが起きる（他 TreeNode は不要 re-render しない）。
 */

interface FileTreeExpandedState {
  /** 展開中のフォルダ path 集合 */
  expandedPaths: Set<string>;
  /** 指定 path が展開状態か */
  isExpanded: (path: string) => boolean;
  /** 指定 path の展開状態をトグル */
  toggleExpanded: (path: string) => void;
  /** 指定 path の展開状態を明示的にセット */
  setExpanded: (path: string, expanded: boolean) => void;
  /** 全 expanded をクリア（プロジェクト切替時に呼ぶ） */
  clearExpanded: () => void;
}

export const useFileTreeExpandedStore = create<FileTreeExpandedState>(
  (set, get) => ({
    expandedPaths: new Set<string>(),
    isExpanded: (path) => get().expandedPaths.has(path),
    toggleExpanded: (path) =>
      set((s) => {
        const next = new Set(s.expandedPaths);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { expandedPaths: next };
      }),
    setExpanded: (path, expanded) =>
      set((s) => {
        const has = s.expandedPaths.has(path);
        if (expanded === has) return s;
        const next = new Set(s.expandedPaths);
        if (expanded) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return { expandedPaths: next };
      }),
    clearExpanded: () => set({ expandedPaths: new Set<string>() }),
  })
);
