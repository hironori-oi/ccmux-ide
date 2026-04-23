"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  DEFAULT_PERMISSION_MODE,
  type EffortLevel,
  type ModelId,
  type PermissionMode,
} from "@/lib/types";

/**
 * PRJ-012 v1.9.0 (DEC-053): **セッション別の model / effort / permissionMode を保持する store**。
 *
 * ## 責務境界（monitor.ts を拡張しなかった理由）
 *
 * `monitor.ts` の `perSession` はあくまで sidecar から push される
 * `MonitorState` スナップショット（tokens / sub_agents / todos 等）の格納庫で、
 * 「ユーザーが明示的に選択した設定」を置くのは責務違反。以下の点でも分離が妥当:
 *
 *  - monitor は sidecar 起点の観測値 → 非永続化（tick 受信で都度上書き）
 *  - preferences はユーザー起点の選択値 → `persist` で localStorage へ書き出し、
 *    アプリ再起動後も同一セッションを開いた時に復元する
 *
 * ## Global fallback（sticky 挙動）
 *
 * 新規 session 作成時は `initializeSession(id, { ...globalDefaults })` を呼び、
 * `useDialogStore` の `selectedModel` / `selectedEffort` を seed として流し込む。
 * これにより「前回の操作で Opus を選んだ状態が次の新規 session にも引き継がれる」
 * という Claude Desktop 風の sticky 体験を保ちつつ、session ごとの上書きも可能。
 *
 * ## sidecar への反映
 *
 * `send_agent_prompt` の options に per-query で `model` / `maxThinkingTokens` /
 * `permissionMode` を同梱する（argv 再起動せずに switching 可能）。sidecar 側
 * (`sidecar/src/index.ts`) の `handlePrompt` は既に req.options からこれらを
 * 拾う実装になっているため、frontend が options を渡すだけで動く。
 *
 * ## 永続化 key
 *
 * - localStorage key: `sumi:session-preferences`
 * - 保存対象: `perSession` のみ（リクエスト in-flight のダーティ値は保存しない）
 * - 破壊的変更（v1.9.0 の schema 追加）は揮発設定なのでマイグレーション不要
 */

export interface SessionPreferences {
  /** null = 明示未設定（global fallback を使う） */
  model: ModelId | null;
  /** null = 明示未設定（global fallback を使う） */
  effort: EffortLevel | null;
  /** "default" が実質的な初期値。null を許容しないのは UI を常に特定モード固定にしたいため。 */
  permissionMode: PermissionMode;
}

export interface SessionPreferencesState {
  perSession: Record<string, SessionPreferences>;

  /**
   * 既存 session 無視で、指定 sessionId を `initial` で丸ごと seed する。
   *
   * 既に値がある場合は **上書きしない**（createNewSession から呼ぶ前提で、
   * 同じ id で複数回呼ばれても初期化は 1 回だけになる）。これにより lazy
   * 初期化経路（session 切替時の useEffect 等）からも安全に呼べる。
   */
  initializeSession: (
    sessionId: string,
    initial: SessionPreferences,
  ) => void;

  /**
   * 指定 session の preferences を部分更新する。
   *
   * sessionId が未登録の場合は `initial` を作らない（呼出側で先に
   * initializeSession を呼ぶべき）。ただし partial patch だけ渡っても壊れない
   * よう、既存値が無い key は `null` / `DEFAULT_PERMISSION_MODE` で埋める。
   */
  setPreference: (
    sessionId: string,
    patch: Partial<SessionPreferences>,
  ) => void;

  /** session 削除時に呼ぶ。未登録 id なら no-op。 */
  clearSession: (sessionId: string) => void;

  /** 全クリア（devtools / テスト用）。 */
  reset: () => void;
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

export const useSessionPreferencesStore = create<SessionPreferencesState>()(
  persist(
    (set) => ({
      perSession: {},

      initializeSession: (sessionId, initial) =>
        set((state) => {
          if (state.perSession[sessionId]) {
            // 既に登録済なら touch しない（lazy 呼出で上書き防止）
            return state;
          }
          return {
            perSession: {
              ...state.perSession,
              [sessionId]: {
                model: initial.model,
                effort: initial.effort,
                permissionMode: initial.permissionMode,
              },
            },
          };
        }),

      setPreference: (sessionId, patch) =>
        set((state) => {
          const prev =
            state.perSession[sessionId] ??
            ({
              model: null,
              effort: null,
              permissionMode: DEFAULT_PERMISSION_MODE,
            } satisfies SessionPreferences);
          return {
            perSession: {
              ...state.perSession,
              [sessionId]: {
                model: patch.model !== undefined ? patch.model : prev.model,
                effort:
                  patch.effort !== undefined ? patch.effort : prev.effort,
                permissionMode:
                  patch.permissionMode !== undefined
                    ? patch.permissionMode
                    : prev.permissionMode,
              },
            },
          };
        }),

      clearSession: (sessionId) =>
        set((state) => {
          if (!state.perSession[sessionId]) return state;
          const next = { ...state.perSession };
          delete next[sessionId];
          return { perSession: next };
        }),

      reset: () => set({ perSession: {} }),
    }),
    {
      name: "sumi:session-preferences",
      storage: safeStorage,
      partialize: (state) => ({ perSession: state.perSession }),
    },
  ),
);

/**
 * 指定 session の preferences を返す。未登録なら null。
 *
 * UI で「この session はまだ seed されていない」判定に使う（TrayPicker の
 * disabled 判定など）。
 */
export function selectSessionPreferences(
  state: SessionPreferencesState,
  sessionId: string | null,
): SessionPreferences | null {
  if (!sessionId) return null;
  return state.perSession[sessionId] ?? null;
}

/**
 * resolve 済 preferences を返す。未登録なら globalDefaults を返す（fallback）。
 *
 * `send_agent_prompt` を呼ぶ直前の InputArea 等で「常に 3 値が埋まった
 * SessionPreferences」が欲しい場面で使う。
 */
export function resolveSessionPreferences(
  state: SessionPreferencesState,
  sessionId: string | null,
  globalDefaults: SessionPreferences,
): SessionPreferences {
  const p = selectSessionPreferences(state, sessionId);
  if (!p) return globalDefaults;
  return {
    model: p.model ?? globalDefaults.model,
    effort: p.effort ?? globalDefaults.effort,
    permissionMode: p.permissionMode ?? globalDefaults.permissionMode,
  };
}
