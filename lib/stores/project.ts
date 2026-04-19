"use client";

import { create } from "zustand";
import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";

import type { ProjectSummary } from "@/lib/types";

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
}));
