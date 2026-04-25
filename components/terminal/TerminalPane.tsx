"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search as SearchIcon, X as CloseIcon } from "lucide-react";

import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";
import {
  registerTerminalReset,
  unregisterTerminalReset,
} from "@/components/terminal/terminal-reset-registry";
import {
  registerActiveTerminal,
  unregisterActiveTerminal,
} from "@/hooks/useTerminalListener";
import {
  TERMINAL_DEFAULT_PANE_ID,
  useTerminalStore,
} from "@/lib/stores/terminal";
// PM-947: Ctrl+Shift+N で新規 terminal 起動時、active project の cwd が必要。
import { useProjectStore } from "@/lib/stores/project";
// PM-951: 設定画面「フォントサイズ」を xterm.js に反映するため購読する。
import { useSettingsStore } from "@/lib/stores/settings";
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
 * ## PM-941 (2026-04-20): tab 切替 scrollback 保持
 * - PM-935 の conditional mount で 0x0 race は消滅したが、tab 切替で
 *   TerminalPane が unmount → xterm dispose → scrollback 消失の回帰が発生。
 * - 対策: `pty:{id}:data` の subscribe を `useTerminalListener` (Shell
 *   singleton) へ移管し、module-level の ring buffer に常時蓄積する。
 *   TerminalPane は mount 時に `registerActiveTerminal(ptyId, term)` を
 *   呼ぶだけで、buffer の再現と以降の live write を subscriber pattern で
 *   受け取る。unmount 時は `unregisterActiveTerminal(ptyId, term)` で
 *   解除 (buffer 自体は保持、pty が store から消えた時点で buffer も削除)。
 * - pendingWrites の pane-local 先取り buffer は本変更で不要化 (singleton
 *   listener が pane mount 前の出力も buffer に貯めているため)。
 *
 * ## PM-947 (v1.2): Terminal keyboard shortcut 拡充
 * - xterm-addon-search で scrollback 全文検索 (Ctrl+Shift+F)
 * - clipboard copy/paste (Ctrl+Shift+C / Ctrl+Shift+V)
 * - terminal clear (Ctrl+Shift+K)
 * - 新規 / close (Ctrl+Shift+N / Ctrl+Shift+W)
 * - sub-tab 内 terminal 切替 (Ctrl+Tab)
 * - hotkey は xterm の `attachCustomKeyEventHandler` で `false` を返して
 *   xterm への文字入力を抑止しつつ、React 側で動作を実行する。これにより
 *   Terminal focus 時だけ有効化され、他の場面 (chat / editor) では発火しない。
 * - Ctrl+Shift+F は SearchPalette (PM-231) と衝突するが、TerminalPane 内の
 *   custom handler が先に preventDefault + stopPropagation するため
 *   useHotkeys (document level) には到達しない。
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

  // PM-947: 検索 UI の表示状態 + 現在の query 文字列。
  // xterm-addon-search の `findNext(query)` / `findPrevious(query)` に渡す。
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // useEffect 内で生成した addon / term instance を参照するため ref に保持。
  // React state にすると再レンダリングの都度 useEffect が走って xterm が破棄
  // されてしまうので、これは必ず ref で持つ。
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const searchAddonRef = useRef<
    import("@xterm/addon-search").SearchAddon | null
  >(null);
  // PM-951: fontSize 変更後に fit.fit() を呼んで rows/cols を再計測するため
  // FitAddon も ref で保持する（既存ロジックは useEffect scope の局所変数で
  // 持っていたが、font size hook からは参照できないため追加）。
  const fitAddonRef = useRef<
    import("@xterm/addon-fit").FitAddon | null
  >(null);

  // PM-947: Ctrl+Tab で同 pane の次 terminal に切替えるため、最新の
  // terminals / panes を store から取る必要がある。useEffect 再起動を
  // 避けるため callback 内で getState() を使う。
  const cycleTerminal = useCallback(
    (direction: 1 | -1) => {
      const state = useTerminalStore.getState();
      const current = state.terminals[ptyId];
      if (!current) return;
      const paneId = current.paneId ?? TERMINAL_DEFAULT_PANE_ID;
      const siblings = Object.values(state.terminals)
        .filter(
          (t) =>
            t.projectId === current.projectId &&
            (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === paneId
        )
        .sort((a, b) => a.startedAt - b.startedAt);
      if (siblings.length <= 1) return;
      const idx = siblings.findIndex((t) => t.ptyId === ptyId);
      if (idx < 0) return;
      const nextIdx = (idx + direction + siblings.length) % siblings.length;
      state.setActiveTerminal(siblings[nextIdx].ptyId, paneId);
    },
    [ptyId]
  );

  // PM-947: 検索 overlay の close handler。
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    // 検索ハイライトを解除して terminal に focus を戻す。
    try {
      searchAddonRef.current?.clearDecorations();
    } catch {
      // addon 未 mount or 旧 version: noop
    }
    try {
      termRef.current?.focus();
    } catch {
      // noop
    }
  }, []);

  // PM-947: findNext / findPrevious は searchQuery を参照する最新の handler
  // を return する。input の onKeyDown から呼ぶ。
  const findNext = useCallback(() => {
    const q = searchQuery;
    if (!q) return;
    try {
      searchAddonRef.current?.findNext(q);
    } catch (e) {
      logger.debug("[TerminalPane] findNext failed:", e);
    }
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    const q = searchQuery;
    if (!q) return;
    try {
      searchAddonRef.current?.findPrevious(q);
    } catch (e) {
      logger.debug("[TerminalPane] findPrevious failed:", e);
    }
  }, [searchQuery]);

  // PM-947: searchOpen が true になったら input に focus。
  useEffect(() => {
    if (searchOpen) {
      // next frame で focus (dialog の mount が先に終わるのを待つ)
      const id = requestAnimationFrame(() => {
        try {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        } catch {
          // noop
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [searchOpen]);

  // PM-951: 設定画面「フォントサイズ」を xterm.js にも反映する。
  // - 初期 mount 時: メイン useEffect 内で fontSizeRef.current を読み、new Terminal({ fontSize }) に渡す。
  // - 以降の変更: この useEffect が term.options.fontSize を書き換え、fit.fit() で再計測する。
  // メイン useEffect の依存に fontSize を入れると term が毎回 dispose+再生成されて
  // scrollback が消えるので、ref + 独立 effect の 2 段構成にしている。
  const fontSize = useSettingsStore((s) => s.settings.appearance.fontSize);
  const fontSizeRef = useRef(fontSize);
  useEffect(() => {
    fontSizeRef.current = fontSize;
    const term = termRef.current;
    if (!term) return;
    try {
      // xterm.js 5.x の ITerminalOptions は runtime 書き換え可 (options は setter)。
      term.options.fontSize = fontSize;
    } catch (e) {
      logger.debug("[TerminalPane] options.fontSize 更新に失敗:", e);
    }
    // fontSize 変更で文字幅/行高が変わるため、cols/rows を再計測する。
    // backend pty の resize は既存 ResizeObserver 経路に任せたいので、
    // fit.fit() 側が自身の listener を通じて resize 通知を発火するのに任せる。
    try {
      fitAddonRef.current?.fit();
    } catch (e) {
      logger.debug("[TerminalPane] fit after fontSize change failed:", e);
    }
  }, [fontSize]);

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
        // PM-947: scrollback 検索のための addon。xterm に load すると
        // Terminal.findNext(q) / findPrevious(q) が使えるようになる。
        const { SearchAddon } = await import("@xterm/addon-search");

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
          // PM-951: 設定画面「フォントサイズ」を初期値として使用。
          // mount 後の変更は上記 useEffect (fontSize dep) が term.options.fontSize を
          // 書き換えるので、ここは ref 経由で初期値のみ注入する。
          fontSize: fontSizeRef.current,
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

        // PM-947: search addon を load。`findNext(query)` / `findPrevious(query)`
        // で scrollback 全体を検索し、match 行にハイライト + scroll する。
        const searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);
        searchAddonRef.current = searchAddon;
        cleanups.push(() => {
          try {
            searchAddon.dispose();
          } catch {
            // noop
          }
          if (searchAddonRef.current === searchAddon) {
            searchAddonRef.current = null;
          }
        });

        // PM-947: Terminal focus 中のみ有効な custom keyboard shortcut。
        // `attachCustomKeyEventHandler` は xterm が keystroke を
        // 文字入力として受け取る前に呼ばれる hook で、false を返すと xterm は
        // その入力を無視する (文字送信しない)。
        //
        // Ctrl+Shift+F (既存 SearchPalette と衝突) / Ctrl+Tab (ブラウザ tab 切替)
        // は preventDefault + stopPropagation を併用して document / window の
        // listener (react-hotkeys-hook の mod+shift+f や Tauri webview の
        // ブラウザ既定動作) に到達させない。
        //
        // Ctrl+Shift+C / V は xterm デフォルトでは無効 (xterm.js は OS 標準
        // copy/paste を honor する設計) だが、Windows の cmd / bash は
        // Ctrl+C を SIGINT として受け取る関係で選択 copy 用の専用キーが
        // 必要になる。ここで明示 handle する。
        term.attachCustomKeyEventHandler((ev) => {
          // keydown のみ処理 (keyup を処理すると二重発火になる)
          if (ev.type !== "keydown") return true;
          // PM-980 (v1.22.8): macOS は Cmd+V、Windows / Linux は Ctrl+V を
          // ペーストとして扱う。OS 判定で「accel = Ctrl OR Meta」とするのが
          // VSCode / Cursor terminal と整合する挙動 (両 OS で同じ keymap)。
          const ctrl = ev.ctrlKey || ev.metaKey;
          const shift = ev.shiftKey;
          const key = ev.key;

          // Ctrl+Tab: 同 pane 内の次 / 前 terminal に切替
          if (ctrl && !shift && key === "Tab") {
            ev.preventDefault();
            ev.stopPropagation();
            cycleTerminal(1);
            return false;
          }
          if (ctrl && shift && key === "Tab") {
            ev.preventDefault();
            ev.stopPropagation();
            cycleTerminal(-1);
            return false;
          }

          // PM-980 (v1.22.8): Ctrl+V (macOS Cmd+V) でクリップボードからペースト。
          // xterm.js のデフォルトは Ctrl+V を SYN (0x16) として shell へ送る挙動だが、
          // Cursor / VSCode の terminal は Ctrl+V でペーストできるためそれに合わせる。
          // bracketed paste mode が有効なら term.paste が escape sequence を付与し、
          // shell 側で複数行入力として安全に取り扱われる。
          // IME composition 中はブラウザが key event を抑制するため (isComposing=true /
          // keyCode=229) ここに到達せず、composition の確定文字列は xterm の通常
          // 入力経路で渡される。明示的に bail out する。
          if (
            ctrl &&
            !shift &&
            (key === "v" || key === "V") &&
            !ev.isComposing &&
            ev.keyCode !== 229
          ) {
            ev.preventDefault();
            ev.stopPropagation();
            void (async () => {
              try {
                const { readText } = await import(
                  "@tauri-apps/plugin-clipboard-manager"
                );
                const text = await readText();
                if (!text) return;
                // term.paste は xterm.js v5 の API: bracketed paste mode を尊重し、
                // 内部的に term.onData を発火するので pty_write 側の paste 経路に
                // 自動的に乗る (上の term.onData listener で pty に書き込まれる)。
                try {
                  term.paste(text);
                } catch (e) {
                  // paste が落ちた場合は直接 pty_write へ fallback
                  logger.debug(
                    "[TerminalPane] term.paste failed, falling back to pty_write:",
                    e
                  );
                  void callTauri<void>("pty_write", {
                    ptyId,
                    data: text,
                  }).catch((err) => {
                    logger.warn(
                      "[TerminalPane] paste pty_write fallback failed:",
                      err
                    );
                  });
                }
              } catch (e) {
                logger.warn(
                  "[TerminalPane] Ctrl+V clipboard read failed:",
                  e
                );
              }
            })();
            return false;
          }

          // 以降は Ctrl+Shift+X 系。Shift なしは xterm にそのまま流す。
          if (!ctrl || !shift) return true;

          // Ctrl+Shift+F: Terminal 内 find を開く (SearchPalette より優先)
          if (key === "F" || key === "f") {
            ev.preventDefault();
            ev.stopPropagation();
            setSearchOpen((prev) => !prev);
            return false;
          }
          // Ctrl+Shift+K: term.clear() (scrollback を残しつつ viewport クリア)
          if (key === "K" || key === "k") {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              term.clear();
            } catch (e) {
              logger.debug("[TerminalPane] term.clear failed:", e);
            }
            return false;
          }
          // Ctrl+Shift+N: 同 pane に新規 terminal を起動
          if (key === "N" || key === "n") {
            ev.preventDefault();
            ev.stopPropagation();
            const state = useTerminalStore.getState();
            const current = state.terminals[ptyId];
            const proj = useProjectStore.getState().getActiveProject();
            if (current && proj) {
              void state.createTerminal(
                proj.id,
                proj.path,
                undefined,
                current.paneId ?? TERMINAL_DEFAULT_PANE_ID
              );
            }
            return false;
          }
          // Ctrl+Shift+W: 現在 terminal を close
          if (key === "W" || key === "w") {
            ev.preventDefault();
            ev.stopPropagation();
            void useTerminalStore.getState().closeTerminal(ptyId);
            return false;
          }
          // Ctrl+Shift+C: 選択範囲を clipboard にコピー
          if (key === "C" || key === "c") {
            ev.preventDefault();
            ev.stopPropagation();
            const selection = term.getSelection();
            if (selection && typeof navigator !== "undefined" && navigator.clipboard) {
              void navigator.clipboard.writeText(selection).catch((e) => {
                logger.warn("[TerminalPane] clipboard write failed:", e);
              });
            }
            return false;
          }
          // Ctrl+Shift+V: clipboard の text を pty に paste
          // PM-980 (v1.22.8): navigator.clipboard は Tauri WebView2 で
          // permissions API 経由の制約があるため、Tauri plugin-clipboard-manager
          // の readText に統一 (Ctrl+V と同じ経路)。
          if (key === "V" || key === "v") {
            ev.preventDefault();
            ev.stopPropagation();
            void (async () => {
              try {
                const { readText } = await import(
                  "@tauri-apps/plugin-clipboard-manager"
                );
                const text = await readText();
                if (!text) return;
                try {
                  term.paste(text);
                } catch (e) {
                  logger.debug(
                    "[TerminalPane] term.paste (Ctrl+Shift+V) failed, fallback to pty_write:",
                    e
                  );
                  void callTauri<void>("pty_write", {
                    ptyId,
                    data: text,
                  }).catch((err) => {
                    logger.warn(
                      "[TerminalPane] paste pty_write fallback failed:",
                      err
                    );
                  });
                }
              } catch (e) {
                logger.warn(
                  "[TerminalPane] Ctrl+Shift+V clipboard read failed:",
                  e
                );
              }
            })();
            return false;
          }
          // Ctrl+Shift+L は従来 container keydown listener (PM-921) 側で
          // 処理。ここでは xterm にそのまま渡してしまうと文字が入るため false。
          if (key === "L" || key === "l") {
            return false;
          }
          return true;
        });

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
        // PM-941 以降、遅延期間中の pty stdout は useTerminalListener の
        // module-level ring buffer に singleton で蓄積されており、open 成功
        // 直後の `registerActiveTerminal` で一括再現される (pane-local
        // pendingWrites は不要)。
        //
        // container が初期から visible なら即座に open、hidden なら ResizeObserver
        // で visibility を待つ。どちらの経路でも pty stdout は取り逃さない。

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
          });
          // PM-941: singleton listener 側の scrollback buffer を一括再現 +
          // 以降の live data event の subscriber として term を登録。
          // 登録は register 関数内で atomic (buffer write → active map set)
          // に実行されるため、登録前後で data event が重複 / 欠落することは
          // ない (JS event loop の単一スレッド性質を利用)。
          try {
            registerActiveTerminal(ptyId, term);
          } catch (e) {
            logger.debug("[TerminalPane] registerActiveTerminal failed:", e);
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
        // PM-947: JSX 側 (search overlay の onChange handler) から term に
        // アクセスするために ref に保持。unmount の cleanup で null に戻す。
        termRef.current = term;
        // PM-951: fontSize 変更時の fit.fit() 呼出のため FitAddon も ref に保持。
        fitAddonRef.current = fit;
        cleanups.push(() => {
          if (termRef.current === term) {
            termRef.current = null;
          }
          if (fitAddonRef.current === fit) {
            fitAddonRef.current = null;
          }
        });

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
        // PM-941: `pty:{ptyId}:data` の購読は useTerminalListener (Shell
        // singleton) 側で一元管理する。TerminalPane は registerActiveTerminal
        // で subscriber として登録されており、以降の data event は
        // buffer 追記 + term.write() の両方が singleton 経路で処理される。
        // 旧実装の pane-local listener は tab 切替で unmount される間の
        // scrollback を保持できなかったため PM-941 で廃止。
        cleanups.push(() => unregisterActiveTerminal(ptyId, term));
        if (disposed) return;

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
    // PM-947: cycleTerminal は ptyId のみに依存する useCallback であり、
    // ptyId が変われば本 useEffect が丸ごと再起動して新しい closure で
    // customKeyEventHandler が張り直されるため exhaustive-deps の警告は
    // 無視してよい (ptyId のみを deps にして多重 mount を避ける意図)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* PM-947: 検索 overlay。Ctrl+Shift+F で開く。
          Enter / Shift+Enter で次 / 前を検索、Esc で閉じる。
          xterm canvas の上に絶対配置、pointer-events で操作可能に。 */}
      {searchOpen && (
        <div
          className="pointer-events-auto absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border/50 bg-background/90 px-2 py-1 shadow-md backdrop-blur-sm"
          role="search"
          aria-label="ターミナル内検索"
        >
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              // input 内で xterm の customKeyEventHandler が動かないため、
              // ここで独立に handling する。
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                  findPrevious();
                } else {
                  findNext();
                }
                return;
              }
              // Ctrl+Shift+F を再度押したら close。入力中の input でも効くように。
              if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
                return;
              }
            }}
            placeholder="検索..."
            className="w-48 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="検索語"
          />
          <button
            type="button"
            onClick={findPrevious}
            className="rounded px-1 text-[10px] text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            aria-label="前を検索"
            title="前を検索 (Shift+Enter)"
          >
            &#x2191;
          </button>
          <button
            type="button"
            onClick={findNext}
            className="rounded px-1 text-[10px] text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            aria-label="次を検索"
            title="次を検索 (Enter)"
          >
            &#x2193;
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            aria-label="検索を閉じる"
            title="閉じる (Esc)"
          >
            <CloseIcon className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
