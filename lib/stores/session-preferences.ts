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
 * PRJ-012 v1.11.0 (DEC-057): **セッション別 + プロジェクト別** の
 * model / effort / permissionMode を保持する store。DEC-053 の global fallback
 * (dialog.selectedModel/selectedEffort) が project 間で設定を連れ回す leak を
 * 起こしていたため、継承源を project scope (`perProject[projectId]`) に移す。
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
 * ## DEC-057 の設計（v1.11.0）
 *
 * - `perSession: Record<sessionId, SessionPreferences>` — session の現行値（従来通り）
 * - `perProject: Record<projectId, SessionPreferences>` — project 単位の sticky
 *   「最後に使った設定」。新規 session の初期値継承源 + setPreference 時に同時更新
 * - 新規 session 初期化時は `perProject[projectId]` (なければ HARD_DEFAULT) を seed
 *   → **dialog store の selectedModel / selectedEffort は参照しない**
 * - setPreference(sessionId, projectId, patch) で **perSession と perProject 両方**
 *   を更新（project scoped sticky）
 *
 * ## HARD_DEFAULT
 *
 *  - model: null (SDK auto-detect / Claude Max 既定)
 *  - effort: null (SDK adaptive thinking)
 *  - permissionMode: "default"
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
 * - 保存対象: `perSession` + `perProject`
 * - persist version: 2（v1.9.0 / v1.10.x は version 0、migrate で `perProject: {}` を補完）
 */

export interface SessionPreferences {
  /** null = 明示未設定（上位レイヤーで既定解決 / sidecar auto-detect） */
  model: ModelId | null;
  /** null = 明示未設定（SDK adaptive thinking） */
  effort: EffortLevel | null;
  /** "default" が実質的な初期値。null を許容しないのは UI を常に特定モード固定にしたいため。 */
  permissionMode: PermissionMode;
  /**
   * PRJ-012 v1.13.0 (DEC-059 案B): 当 session で「常に許可」と記録された tool 名。
   *
   * PermissionDialog で「このセッションで常に許可」を選んだ tool 名を蓄積する。
   * Permission request 受信時に本配列を先にチェックし、該当する tool は dialog
   * を出さず即 allow で resolve する（auto-resolve 経路）。
   *
   * DEC-057 の sticky 設計と整合: setPreference 経由で perProject にも伝播する。
   */
  allowedTools: string[];
  /**
   * PRJ-012 v1.13.0 (DEC-059 案B): 当 session で「常に拒否」と記録された tool 名。
   * 処理方針は allowedTools と対称 (= 該当 tool は dialog なしで deny)。
   */
  deniedTools: string[];
}

/**
 * DEC-057 v1.11.0: 新規 session 初期化時に `perProject[projectId]` が無い場合の
 * ハードコード default。dialog store には依存しない（project 跨ぎ leak の根治）。
 */
export const HARD_DEFAULT_PREFERENCES: SessionPreferences = Object.freeze({
  model: null,
  effort: null,
  permissionMode: DEFAULT_PERMISSION_MODE,
  /** DEC-059 案B: 初期値は空配列（全ての未許可 tool は dialog 経由で確認）。 */
  allowedTools: [],
  deniedTools: [],
}) as SessionPreferences;

export interface SessionPreferencesState {
  perSession: Record<string, SessionPreferences>;
  /** DEC-057: project 単位の「最後に使った設定」 (sticky)。新 session の継承源。 */
  perProject: Record<string, SessionPreferences>;

  /**
   * 指定 sessionId を `perProject[projectId]` (or hardDefault) で seed する。
   *
   * 既に perSession にエントリがある場合は **上書きしない**（createNewSession から
   * 呼ぶ前提で、lazy 初期化経路で重複呼び出しされても 1 回だけ初期化される）。
   *
   * @param sessionId 初期化対象 session
   * @param projectId 所属 project。未分類 session の場合は null を渡す
   *        (HARD_DEFAULT_PREFERENCES で初期化される)
   * @param hardDefault perProject[projectId] が無い場合の初期値。
   *        通常は HARD_DEFAULT_PREFERENCES を渡す（null を許容したのはテスト
   *        で別値を注入するため）。
   */
  initializeSession: (
    sessionId: string,
    projectId: string | null,
    hardDefault?: SessionPreferences,
  ) => void;

  /**
   * Lazy 初期化。既存 session (v1.10 以前に作成) を UI で開いた際、perSession に
   * エントリが無ければ perProject[projectId] or hardDefault で seed する。
   */
  ensureSessionPreferences: (
    sessionId: string,
    projectId: string | null,
    hardDefault?: SessionPreferences,
  ) => void;

  /**
   * 指定 session + project の preferences を部分更新する。
   *
   * DEC-057 v1.11.0: **perSession と perProject を同時に更新**。projectId が null
   * (未分類 session) の場合は perSession のみ更新し、perProject への反映は行わない
   * （NULL key で保持しても他 project に影響するので無視）。
   *
   * sessionId が未登録の場合は HARD_DEFAULT をベースに patch を当てて新規作成する。
   */
  setPreference: (
    sessionId: string,
    projectId: string | null,
    patch: Partial<SessionPreferences>,
  ) => void;

  /**
   * PRJ-012 v1.13.0 (DEC-059 案B): 「このセッションで常に許可/拒否」を記録する。
   *
   * allow=true なら allowedTools に tool 名を append (重複除去)、
   * かつ deniedTools からは remove する (対称反転の安全策)。
   * allow=false なら deniedTools に append、allowedTools からは remove。
   *
   * DEC-057 sticky 挙動と整合: perSession と **perProject の両方**を同時に更新し、
   * 同 project の次回 session にも継承される。projectId が null (未分類) 時は
   * perSession のみ更新。
   */
  rememberToolPermission: (
    sessionId: string,
    projectId: string | null,
    toolName: string,
    allow: boolean,
  ) => void;

  /**
   * session 削除時に呼ぶ。perSession のみ削除し、perProject はそのまま保持
   * （同 project の次回 session に sticky で継承されるべきため）。
   */
  clearSession: (sessionId: string) => void;

  /**
   * v1.12.0 (DEC-058): project 削除 cascade 用。
   *
   * - `perProject[projectId]` を削除（sticky 値を消す）
   * - `perSession[sid]` から対象 session 群を削除
   *
   * project 削除は非可逆なので sticky 値も同時に破棄するのが正しい挙動
   * （clearSession と違い project 単位で一括 purge）。
   */
  purgeProject: (projectId: string, sessionIds: readonly string[]) => void;

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

/**
 * Persist schema version.
 *
 *  - v0/v1: perSession のみ
 *  - v2 (DEC-057 v1.11.0): perProject 追加
 *  - v3 (DEC-059 v1.13.0): SessionPreferences に `allowedTools` / `deniedTools`
 *    を追加。旧データは空配列で補完する。
 */
const PERSIST_VERSION = 3;

function mergePatch(
  base: SessionPreferences,
  patch: Partial<SessionPreferences>,
): SessionPreferences {
  return {
    model: patch.model !== undefined ? patch.model : base.model,
    effort: patch.effort !== undefined ? patch.effort : base.effort,
    permissionMode:
      patch.permissionMode !== undefined
        ? patch.permissionMode
        : base.permissionMode,
    allowedTools:
      patch.allowedTools !== undefined
        ? patch.allowedTools
        : (base.allowedTools ?? []),
    deniedTools:
      patch.deniedTools !== undefined
        ? patch.deniedTools
        : (base.deniedTools ?? []),
  };
}

export const useSessionPreferencesStore = create<SessionPreferencesState>()(
  persist(
    (set) => ({
      perSession: {},
      perProject: {},

      initializeSession: (sessionId, projectId, hardDefault) =>
        set((state) => {
          if (state.perSession[sessionId]) {
            // 既登録なら touch しない (lazy 呼出で上書き防止)
            return state;
          }
          const seed: SessionPreferences =
            (projectId !== null && state.perProject[projectId]) ||
            hardDefault ||
            HARD_DEFAULT_PREFERENCES;
          return {
            perSession: {
              ...state.perSession,
              [sessionId]: {
                model: seed.model,
                effort: seed.effort,
                permissionMode: seed.permissionMode,
                // DEC-059 案B (v1.13.0): allowedTools / deniedTools も sticky 継承。
                // 旧形 (v1.12.x 以前) データから seed される場合は空配列で補完。
                allowedTools: seed.allowedTools ?? [],
                deniedTools: seed.deniedTools ?? [],
              },
            },
          };
        }),

      ensureSessionPreferences: (sessionId, projectId, hardDefault) =>
        set((state) => {
          if (state.perSession[sessionId]) return state;
          const seed: SessionPreferences =
            (projectId !== null && state.perProject[projectId]) ||
            hardDefault ||
            HARD_DEFAULT_PREFERENCES;
          return {
            perSession: {
              ...state.perSession,
              [sessionId]: {
                model: seed.model,
                effort: seed.effort,
                permissionMode: seed.permissionMode,
                // DEC-059 案B (v1.13.0): allowedTools / deniedTools も sticky 継承。
                // 旧形 (v1.12.x 以前) データから seed される場合は空配列で補完。
                allowedTools: seed.allowedTools ?? [],
                deniedTools: seed.deniedTools ?? [],
              },
            },
          };
        }),

      setPreference: (sessionId, projectId, patch) =>
        set((state) => {
          const prevSession =
            state.perSession[sessionId] ?? HARD_DEFAULT_PREFERENCES;
          const nextSession = mergePatch(prevSession, patch);

          const nextPerSession = {
            ...state.perSession,
            [sessionId]: nextSession,
          };

          // projectId が null (未分類) の場合は perProject を触らない
          if (projectId === null) {
            return { perSession: nextPerSession };
          }

          const prevProject =
            state.perProject[projectId] ?? HARD_DEFAULT_PREFERENCES;
          const nextProject = mergePatch(prevProject, patch);

          return {
            perSession: nextPerSession,
            perProject: {
              ...state.perProject,
              [projectId]: nextProject,
            },
          };
        }),

      rememberToolPermission: (sessionId, projectId, toolName, allow) =>
        set((state) => {
          const prevSession =
            state.perSession[sessionId] ?? HARD_DEFAULT_PREFERENCES;

          const prevAllowed = prevSession.allowedTools ?? [];
          const prevDenied = prevSession.deniedTools ?? [];
          const withoutTool = (arr: readonly string[]): string[] =>
            arr.filter((t) => t !== toolName);

          const nextSessionPatch: Partial<SessionPreferences> = allow
            ? {
                allowedTools: prevAllowed.includes(toolName)
                  ? [...prevAllowed]
                  : [...prevAllowed, toolName],
                deniedTools: withoutTool(prevDenied),
              }
            : {
                allowedTools: withoutTool(prevAllowed),
                deniedTools: prevDenied.includes(toolName)
                  ? [...prevDenied]
                  : [...prevDenied, toolName],
              };

          const nextSession = mergePatch(prevSession, nextSessionPatch);
          const nextPerSession = {
            ...state.perSession,
            [sessionId]: nextSession,
          };

          if (projectId === null) {
            return { perSession: nextPerSession };
          }

          const prevProject =
            state.perProject[projectId] ?? HARD_DEFAULT_PREFERENCES;
          const prevProjectAllowed = prevProject.allowedTools ?? [];
          const prevProjectDenied = prevProject.deniedTools ?? [];
          const withoutToolProj = (arr: readonly string[]): string[] =>
            arr.filter((t) => t !== toolName);

          const nextProjectPatch: Partial<SessionPreferences> = allow
            ? {
                allowedTools: prevProjectAllowed.includes(toolName)
                  ? [...prevProjectAllowed]
                  : [...prevProjectAllowed, toolName],
                deniedTools: withoutToolProj(prevProjectDenied),
              }
            : {
                allowedTools: withoutToolProj(prevProjectAllowed),
                deniedTools: prevProjectDenied.includes(toolName)
                  ? [...prevProjectDenied]
                  : [...prevProjectDenied, toolName],
              };
          const nextProject = mergePatch(prevProject, nextProjectPatch);
          return {
            perSession: nextPerSession,
            perProject: {
              ...state.perProject,
              [projectId]: nextProject,
            },
          };
        }),

      clearSession: (sessionId) =>
        set((state) => {
          if (!state.perSession[sessionId]) return state;
          const next = { ...state.perSession };
          delete next[sessionId];
          // perProject は保持（同 project の次 session に継承されるべき）
          return { perSession: next };
        }),

      purgeProject: (projectId, sessionIds) =>
        set((state) => {
          // perProject[projectId] の削除
          let nextPerProject = state.perProject;
          if (projectId in state.perProject) {
            nextPerProject = { ...state.perProject };
            delete nextPerProject[projectId];
          }
          // perSession から対象 session 群を削除
          let nextPerSession = state.perSession;
          if (sessionIds.length > 0) {
            const ids = new Set(sessionIds);
            let changed = false;
            const purged: Record<string, SessionPreferences> = {};
            for (const [sid, pref] of Object.entries(state.perSession)) {
              if (ids.has(sid)) {
                changed = true;
                continue;
              }
              purged[sid] = pref;
            }
            if (changed) {
              nextPerSession = purged;
            }
          }
          if (
            nextPerProject === state.perProject &&
            nextPerSession === state.perSession
          ) {
            return state;
          }
          return {
            perProject: nextPerProject,
            perSession: nextPerSession,
          };
        }),

      reset: () => set({ perSession: {}, perProject: {} }),
    }),
    {
      name: "sumi:session-preferences",
      storage: safeStorage,
      version: PERSIST_VERSION,
      partialize: (state) => ({
        perSession: state.perSession,
        perProject: state.perProject,
      }),
      /**
       * 旧形データの migration:
       *  - v0/v1 (perProject 無し) → v2: perProject を空 object で補完 (DEC-057)
       *  - v2 (allowedTools/deniedTools 無し) → v3: 各 SessionPreferences エントリに
       *    空配列で補完 (DEC-059 案B / v1.13.0)。既存の model / effort /
       *    permissionMode はそのまま保持。
       *
       * いずれの経路も破壊的な値の消失は無い（空配列 default は「未記録 = dialog で
       * 確認」と等価）。
       */
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") {
          return {
            perSession: {},
            perProject: {},
          } as Partial<SessionPreferencesState>;
        }
        const p = persisted as Partial<SessionPreferencesState>;
        const backfill = (
          entries: Record<string, SessionPreferences> | undefined,
        ): Record<string, SessionPreferences> => {
          if (!entries) return {};
          const out: Record<string, SessionPreferences> = {};
          for (const [k, v] of Object.entries(entries)) {
            out[k] = {
              model: v?.model ?? null,
              effort: v?.effort ?? null,
              permissionMode:
                v?.permissionMode ?? HARD_DEFAULT_PREFERENCES.permissionMode,
              allowedTools: Array.isArray(v?.allowedTools)
                ? v.allowedTools
                : [],
              deniedTools: Array.isArray(v?.deniedTools) ? v.deniedTools : [],
            };
          }
          return out;
        };
        return {
          perSession: backfill(p.perSession),
          perProject: backfill(p.perProject),
        } as Partial<SessionPreferencesState>;
      },
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
 * DEC-057 v1.11.0: 指定 project の sticky 値を返す。未登録なら null。
 * 新規 session 初期化時やデバッグで参照する。
 */
export function selectProjectPreferences(
  state: SessionPreferencesState,
  projectId: string | null,
): SessionPreferences | null {
  if (!projectId) return null;
  return state.perProject[projectId] ?? null;
}

/**
 * resolve 済 preferences を返す。未登録なら globalDefaults を返す（fallback）。
 *
 * `send_agent_prompt` を呼ぶ直前の InputArea 等で「常に 3 値が埋まった
 * SessionPreferences」が欲しい場面で使う。
 *
 * DEC-057 v1.11.0: 呼出側が渡す globalDefaults は **当該 project の perProject
 * (or HARD_DEFAULT)** であるべき。dialog store の selectedModel/selectedEffort は
 * 使わない（project leak 防止）。
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
    // DEC-059 案B (v1.13.0): allowedTools / deniedTools は session 側を
    // 優先 (globalDefaults は fallback)。空配列 merge は行わず session 値が
    // 無い場合のみ globalDefaults を採用する (sticky 上書き防止)。
    allowedTools: p.allowedTools ?? globalDefaults.allowedTools ?? [],
    deniedTools: p.deniedTools ?? globalDefaults.deniedTools ?? [],
  };
}
