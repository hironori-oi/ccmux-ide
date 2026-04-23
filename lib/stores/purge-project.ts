"use client";

/**
 * PRJ-012 v1.12.0 / DEC-058: Project 削除 cascade 用の Frontend store cleanup util。
 *
 * ## 背景
 *
 * Rust `delete_project` command が `sessions` テーブルから当該 project の session
 * を cascade 削除した後、frontend 側は以下の store に残留する entry を purge する
 * 必要がある（さもないと:
 *   - localStorage (persist) に project / session キーの設定が残り続け、
 *     プロジェクト再登録時に古い値を拾う
 *   - UI の Tray / Workspace / Preview が stale な session id を参照して
 *     「存在しない session」の slot を描画する
 *   - 次回 session 作成時に別 project の「最後に使った設定」を継承する leak
 *   …が発生する)。
 *
 * 各 store が互いを知らず疎結合に保つため、本 util が **一括で** cleanup を
 * 呼び出す。呼出側（`useProjectStore.removeProject`）は Rust call 後に
 * `purgeProjectArtifacts(projectId, deletedSessionIds)` を 1 回呼ぶだけでよい。
 *
 * ## 対象 store
 *
 * | Store                        | 作用                                                         |
 * | ---------------------------- | ------------------------------------------------------------ |
 * | `useSessionStore`            | sessions cache から対象群を外し、current が対象なら null 化 |
 * | `useSessionPreferencesStore` | `perProject[projectId]` + `perSession[sid]` を削除           |
 * | `useWorkspaceLayoutStore`    | `layouts[projectId]` を削除                                  |
 * | `usePreviewStore`            | `urls / geometries / labels[projectId]` を削除                |
 * | `usePreviewInstances`        | 対象 project の instance を全削除                             |
 * | `useSessionOrderStore`       | `order[projectId]` を削除                                     |
 * | `useMonitorStore`            | 対象 session 群の `perSession[sid]` snapshot を削除            |
 * | `useTerminalStore`           | 対象 project の pty を全 kill + store から除去                 |
 * | `useEditorStore`             | 対象 project path 配下の file を全 pane / pool から閉じる      |
 * | `useChatStore`               | panes / snapshots の `currentSessionId` / `creatingSessionId` |
 * |                              | が対象ならクリア、`projectSnapshots[projectId]` を破棄         |
 *
 * ## エラー方針
 *
 * 各 store 操作は try/catch で wrapping し、1 件失敗しても他 store の cleanup は
 * 継続する。store 未ロード（SSR / test 環境）の場合は silent skip。呼出側には
 * 返り値で cleanup 成否を返さない（既に DB 側は削除済なので UI 側は可能な範囲で
 * 整合を取るだけで良い）。
 *
 * ## 循環 import 回避
 *
 * 本 util は各 store を直接 import する（静的依存）。各 store は本 util を
 * import しないため循環はない。`lib/stores/project.ts` が本 util を import し、
 * `removeProject` 内で呼ぶ — この経路も一方向。
 */

import { useChatStore } from "@/lib/stores/chat";
import { useEditorStore } from "@/lib/stores/editor";
import { useMonitorStore } from "@/lib/stores/monitor";
import { usePreviewStore } from "@/lib/stores/preview";
import { usePreviewInstances } from "@/lib/stores/preview-instances";
import { useSessionStore } from "@/lib/stores/session";
import { useSessionOrderStore } from "@/lib/stores/session-order";
import { useSessionPreferencesStore } from "@/lib/stores/session-preferences";
import { useTerminalStore } from "@/lib/stores/terminal";
import { useWorkspaceLayoutStore } from "@/lib/stores/workspace-layout";

/**
 * Project 削除 cascade 時に呼び出す。Rust `delete_project` 完了後、`removeProject`
 * 内で実行すること。
 *
 * @param projectId         削除する project の registry id
 * @param deletedSessionIds Rust から返された「実際に DB から削除された session id」群。
 *                          frontend cache に無いものが含まれていても問題ない。
 * @param projectPath       project の path。editor store の path prefix purge に使う。
 *                          null なら editor cleanup は skip。
 */
export function purgeProjectArtifacts(
  projectId: string,
  deletedSessionIds: readonly string[],
  projectPath: string | null,
): void {
  if (!projectId) return;

  // 各 store 操作は独立に失敗しても他に影響しないよう try/catch で保護する。
  // 各 catch 内で console.warn を出し、失敗時は UI トーストは呼出側（removeProject）
  // が最終的にまとめて出す方針。

  runSafely("session", () => {
    useSessionStore.getState().purgeSessions(deletedSessionIds);
  });

  runSafely("session-preferences", () => {
    useSessionPreferencesStore
      .getState()
      .purgeProject(projectId, deletedSessionIds);
  });

  runSafely("workspace-layout", () => {
    useWorkspaceLayoutStore.getState().removeProject(projectId);
  });

  runSafely("preview", () => {
    usePreviewStore.getState().removeProject(projectId);
  });

  runSafely("preview-instances", () => {
    usePreviewInstances.getState().removeByProject(projectId);
  });

  runSafely("session-order", () => {
    useSessionOrderStore.getState().removeProject(projectId);
  });

  runSafely("monitor", () => {
    useMonitorStore.getState().purgeSessions(deletedSessionIds);
  });

  runSafely("terminal", () => {
    useTerminalStore.getState().purgeProject(projectId);
  });

  if (projectPath) {
    runSafely("editor", () => {
      useEditorStore.getState().purgeByPathPrefix(projectPath);
    });
  }

  runSafely("chat", () => {
    useChatStore.getState().purgeSessions(deletedSessionIds);
    // projectSnapshots 側は既に useProjectStore.subscribe -> clearProjectSnapshot
    // で自動的に破棄されるが、race を避けるため明示的にもう一度呼ぶ（冪等）。
    useChatStore.getState().clearProjectSnapshot(projectId);
  });
}

/**
 * 1 つの store cleanup を try/catch で保護して実行する内部ヘルパ。
 */
function runSafely(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[purge-project] ${name} store cleanup 中にエラー（継続）:`,
      e,
    );
  }
}
