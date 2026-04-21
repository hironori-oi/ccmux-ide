"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { callTauri } from "@/lib/tauri-api";
import { logger } from "@/lib/logger";

/**
 * アプリ起動時のルート。Welcome Wizard を介さず、Claude 認証状態を
 * Rust command `check_claude_authenticated` で自動検出して `/workspace` に
 * 直遷移する（PRJ-012 v1.1 / PM-938 / DEC-046）。
 *
 * ## Before (v1.0 まで)
 * - `/` は Welcome カード（3 大価値 + 「始める」）を表示
 * - 「始める」→ `/setup` (API Key / Permissions / Sample の 5 ステップ Wizard)
 * - `/setup` 完了後に `/workspace` に遷移
 * → Claude Max / OAuth login 済みユーザーでも毎回 wizard を通す必要があり冗長
 *
 * ## After (本実装)
 * - `/` は redirect 専用 (何も描画しない)
 * - `check_claude_authenticated` を invoke
 *   - `Authenticated` → `/workspace` に `router.replace`（履歴を汚さない）
 *   - `NotFound` / `TokenMissing` → `/workspace` には遷移しつつ toast で案内
 *     - action button「設定を開く」→ `/settings` へ導線（API Key を直接入力
 *       したいユーザー向け）
 * - invoke 自体が失敗した場合でも、workspace は出すべきなので `/workspace`
 *   に fallback で遷移する（UI を人質に取らない）
 *
 * ## 方針
 * - 認証 UI は Rust 側の file 判定のみ。CLI OAuth flow はアプリ内で実装せず、
 *   ユーザーにターミナルでの `claude login` を案内するだけ。
 * - toast は `duration: 10_000`（長め）+ action button で即解決経路を提供。
 * - token 文字列は受け取らない（Rust 側で `AuthStatus` enum のみ返す）。
 */
type AuthStatus = "Authenticated" | "NotFound" | "TokenMissing";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const status = await callTauri<AuthStatus>(
          "check_claude_authenticated"
        );
        if (cancelled) return;

        // 認証未 / token 欠落時は、workspace には進めつつ toast で案内。
        // UI を block しないことで、API Key を直接入力したい人や後から
        // `claude login` する人の両方の動線を塞がない。
        if (status !== "Authenticated") {
          showLoginPrompt(status, router);
        }
      } catch (e) {
        // Rust command の invoke 自体が失敗した場合（Tauri 未 build の Next dev
        // 単体起動時など）。workspace 自体は見せたいので fallback で遷移する。
        logger.warn("check_claude_authenticated failed", e);
      } finally {
        if (!cancelled) {
          router.replace("/workspace");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // redirect 中に一瞬描画されるフラッシュを避けるため、何もレンダリングしない。
  return null;
}

/**
 * 未ログイン / token 欠落時の案内 toast。
 *
 * - duration は 10 秒（「気づかないうちに消える」ことを避ける）
 * - action button「設定を開く」は `/settings` に遷移（API Key タブで直接入力可）
 * - メッセージは `claude login` コマンドを具体的に示す
 */
function showLoginPrompt(
  status: Exclude<AuthStatus, "Authenticated">,
  router: ReturnType<typeof useRouter>
) {
  const description =
    status === "NotFound"
      ? "~/.claude/.credentials.json が見つかりません。ターミナルで `claude login` を実行してください。"
      : "OAuth token が取得できませんでした。ターミナルで `claude login` を再実行してください。";

  toast.warning("Claude にログインしていません", {
    description,
    duration: 10_000,
    action: {
      label: "設定を開く",
      onClick: () => {
        router.push("/settings");
      },
    },
  });
}
