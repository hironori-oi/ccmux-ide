"use client";

import { create } from "zustand";
import { toast } from "sonner";

import { callTauri } from "@/lib/tauri-api";
import type { Worktree } from "@/lib/types";
import { useChatStore } from "@/lib/stores/chat";

/**
 * Week 7 Chunk 3 / PM-260〜262: git worktree 管理 Zustand store。
 *
 * ## 責務
 * - `list_worktrees` で取得した worktree 一覧を保持（`WorktreeTabs` が購読）
 * - active worktree の id / path を持ち、`setActiveWorktree` / `switchWorktree`
 *   で切替える
 * - `addWorktree` / `removeWorktree` は Rust command を呼び、成功時に一覧を再取得
 * - 切替時は `useChatStore.setCwd(path)` で chat 側に cwd を伝達し、
 *   `stop_agent_sidecar` → `start_agent_sidecar({ cwd })` の順で sidecar を再起動
 *   する（sidecar の再接続は「best effort」、失敗時も UI は継続）
 *
 * ## Rust backend との整合
 * `src-tauri/src/commands/worktree.rs` の現行 API に合わせる:
 *  - `list_worktrees(repoRoot)` : `Vec<Worktree>`
 *  - `add_worktree(repoRoot, id)` : 新規 worktree を `.claude-ide/worktrees/<id>`
 *    に作成し、`agent/<id>` ブランチを切る
 *  - `remove_worktree(repoRoot, id)` : `--force` で削除
 *  - `switch_worktree(repoRoot, id)` : 指定 id の `Worktree` を返す（存在確認）
 *
 * ## 禁止範囲への配慮（PRJ-012 Week7 Chunk 3 の排他）
 * Chunk 1（`components/chat/ChatPanel.tsx` 側の sidecar useEffect）との干渉を避ける
 * ため、本 store の `switchWorktree` は chat.cwd を更新したうえで自力で sidecar を
 * stop → start する（ChatPanel の再描画を待たずに確定させる）。ChatPanel は
 * `cwd` を watch する改修を Chunk 1 合流後に /review で行う想定。
 */

interface WorktreeState {
  /** workspace の repo root 絶対パス（null は未解決） */
  repoRoot: string | null;
  /** 直近 list で取得した worktree 一覧（order は porcelain 出力の並び） */
  worktrees: Worktree[];
  /** 現在 active な worktree の id（`Worktree.id` と一致） */
  activeWorktreeId: string | null;
  /** 最新操作が進行中なら true（ボタンの disabled 用） */
  isLoading: boolean;
  /** 最新操作のエラーメッセージ（UI banner 用） */
  error: string | null;

  /** repo root を外部から設定（ProjectSwitcher 等から渡される想定） */
  setRepoRoot: (path: string) => void;
  /** `list_worktrees` を呼んで `worktrees` を再読込 */
  fetchWorktrees: () => Promise<void>;
  /** active worktree を切替（sidecar 再起動 + chat.cwd 更新） */
  switchWorktree: (id: string) => Promise<void>;
  /**
   * 新規 worktree 作成。
   * @param id ディレクトリ名 / ブランチ suffix（例: `feat-login` → `agent/feat-login`）
   * @returns 作成された Worktree
   */
  addWorktree: (id: string) => Promise<Worktree>;
  /** 既存 worktree 削除。 */
  removeWorktree: (id: string) => Promise<void>;
  /** active worktree id のみ set（sidecar 操作は行わない、テスト / 内部用） */
  setActiveWorktree: (id: string | null) => void;
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  repoRoot: null,
  worktrees: [],
  activeWorktreeId: null,
  isLoading: false,
  error: null,

  setRepoRoot: (path) => set({ repoRoot: path }),

  fetchWorktrees: async () => {
    const repoRoot = get().repoRoot;
    if (!repoRoot) {
      set({ worktrees: [], error: null });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const list = await callTauri<Worktree[]>("list_worktrees", {
        repoRoot,
      });
      // 現在の active id が list に存在しなくなった場合は null に戻す
      const currentId = get().activeWorktreeId;
      const stillPresent = currentId
        ? list.some((w) => w.id === currentId)
        : false;
      set({
        worktrees: list,
        activeWorktreeId: stillPresent ? currentId : list[0]?.id ?? null,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false, worktrees: [] });
    }
  },

  switchWorktree: async (id) => {
    const { worktrees, activeWorktreeId, repoRoot } = get();
    if (id === activeWorktreeId) return;
    set({ isLoading: true, error: null });

    // ローカルに一覧がある場合はそこから優先取得、無ければ Rust 側に確認を委ねる
    let target = worktrees.find((w) => w.id === id) ?? null;
    try {
      if (!target && repoRoot) {
        target = await callTauri<Worktree>("switch_worktree", {
          repoRoot,
          id,
        });
      }
      if (!target) {
        throw new Error(`worktree が見つかりません: ${id}`);
      }

      // 1) chat store に cwd を伝達（ChatPanel 側の cwd watcher が有効化されたら自動再起動）
      useChatStore.getState().setCwd(target.path);

      // 2) 現行 sidecar を停止 → 新 cwd で再起動（best effort）
      try {
        await callTauri<void>("stop_agent_sidecar");
      } catch (e) {
        // sidecar 未起動 / 二重停止 は無視
        console.warn("[worktree] stop_agent_sidecar warn:", e);
      }
      try {
        await callTauri<void>("start_agent_sidecar", { cwd: target.path });
      } catch (e) {
        // start 失敗は UI に出す（sidecar 停止済なので chat は一時不通になる）
        toast.error(
          `sidecar の再起動に失敗しました: ${String(e)}（手動で再起動してください）`
        );
        set({
          error: String(e),
          isLoading: false,
          activeWorktreeId: id,
        });
        return;
      }

      set({ activeWorktreeId: id, isLoading: false });
      toast.message(
        `worktree を切替えました: ${target.branch}（会話 context は再構築されます）`
      );
    } catch (e) {
      set({ error: String(e), isLoading: false });
      toast.error(`worktree 切替に失敗: ${String(e)}`);
    }
  },

  addWorktree: async (id) => {
    const repoRoot = get().repoRoot;
    if (!repoRoot) {
      const msg = "repo root が未設定です";
      set({ error: msg });
      throw new Error(msg);
    }
    set({ isLoading: true, error: null });
    try {
      const created = await callTauri<Worktree>("add_worktree", {
        repoRoot,
        id,
      });
      // 再 list して最新を反映
      const list = await callTauri<Worktree[]>("list_worktrees", {
        repoRoot,
      });
      set({ worktrees: list, isLoading: false });
      toast.success(`worktree を作成しました: ${created.branch}`);
      return created;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      toast.error(`worktree 作成に失敗: ${String(e)}`);
      throw e;
    }
  },

  removeWorktree: async (id) => {
    const repoRoot = get().repoRoot;
    if (!repoRoot) {
      const msg = "repo root が未設定です";
      set({ error: msg });
      throw new Error(msg);
    }
    set({ isLoading: true, error: null });
    try {
      await callTauri<void>("remove_worktree", { repoRoot, id });
      const list = await callTauri<Worktree[]>("list_worktrees", {
        repoRoot,
      });
      const wasActive = get().activeWorktreeId === id;
      set({
        worktrees: list,
        isLoading: false,
        activeWorktreeId: wasActive ? list[0]?.id ?? null : get().activeWorktreeId,
      });
      toast.success(`worktree を削除しました: ${id}`);
    } catch (e) {
      set({ error: String(e), isLoading: false });
      toast.error(`worktree 削除に失敗: ${String(e)}`);
    }
  },

  setActiveWorktree: (id) => set({ activeWorktreeId: id }),
}));
