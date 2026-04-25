"use client";

import type { useRouter } from "next/navigation";
import type { toast as toastFn } from "sonner";

import { callTauri } from "@/lib/tauri-api";
import { useDialogStore } from "@/lib/stores/dialog";
import { useChatStore } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";

/**
 * PRJ-012 v4 / Chunk C / DEC-028: Claude Code 組込 slash の frontend dispatcher。
 *
 * Claude Code の組込コマンド (`/mcp`, `/clear`, `/model`, `/init`, `/help`,
 * `/compact`, `/config`) は Agent SDK 経由では実行できないため、`InputArea`
 * 送信直前に本ハンドラで intercept し、GUI ネイティブな action（router 遷移 /
 * dialog 開閉 / Rust command 呼出）に振り分ける。
 *
 * ## 使い方
 *
 * ```tsx
 * const router = useRouter();
 * if (handleBuiltinSlash(text.trim(), { router, toast, workspaceRoot }) ) {
 *   setText("");
 *   return; // sidecar には送信しない
 * }
 * ```
 *
 * 戻り値:
 *   - `true`  : 本 dispatcher が消費した（送信不要）
 *   - `false` : 組込 slash ではなかった（呼び出し元で通常通り送信する）
 */

/** Tauri backend の `BuiltinSlash` と 1:1。 */
export interface BuiltinSlash {
  name: string;
  description: string;
  /** lib/builtin-slash.ts 側 dispatcher の switch key。 */
  action: BuiltinAction;
}

/**
 * builtin slash 1 件の action ID（Rust `BuiltinSlash.action` と一致させる）。
 *
 * 新しい組込コマンドを追加する場合は backend (`builtin_slash.rs`) の
 * `list_builtin_slashes` と本 union、`dispatch` の switch を 3 箇所同時に更新する。
 *
 * v1.24.0 (DEC-070): `passthrough_to_sdk` は intercept せず通常 prompt として
 * sidecar に流すマーカー（`/chrome` 等、CLI / SDK が組み込み解釈するもの）。
 * `BUILTIN_SLASH_ACTIONS` には登録せず、`handleBuiltinSlash` は false を返す。
 */
export type BuiltinAction =
  | "open_mcp_settings"
  | "clear_session"
  | "open_model_picker"
  | "open_effort_picker"
  | "init_claude_md"
  | "open_help"
  | "compact_pending"
  | "open_config"
  | "toggle_chrome_mode"
  | "passthrough_to_sdk";

/**
 * 名前 → action の lookup。`list_builtin_slashes` を呼ばずに最初から判定したい
 * intercept ホットパスではこの map を使う（cmdk palette でメタを表示する場合は
 * Rust 側 `list_builtin_slashes` を別途叩く）。
 */
export const BUILTIN_SLASH_ACTIONS: Readonly<Record<string, BuiltinAction>> = {
  "/mcp": "open_mcp_settings",
  "/clear": "clear_session",
  "/model": "open_model_picker",
  "/effort": "open_effort_picker",
  "/init": "init_claude_md",
  "/help": "open_help",
  "/compact": "compact_pending",
  "/config": "open_config",
  // v1.24.2 (DEC-070 改訂): `/chrome` を intercept して chromeEnabled を toggle。
  "/chrome": "toggle_chrome_mode",
};

/** dispatcher が必要とする最小コンテキスト。 */
export interface BuiltinSlashContext {
  router: ReturnType<typeof useRouter>;
  /** sonner の `toast` をそのまま渡す。*/
  toast: typeof toastFn;
  /** 現在の workspace root（プロジェクト未選択なら null）。/init / /mcp(Project) で要求。 */
  workspaceRoot: string | null;
}

/**
 * 入力行が組込 slash 単独なら true を返し副作用を実行する。
 *
 * 判定ルール:
 *  - `text.trim() === "<slash>"` のみを受け付ける（後ろに何かある場合はカスタム
 *    slash 同様、通常送信に流す。`/mcp foo` のような未対応引数は素人混乱を防ぐ
 *    ため intercept しない）
 */
export function handleBuiltinSlash(
  text: string,
  ctx: BuiltinSlashContext
): boolean {
  const trimmed = text.trim();
  const action = BUILTIN_SLASH_ACTIONS[trimmed];
  if (!action) return false;
  dispatch(action, ctx);
  return true;
}

function dispatch(action: BuiltinAction, ctx: BuiltinSlashContext): void {
  const { router, toast, workspaceRoot } = ctx;
  const dialog = useDialogStore.getState();
  const chat = useChatStore.getState();

  switch (action) {
    case "open_mcp_settings": {
      // Project スコープを編集する場合は workspace_root が必要。Global は不要なので
      // ここでは workspaceRoot 未選択でも settings page へは遷移させ、設定画面側
      // で Project タブを必要に応じて disable する（UX として「設定は開けるが
      // Project だけ操作不可」が一番親切）。
      router.push("/settings/mcp");
      return;
    }
    case "clear_session": {
      dialog.openClear();
      return;
    }
    case "open_model_picker": {
      dialog.openModelPicker();
      return;
    }
    case "open_effort_picker": {
      dialog.openEffortPicker();
      return;
    }
    case "init_claude_md": {
      if (!workspaceRoot) {
        toast.error(
          "ワークスペースが選択されていません。サイドバーからプロジェクトを開いてください。"
        );
        return;
      }
      void (async () => {
        try {
          const path = await callTauri<string>("builtin_init_claude_md", {
            workspaceRoot,
          });
          toast.success(`CLAUDE.md を生成しました: ${path}`);
        } catch (e) {
          toast.error(
            `CLAUDE.md の生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      })();
      return;
    }
    case "open_help": {
      dialog.openHelp();
      return;
    }
    case "compact_pending": {
      toast.message("/compact は v4 で対応予定です（Agent SDK の compaction API 待ち）。");
      return;
    }
    case "open_config": {
      router.push("/settings");
      return;
    }
    case "toggle_chrome_mode": {
      // v1.24.2 (DEC-070 改訂): `/chrome` を Sumi 側で intercept。
      // 現 session の chromeEnabled を toggle し、現 sidecar を kill して
      // 次の送信で `--chrome` 付きで lazy spawn させる。
      void (async () => {
        try {
          const projectStore = useProjectStore.getState();
          const sessionStore = useSessionStore.getState();
          const projectId = projectStore.activeProjectId;
          const sessionId = sessionStore.currentSessionId;
          if (!projectId || !sessionId) {
            toast.error(
              "プロジェクトとセッションを選択してから `/chrome` を実行してください"
            );
            return;
          }

          const prefMod = await import("@/lib/stores/session-preferences");
          const prefStore = prefMod.useSessionPreferencesStore.getState();
          const current =
            prefMod.resolveSessionPreferences(
              prefStore,
              sessionId,
              prefMod.HARD_DEFAULT_PREFERENCES,
            ).chromeEnabled ?? false;
          const next = !current;

          prefStore.setPreference(sessionId, projectId, {
            chromeEnabled: next,
          });

          // 現 session の sidecar を kill。次の送信で --chrome flag 付きで
          // lazy spawn される (DEC-063)。
          try {
            await callTauri<void>("stop_agent_sidecar", { sessionId });
          } catch {
            // 既に停止済み等は silent fallback
          }

          if (next) {
            toast.success(
              "Chrome モードを有効にしました。次の送信で --chrome 付き起動 + Chrome 拡張に接続します"
            );
          } else {
            toast.success(
              "Chrome モードを無効にしました。次の送信から通常モードで起動します"
            );
          }
        } catch (e) {
          toast.error(
            `/chrome の処理に失敗しました: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      })();
      return;
    }
    case "passthrough_to_sdk": {
      // v1.24.0 (DEC-070): `/chrome` 等は intercept せず通常 prompt として
      // sidecar に送る経路 (handleBuiltinSlash は false を返す)。BUILTIN_SLASH_ACTIONS
      // にも登録していないため本来 dispatch には到達しないが、SlashPalette が
      // 直接 dispatch を呼ぶ将来拡張に備えて no-op で受けておく。
      return;
    }
    default: {
      // 型レベルで網羅しているが将来の追加忘れ防止
      const _exhaustive: never = action;
      void _exhaustive;
      return;
    }
  }

  // chat store 参照は将来 /clear 拡張で使う想定（現状は ClearSessionDialog 側で参照）
  void chat;
}
