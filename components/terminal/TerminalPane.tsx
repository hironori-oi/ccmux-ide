"use client";

import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { logger } from "@/lib/logger";
import { callTauri, onTauriEvent } from "@/lib/tauri-api";
import {
  registerTerminalReset,
  unregisterTerminalReset,
} from "@/components/terminal/terminal-reset-registry";
import "@xterm/xterm/css/xterm.css";

/**
 * PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル xterm.js canvas。
 *
 * ## 責務
 * - xterm.js Terminal を 1 つ mount (PM-922 以降は canvas renderer のみ使用、
 *   WebglAddon は透過 background 未対応のため削除済)
 * - `term.onData` → `pty_write` (stdin 書込)
 * - `pty:{ptyId}:data` event → `term.write` (stdout 描画)
 * - ResizeObserver → FitAddon fit() + `pty_resize`
 *
 * ## 方針
 * - ptyId ごとに 1 Terminal instance (unmount 時 dispose)
 * - view 切替で unmount されても pty は kill しない (タブ切替で保持)
 *   → 本 pane は `display:none` で隠す運用を推奨 (Shell.tsx 側で制御)
 * - ただし React の仕組み上 `display:none` の親でも child は mount されるので、
 *   ptyId を key に持たせれば pty 切替 = 別 component instance として動く
 *
 * ## xterm Theme
 * - shadcn の CSS variable (`--background` 等) は xterm の internal CSS に
 *   直接渡せないため、hex で近似 (dark 前提)。将来 useTheme で dynamic 切替検討。
 *
 * ## PM-930 (2026-04-20): term.open() の遅延起動
 * - アプリ起動直後の viewMode は "chat" のため Terminal container は `display:none`
 *   でマウントされる。この状態で auto-spawn された pty の TerminalPane も
 *   container rect = 0x0 でマウントされ、従来実装は `term.open()` + `fit.fit()` を
 *   即座に呼んでいたため xterm 内部 renderer が broken state で初期化されていた。
 * - 本バージョン以降は container の `getBoundingClientRect()` が non-zero に
 *   なるまで `term.open()` を遅延し、その間の pty stdout は `pendingWrites` buffer
 *   に貯めておく。visibility 検知は `ResizeObserver` (display:none → visible の
 *   遷移で Chromium が fire する) に任せ、open 成功時点で buffer を flush する。
 *
 * ## PM-932 (2026-04-20): DOM overlay 方式への切替 (透過問題の根治)
 * - PM-928 で `theme.background: rgba(0,0,0,0.6)` + `allowTransparency: true` を
 *   指定したが xterm.js canvas renderer では実効透過されず canvas が不透明黒で
 *   塗られるケースが残存 (オーナー画像 4 で確認)。
 * - 根本対策として **canvas を完全透明** (`rgba(0,0,0,0)`) にし、**wrapper div** に
 *   `background: rgba(0,0,0,0.55)` を適用して半透明 overlay を描画。
 *   壁紙 (html::before) → wrapper overlay (半透明黒) → xterm canvas (text のみ)
 *   の 3 層構造で合成。
 * - xterm.js の内部構造: `term.open(inner)` は `inner` 配下に `.xterm` element を
 *   作り、その内部に canvas を配置する。`inner` 自身の background は透明
 *   (wrapper の overlay が見える) にすることで合成成立。
 * - ResizeObserver は `innerRef` を観察 (canvas の描画先サイズ基準)。
 *
 * ## PM-934 (2026-04-20): 0x0 defer 無限ループの hotfix
 * - PM-932 で wrapper + inner の 2 層化を行った結果、以下の症状が発生:
 *     `[TerminalPane] container still 0x0, defer open` が連続出力され term.open が
 *     呼ばれず文字が描画されない (defer 無限ループ)。
 * - 根本原因は ResizeObserver の observe 対象が inner だけだったこと。
 *   inner は `position: absolute; inset: 0` で wrapper 配下にあり、wrapper の
 *   親 (Shell.tsx の `<div class={hidden|block}>`) が display:none の間は
 *   wrapper も inner も 0x0 のまま。viewMode 切替で親の display が block に
 *   なった瞬間、実際には wrapper の rect が先に確定して inner が次 frame で
 *   追従するケースがあり、inner の ResizeObserver notification が fire しても
 *   その瞬間 getBoundingClientRect が 0x0 を返す race が発生していた。
 * - hotfix: ResizeObserver で **wrapper と inner の両方** を observe。加えて、
 *   wrapper は visible だが inner が 0x0 のケースは requestAnimationFrame で
 *   次 frame に再 try する短い loop を追加 (最大 10 frame ≒ 166ms)。
 *   これで display:hidden → block 直後の layout race を確実に吸収する。
 */
export function TerminalPane({ ptyId }: { ptyId: string }) {
  // PM-932: wrapper は半透明 overlay (壁紙への透過) を担う。
  // inner は xterm canvas の mount 先 (xterm.js が .xterm を生成するコンテナ)。
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = innerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;

    let disposed = false;
    // cleanup 用 function を集約管理 (async race で作られる listener も含む)。
    const cleanups: Array<() => void> = [];

    let termInstance: import("@xterm/xterm").Terminal | null = null;
    let fitAddonInstance: import("@xterm/addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    // PM-934: rAF 再試行 loop の ID。cleanup で cancel する必要があるため outer scope。
    let pendingRafId: number | null = null;

    // xterm は SSR 不可のため dynamic import (TerminalPane 自体 "use client" だが、
    // build 時の bundling での Node-only code 回避のため念押し)。
    void (async () => {
      try {
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");

        if (disposed) return;

        // PM-932 (DOM overlay 方式): wrapper に `--terminal-bg` (rgba 半透明黒) を
        // 適用し、xterm canvas は完全透明にする。これにより canvas renderer の
        // `allowTransparency` 実装依存の透過挙動 (PM-928/PM-930 で不安定だった)
        // から脱却し、壁紙 → wrapper overlay → canvas text の 3 層合成を純粋な
        // DOM で保証する。`--terminal-bg` の default は globals.css で定義。
        const bgFromVar =
          typeof window !== "undefined"
            ? getComputedStyle(document.documentElement)
                .getPropertyValue("--terminal-bg")
                .trim()
            : "";
        const wrapperBg = bgFromVar || "rgba(0, 0, 0, 0.55)";
        // wrapper の inline style で明示上書き (PM-932: CSS variable が未適用でも
        // 必ず overlay が効くように固定値を流し込む)。
        wrapper.style.background = wrapperBg;

        const term = new Terminal({
          cursorBlink: true,
          fontFamily:
            "'Cascadia Mono', Menlo, Consolas, 'Courier New', monospace",
          fontSize: 13,
          lineHeight: 1.2,
          scrollback: 5000,
          // PM-922: 背景画像 (PM-870) を terminal pane でも透過させるため、
          // rgba background を使う。xterm.js は allowTransparency=true の場合のみ
          // rgba を尊重し、canvas renderer で透過合成する。WebGL renderer は
          // 透過未対応のため loadAddon も削除 (0.18.0 の WebglAddon は
          // background を opaque にするため壁紙が見えなくなる)。
          // PM-932: canvas 自体を完全透明にして DOM overlay に委譲 (下記 theme 参照)。
          allowTransparency: true,
          theme: {
            // shadcn dark theme 近似。
            // PM-932 hotfix: background を完全透明 (rgba(0,0,0,0)) に変更。
            // 半透明黒 overlay は wrapper div (CSS) 側で描画し、canvas は文字のみ
            // 描画する。canvas renderer の透過合成依存を排除して確実に壁紙が
            // 透ける構造に変更。
            // foreground は #ffffff 維持 (PM-928、可読性優先)。
            background: "rgba(0, 0, 0, 0)",
            foreground: "#ffffff",
            cursor: "#ffffff",
            cursorAccent: "#0a0a0a",
            // PM-932: canvas が透明になったため、selection 背景も見えづらくなる
            // 可能性がある。薄めの白半透明で選択範囲を明示。
            selectionBackground: "rgba(255, 255, 255, 0.3)",
            black: "#1e1e1e",
            red: "#f85149",
            green: "#56d364",
            yellow: "#e3b341",
            blue: "#58a6ff",
            magenta: "#bc8cff",
            cyan: "#39c5cf",
            white: "#b1bac4",
            brightBlack: "#6e7681",
            brightRed: "#ff7b72",
            brightGreen: "#7ee787",
            brightYellow: "#f2cc60",
            brightBlue: "#79c0ff",
            brightMagenta: "#d2a8ff",
            brightCyan: "#56d4dd",
            brightWhite: "#f0f6fc",
          },
        });

        const fit = new FitAddon();
        term.loadAddon(fit);

        // PM-930 hotfix (root cause of PM-928 regression):
        // term.open() を display:none 親配下 (container rect = 0x0) で呼ぶと、
        // xterm.js の renderer は font metric の測定に失敗し canvas が 0 dimension
        // で生成される。後続の ResizeObserver で fit.fit() が呼ばれても、
        // 内部 renderer は初期化時の broken state を持ち続け text が描画されない。
        //
        // 本件の発生経路:
        //   1. Shell のデフォルト viewMode は "chat" のため Terminal タブは
        //      起動直後 `display:hidden` でマウント (Shell.tsx 275-283 行)
        //   2. TerminalPaneItem の auto-spawn useEffect で pty 作成
        //   3. TerminalPane がマウントされ useEffect 発火
        //   4. container は ancestor display:none で getBoundingClientRect() = 0x0
        //   5. term.open() + fit.fit() が 0x0 で実行され renderer が broken
        //   6. ユーザーが terminal タブに切替えると ResizeObserver が fire するが
        //      既に canvas が壊れているため text は表示されない (背景画像のみ見える)
        //
        // 対策: container が非 0 サイズになるまで term.open() を遅延する。
        // その間の pty stdout は pendingWrites buffer に貯めて、open 後に flush。
        //
        // container が初期から visible なら即座に open、hidden なら ResizeObserver
        // で visibility を待つ。どちらの経路でも pty stdout は取り逃さない。

        const pendingWrites: string[] = [];
        let termOpened = false;
        // PM-934: rAF 再試行 loop の attempt counter。ID 自体は outer scope の
        // `pendingRafId` に保持 (cleanup から cancel できるように)。
        let rafAttempts = 0;
        const RAF_MAX_ATTEMPTS = 10; // ≒ 166ms (16.6ms * 10)

        const flushAndOpen = () => {
          if (termOpened || disposed) return;
          const rect = container.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            // PM-934: wrapper は visible (rect 非 0) だが inner だけ 0x0 の
            // race を救済。ResizeObserver は inner/wrapper 両方を観察している
            // が、display:hidden → block 直後の 1〜2 frame は layout が安定
            // しておらず inner の rect が遅延するケースがある。rAF で最大
            // RAF_MAX_ATTEMPTS 回まで次 frame に再 try して確実に捕捉する。
            const wrapperRect = wrapper.getBoundingClientRect();
            if (
              wrapperRect.width > 0 &&
              wrapperRect.height > 0 &&
              rafAttempts < RAF_MAX_ATTEMPTS &&
              pendingRafId === null
            ) {
              rafAttempts += 1;
              pendingRafId = requestAnimationFrame(() => {
                pendingRafId = null;
                flushAndOpen();
              });
              return;
            }
            // wrapper も 0x0、または rAF 上限到達: ResizeObserver の次通知を待つ。
            // (debug log は最初の数回のみ出す。無限ループ気味に見える現象を
            //  抑えつつ、実機 diag のため完全 suppress はしない。)
            if (rafAttempts <= 2) {
              logger.debug("[TerminalPane] container still 0x0, defer open", {
                ptyId,
                width: rect.width,
                height: rect.height,
                wrapperWidth: wrapperRect.width,
                wrapperHeight: wrapperRect.height,
                rafAttempts,
              });
            }
            return;
          }
          // 成功 path に入ったら rAF attempt counter を reset (未使用だがセマンティクス上)。
          rafAttempts = 0;
          try {
            term.open(container);
            termOpened = true;
          } catch (e) {
            logger.warn("[TerminalPane] term.open failed:", e);
            return;
          }
          try {
            fit.fit();
          } catch (e) {
            logger.debug("[TerminalPane] initial fit failed:", e);
          }
          logger.debug("[TerminalPane] opened", {
            ptyId,
            cols: term.cols,
            rows: term.rows,
            width: rect.width,
            height: rect.height,
            pending: pendingWrites.length,
          });
          // 貯めていた stdout を flush (順序保持)。
          if (pendingWrites.length > 0) {
            for (const chunk of pendingWrites) {
              term.write(chunk);
            }
            pendingWrites.length = 0;
          }
          try {
            term.focus();
          } catch {
            // noop
          }
        };

        // 初回試行 (container が即座に visible なケース)。
        flushAndOpen();

        termInstance = term;
        fitAddonInstance = fit;

        // PM-921 Bug 1: viewport reset 関数を registry へ登録。
        // reset + fit を合わせて呼ぶことで alt screen 残留の scroll region /
        // cursor offset / viewport を強制初期化する。
        const resetFn = () => {
          try {
            term.reset();
          } catch (e) {
            logger.debug("[TerminalPane] term.reset failed:", e);
          }
          try {
            fit.fit();
          } catch (e) {
            logger.debug("[TerminalPane] fit after reset failed:", e);
          }
          // shell 側にも redraw を要求 (cmd.exe は Ctrl+L で prompt 再描画しないが
          // bash / powershell は効く。cmd.exe はユーザに明示 `cls` を促す想定)。
          // あえて何も送らない: 余計な keystroke 送信は副作用リスクが大きいため
          // xterm viewport の reset のみに留める。
          try {
            term.focus();
          } catch {
            // noop
          }
        };
        registerTerminalReset(ptyId, resetFn);
        cleanups.push(() => unregisterTerminalReset(ptyId, resetFn));

        // PM-921 Bug 1: Ctrl+Shift+L で手動 reset (Unix 慣例の Ctrl+L は
        // shell の screen clear と衝突するため Shift 付き)。
        const handleKeydown = (ev: KeyboardEvent) => {
          if (ev.ctrlKey && ev.shiftKey && (ev.key === "L" || ev.key === "l")) {
            ev.preventDefault();
            ev.stopPropagation();
            resetFn();
          }
        };
        container.addEventListener("keydown", handleKeydown, true);
        cleanups.push(() =>
          container.removeEventListener("keydown", handleKeydown, true)
        );

        // stdin: xterm → Rust
        const dataDisp = term.onData((data) => {
          void callTauri<void>("pty_write", { ptyId, data }).catch((e) => {
            logger.warn("[TerminalPane] pty_write failed:", e);
          });
        });
        cleanups.push(() => dataDisp.dispose());

        // stdout: Rust → xterm
        // PM-930: term がまだ open されていない場合 (container 0x0 で遅延中) は
        // pendingWrites に貯めて、flushAndOpen() で flush する。これにより
        // tab 切替前に pty から届いた最初の prompt (`C:\...>` や bash の PS1) も
        // 取りこぼさず表示できる。
        let unlistenData: UnlistenFn | null = null;
        try {
          unlistenData = await onTauriEvent<string>(
            `pty:${ptyId}:data`,
            (payload) => {
              if (typeof payload !== "string") return;
              if (termOpened) {
                term.write(payload);
              } else {
                pendingWrites.push(payload);
              }
            }
          );
        } catch (e) {
          logger.warn("[TerminalPane] listen data failed:", e);
        }
        if (disposed) {
          unlistenData?.();
          return;
        }
        if (unlistenData) cleanups.push(unlistenData);

        // resize: ResizeObserver で container size 変化を追い FitAddon + backend resize
        // 短時間に連続 resize されるケース (window 拡大中) は debounce で抑える。
        //
        // PM-930: term がまだ open されていない場合 (起動直後 display:none) は、
        // この ResizeObserver が container の visibility 変化を検知する primary path
        // となる。display:hidden → block 切替で rect が 0x0 → non-zero になった
        // タイミングで flushAndOpen() を呼び、term.open() + fit.fit() + pending
        // stdout の flush を行う。
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const handleResize = () => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            // まだ open されていないなら、visibility 待機中。open を試みる。
            if (!termOpened) {
              flushAndOpen();
              if (!termOpened) return; // まだ 0x0 なら次の resize event を待つ
            }
            if (!fitAddonInstance || !termInstance) return;
            try {
              fitAddonInstance.fit();
            } catch (e) {
              logger.debug("[TerminalPane] fit error:", e);
              return;
            }
            const cols = termInstance.cols;
            const rows = termInstance.rows;
            if (cols > 0 && rows > 0) {
              void callTauri<void>("pty_resize", {
                ptyId,
                cols,
                rows,
              }).catch((e) => {
                logger.warn("[TerminalPane] pty_resize failed:", e);
              });
            }
          }, 50);
        };
        // PM-934: wrapper + inner の両方を observe。
        // - inner が 0x0 のまま wrapper だけ visible になる race で、wrapper の
        //   変化で handleResize が発火 → flushAndOpen が rAF retry loop に入り、
        //   次 frame で inner が実 size を持つタイミングを確実に捕捉する。
        // - 以後の window resize / split layout 変化はどちらの notification でも
        //   最終的に fit.fit() が呼ばれれば挙動は同じ (handleResize 内で debounce
        //   しているため 2 重 fire でも 1 回の fit に集約される)。
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        resizeObserver.observe(wrapper);
        // 初回 resize を trigger (fit の結果を backend に伝える)
        handleResize();
      } catch (e) {
        logger.warn("[TerminalPane] initialize failed:", e);
      }
    })();

    return () => {
      disposed = true;
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch {
          // noop
        }
      }
      // PM-934: rAF retry loop を cancel。disposed=true で次 frame の
      // flushAndOpen は early return されるが、念のため rAF 自体も cancel。
      if (pendingRafId !== null) {
        try {
          cancelAnimationFrame(pendingRafId);
        } catch {
          // noop
        }
      }
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          // noop
        }
      }
      try {
        termInstance?.dispose();
      } catch {
        // noop
      }
    };
  }, [ptyId]);

  return (
    // PM-932: DOM overlay 方式。wrapper に半透明黒を塗り (CSS variable
    // `--terminal-bg` or 実行時 inline style で上書き)、inner は xterm の canvas
    // mount 先。xterm canvas は完全透明に設定しているので、wrapper の半透明黒が
    // 実効背景色として機能し、その奥の html::before 壁紙が透けて見える。
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        // inline 初期値 (useEffect で `--terminal-bg` から上書き)。
        // SSR 時点でも wrapper が overlay として機能するように fallback を設定。
        background: "rgba(0, 0, 0, 0.55)",
      }}
      aria-label="ターミナル"
      role="application"
    >
      <div ref={innerRef} className="absolute inset-0" />
    </div>
  );
}
