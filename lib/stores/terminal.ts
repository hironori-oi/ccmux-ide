"use client";

import { create } from "zustand";
import { toast } from "sonner";

import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";

/**
 * PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル (xterm.js + Rust PTY) 用 store。
 *
 * - `terminals` は `projectId` field で紐付け管理 (project 切替で active が切替)。
 * - Rust 側の `PtyState` は Tauri 再起動で空になるため、本 store は persist しない。
 * - pty_id は Rust 側 `pty_spawn` が UUID で発行し、frontend はそれを受けて保持。
 * - exit event (`pty:{pty_id}:exit`) は `useTerminalListener` が受けて
 *   `terminals[ptyId].exitCode` に反映し、UI が「終了 (exit code N)」を表示する。
 *
 * ## UI 連携
 * - TerminalPane (xterm.js canvas) は `ptyId` を prop で受ける。
 *   mount 時に `listen(`pty:${ptyId}:data`)` で stdout を受け、`term.write()`。
 *   unmount 時に unlisten + term.dispose() (pty は kill しない、タブ切替で保持)。
 *   close 操作時のみ `closeTerminal(ptyId)` で `pty_kill` を呼ぶ。
 *
 * ## 多 Terminal
 * - 同一 project で複数 pty を持てる (「+新規」ボタンで `createTerminal` 再呼出)。
 * - `activeTerminalId` は「現在表示中の pty_id」を 1 つだけ保持 (sub-tab 切替で変更)。
 */

/**
 * PM-924 (2026-04-20): Terminal 分割 pane の既定 id。
 *
 * Editor / Chat と同じく "main" を default。sub-tab は pane ごとに独立して持つ。
 */
export const TERMINAL_DEFAULT_PANE_ID = "main";

/**
 * Terminal 分割の最大 pane 数。
 * Chat / Editor と揃える。PM-937 (2026-04-20) で 4 pane (2x2 grid) 対応。
 *
 * tradeoff: 4 pane だと PTY process が project あたり最大 4 個 spawn される。
 * Rust 側 (`PtyState`) は HashMap で 1 process / 数 MB なので OS 上限内には収まるが、
 * ユーザが明示的に 4 pane を選んだ時のみ起動される設計。
 */
export const TERMINAL_MAX_PANES = 4;

export interface TerminalState {
  ptyId: string;
  /** 紐づく project の registry id (project 切替時の filter 用)。 */
  projectId: string;
  /**
   * PM-924 (2026-04-20): 紐づく terminal pane の id。省略時は
   * `TERMINAL_DEFAULT_PANE_ID` として扱う（旧 state との後方互換）。
   */
  paneId?: string;
  /** 表示ラベル（sub-tab の title）。shell 名 or 連番。 */
  title: string;
  /** 起動時刻 (UNIX epoch ms)。 */
  startedAt: number;
  /** 終了した pty は `exitCode` がセットされる。null = 正常終了 or 未終了。 */
  exitCode: number | null;
  /** exit 受信後 true。sub-tab に「終了」ラベル、close ボタンで除去可。 */
  exited: boolean;
  /**
   * PM-975: 作成時にアクティブだった SQLite session id。
   * tray の session フィルタで該当 session のチップだけ表示するのに使う。
   */
  creatingSessionId?: string | null;
}

/**
 * PM-924 (2026-04-20): 1 pane 分の terminal タブ state。
 *
 * - `activeTerminalId`: この pane で現在 focus 中の pty_id（sub-tab 切替で変更）
 */
export interface TerminalPaneState {
  activeTerminalId: string | null;
}

interface TerminalStoreState {
  /** 全 pty の map。key = pty_id。 */
  terminals: Record<string, TerminalState>;
  /**
   * 現在 focus 中の pty_id (後方互換用。activePane の activeTerminalId を反映)。
   */
  activeTerminalId: string | null;

  /**
   * PM-924: pane ごとの terminal タブ state。初期は main pane のみ。
   * 各 pane は自前の sub-tab (pty) 群を持ち、project 単位で filter される。
   */
  terminalPanes: Record<string, TerminalPaneState>;
  /** 現在 focus 中の terminal pane id。 */
  activeTerminalPaneId: string;

  // ---- actions ----

  /**
   * 新規 pty を起動して store に登録。
   *
   * @param projectId 紐付ける project id
   * @param cwd       pty の作業ディレクトリ (project の path を渡す)
   * @param shell     省略時は OS default (Windows: cmd.exe / unix: bash)
   * @param paneId    PM-924 で追加: どの terminal pane に属させるか（省略時は active）
   * @returns         pty_id (失敗時は null)
   */
  createTerminal: (
    projectId: string,
    cwd: string,
    shell?: string,
    paneId?: string
  ) => Promise<string | null>;

  /**
   * pty を明示的に kill + store から除去。
   *
   * 既に exited の pty に対して呼んでも pty_kill は idempotent なので安全。
   */
  closeTerminal: (ptyId: string) => Promise<void>;

  /**
   * active 切替 (sub-tab クリック)。
   *
   * @param ptyId
   * @param paneId PM-924: どの pane の active を変えるか。省略時は active pane。
   */
  setActiveTerminal: (ptyId: string | null, paneId?: string) => void;

  /** project に紐づく pty のみを返す (UI filter 用)。 */
  getTerminalsForProject: (projectId: string) => TerminalState[];

  // ---- PM-924: pane lifecycle ----
  /** pane 追加。TERMINAL_MAX_PANES 到達時は no-op + 既存 active を返す。 */
  addTerminalPane: () => string;
  /** pane 削除。最後の 1 件は削除不可。削除 pane 所属 pty は全て kill する。 */
  removeTerminalPane: (paneId: string) => Promise<void>;
  /** focus pane 切替。 */
  setActiveTerminalPane: (paneId: string) => void;

  // ---- listener 内部用 (外部呼出は原則しない) ----

  /** `pty:{id}:exit` event を受けて state を更新 (useTerminalListener から呼ぶ)。 */
  markExited: (ptyId: string, exitCode: number | null) => void;
}

/** crypto.randomUUID fallback (title 連番用 id)。 */
function makeTitle(index: number, shell?: string): string {
  if (shell) {
    const base = shell.split(/[\\/]/).pop() ?? shell;
    return `${base} #${index}`;
  }
  return `Terminal #${index}`;
}

/** PM-924: 新しい terminal pane id を生成。 */
function newTerminalPaneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tpane-${crypto.randomUUID()}`;
  }
  return `tpane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  terminals: {},
  activeTerminalId: null,
  terminalPanes: {
    [TERMINAL_DEFAULT_PANE_ID]: { activeTerminalId: null },
  },
  activeTerminalPaneId: TERMINAL_DEFAULT_PANE_ID,

  createTerminal: async (projectId, cwd, shell, paneId) => {
    try {
      const ptyId = await callTauri<string>("pty_spawn", {
        shell: shell ?? null,
        cwd,
      });
      const state = get();
      const targetPaneId = paneId ?? state.activeTerminalPaneId;
      const resolvedPaneId = state.terminalPanes[targetPaneId]
        ? targetPaneId
        : TERMINAL_DEFAULT_PANE_ID;
      const existing = Object.values(state.terminals).filter(
        (t) =>
          t.projectId === projectId &&
          (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === resolvedPaneId
      ).length;
      const title = makeTitle(existing + 1, shell);
      // PM-975: 現在の session を取得してタグ付け
      let creatingSessionId: string | null = null;
      try {
        const { useSessionStore } = await import("@/lib/stores/session");
        creatingSessionId = useSessionStore.getState().currentSessionId;
      } catch {
        // session store 未利用の context ではタグなし
      }
      set((prev) => ({
        terminals: {
          ...prev.terminals,
          [ptyId]: {
            ptyId,
            projectId,
            paneId: resolvedPaneId,
            title,
            startedAt: Date.now(),
            exitCode: null,
            exited: false,
            creatingSessionId,
          },
        },
        activeTerminalId: ptyId,
        terminalPanes: {
          ...prev.terminalPanes,
          [resolvedPaneId]: {
            ...prev.terminalPanes[resolvedPaneId],
            activeTerminalId: ptyId,
          },
        },
      }));
      logger.debug("[terminal-store] spawned", {
        ptyId,
        projectId,
        paneId: resolvedPaneId,
        cwd,
        shell,
      });
      return ptyId;
    } catch (e) {
      logger.warn("[terminal-store] spawn failed:", e);
      toast.error(`ターミナル起動に失敗しました: ${String(e)}`);
      return null;
    }
  },

  closeTerminal: async (ptyId) => {
    // PM-921 Bug 2 修正: UI を先に更新 (optimistic)。
    // Rust `pty_kill` の完了を await すると、万一 kill が遅延・hang した場合に
    // × ボタン押下後 UI が固まって見えるため、先に store から削除して
    // xterm instance を unmount する。kill 自体は fire-and-forget で投げる。
    //
    // Rust 側でも kill は child mutex を使わない独立 killer handle で発行する
    // ため、本来は await しても即 return するはずだが、保険として optimistic
    // 化しておく (event loop が重い / 複数 terminal 同時 close 等のエッジケース)。
    set((state) => {
      const closed = state.terminals[ptyId];
      const next = { ...state.terminals };
      delete next[ptyId];
      // active を閉じたら、同 project / 同 pane の残りから先頭を active に (無ければ null)
      let nextActive = state.activeTerminalId;
      if (state.activeTerminalId === ptyId) {
        const projectId = closed?.projectId ?? null;
        const paneId = closed?.paneId ?? TERMINAL_DEFAULT_PANE_ID;
        const candidate = Object.values(next).find(
          (t) =>
            (!projectId || t.projectId === projectId) &&
            (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === paneId
        );
        nextActive = candidate ? candidate.ptyId : null;
      }
      // pane の activeTerminalId も同期更新
      const nextTerminalPanes = { ...state.terminalPanes };
      Object.entries(nextTerminalPanes).forEach(([pid, p]) => {
        if (p.activeTerminalId === ptyId) {
          // 同 pane + 同 project の残り先頭
          const candidate = Object.values(next).find(
            (t) =>
              (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === pid &&
              (!closed || t.projectId === closed.projectId)
          );
          nextTerminalPanes[pid] = {
            ...p,
            activeTerminalId: candidate ? candidate.ptyId : null,
          };
        }
      });
      return {
        terminals: next,
        activeTerminalId: nextActive,
        terminalPanes: nextTerminalPanes,
      };
    });
    // kill は fire-and-forget (失敗しても UI は既に削除済)。
    void callTauri<void>("pty_kill", { ptyId }).catch((e) => {
      logger.warn("[terminal-store] kill failed (UI は既に削除済):", e);
    });
  },

  setActiveTerminal: (ptyId, paneId) => {
    const state = get();
    const targetPaneId = paneId ?? state.activeTerminalPaneId;
    const pane = state.terminalPanes[targetPaneId];
    if (!pane) return;

    if (ptyId === null) {
      set({
        activeTerminalId:
          targetPaneId === state.activeTerminalPaneId
            ? null
            : state.activeTerminalId,
        terminalPanes: {
          ...state.terminalPanes,
          [targetPaneId]: { ...pane, activeTerminalId: null },
        },
      });
      return;
    }
    const terminal = state.terminals[ptyId];
    if (!terminal) return;
    // pane id 不整合（別 pane の terminal は activate しない）
    const terminalPaneId = terminal.paneId ?? TERMINAL_DEFAULT_PANE_ID;
    if (terminalPaneId !== targetPaneId) return;
    set({
      activeTerminalId:
        targetPaneId === state.activeTerminalPaneId
          ? ptyId
          : state.activeTerminalId,
      terminalPanes: {
        ...state.terminalPanes,
        [targetPaneId]: { ...pane, activeTerminalId: ptyId },
      },
    });
  },

  getTerminalsForProject: (projectId) => {
    return Object.values(get().terminals)
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => a.startedAt - b.startedAt);
  },

  addTerminalPane: () => {
    const state = get();
    const paneIds = Object.keys(state.terminalPanes);
    if (paneIds.length >= TERMINAL_MAX_PANES) {
      return state.activeTerminalPaneId;
    }
    const id = newTerminalPaneId();
    set({
      terminalPanes: {
        ...state.terminalPanes,
        [id]: { activeTerminalId: null },
      },
      activeTerminalPaneId: id,
    });
    return id;
  },

  removeTerminalPane: async (paneId) => {
    const state = get();
    const paneIds = Object.keys(state.terminalPanes);
    if (paneIds.length <= 1) return;
    if (!state.terminalPanes[paneId]) return;

    // この pane に属していた pty を全て kill する
    const ptysToKill = Object.values(state.terminals)
      .filter((t) => (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === paneId)
      .map((t) => t.ptyId);

    const { [paneId]: _removed, ...restPanes } = state.terminalPanes;
    void _removed;

    const nextTerminals = { ...state.terminals };
    ptysToKill.forEach((id) => {
      delete nextTerminals[id];
    });

    let nextActivePane = state.activeTerminalPaneId;
    if (nextActivePane === paneId) {
      nextActivePane = Object.keys(restPanes)[0];
    }
    const nextActiveTerminalId =
      restPanes[nextActivePane]?.activeTerminalId ?? null;

    set({
      terminalPanes: restPanes,
      activeTerminalPaneId: nextActivePane,
      terminals: nextTerminals,
      activeTerminalId: nextActiveTerminalId,
    });

    // pty_kill は fire-and-forget
    ptysToKill.forEach((id) => {
      void callTauri<void>("pty_kill", { ptyId: id }).catch((e) => {
        logger.warn("[terminal-store] pane remove kill failed:", e);
      });
    });
  },

  setActiveTerminalPane: (paneId) => {
    const state = get();
    if (!state.terminalPanes[paneId]) return;
    set({
      activeTerminalPaneId: paneId,
      activeTerminalId: state.terminalPanes[paneId].activeTerminalId,
    });
  },

  markExited: (ptyId, exitCode) => {
    set((state) => {
      const t = state.terminals[ptyId];
      if (!t) return state;
      return {
        terminals: {
          ...state.terminals,
          [ptyId]: { ...t, exitCode, exited: true },
        },
      };
    });
  },
}));
