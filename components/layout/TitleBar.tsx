"use client";

import { useState } from "react";
import { Folder, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useChatStore } from "@/lib/stores/chat";
import { callTauri } from "@/lib/tauri-api";

/**
 * PM-172 派生: タイトルバー（画面上端・36px 固定）。
 *
 * 左:
 *  - lucide `Sparkles` アイコン + ブランド名 "ccmux-ide"
 *  - ブランド名の右隣に作業ディレクトリ（cwd）表示 + クリックでピッカー起動
 *    （PRJ-012 Stage 1: Claude の作業対象をユーザーが GUI から指定できる）
 * 右:
 *  - `<ThemeToggle />`（PM-170、ダーク / ライト トグル）
 *  - アカウントドロップダウンは M2 以降で本実装予定のため現状 placeholder
 *    （空 div のまま、見た目だけ spacing を確保）。
 *
 * Shell.tsx（Chunk 2）の最上段にそのまま流し込む前提で、自身の幅は親 flex に従う。
 */
export function TitleBar() {
  const cwd = useChatStore((s) => s.cwd);
  const [switching, setSwitching] = useState(false);

  /**
   * 作業ディレクトリピッカーを起動して、選択されたディレクトリで sidecar を
   * stop → start し直す。
   *
   * Tauri plugin-dialog の `open({ directory: true })` を dynamic import し、
   * SSR 時（Next.js build / prerender）は呼ばれない前提。
   */
  async function openCwdPicker() {
    if (switching) return;
    let selected: string | null = null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        directory: true,
        multiple: false,
        title: "作業ディレクトリを選択",
      });
      if (typeof result === "string" && result.length > 0) {
        selected = result;
      }
    } catch (e) {
      toast.error(`ディレクトリ選択に失敗しました: ${String(e)}`);
      return;
    }

    if (!selected) {
      // キャンセルされた場合は何もしない
      return;
    }

    setSwitching(true);
    try {
      // localStorage に persist（zustand persist middleware が自動で保存）
      useChatStore.getState().setCwd(selected);

      // sidecar を再起動（既存プロセスを落としてから新しい cwd で起動）
      try {
        await callTauri<void>("stop_agent_sidecar");
      } catch {
        // stop 失敗は ignore（プロセス未起動時など）
      }
      await callTauri<void>("start_agent_sidecar", { cwd: selected });

      toast.success(`作業ディレクトリを ${selected} に変更しました`);
      toast.message("Claude を再起動しました");
    } catch (e) {
      toast.error(`作業ディレクトリ切替に失敗しました: ${String(e)}`);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <header
      aria-label="タイトルバー"
      className="flex h-9 shrink-0 items-center justify-between border-b bg-background px-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="shrink-0 text-sm font-semibold tracking-tight">
          ccmux-ide
        </span>
        <CwdIndicator
          cwd={cwd}
          onClick={openCwdPicker}
          disabled={switching}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {switching && (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label="作業ディレクトリ切替中"
          />
        )}
        <ThemeToggle />
        {/* アカウントドロップダウン placeholder: M2 で DropdownMenu + avatar を配置予定 */}
        <div aria-hidden className="h-8 w-8" />
      </div>
    </header>
  );
}

/**
 * cwd 表示ボタン。クリックでディレクトリピッカーを起動する。
 *
 * - cwd が null の場合は薄い placeholder を表示
 * - 長いパスは `~/.../tail` 形式に短縮（HOME prefix 置換 + 中間省略）
 * - hover で clickable を強調、title attr に full path
 */
function CwdIndicator({
  cwd,
  onClick,
  disabled,
}: {
  cwd: string | null;
  onClick: () => void;
  disabled: boolean;
}) {
  const display = cwd ? truncateCwd(cwd, 40) : "作業ディレクトリ未選択";
  const ariaLabel = cwd
    ? `作業ディレクトリ: ${cwd} (クリックで変更)`
    : "作業ディレクトリを選択";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={cwd ?? "クリックで作業ディレクトリを選択"}
      className={
        "ml-2 flex min-w-0 max-w-full items-center gap-1 rounded border border-transparent px-2 py-0.5 text-xs transition-colors hover:border-border hover:bg-muted disabled:cursor-wait disabled:opacity-60 " +
        (cwd ? "text-muted-foreground" : "text-muted-foreground/60")
      }
    >
      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate font-mono">{display}</span>
    </button>
  );
}

/**
 * 表示用にパスを短縮する。
 *
 * ルール:
 *  1. HOME (`/Users/xxx` / `C:\Users\xxx`) を `~` に置換
 *  2. それでも `maxLen` を超える場合、先頭セグメントを `~/...` に畳み、
 *     末尾セグメント（最後の 2 要素程度）をフル表示する
 *  3. 区切り文字は OS に依らずそのまま残す
 *
 * 例 (maxLen=40):
 *  - "C:\Users\hiron\Desktop\ccmux-ide-gui"
 *      → "~\Desktop\ccmux-ide-gui"                (HOME 置換後に収まる)
 *  - "C:\Users\hiron\Desktop\claude-code-company\projects\PRJ-012\reports"
 *      → "~\...\PRJ-012\reports"                  (中間省略)
 *  - "/var/www/html/long/project/name/goes/here"
 *      → "/.../project/name/goes/here"            (HOME ではない → 先頭省略)
 */
function truncateCwd(cwd: string, maxLen: number): string {
  // HOME の推定: Windows の "C:\Users\<name>" もしくは POSIX の "/Users/<name>" / "/home/<name>"
  const homeReplaced = replaceHomePrefix(cwd);
  if (homeReplaced.length <= maxLen) return homeReplaced;

  // セパレータを推定（Windows スタイルを含むかで決める）
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  // どちらの区切りでも split できるよう normalize
  const parts = homeReplaced
    .split(/[\\/]/)
    .filter((p) => p.length > 0);

  if (parts.length <= 2) {
    // すでに十分短い要素数 → そのまま返す
    return homeReplaced;
  }

  const leadsWithHome = homeReplaced.startsWith("~");
  const prefix = leadsWithHome ? "~" + sep : sep;

  // 末尾から要素を拾って maxLen に収まる範囲まで残す
  let tail = "";
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = parts[i] + (tail ? sep + tail : "");
    // "..." + sep + candidate の長さを prefix と合わせて比較
    if (prefix.length + 3 + sep.length + candidate.length > maxLen) {
      break;
    }
    tail = candidate;
  }

  // tail が空（末尾 1 要素でも入らない）場合は末尾要素だけ残す
  if (!tail) {
    tail = parts[parts.length - 1] ?? "";
  }

  // HOME プレフィックスがなければ "/..." 形式、あれば "~/..." 形式
  const result = leadsWithHome
    ? `~${sep}...${sep}${tail}`
    : `${sep}...${sep}${tail}`;

  // それでも長すぎる場合は素朴に末尾切り詰め
  if (result.length <= maxLen) return result;
  const head = result.slice(0, Math.max(0, maxLen - 1));
  return head + "…";
}

/**
 * HOME プレフィックスを `~` に置換。判定できなければ原文をそのまま返す。
 *
 * Windows: `C:\Users\<name>\...` → `~\...`
 * macOS  : `/Users/<name>/...`   → `~/...`
 * Linux  : `/home/<name>/...`    → `~/...`
 */
function replaceHomePrefix(cwd: string): string {
  // Windows
  const winMatch = cwd.match(/^([A-Za-z]):[\\/]Users[\\/]([^\\/]+)([\\/].*)?$/);
  if (winMatch) {
    const tail = winMatch[3] ?? "";
    return "~" + tail;
  }
  // macOS
  const macMatch = cwd.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (macMatch) {
    return "~" + (macMatch[1] ?? "");
  }
  // Linux
  const linuxMatch = cwd.match(/^\/home\/[^/]+(\/.*)?$/);
  if (linuxMatch) {
    return "~" + (linuxMatch[1] ?? "");
  }
  return cwd;
}
