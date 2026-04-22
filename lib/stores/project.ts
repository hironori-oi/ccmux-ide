"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

import type {
  EffortLevel,
  ModelId,
  ProjectSummary,
  RegisteredProject,
} from "@/lib/types";
import { EFFORT_CHOICES, modelIdToSdkId } from "@/lib/types";
import { callTauri } from "@/lib/tauri-api";

/**
 * PRJ-012 v3.2 Chunk A（DEC-031）: registry 型 project store。
 *
 * ## 方針（DEC-031 Workspace 概念の完全撤去）
 * - 旧 Workspace（ルートディレクトリ hardcode → 配下 auto-detect）は **完全撤去**
 * - すべて「Project = 任意ディレクトリ」の単層モデルに統一
 * - persist key: `ccmux-project-registry` （旧 `ccmux-workspace` / `ccmux-ide.projects.extra-paths` は廃止）
 * - 起動時 stale check: 消えたパスは自動で除外
 *
 * ## API 契約（Chunk B / C から参照）
 * ```ts
 * const activeProjectId = useProjectStore((s) => s.activeProjectId);
 * const getActivePath = useProjectStore((s) => s.getActivePath);
 * const projects = useProjectStore((s) => s.projects);
 * const updateProject = useProjectStore((s) => s.updateProject);
 * ```
 */

/** persist 用 localStorage key（DEC-054 で `ccmux-project-registry` から改名）。 */
export const PROJECT_REGISTRY_STORAGE_KEY = "sumi-project-registry";

/** DEC-054: 旧 key（`ccmux-project-registry`）。migration 時に読み取って移行し、移行後削除する。 */
const LEGACY_PROJECT_REGISTRY_KEY = "ccmux-project-registry";

/**
 * PRJ-012 v3.3 / Chunk B (DEC-033): sidecar の生存状態。
 *
 * - `stopped`  : 起動していない（初期値 / kill 済）
 * - `starting` : invoke("start_agent_sidecar") 実行中
 * - `running`  : sidecar 起動成功、prompt 送信可能
 * - `stopping` : invoke("stop_agent_sidecar") 実行中
 * - `error`    : 起動 / 停止が失敗し、次回 ensure まで待機中
 *
 * persist 対象外（起動時は常に `stopped` から再 lazy-start）。
 */
export type SidecarStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/**
 * 旧 localStorage key 郡（v3.1 以前）。起動時に silently 破棄する。
 * 後方互換で残さない（DEC-031 の後方互換方針）。
 */
const LEGACY_STORAGE_KEYS = [
  "ccmux-workspace",
  "ccmux-ide.projects.extra-paths",
] as const;

/** `+` ボタン等から addProject 時のオプション。 */
export interface RegisterProjectOptions {
  /** 追加後に activeProjectId に設定するか（既定 true）。 */
  activate?: boolean;
}

/**
 * ProjectRail の 8 色アクセント（`ACCENT_CLASSES` 同値）と揃えた固定長。
 * colorIdx は 0..7 で hash stable。
 */
const COLOR_PALETTE_SIZE = 8;

interface ProjectState {
  /** 登録済み project 一覧（追加順 or activatedAt 最新順 — 追加順で固定）。 */
  projects: RegisteredProject[];
  /** 現在選択中の project id。null は未選択。 */
  activeProjectId: string | null;
  /** persist からの rehydrate 完了フラグ（stale check の 1 回限定 guard）。 */
  hydrated: boolean;
  /** stale check 等の一時的フラグ。 */
  isLoading: boolean;
  /** 最新エラー（UI banner 用）。 */
  error: string | null;

  /**
   * v3.3 (DEC-033): project id ごとの sidecar 状態。
   *
   * persist 対象外（partialize で除外）。起動時は空 map で、Lazy start に
   * よって初回 `ensureSidecarRunning` 時に invoke("start_agent_sidecar") 実行。
   * RegisteredProject 本体に寄せず分離することで、persist サイクルで誤って
   * 「running」が復元される事故を防ぐ。
   */
  sidecarStatus: Record<string, SidecarStatus>;

  // ---- actions ----
  /** 任意ディレクトリを project として登録。既に同一 path があれば activate のみ。 */
  registerProject: (
    path: string,
    options?: RegisterProjectOptions
  ) => Promise<RegisteredProject>;
  /**
   * project を登録解除。
   *
   * v3.3 (DEC-033): 登録解除前に `stopSidecar(id)` を待機し、Rust 側の
   * HashMap からも remove する。active だった場合は activeProjectId = null。
   */
  removeProject: (id: string) => Promise<void>;
  /**
   * active project を切替。存在しない id は no-op。
   *
   * v3.3 (DEC-033): 切替後に Lazy `ensureSidecarRunning(id)` を発火する
   * （fire-and-forget、失敗は toast で通知）。
   */
  setActiveProject: (id: string | null) => void;
  /** 任意フィールドを部分更新（lastSessionId / preferredModel 等）。 */
  updateProject: (id: string, patch: Partial<RegisteredProject>) => void;
  /** rehydrate 直後に 1 回呼び、存在しない path を除外する。 */
  pruneStaleProjects: () => Promise<void>;

  // ---- v3.3 DEC-033: sidecar lifecycle ----
  /**
   * 指定 project の sidecar が未起動なら start、起動済なら no-op。
   *
   * - status が "running" / "starting" なら no-op
   * - "stopping" は完了を待たず短絡（呼出側は後で再試行）
   * - "stopped" / "error" / undefined なら invoke("start_agent_sidecar", { projectId, cwd })
   */
  ensureSidecarRunning: (id: string) => Promise<void>;
  /**
   * 指定 project の sidecar を停止する。
   *
   * - status が "running" / "error" なら invoke("stop_agent_sidecar", { projectId })
   * - "stopped" なら no-op（HashMap に無いので safe）
   */
  stopSidecar: (id: string) => Promise<void>;
  /**
   * v3.5.16 PM-840 (Claude Desktop 風 Live 切替):
   * 指定 project の sidecar を **stop → start** で即再起動し、新しい
   * model / effort を反映する。
   *
   * - 現在 session の `sdkSessionId` があれば `resume` として sidecar 起動時に
   *   渡さず（sidecar 起動時点では resume 概念はない）、次回 `send_agent_prompt`
   *   の `resume` 引数に **自動継続** される（session store の sdkSessionId は保持）。
   *   結果として会話 context は切れない（Claude Desktop と同等 UX）。
   * - 成功時に `updateProject(id, { runningModel, runningEffort })` で記録。
   * - 失敗時は status=error / toast で通知。
   *
   * @param id     対象 project の registry id
   * @param model  切替後の model（ModelId）。`null` なら dialog default に追随
   * @param effort 切替後の effort（EffortLevel）。`null` なら dialog default に追随
   */
  restartSidecarWithModel: (
    id: string,
    model: ModelId | null,
    effort: EffortLevel | null
  ) => Promise<void>;
  /**
   * PRJ-012 PM-910 (v3.5.21) — `/clear` 時のコンテキスト完全リセット用 silent 再起動。
   *
   * `restartSidecarWithModel` と同じ stop→start シーケンスだが、以下が異なる:
   *   1. **toast を出さない**（/clear の UX は ClearSessionDialog 側で toast 済）
   *   2. `runningModel` / `runningEffort` は **現状維持**（model 切替ではないため）
   *   3. 「starting / stopping 中」の race 短絡もしない（/clear は UX 上必ず完了させたい）
   *
   * ## 目的 (PM-910 H3 対応)
   * Claude Agent SDK v0.2.x は `query()` 毎に `claude` CLI subprocess を spawn する
   * 設計だが、過去 session の JSONL (`~/.claude/projects/<cwd>/`) は残存する。
   * sidecar プロセス自体は長命で node 側の静的状態を引きずるため、**`/clear` の
   * 挙動を「Claude Desktop の新規会話」と同等に保証する最も確実な方法は sidecar
   * 再起動** (resume=undefined + 新プロセス + 新 session UUID) になる。
   *
   * - 失敗時は `sidecarStatus[id] = "error"` + silent warn のみ（toast しない）
   * - 呼出側は状態変化を subscribe して UI 反映（ChatPanel の sidecarStatusForActive）
   */
  restartSidecarForClear: (id: string) => Promise<void>;
  /** sidecarStatus の読み取りヘルパ（未登録なら "stopped" を返す）。 */
  getSidecarStatus: (id: string) => SidecarStatus;

  // ---- helpers（Chunk B/C から参照） ----
  /** active project object を返す（null 可）。 */
  getActiveProject: () => RegisteredProject | null;
  /** active project の絶対パスを返す（null 可、Chunk B/C 向け）。 */
  getActivePath: () => string | null;
}

/**
 * 互換ヘルパ（旧 API 名）: `projects[].id` から project を探す。
 *
 * 旧 `ProjectSummary` 時代の findProjectById の shape を維持し、
 * 他 Chunk が引き続き import できるようにしている。
 */
export function findProjectById(
  projects: RegisteredProject[],
  id: string | null
): RegisteredProject | null {
  if (!id) return null;
  return projects.find((p) => p.id === id) ?? null;
}

/**
 * SSR / static export ビルド時に `localStorage` が無いケースを guard した
 * JSONStorage。
 *
 * DEC-054: `ccmux-project-registry` → `sumi-project-registry` への 1 回限り
 * transparent migration を getItem にインライン実装。zustand persist の初回
 * rehydrate でもマイグレーション後のデータが読まれるので、state が空に
 * ならない。
 */
const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return {
    getItem: (name: string): string | null => {
      const value = window.localStorage.getItem(name);
      if (value !== null) return value;
      // DEC-054: 新 registry key 空 + 旧 key 存在の時のみ transparent に migrate
      if (name === PROJECT_REGISTRY_STORAGE_KEY) {
        const legacy = window.localStorage.getItem(LEGACY_PROJECT_REGISTRY_KEY);
        if (legacy !== null) {
          try {
            window.localStorage.setItem(name, legacy);
            window.localStorage.removeItem(LEGACY_PROJECT_REGISTRY_KEY);
            // eslint-disable-next-line no-console
            console.info(
              "[sumi] migrated project registry: ccmux-project-registry -> sumi-project-registry"
            );
          } catch {
            // quota / SecurityError は無視（fallback で legacy を返すのみ）
          }
          return legacy;
        }
      }
      return null;
    },
    setItem: (name: string, value: string) => {
      window.localStorage.setItem(name, value);
    },
    removeItem: (name: string) => {
      window.localStorage.removeItem(name);
    },
  };
});

/**
 * ディレクトリ basename を OS 依存 separator を無視して抽出（UI 初期値用）。
 * `@tauri-apps/api/path::basename` と同様の挙動だが同期呼出。
 */
function syncBasename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * brief.md 先頭から title / phase を抽出する軽量パーサ（YAML frontmatter 対応）。
 *
 * - frontmatter（`---` で囲まれた先頭ブロック）内の `title: ...` / `phase: ...` を優先
 * - 無ければ最初の `# ` 行（2〜120 文字 trunc）を title に
 * - phase は `Phase N` / `フェーズ N` を本文から抽出
 */
function parseBrief(contents: string): { title?: string; phase?: string } {
  let title: string | undefined;
  let phase: string | undefined;

  // YAML frontmatter 抽出（先頭が `---` で開始時のみ）
  let body = contents;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(contents);
  if (fmMatch) {
    const fm = fmMatch[1];
    for (const line of fm.split(/\r?\n/)) {
      const t = /^\s*title\s*:\s*(?:["']?)([^"'\r\n]+)(?:["']?)\s*$/i.exec(line);
      if (t && !title) title = t[1].trim().slice(0, 120);
      const p = /^\s*phase\s*:\s*(?:["']?)([A-Za-z0-9\-_./ ]+)(?:["']?)\s*$/i.exec(line);
      if (p && !phase) phase = p[1].trim();
    }
    body = contents.slice(fmMatch[0].length);
  }

  if (!title || !phase) {
    const lines = body.split(/\r?\n/).slice(0, 200);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!title && line.startsWith("# ")) {
        title = line.slice(2).trim().slice(0, 120);
      }
      if (!phase) {
        const m =
          /(?:Phase|フェーズ)\s*[:：]?\s*([A-Za-z0-9\-_/.]+)/.exec(line);
        if (m) phase = m[1];
      }
      if (title && phase) break;
    }
  }

  return { title, phase };
}

/**
 * v3.5.16 PM-840: ModelId から短い表示ラベルを返す（toast 用）。
 *
 * `MODEL_CHOICES` を import せず軽量に整形。StatusBar の `shortModel` と似た
 * 整形規則で、`claude-opus-4-7[1m]` → `Opus 4.7 (1M)`、`claude-sonnet-4-6` →
 * `Sonnet 4.6`、その他は元 ID をそのまま返す。
 */
function prettyModelLabel(id: ModelId): string {
  if (id === "claude-opus-4-7[1m]") return "Opus 4.7 (1M)";
  if (id === "claude-sonnet-4-6") return "Sonnet 4.6";
  if (id === "claude-haiku-4-5") return "Haiku 4.5";
  return id;
}

/** 文字列から stable に 0..COLOR_PALETTE_SIZE-1 を返す djb2 類似ハッシュ。 */
function hashToColorIndex(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % COLOR_PALETTE_SIZE;
}

/**
 * 新規 RegisteredProject を build する。
 *
 * - brief.md が存在すれば frontmatter or heading から title / phase 抽出
 * - 無ければ basename をタイトル、phase = undefined
 * - id は `crypto.randomUUID()`（path の衝突は呼出側で事前チェック）
 * - colorIdx は path hash
 */
async function buildRegisteredProject(
  path: string
): Promise<RegisteredProject> {
  const fallbackTitle = syncBasename(path);
  let title: string | undefined;
  let phase: string | undefined;

  try {
    const briefPath = await join(path, "brief.md");
    if (await exists(briefPath)) {
      const contents = await readTextFile(briefPath);
      const parsed = parseBrief(contents);
      title = parsed.title;
      phase = parsed.phase;
    }
  } catch {
    // brief 読めなくても path/title だけで登録
  }

  // crypto.randomUUID は Tauri (Chromium) / JSDOM (test) どちらでも利用可
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : // fallback: path hash + timestamp（tests などで crypto 無い場合）
        `p-${hashToColorIndex(path)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    path,
    title: title ?? fallbackTitle,
    phase,
    colorIdx: hashToColorIndex(path),
    lastSessionId: null,
    preferredModel: undefined,
    addedAt: Date.now(),
  };
}

/** 旧 storage key（v3.1 以前）を削除する（起動時 1 回）。
 *  DEC-054 の registry migration は safeStorage の getItem が transparent に処理する。 */
function purgeLegacyStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // quota / SecurityError は無視
    }
  }
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      hydrated: false,
      isLoading: false,
      error: null,
      sidecarStatus: {},

      registerProject: async (path, options) => {
        const activate = options?.activate ?? true;

        // 重複チェック: 同一 path は既存を active にするのみ
        const existing = get().projects.find((p) => p.path === path);
        if (existing) {
          if (activate) {
            set({ activeProjectId: existing.id });
            // v3.3: setActiveProject 経由と同じく Lazy start をトリガ
            void get().ensureSidecarRunning(existing.id);
          }
          return existing;
        }

        const project = await buildRegisteredProject(path);
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: activate ? project.id : state.activeProjectId,
          error: null,
        }));
        if (activate) {
          void get().ensureSidecarRunning(project.id);
        }
        return project;
      },

      removeProject: async (id) => {
        // v3.3 (DEC-033): sidecar を先に停止してから registry から外す。
        // stop が失敗しても（プロセス既に死んでいた等）登録解除は続行。
        try {
          await get().stopSidecar(id);
        } catch {
          // silent fallback: ログに残した上で registry 更新は継続
        }
        set((state) => {
          const nextProjects = state.projects.filter((p) => p.id !== id);
          const nextActive =
            state.activeProjectId === id ? null : state.activeProjectId;
          // sidecarStatus からも drop
          const nextStatus = { ...state.sidecarStatus };
          delete nextStatus[id];
          return {
            projects: nextProjects,
            activeProjectId: nextActive,
            sidecarStatus: nextStatus,
          };
        });
      },

      setActiveProject: (id) => {
        if (id === null) {
          set({ activeProjectId: null });
          return;
        }
        const found = get().projects.some((p) => p.id === id);
        if (!found) return;
        set({ activeProjectId: id });
        // v3.5.8 (2026-04-20): Lazy auto-start を **意図的に削除**。
        // 停止中プロジェクトへの切替で勝手に sidecar が起動すると、ユーザーが
        // 「停止」した意味が失われる。起動はユーザーの明示操作（TitleBar の「起動」
        // ボタン or 新規 registerProject 直後の初回起動）のみで行う。
        //
        // 旧: v3.3 DEC-033 で `void get().ensureSidecarRunning(id)` を fire-and-forget
        //     していたが、「停止 → 別 project に切替 → 元の停止済 project に戻る」
        //     で意図せず起動される体験上のバグを起こしていた。
      },

      updateProject: (id, patch) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...patch, id: p.id } : p
          ),
        }));
      },

      // -----------------------------------------------------------------
      // v3.3 DEC-033: sidecar lifecycle
      // -----------------------------------------------------------------
      ensureSidecarRunning: async (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        const current = get().sidecarStatus[id] ?? "stopped";
        // 既に起動中 or 起動処理中なら no-op
        if (current === "running" || current === "starting") return;
        // stopping 中は短絡（次回選択時に再試行）
        if (current === "stopping") return;

        set((state) => ({
          sidecarStatus: { ...state.sidecarStatus, [id]: "starting" },
        }));
        try {
          // PM-760 / v3.4.9 Chunk A: sidecar 起動時に ModelPickerPopover /
          // EffortPickerPopover の選択値を argv で渡す。
          //
          // v3.5.16 PM-840 (Claude Desktop 風 Live 切替):
          //   dialog.selectedModel / selectedEffort は「次回起動の default」の
          //   役割に変更済。すでに project に runningModel / runningEffort が
          //   記録されている場合は本関数が短絡するため、ここは **dialog store の
          //   default 値**をそのまま使う（新規起動の初回 default）。Model 切替後の
          //   再起動は `restartSidecarWithModel` を経由して走るため、こちらで
          //   preferredModel を参照する必要はない（Claude Desktop は project 切替で
          //   default model を保持しない挙動と同じ）。
          //
          // dynamic import で dialog store を取り出しているのは、project store が
          // dialog store に対して常時依存する形だと SSR / test で cycle を招きやすい
          // ため。sidecar 起動時 (= user interaction 後) だけ遅延読込する。
          const { useDialogStore } = await import("@/lib/stores/dialog");
          const dialogState = useDialogStore.getState();
          const uiModelId = dialogState.selectedModel;
          const uiEffortId = dialogState.selectedEffort;
          const model = modelIdToSdkId(uiModelId);
          const thinkingTokens =
            EFFORT_CHOICES.find((c) => c.id === uiEffortId)?.thinkingTokens;

          await callTauri<void>("start_agent_sidecar", {
            projectId: id,
            cwd: project.path,
            // null / undefined は Rust 側で `Option::None` として扱われ、
            // sidecar 起動 argv への追加がスキップされる (= SDK デフォルトに委譲)。
            model: model ?? null,
            thinkingTokens: thinkingTokens ?? null,
          });
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "running" },
            // v3.5.16 PM-840: 実起動時の model / effort を project に記録。
            // StatusBar の ModelPickerPopover / EffortPickerPopover が本値を
            // 表示することで「StatusBar 表示 = 実動作モデル」が一致する。
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                    ...p,
                    runningModel: uiModelId,
                    runningEffort: uiEffortId,
                  }
                : p
            ),
          }));
        } catch (e) {
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "error" },
            error: `sidecar 起動失敗 (${project.title}): ${String(e)}`,
          }));
          // toast は frontend 層（ChatPanel / ProjectRail 等）でも出すが、
          // 直接発火できるよう dynamic import で sonner を読み込む。
          if (typeof window !== "undefined") {
            void import("sonner")
              .then((m) => {
                m.toast.error(
                  `sidecar 起動に失敗しました: ${project.title}（${String(e)}）`
                );
              })
              .catch(() => {
                // toast 読み込みに失敗しても state 反映は済んでいるので無害
              });
          }
        }
      },

      stopSidecar: async (id) => {
        const current = get().sidecarStatus[id] ?? "stopped";
        // 未起動 / 停止処理中 / starting の途中停止は skip
        // （starting 中の kill は Rust 側 HashMap race を招くため、
        //   running / error に遷移してから呼び直す運用）
        if (
          current === "stopped" ||
          current === "stopping" ||
          current === "starting"
        ) {
          return;
        }

        set((state) => ({
          sidecarStatus: { ...state.sidecarStatus, [id]: "stopping" },
        }));
        try {
          await callTauri<void>("stop_agent_sidecar", { projectId: id });
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "stopped" },
            // v3.5.16 PM-840: 停止時は runningModel / runningEffort を null に戻す。
            // これにより StatusBar の picker は dialog default にフォールバックする。
            projects: state.projects.map((p) =>
              p.id === id
                ? { ...p, runningModel: null, runningEffort: null }
                : p
            ),
          }));
        } catch (e) {
          // 停止失敗は「error」に倒すと次回 ensure でリトライできる
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "error" },
            error: `sidecar 停止失敗: ${String(e)}`,
          }));
        }
      },

      /**
       * v3.5.16 PM-840: sidecar を stop → start で再起動し、新 model / effort を反映する。
       *
       * ## シーケンス
       *   1. 現在 status を snapshot。"running" / "error" ならまず stop を await。
       *      "starting" 中の場合は race を避けるため短絡（toast で案内）。
       *   2. start_agent_sidecar を新 model / effort 引数で invoke。
       *   3. 成功時: sidecarStatus=running、runningModel/runningEffort 更新、
       *      preferredModel は互換性のため敢えて触らない（PreferredModelId と
       *      ModelId は型が別体系で、DEC-031 以降どこからも読まれていない）。
       *   4. 失敗時: toast.error + status=error。session の sdkSessionId は
       *      そのままなので、次回送信時に resume で context 継続を再試行する
       *      （resume_failed event は listener 側で既存処理が toast する）。
       *
       * ## resume 継続の仕組み
       *
       * Claude Desktop 相当の「会話継続」は PM-830 (v3.5.14) の resume 機構が担う。
       * - session store の sdkSessionId は DB に永続化されており、sidecar 再起動で
       *   飛ばない（project store の runningModel だけが揮発）
       * - 再起動後、次回 `send_agent_prompt` で自動的に `resume: sdkSessionId` が
       *   渡り、Claude SDK 側で前回 context を復元する
       * - resume 失敗時は `useAllProjectsSidecarListener` が `resume_failed` を
       *   検知して sdkSessionId を null reset、ユーザには toast.warning で通知
       */
      restartSidecarWithModel: async (id, model, effort) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        const current = get().sidecarStatus[id] ?? "stopped";

        // starting / stopping 中は race を避けるため短絡（ユーザに軽く通知）。
        if (current === "starting" || current === "stopping") {
          if (typeof window !== "undefined") {
            void import("sonner").then((m) => {
              m.toast.message(
                "Claude プロセスが遷移中です。数秒後にもう一度お試しください。"
              );
            });
          }
          return;
        }

        // Model label 解決（toast 表示用）。
        const modelLabel = model
          ? // 表示用の短縮ラベル（MODEL_CHOICES からは直接引かず、id 末尾を簡易整形）
            prettyModelLabel(model)
          : "(default)";

        set((state) => ({
          sidecarStatus: { ...state.sidecarStatus, [id]: "starting" },
        }));

        // 停止フェーズ: running / error なら stop_agent_sidecar で確実に kill を
        // 待ってから新しい sidecar を spawn する。"stopped" なら skip（既に死んでる）。
        if (current === "running" || current === "error") {
          try {
            // HashMap からの remove を await で確実に待つ（race 対策）。
            // stopSidecar 内部で status=stopping → stopped を遷移させるが、
            // 既に本関数冒頭で sidecarStatus=starting に書き換えてしまっているため、
            // 直接 Rust command を叩く。
            await callTauri<void>("stop_agent_sidecar", { projectId: id });
          } catch (e) {
            // stop 失敗しても spawn はリトライ可能（Rust 側 idempotent）。warn のみ。
            console.warn(
              `[project-store] restartSidecarWithModel: stop failed for ${id}:`,
              e
            );
          }
        }

        // 起動フェーズ: 新 model / effort で spawn。
        try {
          const sdkModel = modelIdToSdkId(model);
          const thinkingTokens = effort
            ? EFFORT_CHOICES.find((c) => c.id === effort)?.thinkingTokens
            : undefined;
          await callTauri<void>("start_agent_sidecar", {
            projectId: id,
            cwd: project.path,
            model: sdkModel ?? null,
            thinkingTokens: thinkingTokens ?? null,
          });
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "running" },
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                    ...p,
                    runningModel: model,
                    runningEffort: effort,
                  }
                : p
            ),
          }));
          if (typeof window !== "undefined") {
            void import("sonner").then((m) => {
              m.toast.success(
                `モデルを ${modelLabel} に切替えました（会話は継続されます）`
              );
            });
          }
        } catch (e) {
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "error" },
            error: `sidecar 再起動失敗 (${project.title}): ${String(e)}`,
          }));
          if (typeof window !== "undefined") {
            void import("sonner").then((m) => {
              m.toast.error(
                `Claude の切替に失敗しました: ${project.title}（${String(e)}）`
              );
            });
          }
        }
      },

      /**
       * PM-910: `/clear` 時の silent sidecar 再起動。
       *
       * 実装は `restartSidecarWithModel` の最小派生で、以下のみ差分:
       *   - runningModel / runningEffort は維持（切替ではない）
       *   - 成功 toast を出さない（呼出側 ClearSessionDialog が toast 済）
       *   - race 短絡しない（UX 上必ず再起動を走らせる）
       *
       * stop_agent_sidecar / start_agent_sidecar 自体は idempotent なので
       * 並列呼出されても Rust 側の HashMap lock で順序化される。
       */
      restartSidecarForClear: async (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        const current = get().sidecarStatus[id] ?? "stopped";

        set((state) => ({
          sidecarStatus: { ...state.sidecarStatus, [id]: "starting" },
        }));

        // 停止フェーズ: running / error / starting / stopping 全て kill に寄せる。
        // stop_agent_sidecar は Rust 側 idempotent なので HashMap に無ければ no-op。
        if (current !== "stopped") {
          try {
            await callTauri<void>("stop_agent_sidecar", { projectId: id });
          } catch (e) {
            console.warn(
              `[project-store] restartSidecarForClear: stop failed for ${id}:`,
              e
            );
          }
        }

        // 起動フェーズ: 現 runningModel / runningEffort を維持して spawn。
        const currentModel = project.runningModel ?? null;
        const currentEffort = project.runningEffort ?? null;
        try {
          const sdkModel = modelIdToSdkId(currentModel);
          const thinkingTokens = currentEffort
            ? EFFORT_CHOICES.find((c) => c.id === currentEffort)?.thinkingTokens
            : undefined;
          await callTauri<void>("start_agent_sidecar", {
            projectId: id,
            cwd: project.path,
            model: sdkModel ?? null,
            thinkingTokens: thinkingTokens ?? null,
          });
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "running" },
          }));
        } catch (e) {
          set((state) => ({
            sidecarStatus: { ...state.sidecarStatus, [id]: "error" },
            error: `sidecar 再起動失敗 (${project.title}): ${String(e)}`,
          }));
          console.warn(
            `[project-store] restartSidecarForClear: start failed for ${id}:`,
            e
          );
          // toast は ClearSessionDialog 側で失敗時ハンドリング（呼出側で throw 不要、
          // status=error を subscribe している ChatPanel のヘッダ表示で気付ける）。
        }
      },

      getSidecarStatus: (id) => {
        return get().sidecarStatus[id] ?? "stopped";
      },

      pruneStaleProjects: async () => {
        const before = get().projects;
        if (before.length === 0) {
          set({ isLoading: false });
          return;
        }
        set({ isLoading: true, error: null });
        try {
          const checks = await Promise.all(
            before.map(async (p) => ({
              project: p,
              ok: await safeExists(p.path),
            }))
          );
          const alive = checks.filter((c) => c.ok).map((c) => c.project);
          const dropped = checks.filter((c) => !c.ok).map((c) => c.project);

          if (dropped.length === 0) {
            set({ isLoading: false });
            return;
          }

          const nextActive =
            get().activeProjectId &&
            alive.some((p) => p.id === get().activeProjectId)
              ? get().activeProjectId
              : null;

          // v3.3 DEC-033: 外れた project の sidecar status も掃除
          const nextStatus: Record<string, SidecarStatus> = {};
          for (const p of alive) {
            const s = get().sidecarStatus[p.id];
            if (s) nextStatus[p.id] = s;
          }

          set({
            projects: alive,
            activeProjectId: nextActive,
            sidecarStatus: nextStatus,
            isLoading: false,
            error:
              dropped.length > 0
                ? `削除済みのパス ${dropped.length} 件を登録解除しました: ${dropped
                    .map((d) => syncBasename(d.path))
                    .join(", ")}`
                : null,
          });
        } catch (e) {
          set({ error: String(e), isLoading: false });
        }
      },

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        if (!activeProjectId) return null;
        return projects.find((p) => p.id === activeProjectId) ?? null;
      },

      getActivePath: () => {
        const active = get().getActiveProject();
        return active?.path ?? null;
      },
    }),
    {
      name: PROJECT_REGISTRY_STORAGE_KEY,
      storage: safeStorage,
      version: 1,
      // persist 対象は projects / activeProjectId のみ（hydrated / isLoading /
      // error / sidecarStatus は揮発）。v3.3 DEC-033: sidecarStatus は再起動時に
      // 必ず空 map から再 Lazy-start する設計のため、あえて除外する。
      //
      // v3.5.16 PM-840: projects[].runningModel / runningEffort は **揮発フィールド**
      // （実起動中 sidecar の状態を表す）。sidecar は再起動で必ず空 map 化するので、
      // これらも persist から外しておかないと「localStorage には running 状態が
      // 残っているのに実体は死んでいる」乖離を起こす。partialize で明示除外する。
      partialize: (state) => ({
        projects: state.projects.map((p) => ({
          ...p,
          runningModel: undefined,
          runningEffort: undefined,
        })),
        activeProjectId: state.activeProjectId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[project-store] rehydrate failed:", error);
          return;
        }
        if (!state) return;
        // 旧 storage key は hydrate タイミングで掃除（毎回 no-op に近いが害なし）
        purgeLegacyStorage();

        // v1 以前のデータ互換: 想定外の shape が入ったら safe default
        if (!Array.isArray(state.projects)) {
          state.projects = [];
          state.activeProjectId = null;
        }
        // v3.3 DEC-033: persist からは sidecarStatus が復元されないので空で初期化
        state.sidecarStatus = {};

        // v3.5.16 PM-840: 旧 localStorage (partialize 前) に runningModel /
        // runningEffort が残っているケースへの保険。明示的に null に戻す。
        state.projects = state.projects.map((p) => ({
          ...p,
          runningModel: null,
          runningEffort: null,
        }));

        // -----------------------------------------------------------------
        // v3.3.1 Chunk B (Should Fix C-1 → S-3): rehydrate 直後の race を防ぐ。
        //
        // 旧実装は `pruneStaleProjects` を fire-and-forget しつつ、同時に
        // activeProjectId 残存時は `ensureSidecarRunning` も即発火していた。
        //
        // 問題: pruneStaleProjects は async で projects / activeProjectId を
        // 改変しうるため、ensureSidecarRunning が「stale check 後に存在しない
        // project」に対して `start_agent_sidecar` を invoke してしまう race
        // が理論上発生する（実害稀だが将来 dogfood で表面化する温床）。
        //
        // 対策:
        //   1. pruneStaleProjects を await してから hydrated = true をセット
        //   2. stale check 後に「activeProjectId が依然存在するか」を再確認
        //   3. 生存していれば useProjectStore.getState() の最新 actions で
        //      ensureSidecarRunning を呼ぶ（state は persist 内部の draft で
        //      内部参照が不安定なケースに備え、live store から actions を引く）
        // -----------------------------------------------------------------
        void (async () => {
          try {
            await state.pruneStaleProjects();
          } catch {
            // pruneStaleProjects 内部で error は state.error にセット済。継続。
          }

          // -----------------------------------------------------------------
          // PM-950 (v1.2) — 前回 active project の auto-restore。
          //
          // Cursor / VSCode 同等 UX: アプリ起動時に「前回開いていた project」を
          // 自動選択する。実装方針:
          //
          //   1. persist で `activeProjectId` は既に復元済。
          //   2. `pruneStaleProjects` が「削除されたパス」を除外し、該当 project
          //      が stale なら activeProjectId も null に戻している。
          //   3. ここで **activeProjectId が null で、かつ projects が 1 件以上
          //      ある場合、最初の project を自動選択** して未選択状態を避ける。
          //   4. projects が空ならそのまま null（初回 user / 全 project 削除後）。
          //
          // 既存 sidecar lifecycle への影響:
          //   - `setActiveProject` の内部 lazy-start は v3.5.8 で削除済（L465）。
          //     従って auto-select しても sidecar は起動せず、UX 期待どおり
          //     「前回 project が見える + 停止中のまま」となる。
          //   - 下の `list_active_sidecars` により、sidecar が実際に生きていた
          //     ら `sidecarStatus: running` が復元され、整合は保たれる。
          //
          // 直接 setState で書き換えているのは、pruneStaleProjects 後の最新
          // state を live store から読みたいため（draft では projects[] が古い）。
          // -----------------------------------------------------------------
          const liveForAutoSelect = useProjectStore.getState();
          const savedActive = liveForAutoSelect.activeProjectId;
          const projectsAfterPrune = liveForAutoSelect.projects;
          const savedIsValid =
            savedActive !== null &&
            projectsAfterPrune.some((p) => p.id === savedActive);
          if (!savedIsValid && projectsAfterPrune.length > 0) {
            useProjectStore.setState({
              activeProjectId: projectsAfterPrune[0].id,
            });
          }

          // hydrated は stale check 完了後にセット（subscribe 側の guard 用）。
          // 直接 set すると persist middleware の draft 外で書き換えとなり
          // 反映されないため、live store の setState を経由する。
          useProjectStore.setState({ hydrated: true });

          // v3.5.14 (2026-04-20) crit 修正: リロード時の sidecar 状態乖離を根治。
          //
          // 旧: onRehydrateStorage で activeProjectId の sidecar を `ensureSidecarRunning`
          //     で強制起動していた。これにより:
          //       - 停止中プロジェクトがリロードで勝手に起動する
          //       - Rust 側の HashMap には起動中 sidecar が残っているのに frontend は
          //         sidecarStatus 揮発で "stopped" 表示 → 再 ensure で二重起動に見える
          //     という乖離バグが発生していた。
          //
          // 新: **Rust 側の `list_active_sidecars` で実態を取得し、sidecarStatus map を
          //     実態に合わせて復元する**。frontend の表示と Rust の HashMap が一致する。
          //     起動は明示操作（TitleBar の「起動」ボタン / 新規 registerProject）のみ。
          //
          // v1.1.1 PM-946 hotfix: SSR / Next.js build 時は `window` が無いので
          // `@tauri-apps/api/core` の invoke が即死する (ReferenceError: window is not
          // defined at project.ts:943)。persist middleware は onRehydrateStorage を
          // SSR でも叩くケースがあるため、ここで明示的に server-side を早期 return する。
          if (typeof window === "undefined") {
            return;
          }
          const live = useProjectStore.getState();
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            interface SidecarInfo {
              projectId: string;
              cwd: string;
              startedAt: number;
            }
            const active = await invoke<SidecarInfo[]>("list_active_sidecars");
            const runningIds = new Set(active.map((s) => s.projectId));
            const statusMap: Record<string, import("@/lib/sidecar-status").SidecarStatus> = {};
            for (const p of live.projects) {
              statusMap[p.id] = runningIds.has(p.id) ? "running" : "stopped";
            }
            useProjectStore.setState({ sidecarStatus: statusMap });
          } catch (e) {
            // Tauri env でない or invoke 失敗: 全 stopped にフォールバック
            console.warn("[project-store] list_active_sidecars failed:", e);
          }
        })();
      },
    }
  )
);

/** exists() を try/catch で guard したラッパ（SSR / test での失敗を no-op 化）。 */
async function safeExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// deprecated: 旧 API（後方互換のため shim として残す）
//
// v3.1 以前の `useProjectStore` は `workspaceRoot` / `detectionMode` /
// `fetchProjects` / `addProjectFromPath` / `setWorkspaceRoot` / `setDetectionMode`
// を公開していた。DEC-031 の完全撤去に伴いこれらは削除。
// 代わりに `registerProject` / `removeProject` / `updateProject` /
// `getActivePath` / `getActiveProject` を使用すること。
// ---------------------------------------------------------------------------

export type { ProjectSummary };
