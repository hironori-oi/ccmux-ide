"use client";

/**
 * PM-283 / v1.16.0 DEC-062: 起動時 + 手動トリガで GitHub Release の latest.json を
 * チェックし、利用可能な更新があれば sonner トースト + TitleBar UpdateBadge で通知。
 * ユーザー承認後に `downloadAndInstall` でダウンロード & インストールまで行う。
 *
 * 設計メモ:
 *   - `@tauri-apps/plugin-updater` の `check()` は endpoint（tauri.conf.json）
 *     の latest.json を取得し、現在のバージョンと比較。更新ありなら `Update`
 *     を返す。pubkey 空文字（MVP）のため署名検証は skip。
 *   - インストールは `update.downloadAndInstall(progressCb)` で progress を
 *     受けつつ実施。ダウンロード後は plugin-process の relaunch() でアプリを
 *     再起動する（macOS/Linux は必須、Windows は passive インストーラが
 *     自動再起動する場合あり）。
 *   - 起動時チェックは 3 秒遅延（起動直後の I/O 輻輳を避ける）。
 *   - 手動チェックは Settings > Appearance の「更新を確認」ボタンから発火。
 *     window CustomEvent `ccmux:check-update` を購読する。
 *   - 署名鍵は M3 PM-304 で Ed25519 ペアを発行 → ここの endpoint で署名検証
 *     に切り替える想定。現状は trust-on-first-use（TOFU）相当。
 *
 * v1.16.0 変更点 (DEC-062):
 *   - `useUpdaterStore` に状態を集約。UpdateBadge / UpdateDialog が同じ store を
 *     subscribe して一貫した UI を提供。
 *   - 起動時 autoCheck=false ならチェック skip。
 *   - latestVersion が skippedVersions に含まれるなら自動 check 時は通知しない
 *     （手動 check は無視して常に通知）。
 *   - React error #185 対策として Shell から ErrorBoundary で包む構成に移行。
 *     本ファイル内でも render 中の setState を避け、effect / async context のみで
 *     state を更新する方針を維持。
 *   - `Update` インスタンスはシリアライズ不可なのでモジュール scope の ref に保持し、
 *     CustomEvent `ccmux:install-update` で UpdateDialog から install を発火する。
 */

import { useCallback, useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

import { useUpdaterStore } from "@/lib/stores/updater";

const STARTUP_CHECK_DELAY_MS = 3_000;
const CHECK_UPDATE_EVENT = "ccmux:check-update";
const INSTALL_UPDATE_EVENT = "ccmux:install-update";
const OPEN_UPDATE_DIALOG_EVENT = "ccmux:open-update-dialog";

/**
 * 直近 check() で得た Update インスタンスをモジュール scope に保持する。
 * Zustand store には Update オブジェクトを入れられない（関数を含むので
 * JSON.stringify 不可 + 再ハイドレートできない）ため、ref で運用する。
 *
 * UpdateDialog 側は `requestInstallUpdate()` → CustomEvent → UpdateNotifier が
 * この ref を使って downloadAndInstall を呼ぶ構成。
 */
let latestUpdateRef: Update | null = null;

/**
 * UpdateBadge から UpdateDialog を開かせる CustomEvent を dispatch。
 * UpdateDialog 側が listener を張る。
 */
export function requestOpenUpdateDialog() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_UPDATE_DIALOG_EVENT));
}

/**
 * UpdateDialog の「今すぐ更新」から呼ばれる。ref に保持してある Update に対し
 * UpdateNotifier が downloadAndInstall を実行する。
 */
export function requestInstallUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSTALL_UPDATE_EVENT));
}

/**
 * 外部モジュール（Settings など）から手動チェックをトリガするための公開 API。
 * window CustomEvent を使うことで、UpdateNotifier の state を汚さずに呼び出せる。
 */
export function triggerManualUpdateCheck() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHECK_UPDATE_EVENT));
}

/** Dialog を開く CustomEvent 名（UpdateDialog 側で listen 用に export）。 */
export const UPDATE_DIALOG_EVENT_NAMES = {
  open: OPEN_UPDATE_DIALOG_EVENT,
  install: INSTALL_UPDATE_EVENT,
  check: CHECK_UPDATE_EVENT,
};

export function UpdateNotifier() {
  // store actions (zustand の setter 関数参照は stable、依存配列に入れても再実行されない)
  const setStatus = useUpdaterStore((s) => s.setStatus);
  const setLatestVersion = useUpdaterStore((s) => s.setLatestVersion);
  const setDownloadProgress = useUpdaterStore((s) => s.setDownloadProgress);
  const setLastCheckAt = useUpdaterStore((s) => s.setLastCheckAt);
  const setLastError = useUpdaterStore((s) => s.setLastError);

  // updater が downloadAndInstall 中の再発火を防ぐ ref（store.status と二重管理に
  // なるが、runCheck の async 途中で setStatus("downloading") される前に並行で
  // もう一度 check が走るのを防ぐため、同期的に参照できる ref を持つ）。
  const busyRef = useRef(false);
  const hasRunStartupCheckRef = useRef(false);

  // ------------------------------------------------------------------
  // ダウンロード & インストール
  // ------------------------------------------------------------------
  const installUpdate = useCallback(
    async (update: Update) => {
      let downloaded = 0;
      let contentLength = 0;

      setStatus("downloading");
      setDownloadProgress(0);

      const progressToastId = toast.loading("更新をダウンロード中...", {
        duration: Infinity,
      });

      try {
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength ?? 0;
              downloaded = 0;
              setDownloadProgress(0);
              break;
            case "Progress":
              downloaded += event.data.chunkLength ?? 0;
              if (contentLength > 0) {
                const pct = Math.min(
                  100,
                  Math.round((downloaded / contentLength) * 100)
                );
                setDownloadProgress(pct);
                toast.loading(`更新をダウンロード中... ${pct}%`, {
                  id: progressToastId,
                });
              }
              break;
            case "Finished":
              setDownloadProgress(100);
              toast.loading("インストールしています...", {
                id: progressToastId,
              });
              break;
          }
        });

        toast.success("更新が完了しました。再起動します。", {
          id: progressToastId,
          duration: 3_000,
        });
        setStatus("ready");

        // Tauri 2 の passive インストーラは Windows で auto-relaunch しない
        // ケースがあるため明示的に relaunch。
        try {
          await relaunch();
        } catch (err) {
          console.warn("[updater] relaunch failed", err);
        }
      } catch (err) {
        console.error("[updater] install failed", err);
        setStatus("error");
        setLastError(err instanceof Error ? err.message : String(err));
        toast.error("更新のインストールに失敗しました", {
          id: progressToastId,
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        busyRef.current = false;
      }
    },
    [setStatus, setDownloadProgress, setLastError]
  );

  // ------------------------------------------------------------------
  // 更新確認 → store 反映 → 通知（manual 時のみ / skip ロジック）
  // ------------------------------------------------------------------
  const runCheck = useCallback(
    async (opts: { manual: boolean }) => {
      if (busyRef.current) return;
      busyRef.current = true;

      setStatus("checking");
      setLastError(null);
      setLastCheckAt(Date.now());

      let update: Update | null = null;
      try {
        update = await check();
      } catch (err) {
        console.error("[updater] check failed", err);
        setStatus("error");
        setLastError(err instanceof Error ? err.message : String(err));
        if (opts.manual) {
          toast.error("更新確認に失敗しました", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        busyRef.current = false;
        return;
      }

      if (!update) {
        setStatus("idle");
        setLatestVersion(null);
        latestUpdateRef = null;
        if (opts.manual) {
          toast.info("現在のバージョンは最新です");
        }
        busyRef.current = false;
        return;
      }

      const version = update.version ?? "(不明)";
      latestUpdateRef = update;
      setLatestVersion(version);
      setStatus("available");

      // skip 判定は手動 check では無視、自動 check のみ適用
      const { isSkipped } = useUpdaterStore.getState();
      if (!opts.manual && isSkipped(version)) {
        // skip 対象: badge / toast は出さず、store は available のまま
        //（UpdateBadge 側で「skipped でも表示する」か「抑制する」かはバッジ側の
        // 判断だが、デフォルトでは available を見せない方が親切。よって status を
        // idle に戻す）。手動 check で開けばそのバージョンを改めて検討可能。
        setStatus("idle");
        setLatestVersion(null);
        busyRef.current = false;
        return;
      }

      toast(`v${version} が利用可能です`, {
        description: update.body
          ? String(update.body).slice(0, 120)
          : "更新内容を確認して適用してください。",
        duration: 20_000,
        action: {
          label: "更新する",
          onClick: () => {
            if (latestUpdateRef) {
              void installUpdate(latestUpdateRef);
            }
          },
        },
      });

      busyRef.current = false;
    },
    [installUpdate, setStatus, setLatestVersion, setLastCheckAt, setLastError]
  );

  // ------------------------------------------------------------------
  // 起動時チェック（3 秒遅延、autoCheck=OFF なら skip）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (hasRunStartupCheckRef.current) return;
    hasRunStartupCheckRef.current = true;

    const timer = window.setTimeout(() => {
      const { autoCheck } = useUpdaterStore.getState();
      if (!autoCheck) return;
      void runCheck({ manual: false });
    }, STARTUP_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [runCheck]);

  // ------------------------------------------------------------------
  // 手動チェック（Settings or UpdateBadge のボタンから発火）
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      void runCheck({ manual: true });
    };
    window.addEventListener(CHECK_UPDATE_EVENT, handler);
    return () => window.removeEventListener(CHECK_UPDATE_EVENT, handler);
  }, [runCheck]);

  // ------------------------------------------------------------------
  // Install trigger（UpdateDialog の「今すぐ更新」から）
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      if (!latestUpdateRef) {
        // Update 情報が失われているケース（Dialog 開いたまま長時間放置など）。
        // 再度 check してから install する必要があるが、UX 上は自動で check →
        // 見つかれば install までを連鎖させる。
        void runCheck({ manual: true });
        return;
      }
      void installUpdate(latestUpdateRef);
    };
    window.addEventListener(INSTALL_UPDATE_EVENT, handler);
    return () => window.removeEventListener(INSTALL_UPDATE_EVENT, handler);
  }, [installUpdate, runCheck]);

  // UpdateNotifier 自体は store / toast を更新するだけで DOM を持たない。
  // Progress 表示 / badge / dialog は UpdateBadge / UpdateDialog が担当。
  return null;
}
