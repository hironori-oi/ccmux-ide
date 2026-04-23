"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { readTextFile, writeTextFile, stat } from "@tauri-apps/plugin-fs";

import { detectLang } from "@/lib/detect-lang";
import type { OpenFile } from "@/lib/types";

/**
 * PRJ-012 v3.4 Chunk A (DEC-034 Must 1): ファイルエディタ統合用 store。
 *
 * ## 方針
 * - ProjectTree ファイルクリック → `openFile(path)` でエディタ open
 * - 同一 path が既に open なら activeFileId にするのみ（重複 open 抑止）
 * - 複数ファイルをタブ管理、`activeFileId` が現在表示中
 * - `content` と `savedContent` の diff で dirty 判定、UI タブに `●` 表示
 * - `saveFile` で `@tauri-apps/plugin-fs::writeTextFile` を呼ぶ（capabilities で
 *   `fs:allow-write-text-file` 済）
 *
 * ## persist 戦略
 * - persist 対象は `openFiles` の **パスリストのみ**（content / dirty / savedContent
 *   は再起動時に信用できないため破棄）
 * - 再起動時は path list を受け取り、各 path に対して再 load を試みる
 *   （lazy-rehydrate、ファイルが既に存在しない場合は silent drop）
 * - `activeFileId` は persist する（新しい id に再 assign される）
 *
 * ## API（EditorTabs / FileEditor から参照）
 * ```ts
 * const openFile = useEditorStore((s) => s.openFile);
 * const closeFile = useEditorStore((s) => s.closeFile);
 * const setActiveFile = useEditorStore((s) => s.setActiveFile);
 * const updateContent = useEditorStore((s) => s.updateContent);
 * const saveFile = useEditorStore((s) => s.saveFile);
 * ```
 */

/** persist 用 localStorage key。 */
export const EDITOR_STORAGE_KEY = "ccmux-editor-open-files";

/** 1MB 以上のファイルは open を拒否（警告表示）。 */
export const MAX_OPEN_FILE_BYTES = 1024 * 1024;

/**
 * PM-968: asset:// プロトコルで直接表示するバイナリ拡張子。
 * これらは readTextFile をスキップし、1MB 制限の対象外とする
 * （FileViewer が convertFileSrc で iframe/img/video に渡す）。
 */
const BINARY_VIEWER_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "ico",
  "avif",
  "svg",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
]);

/** バイナリビューワで表示する拡張子か（readTextFile をスキップして良いか） */
function isBinaryViewerFile(path: string): boolean {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return false;
  const ext = path.slice(idx + 1).toLowerCase();
  return BINARY_VIEWER_EXTENSIONS.has(ext);
}

/** バイナリビューワ用のより緩い上限（50MB、動画は超えうるが別途判断） */
const MAX_BINARY_VIEWER_BYTES = 50 * 1024 * 1024;

/**
 * PM-924 (2026-04-20): Editor 分割 pane の既定 id。
 *
 * Chat の DEFAULT_PANE_ID ("main") と同様、最初の 1 pane は固定 id "main" を使用する。
 * 後方互換 API（paneId 引数なし）は常にこの main pane に作用する。
 */
export const EDITOR_DEFAULT_PANE_ID = "main";

/**
 * Editor 分割の最大 pane 数。
 * Chat の MAX_PANES と揃える。PM-937 (2026-04-20) で 4 pane (2x2 grid) 対応。
 */
export const EDITOR_MAX_PANES = 4;

/**
 * PM-924 (2026-04-20): 1 pane 分の editor タブ state。
 *
 * - `openFileIds`: この pane で表示中のファイル id 一覧（`openFiles` プールへの参照）
 * - `activeFileId`: この pane で現在 focus 中のファイル id
 *
 * 同じ file を両 pane の openFileIds に入れることで「同じファイルを両 pane で開く」
 * ことを許容する（VSCode 的 UX）。content は `openFiles` プールで共有されるため
 * 両 pane での編集は自動同期する。
 */
export interface EditorPaneState {
  openFileIds: string[];
  activeFileId: string | null;
}

/**
 * 1 つの開かれたファイル型は `lib/types.ts` の `OpenFile` を単一情報源とする。
 * 本 store からも re-export して、既存 import パス（`@/lib/stores/editor`）を
 * 壊さない。
 */
export type { OpenFile } from "@/lib/types";

/**
 * Shell の main 領域がチャットとエディタのどちらを表示しているか。
 *
 * - `chat`     : ChatPanel（既定）
 * - `editor`   : EditorPane（ファイル open 時に自動遷移）
 * - `terminal` : TerminalPane (PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル、
 *                xterm.js + Rust portable-pty で cmd.exe / bash / vim 等を実行)
 * - `preview`  : PreviewPane (PRJ-012 v1.0 / PM-925: ブラウザプレビュー、
 *                iframe + 外部ブラウザ fallback のハイブリッド方式で
 *                `http://localhost:*` の dev server を IDE 内に埋め込む)
 *
 * ProjectTree でのファイルクリック時に `openFile` 内部で `setViewMode("editor")`
 * を呼ぶことで Editor に自動切替。Shell の TitleBar 直下 Tabs で手動切替も可能。
 */
export type EditorViewMode =
  | "chat"
  | "editor"
  | "terminal"
  | "preview"
  /** PM-969: ヘテロ分割モード。Tray Bar から任意の項目を任意の slot に DnD で配置可能。 */
  | "workspace";

interface EditorState {
  /**
   * 全 pane で共有される読込済ファイルのプール。
   *
   * 複数 pane で同じ file を表示することも可能（両 pane の `openFileIds` に同じ id が
   * 含まれる形）。content は 1 箇所で保持するので片方で編集すれば他方にも反映される。
   */
  openFiles: OpenFile[];

  /**
   * PM-924: pane ごとの editor タブ state。初期は main pane 1 件のみ。
   *
   * 後方互換のため、paneId 引数なしの action（openFile / closeFile / ...）は
   * すべて `activeEditorPaneId`（または main）に対して動作する。
   */
  editorPanes: Record<string, EditorPaneState>;
  /** 現在 focus 中の pane id（新規 open や外部 action のデフォルトターゲット）。 */
  activeEditorPaneId: string;

  /**
   * 後方互換用 compat getter。activeEditorPane.activeFileId を返す。
   *
   * 既存呼出元（FileEditor / EditorTabs 以外）が `s.activeFileId` を読めるよう
   * selector ではなく state field として維持する。action 側で editorPanes と
   * 同期更新する。
   */
  activeFileId: string | null;

  /** main 領域の表示モード（chat or editor）、persist 対象外。 */
  viewMode: EditorViewMode;

  /** 表示モード切替（persist しない）。 */
  setViewMode: (mode: EditorViewMode) => void;

  // --- PM-924: pane lifecycle ---
  /** pane を 1 つ追加。EDITOR_MAX_PANES 到達時は no-op + 既存 active を返す。 */
  addEditorPane: () => string;
  /** pane 削除。0 件にならないよう最後の 1 件は削除不可。 */
  removeEditorPane: (paneId: string) => void;
  /** focus pane を切替。 */
  setActiveEditorPane: (paneId: string) => void;

  /**
   * 指定 path を open。
   *
   * - 既に同一 path が openFiles プールにあればその id を当該 pane の active に
   *   （必要なら openFileIds にも追加）、content は再 read しない
   * - 未 open なら新規 OpenFile を push + pane の active に設定、非同期で content load
   * - 1MB 以上は error fallback（本文 read しない、title / path のみ保持）
   * - `paneId` 省略時は `activeEditorPaneId`
   */
  openFile: (path: string, paneId?: string) => Promise<void>;

  /**
   * 指定 id を指定 pane から閉じる。
   *
   * - dirty のまま close した場合の確認 dialog は **呼出側（EditorTabs）で実施**
   *   し、ここではそのまま削除する。
   * - active が close されたら隣接タブ（右優先、無ければ左）を active に。
   * - どの pane にも属さなくなった file は openFiles プールからも除去する。
   * - `paneId` 省略時は `activeEditorPaneId`。
   */
  closeFile: (id: string, paneId?: string) => void;

  /** 他のタブを全て閉じる（指定 id のみ残す）。dirty チェックは呼出側。 */
  closeOtherFiles: (id: string, paneId?: string) => void;

  /** active を切替。null を渡すと未選択に。 */
  setActiveFile: (id: string | null, paneId?: string) => void;

  /**
   * エディタからの編集で content を差し替える。
   *
   * dirty は `content !== savedContent` で再計算する。
   */
  updateContent: (id: string, content: string) => void;

  /**
   * writeTextFile で実ファイルに保存。
   *
   * 成功時は savedContent = content に同期し、dirty = false。
   * 失敗時は error をセット（UI で toast + Alert）。
   */
  saveFile: (id: string) => Promise<void>;

  /** 実ファイルから再読込（dirty を discard）。 */
  reloadFile: (id: string) => Promise<void>;
}

/** path から basename を取り出す（同期）。 */
function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** crypto.randomUUID の fallback 付きラッパ。 */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ef-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** PM-924: 新しい editor pane id を生成。 */
function newEditorPaneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `epane-${crypto.randomUUID()}`;
  }
  return `epane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 空の EditorPaneState を生成。
 */
function makeEmptyEditorPane(): EditorPaneState {
  return { openFileIds: [], activeFileId: null };
}

/** SSR 時の localStorage 不在を guard した JSONStorage。 */
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

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      openFiles: [],
      editorPanes: { [EDITOR_DEFAULT_PANE_ID]: makeEmptyEditorPane() },
      activeEditorPaneId: EDITOR_DEFAULT_PANE_ID,
      activeFileId: null,
      viewMode: "chat",

      setViewMode: (mode) => {
        set({ viewMode: mode });
      },

      // --- PM-924: pane lifecycle ---
      addEditorPane: () => {
        const state = get();
        const paneIds = Object.keys(state.editorPanes);
        if (paneIds.length >= EDITOR_MAX_PANES) {
          return state.activeEditorPaneId;
        }
        const id = newEditorPaneId();
        // 新 pane は空で start（VSCode も split 時は empty group）。
        set({
          editorPanes: {
            ...state.editorPanes,
            [id]: makeEmptyEditorPane(),
          },
          activeEditorPaneId: id,
        });
        return id;
      },

      removeEditorPane: (paneId) => {
        const state = get();
        const paneIds = Object.keys(state.editorPanes);
        if (paneIds.length <= 1) return;
        if (!state.editorPanes[paneId]) return;
        const { [paneId]: _removed, ...rest } = state.editorPanes;
        void _removed;
        // 消える pane にしか属さなかった file は openFiles プールから除去する。
        const remainingIds = new Set<string>();
        Object.values(rest).forEach((p) => {
          p.openFileIds.forEach((id) => remainingIds.add(id));
        });
        const nextOpenFiles = state.openFiles.filter((f) =>
          remainingIds.has(f.id)
        );
        let nextActivePane = state.activeEditorPaneId;
        if (nextActivePane === paneId) {
          nextActivePane = Object.keys(rest)[0];
        }
        const nextActiveFileId =
          rest[nextActivePane]?.activeFileId ?? null;
        set({
          editorPanes: rest,
          activeEditorPaneId: nextActivePane,
          openFiles: nextOpenFiles,
          activeFileId: nextActiveFileId,
        });
      },

      setActiveEditorPane: (paneId) => {
        const state = get();
        if (!state.editorPanes[paneId]) return;
        set({
          activeEditorPaneId: paneId,
          activeFileId: state.editorPanes[paneId].activeFileId,
        });
      },

      openFile: async (path, paneId) => {
        // ファイル open 時は自動で editor モードに遷移
        set({ viewMode: "editor" });

        const targetPaneId = paneId ?? get().activeEditorPaneId;
        // 念のため pane 存在確認（存在しなければ main にフォールバック）。
        const resolvedPaneId = get().editorPanes[targetPaneId]
          ? targetPaneId
          : EDITOR_DEFAULT_PANE_ID;

        // 既に openFiles プールに同一 path があるなら content 再 read しない
        const existing = get().openFiles.find((f) => f.path === path);
        if (existing) {
          set((state) => {
            const pane =
              state.editorPanes[resolvedPaneId] ?? makeEmptyEditorPane();
            const openFileIds = pane.openFileIds.includes(existing.id)
              ? pane.openFileIds
              : [...pane.openFileIds, existing.id];
            return {
              editorPanes: {
                ...state.editorPanes,
                [resolvedPaneId]: {
                  openFileIds,
                  activeFileId: existing.id,
                },
              },
              activeFileId:
                resolvedPaneId === state.activeEditorPaneId
                  ? existing.id
                  : state.activeFileId,
            };
          });
          return;
        }

        const id = newId();
        const title = basename(path);
        const language = detectLang(path);
        // PM-975: 現在の session を取得してタグ付け（動的 import で循環参照回避）
        let creatingSessionId: string | null = null;
        try {
          const { useSessionStore } = await import("@/lib/stores/session");
          creatingSessionId = useSessionStore.getState().currentSessionId;
        } catch {
          // session store 未利用の context ではタグなし
        }

        // 先に placeholder を挿入、active 化してから実 read
        const placeholder: OpenFile = {
          id,
          path,
          title,
          language,
          content: "",
          savedContent: "",
          dirty: false,
          loading: true,
          error: null,
          creatingSessionId,
        };
        set((state) => {
          const pane =
            state.editorPanes[resolvedPaneId] ?? makeEmptyEditorPane();
          return {
            openFiles: [...state.openFiles, placeholder],
            editorPanes: {
              ...state.editorPanes,
              [resolvedPaneId]: {
                openFileIds: [...pane.openFileIds, id],
                activeFileId: id,
              },
            },
            activeFileId:
              resolvedPaneId === state.activeEditorPaneId
                ? id
                : state.activeFileId,
          };
        });

        try {
          const isBinaryViewer = isBinaryViewerFile(path);

          // size チェック（バイナリは緩い上限、テキストは 1MB）
          try {
            const meta = await stat(path);
            const size = meta.size ?? 0;
            const limit = isBinaryViewer
              ? MAX_BINARY_VIEWER_BYTES
              : MAX_OPEN_FILE_BYTES;
            if (size > limit) {
              set((state) => ({
                openFiles: state.openFiles.map((f) =>
                  f.id === id
                    ? {
                        ...f,
                        loading: false,
                        error: `ファイルが大きすぎます（${humanSize(size)} / 上限 ${humanSize(
                          limit
                        )}）`,
                      }
                    : f
                ),
              }));
              return;
            }
          } catch {
            // stat が失敗しても読込を試す（一部 FS で stat が使えないケース）
          }

          // PM-968: バイナリ viewer 対応拡張子は readTextFile を呼ばずに
          // loading:false で終わらせる。FileViewer 側が convertFileSrc(path)
          // を使って iframe / img / video / audio に直接渡す。
          if (isBinaryViewer) {
            set((state) => ({
              openFiles: state.openFiles.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      loading: false,
                      content: "",
                      savedContent: "",
                      dirty: false,
                      error: null,
                    }
                  : f
              ),
            }));
            return;
          }

          const content = await readTextFile(path);
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    content,
                    savedContent: content,
                    dirty: false,
                    loading: false,
                    error: null,
                  }
                : f
            ),
          }));
        } catch (e) {
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    loading: false,
                    error: `読込に失敗しました: ${String(e)}`,
                  }
                : f
            ),
          }));
        }
      },

      closeFile: (id, paneId) => {
        set((state) => {
          const targetPaneId = paneId ?? state.activeEditorPaneId;
          const pane = state.editorPanes[targetPaneId];
          if (!pane) return state;
          const idx = pane.openFileIds.indexOf(id);
          if (idx < 0) return state;

          const nextIds = pane.openFileIds.filter((x) => x !== id);
          let nextPaneActive = pane.activeFileId;
          if (pane.activeFileId === id) {
            // 右優先、無ければ左、無ければ null
            const candidate =
              pane.openFileIds[idx + 1] ?? pane.openFileIds[idx - 1] ?? null;
            nextPaneActive = candidate ?? null;
          }
          const nextPanes = {
            ...state.editorPanes,
            [targetPaneId]: {
              openFileIds: nextIds,
              activeFileId: nextPaneActive,
            },
          };

          // 他 pane でも参照されていなければ openFiles プールから削除
          const stillReferenced = Object.values(nextPanes).some((p) =>
            p.openFileIds.includes(id)
          );
          const nextFiles = stillReferenced
            ? state.openFiles
            : state.openFiles.filter((f) => f.id !== id);

          return {
            openFiles: nextFiles,
            editorPanes: nextPanes,
            activeFileId:
              targetPaneId === state.activeEditorPaneId
                ? nextPaneActive
                : state.activeFileId,
          };
        });
      },

      closeOtherFiles: (id, paneId) => {
        set((state) => {
          const targetPaneId = paneId ?? state.activeEditorPaneId;
          const pane = state.editorPanes[targetPaneId];
          if (!pane) return state;
          if (!pane.openFileIds.includes(id)) return state;

          const nextPanes = {
            ...state.editorPanes,
            [targetPaneId]: {
              openFileIds: [id],
              activeFileId: id,
            },
          };

          // 他 pane で参照されているかチェックし、孤立 file を openFiles から除去
          const referenced = new Set<string>();
          Object.values(nextPanes).forEach((p) => {
            p.openFileIds.forEach((fid) => referenced.add(fid));
          });
          const nextFiles = state.openFiles.filter((f) => referenced.has(f.id));

          return {
            openFiles: nextFiles,
            editorPanes: nextPanes,
            activeFileId:
              targetPaneId === state.activeEditorPaneId
                ? id
                : state.activeFileId,
          };
        });
      },

      setActiveFile: (id, paneId) => {
        const state = get();
        const targetPaneId = paneId ?? state.activeEditorPaneId;
        const pane = state.editorPanes[targetPaneId];
        if (!pane) return;

        if (id === null) {
          set({
            editorPanes: {
              ...state.editorPanes,
              [targetPaneId]: { ...pane, activeFileId: null },
            },
            activeFileId:
              targetPaneId === state.activeEditorPaneId
                ? null
                : state.activeFileId,
          });
          return;
        }
        // pane の openFileIds に無ければ reject（openFile 経由で追加すべき）。
        if (!pane.openFileIds.includes(id)) return;
        set({
          editorPanes: {
            ...state.editorPanes,
            [targetPaneId]: { ...pane, activeFileId: id },
          },
          activeFileId:
            targetPaneId === state.activeEditorPaneId
              ? id
              : state.activeFileId,
        });
      },

      updateContent: (id, content) => {
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  content,
                  dirty: content !== f.savedContent,
                }
              : f
          ),
        }));
      },

      saveFile: async (id) => {
        const file = get().openFiles.find((f) => f.id === id);
        if (!file) return;
        // loading 中（まだ read が終わってない）は save しない
        if (file.loading) return;

        try {
          await writeTextFile(file.path, file.content);
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    savedContent: f.content,
                    dirty: false,
                    error: null,
                  }
                : f
            ),
          }));
        } catch (e) {
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    error: `保存に失敗しました: ${String(e)}`,
                  }
                : f
            ),
          }));
          throw e;
        }
      },

      reloadFile: async (id) => {
        const file = get().openFiles.find((f) => f.id === id);
        if (!file) return;
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.id === id ? { ...f, loading: true, error: null } : f
          ),
        }));
        try {
          const content = await readTextFile(file.path);
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    content,
                    savedContent: content,
                    dirty: false,
                    loading: false,
                    error: null,
                  }
                : f
            ),
          }));
        } catch (e) {
          set((state) => ({
            openFiles: state.openFiles.map((f) =>
              f.id === id
                ? {
                    ...f,
                    loading: false,
                    error: `読込に失敗しました: ${String(e)}`,
                  }
                : f
            ),
          }));
        }
      },
    }),
    {
      name: EDITOR_STORAGE_KEY,
      storage: safeStorage,
      version: 2,
      /**
       * PM-924: v1 → v2 migration。
       *
       * v1 schema は `openFiles` + `activeFileId` のみ。v2 で `editorPanes` /
       * `activeEditorPaneId` を追加した。migrate でフィールドを足し、既存 openFiles を
       * main pane に流し込むことで split 切替前の UX を完全保持する。
       */
      migrate: (persistedState, version) => {
        const s = (persistedState ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const openFiles = Array.isArray(s.openFiles) ? (s.openFiles as OpenFile[]) : [];
          const activeFileId = (s.activeFileId as string | null | undefined) ?? null;
          s.editorPanes = {
            [EDITOR_DEFAULT_PANE_ID]: {
              openFileIds: openFiles.map((f) => f.id),
              activeFileId,
            },
          };
          s.activeEditorPaneId = EDITOR_DEFAULT_PANE_ID;
        }
        return s;
      },
      /**
       * persist 対象は openFiles の **path list のみ**（content は信用しない）。
       * PM-924 v2: editorPanes / activeEditorPaneId も persist し、再起動後も
       * split 状態が復元されるようにする（v1 schema は activeFileId のみだった）。
       *
       * 復元時は placeholder state として `loading: true` で push し、
       * onRehydrateStorage で各 path を 1 つずつ reloadFile する。
       */
      partialize: (state) => ({
        openFiles: state.openFiles.map((f) => ({
          id: f.id,
          path: f.path,
          title: f.title,
          language: f.language,
          content: "",
          savedContent: "",
          dirty: false,
          loading: true,
          error: null,
        })),
        editorPanes: state.editorPanes,
        activeEditorPaneId: state.activeEditorPaneId,
        activeFileId: state.activeFileId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[editor-store] rehydrate failed:", error);
          return;
        }
        if (!state) return;
        if (!Array.isArray(state.openFiles)) {
          state.openFiles = [];
          state.activeFileId = null;
        }
        // PM-924: v1 → v2 migration。editorPanes が無ければ main pane に
        // 全 openFiles を移す（旧挙動と互換）。
        if (
          !state.editorPanes ||
          typeof state.editorPanes !== "object" ||
          Object.keys(state.editorPanes).length === 0
        ) {
          state.editorPanes = {
            [EDITOR_DEFAULT_PANE_ID]: {
              openFileIds: state.openFiles.map((f) => f.id),
              activeFileId: state.activeFileId ?? null,
            },
          };
          state.activeEditorPaneId = EDITOR_DEFAULT_PANE_ID;
        }
        if (!state.activeEditorPaneId || !state.editorPanes[state.activeEditorPaneId]) {
          state.activeEditorPaneId =
            Object.keys(state.editorPanes)[0] ?? EDITOR_DEFAULT_PANE_ID;
        }
        // TDZ 回避（2026-04-20 修正）:
        // zustand persist は storage が同期 null を返すと `create()` 実行中に
        // onRehydrateStorage callback を発火してしまい、そこで
        // `useEditorStore.getState()` を参照すると TDZ で
        // `ReferenceError: Cannot access 'useEditorStore' before initialization`
        // が出る。`setTimeout(fn, 0)` で macrotask に遅延して `create()` 完了後に
        // 実行する。
        setTimeout(() => {
          void (async () => {
            const live = useEditorStore.getState();
            const ids = state.openFiles.map((f) => f.id);
            // activeFileId 整合性確認
            if (
              state.activeFileId &&
              !ids.includes(state.activeFileId) &&
              ids.length > 0
            ) {
              useEditorStore.setState({ activeFileId: ids[0] });
            }
            for (const id of ids) {
              try {
                await live.reloadFile(id);
              } catch {
                // reloadFile 内部で error 状態セット済
              }
            }
          })();
        }, 0);
      },
    }
  )
);
// -----------------------------------------------------------------------------
// 補助関数
// -----------------------------------------------------------------------------

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
