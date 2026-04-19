"use client";

import { create } from "zustand";
import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join, basename } from "@tauri-apps/api/path";

import type { ProjectSummary } from "@/lib/types";

/**
 * localStorage に保存する「手動追加プロジェクト」の絶対パス一覧の key。
 * fetchProjects() が workspace 配下だけを走査するのに対し、
 * addProjectFromPath() はワークスペース外の任意ディレクトリも登録できるので
 * 永続化は分離して持つ（Round B 追加）。
 */
const EXTRA_PROJECTS_STORAGE_KEY = "ccmux-ide.projects.extra-paths";

/**
 * PRJ-XXX プロジェクト管理ドメインの Zustand store (Week 6 Chunk 2 / PM-203)。
 *
 * `claude-code-company` workspace 直下の `projects/` を走査し、`brief.md` が存在する
 * ディレクトリを project candidate として扱う。
 *
 * workspace root の決定方針（v3 判断指針より）:
 *  - MVP では `~/Desktop/claude-code-company` を既定値として hardcode
 *  - 将来は Settings で差替可能（PM-213 で拡張）
 *  - `setWorkspaceRoot(path)` で runtime 上書き可（テスト / 他 workspace 向け）
 *
 * 禁止範囲（`src-tauri/**`）に抵触しないため、Rust 側に command を追加せず
 * `@tauri-apps/plugin-fs::readDir` のみで完結させている。fs scope は
 * capabilities/default.json で `$HOME/**` が許可済なので Desktop 配下も読める。
 */

interface ProjectState {
  /** workspace root（claude-code-company の絶対パス）。null は未解決（起動直後） */
  workspaceRoot: string | null;
  /** projects/ 配下の一覧（brief.md 存在のもののみ） */
  projects: ProjectSummary[];
  /** 現在選択中の project id。`null` は未選択 */
  activeProjectId: string | null;
  isLoading: boolean;
  /** 最新 fetch のエラー（UI banner 用） */
  error: string | null;

  /** runtime に workspace root を差替え（Settings / テスト想定） */
  setWorkspaceRoot: (path: string) => void;
  /** 既定 workspace root を `~/Desktop/claude-code-company` で解決してから fetch */
  fetchProjects: () => Promise<void>;
  /** 選択変更。id が見つからない場合は no-op */
  setActiveProject: (id: string) => void;
  /**
   * 任意のディレクトリをプロジェクトとして手動追加する（PRJ-012 Round B）。
   *
   * - `brief.md` の有無は不問。無い場合も `id = basename(path)` で仮登録する
   * - 同一 `path` が既に登録済なら skip（冪等）
   * - 追加した project は activeProjectId にも設定する
   * - 絶対パス一覧を localStorage に persist（リロード後も復元）
   */
  addProjectFromPath: (path: string) => Promise<void>;
}

/** projects 配列から activeProjectId と match するものを返す補助 */
export function findProjectById(
  projects: ProjectSummary[],
  id: string | null
): ProjectSummary | null {
  if (!id) return null;
  return projects.find((p) => p.id === id) ?? null;
}

/**
 * brief.md 先頭から title / phase を抽出する軽量パーサ。
 *
 * - title: 最初の `# ` 行（2 ～ 120 文字 trunc）
 * - phase: 最初に Phase / フェーズ を含む行の `Phase N` 形式
 *   無ければ undefined。先頭 200 行までに限定してコストを抑える。
 */
function parseBrief(contents: string): { title?: string; phase?: string } {
  const lines = contents.split(/\r?\n/).slice(0, 200);

  let title: string | undefined;
  let phase: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!title && line.startsWith("# ")) {
      title = line.slice(2).trim().slice(0, 120);
    }
    if (!phase) {
      const m =
        /(?:Phase|フェーズ)\s*[:：]?\s*([A-Za-z0-9\-_/.]+)/.exec(line);
      if (m) {
        phase = m[1];
      }
    }
    if (title && phase) break;
  }

  return { title, phase };
}

/**
 * 既定 workspace root を返す。
 *
 * Windows / macOS / Linux いずれでも `~/Desktop/claude-code-company` を
 * MVP の既定とする（Settings 経由で上書き可能に拡張予定）。
 */
async function resolveDefaultWorkspaceRoot(): Promise<string> {
  const home = await homeDir();
  return await join(home, "Desktop", "claude-code-company");
}

/**
 * localStorage から extra projects の絶対パス一覧を読む。
 * SSR/初期ロード時の `window` 未定義にも耐える。
 */
function loadExtraPaths(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EXTRA_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** localStorage に extra projects の絶対パス一覧を保存。 */
function saveExtraPaths(paths: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXTRA_PROJECTS_STORAGE_KEY,
      JSON.stringify(paths)
    );
  } catch {
    // quota 超過等は無視（UI 側で toast を出す）
  }
}

/**
 * 絶対パスから `ProjectSummary` を作る（`brief.md` があれば中身も読む）。
 * どこから呼ばれても reusable にするためヘルパ化。
 */
async function buildExtraSummary(path: string): Promise<ProjectSummary> {
  const id = await basename(path);
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
    // brief が読めなくても id / path だけで登録
  }
  return { id, path, title, phase };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  workspaceRoot: null,
  projects: [],
  activeProjectId: null,
  isLoading: false,
  error: null,

  setWorkspaceRoot: (path: string) => {
    set({ workspaceRoot: path });
  },

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      let root = get().workspaceRoot;
      if (!root) {
        root = await resolveDefaultWorkspaceRoot();
        set({ workspaceRoot: root });
      }

      const projectsDir = await join(root, "projects");

      const dirExists = await exists(projectsDir);
      if (!dirExists) {
        set({ projects: [], isLoading: false });
        return;
      }

      const entries = await readDir(projectsDir);
      const summaries: ProjectSummary[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        if (entry.name.startsWith(".")) continue;

        const projectPath = await join(projectsDir, entry.name);
        const briefPath = await join(projectPath, "brief.md");

        const briefExists = await exists(briefPath);
        if (!briefExists) continue;

        let title: string | undefined;
        let phase: string | undefined;
        try {
          const contents = await readTextFile(briefPath);
          const parsed = parseBrief(contents);
          title = parsed.title;
          phase = parsed.phase;
        } catch {
          // 読めなくても id だけ残す
        }

        summaries.push({
          id: entry.name,
          path: projectPath,
          title,
          phase,
        });
      }

      // Round B: workspace 外から手動追加した extra projects を復元・合流
      const extraPaths = loadExtraPaths();
      const knownPaths = new Set(summaries.map((s) => s.path));
      for (const p of extraPaths) {
        if (knownPaths.has(p)) continue;
        try {
          const extra = await buildExtraSummary(p);
          if (summaries.some((s) => s.id === extra.id)) continue;
          summaries.push(extra);
        } catch {
          // 読めないパスは黙って skip（次回 fetch でも再試行）
        }
      }

      // id 昇順（PRJ-001 ～ PRJ-012 ～ COMPANY-WEBSITE）
      summaries.sort((a, b) => a.id.localeCompare(b.id, "ja"));

      set({
        projects: summaries,
        isLoading: false,
        activeProjectId: summaries.some((p) => p.id === get().activeProjectId)
          ? get().activeProjectId
          : null,
      });
    } catch (e) {
      set({
        error: String(e),
        isLoading: false,
      });
    }
  },

  setActiveProject: (id: string) => {
    const found = get().projects.some((p) => p.id === id);
    if (!found) return;
    set({ activeProjectId: id });
  },

  addProjectFromPath: async (path: string) => {
    try {
      // 既に path が登録済みなら activeProjectId 切替のみ
      const existing = get().projects.find((p) => p.path === path);
      if (existing) {
        set({ activeProjectId: existing.id });
        return;
      }

      const summary = await buildExtraSummary(path);

      // id 衝突（別 path だが同名ディレクトリ）の場合はサフィックスを付与
      let finalId = summary.id;
      let suffix = 2;
      const existingIds = new Set(get().projects.map((p) => p.id));
      while (existingIds.has(finalId)) {
        finalId = `${summary.id} (${suffix})`;
        suffix++;
      }
      const finalSummary: ProjectSummary = { ...summary, id: finalId };

      const next = [...get().projects, finalSummary].sort((a, b) =>
        a.id.localeCompare(b.id, "ja")
      );

      // localStorage に絶対パスを persist（id はパス basename から都度再生成）
      const extraPaths = loadExtraPaths();
      if (!extraPaths.includes(path)) {
        saveExtraPaths([...extraPaths, path]);
      }

      set({
        projects: next,
        activeProjectId: finalSummary.id,
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },
}));
