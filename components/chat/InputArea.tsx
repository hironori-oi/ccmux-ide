"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Paperclip, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ImageThumb } from "@/components/chat/ImageThumb";
import { SlashPalette } from "@/components/palette/SlashPalette";
import { AtMentionPicker } from "@/components/chat/AtMentionPicker";
import { HelpDialog } from "@/components/chat/HelpDialog";
import { ClearSessionDialog } from "@/components/chat/ClearSessionDialog";
import { ModelPickerDialog } from "@/components/chat/ModelPickerDialog";
import { EffortPickerDialog } from "@/components/chat/EffortPickerDialog";
import { useChatStore, DEFAULT_PANE_ID, type Attachment } from "@/lib/stores/chat";
// DEC-057 v1.11.0: dialog store は session-preferences の継承源として使用しない
// (project 間 leak 防止)。ModelPickerDialog/EffortPickerDialog/HelpDialog 等で
// 独立に useDialogStore を参照しているため、import は本ファイルから除去して OK。
import {
  resolveSessionPreferences,
  useSessionPreferencesStore,
  type SessionPreferences,
} from "@/lib/stores/session-preferences";
import {
  DEFAULT_PERMISSION_MODE,
  EFFORT_CHOICES,
  modelIdToSdkId,
} from "@/lib/types";

// React 19 + zustand: selector が新配列を返すと getSnapshot cache が効かず
// infinite loop。固定参照の凍結空配列で回避。
const EMPTY_ATTACHMENTS: readonly Attachment[] = Object.freeze([]);
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import {
  useSessionStore,
  getSdkSessionIdFromCache,
} from "@/lib/stores/session";
import { claimNextSendForPane } from "@/hooks/useAllProjectsSidecarListener";
import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";
import { handleBuiltinSlash } from "@/lib/builtin-slash";
import {
  CCMUX_FILE_PATH_MIME,
  formatFileMention,
} from "@/lib/file-drag";
import { writeFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { humanFileSize } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import type { SlashCmd } from "@/lib/types";

/** PRJ-012 Round E1: 「大きい画像」警告の閾値（100KB）。 */
const LARGE_ATTACHMENT_BYTES = 100 * 1024;

/**
 * PM-132 / PM-142 / PM-143 / PM-201: 送信入力欄。
 *
 * - Textarea + 送信ボタン、Ctrl/Cmd+Enter で送信
 * - onDrop で D&D 画像（先頭 1 枚）を `$APPLOCALDATA/ccmux-images/` に保存し attachment 追加
 * - 送信時、attachment があれば prompt 末尾に `@"<path>"` 形式で注入（DEC-011 継承）
 * - 送信完了後は画像のみクリア（メッセージ履歴は残す）
 * - `/` で始まる最後のトークン（空白/改行区切り）検出時に SlashPalette を開き、
 *   選択された slash を該当トークンに置換（末尾に空白を足してカーソル続行）
 * - SlashPalette 表示中は Ctrl+Enter 送信を抑止（slash 選択を優先）
 */
export function InputArea({
  paneId = DEFAULT_PANE_ID,
}: {
  paneId?: string;
}) {
  const attachments = useChatStore(
    (s) => (s.panes[paneId]?.attachments ?? EMPTY_ATTACHMENTS) as Attachment[]
  );
  const appendAttachment = useChatStore((s) => s.appendAttachment);
  const clearAttachments = useChatStore((s) => s.clearAttachments);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const streaming = useChatStore((s) => s.panes[paneId]?.streaming ?? false);
  const setActivePane = useChatStore((s) => s.setActivePane);

  // PRJ-012 v4 / Chunk C: 組込 slash dispatcher が router / workspaceRoot を要求する。
  const router = useRouter();
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const workspaceRoot = useMemo(
    () => findProjectById(projects, activeProjectId)?.path ?? null,
    [projects, activeProjectId]
  );

  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  /**
   * Round E1: attachment ごとのファイルサイズ (bytes)。
   * key は `Attachment.id`。計測失敗時は undefined のまま。
   * 100KB 超で warn icon + tooltip 表示。
   */
  const [attachmentSizes, setAttachmentSizes] = useState<
    Record<string, number | undefined>
  >({});
  // slash クエリは textarea の onChange / onKeyUp / onClick 時に再計算する
  const [slashQuery, setSlashQuery] = useState("");
  // v3.4 Chunk B (DEC-034 Must 2): @file / @folder mention picker 状態
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /**
   * attachments 変更時にファイルサイズを計測する。
   * 既に計測済みの id は skip、削除された id は state から除去。
   * 100KB 超の判定に使うだけなので失敗は silent。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates: Record<string, number | undefined> = {};
      let changed = false;
      for (const a of attachments) {
        // 計測済み（成功/失敗問わずキーが存在）なら skip
        if (Object.prototype.hasOwnProperty.call(attachmentSizes, a.id)) continue;
        try {
          const s = await stat(a.path);
          if (cancelled) return;
          updates[a.id] = typeof s.size === "number" ? s.size : undefined;
          changed = true;
        } catch {
          updates[a.id] = undefined;
          changed = true;
        }
      }
      // 削除された id を掃除
      const liveIds = new Set(attachments.map((a) => a.id));
      const pruned: Record<string, number | undefined> = {};
      for (const [id, v] of Object.entries(attachmentSizes)) {
        if (liveIds.has(id)) pruned[id] = v;
        else changed = true;
      }
      if (changed && !cancelled) {
        setAttachmentSizes({ ...pruned, ...updates });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentSizes]);

  /**
   * 現在の caret で slash / at mention 断片を再評価して state に反映する。
   *
   * v3.4 Chunk B (DEC-034 Must 2): slash と at の排他制御。
   * 同一トークンに両方が前置することは無いが、カーソル直近の token が
   * `/` / `@` どちらで始まるかで分岐する。両方同時 open しないよう
   * 以下の順で判定し、どちらかが open になればもう一方は close する:
   *
   *   1. slash（`/` 始まり） → SlashPalette を優先
   *   2. at（`@` 始まり）    → AtMentionPicker
   *   3. どちらでもない      → 両方 close
   */
  function recomputeSlashAt(value: string, caret: number) {
    const s = detectSlashFragment(value, caret);
    if (s) {
      setSlashQuery(s.query);
      setSlashOpen(true);
      setAtOpen(false);
      return;
    }
    const a = detectAtFragment(value, caret);
    if (a) {
      setAtQuery(a.query);
      setAtOpen(true);
      setSlashOpen(false);
      return;
    }
    setSlashOpen(false);
    setAtOpen(false);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    // v3.3 DEC-033: activeProjectId が無ければ送信不可（sidecar が無い）。
    if (!activeProjectId) {
      toast.error(
        "プロジェクトが選択されていません。左のレールからプロジェクトを選ぶか追加してください。"
      );
      return;
    }

    // PRJ-012 v4 / Chunk C / DEC-028: Claude Code 組込 slash の intercept。
    // 戻り値 true なら本入力欄が消費したと判断し、sidecar 送信せずクリアして終了。
    if (handleBuiltinSlash(trimmed, { router, toast, workspaceRoot })) {
      setText("");
      setSlashOpen(false);
      return;
    }

    // v3.5.13 crit fix (session 永続化): 送信時に session が無ければ自動作成する。
    //
    // 旧挙動: ユーザーが「新規セッション」ボタンを押さずに送信すると
    //   currentSessionId が null のまま → chat store の appendMessage が DB に
    //   書込まれず、リロードで会話が消失する致命バグがあった。
    //
    // 新挙動: paneId の currentSessionId が null なら、送信前に createNewSession
    //   を await し、chat store の setSessionId までを同期的に済ませてから送る。
    //   これで以降の appendMessage / finalizeStreamingMessage / updateToolUseStatus が
    //   確定した session id に紐づいて DB に永続化される。
    //
    // 注意: createNewSession 内部で `useChatStore.getState().setSessionId(id)` が
    // 呼ばれるが、paneId を明示指定していない（activePane 経由で書き込む）ため
    // 念のため本 pane でも setSessionId を行って確実に紐付ける。
    let sessionId =
      useChatStore.getState().panes[paneId]?.currentSessionId ?? null;
    if (!sessionId) {
      try {
        const session = await useSessionStore.getState().createNewSession();
        sessionId = session.id;
        useChatStore.getState().setSessionId(paneId, sessionId);
      } catch (e) {
        toast.error(
          `セッション作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`
        );
        return;
      }
    }

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}`;

    // PM-143: 送信 prompt 組立。attachment があれば `@"<path>"` で改行区切り追記。
    const prompt =
      attachments.length > 0
        ? `${trimmed}\n\n${attachments.map((a) => `@"${a.path}"`).join("\n")}`
        : trimmed;

    // 画面には user message を添付画像付きで即追加（prompt は裏で sidecar へ）
    appendMessage(paneId, {
      id: `${id}:u`,
      role: "user",
      content: trimmed,
      attachments: [...attachments],
    });
    setText("");
    setStreaming(paneId, true);
    // v3.3.2 Activity: 送信直後は thinking、最初の sidecar event で streaming / tool_use に遷移
    useChatStore.getState().setActivity(paneId, { kind: "thinking" });

    try {
      // v3.5.8 (2026-04-20): 停止中 sidecar の自動起動を廃止。
      // 旧: 送信時に sidecar が未起動でも ensureSidecarRunning で自動起動し、
      //     ユーザーが「停止」した意図が無視されていた。
      // 新: stopped / error の場合は送信を拒否、TitleBar「起動」ボタンを促す。
      //     starting / stopping（遷移中）の場合のみ polling で待つ。
      const projectStore = useProjectStore.getState();
      const initialStatus = projectStore.getSidecarStatus(activeProjectId);
      if (initialStatus === "stopped" || initialStatus === "error") {
        toast.error(
          "Claude が停止中です。画面上部の「起動」ボタンを押してから送信してください。"
        );
        // 表示中のユーザーメッセージは残すが、streaming / thinking 状態を解除
        setStreaming(paneId, false);
        useChatStore.getState().setActivity(paneId, { kind: "idle" });
        return;
      }
      if (initialStatus !== "running") {
        // starting / stopping（遷移中）: running になるまで polling で待つ（最大 15s）
        const POLL_INTERVAL_MS = 100;
        const POLL_TIMEOUT_MS = 15_000;
        let waited = 0;
        while (waited < POLL_TIMEOUT_MS) {
          const s = useProjectStore.getState().getSidecarStatus(activeProjectId);
          if (s === "running") break;
          if (s === "error" || s === "stopped") {
            throw new Error(
              "Claude が起動していません。画面上部の「起動」ボタンを押してください。"
            );
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          waited += POLL_INTERVAL_MS;
        }
        const finalStatus = useProjectStore
          .getState()
          .getSidecarStatus(activeProjectId);
        if (finalStatus !== "running") {
          throw new Error(
            `Claude プロセスが起動中です（状態: ${finalStatus}）。数秒待ってから再送信してください。`
          );
        }
      }

      // v3.3 DEC-033: projectId を Rust に渡す。attachments は parallel sidecar
      // 経路で渡せるよう配列 shape で同梱（現行 Rust command は `prompt` に
      // `@"<path>"` 埋め込み済の文字列を受けるが、将来 attachment 分離に備え
      // 別フィールドでも送っておく）。
      //
      // PM-830 (v3.5.14): 現 session の sdkSessionId があれば resume として渡す。
      //   - 初回送信 (sdkSessionId == null) → SDK が新規 session を発行し、
      //     sidecar が `sdk_session_ready` event で frontend に通知 → DB 保存
      //   - 2 回目以降 → resume で前回会話 context を継続
      //   - リロード後も session.sdkSessionId は DB に永続化されているため、
      //     次の送信時にこの分岐で resume が付き Claude が文脈を覚えている
      let sdkSessionId = getSdkSessionIdFromCache(sessionId);
      // v3.5.19 PM-830 hotfix (2026-04-20): cache miss fallback (二重 safety net).
      //
      // root cause: `sdk_session_ready` event で updateSessionSdkId を呼んでも、
      // 新規 session が session store cache (`sessions` 配列) に entry として
      // 積まれていないと楽観更新 (`state.sessions.map(...)`) は no-op になり、
      // cache に sdkSessionId が反映されない。結果、次回送信でこの cache lookup が
      // null を返し resume=undefined で送信 → Claude が context を忘れる。
      //
      // fix: cache miss のとき fetchSessions() で DB から session 一覧を再 fetch
      // し、直後に再度 lookup する。activeProjectId 経由の filter 付き query なので
      // 当該 session が必ず返る（DB には sdk_session_ready 受信時に DB 書込み済み
      // のはず）。fetchSessions が失敗しても送信 flow は継続（resume なし fallback）。
      if (!sdkSessionId) {
        try {
          await useSessionStore.getState().fetchSessions();
          const refreshed = getSdkSessionIdFromCache(sessionId);
          if (refreshed) {
            sdkSessionId = refreshed;
            // PM-746 (2026-04-20): production gate のため logger.debug に移行。
            logger.debug(
              "[send] cache miss recovered via fetchSessions",
              { sessionId, sdkSessionId },
            );
          }
        } catch (e) {
          // fetch 失敗時は resume なしで送信を続行（context は失われるが UX は止めない）
          // PM-746: warn は production でも残すため console.warn 残置。
          // eslint-disable-next-line no-console
          console.warn("[send] fetchSessions fallback failed", e);
        }
      }
      // v3.5.18 PM-830 hotfix debug (2026-04-20): model 切替後の resume 伝播を
      // 可視化するため送信直前の値を log。root cause 特定後も dogfood 期間中は
      // 残置し、後日 PM-746 相当のクリーンアップで削除予定。
      // PM-746 (2026-04-20): production gate のため logger.debug に移行。
      logger.debug(
        "[send] resume=",
        sdkSessionId,
        "sessionId=",
        sessionId,
        "projectId=",
        activeProjectId,
        "cacheSessions=",
        useSessionStore
          .getState()
          .sessions.map((s) => ({ id: s.id, sdk: s.sdkSessionId })),
      );
      // PRJ-012 PM-810 (v3.6 Step 1): 送信直前に自 paneId を pending FIFO キューに
      // push する。sidecar からの最初の event 到着時に pop され `reqIdToPane` に
      // 確定 mapping が作られる。以降同 requestId の event は必ず当該 pane に
      // dispatch される (split second pane 送信時の DEFAULT_PANE_ID 誤配信を解消)。
      claimNextSendForPane(activeProjectId, paneId);

      // v1.11.0 (DEC-057): session 別 preferences を per-query options として Rust に
      // 渡す。sidecar (handlePrompt) は req.options.{model,maxThinkingTokens,
      // permissionMode} を SDK query option に上書きする実装なので、argv 再起動を
      // 経ずに設定切替が適用される。
      //
      // DEC-053 で使っていた dialog.selectedModel / selectedEffort 継承は撤廃。
      // fallback は **当該 project の perProject** → HARD_DEFAULT。
      const prefState = useSessionPreferencesStore.getState();
      const projectPref = prefState.perProject[activeProjectId] ?? null;
      const globalDefaults: SessionPreferences = {
        model: projectPref?.model ?? null,
        effort: projectPref?.effort ?? null,
        permissionMode:
          projectPref?.permissionMode ?? DEFAULT_PERMISSION_MODE,
        // DEC-059 案B (v1.13.0): permission 承認の sticky 値は project sticky
        // を直接継承する（空配列 fallback で後方互換）。
        allowedTools: projectPref?.allowedTools ?? [],
        deniedTools: projectPref?.deniedTools ?? [],
      };
      const resolvedPrefs = resolveSessionPreferences(
        prefState,
        sessionId,
        globalDefaults,
      );
      const effortMeta = resolvedPrefs.effort
        ? EFFORT_CHOICES.find((e) => e.id === resolvedPrefs.effort) ?? null
        : null;
      const sdkModel = modelIdToSdkId(resolvedPrefs.model);
      const perQueryOptions: Record<string, unknown> = {
        permissionMode: resolvedPrefs.permissionMode,
      };
      if (sdkModel) perQueryOptions.model = sdkModel;
      if (effortMeta) perQueryOptions.maxThinkingTokens = effortMeta.thinkingTokens;

      await callTauri<void>("send_agent_prompt", {
        projectId: activeProjectId,
        id,
        prompt,
        attachments: attachments.map((a) => ({ path: a.path })),
        // Rust 側は `resume: Option<String>`、null/undefined を送ると
        // serde が None として扱う。明示的に null を渡しても same shape。
        resume: sdkSessionId,
        options: perQueryOptions,
      });
      clearAttachments(paneId);
    } catch (e) {
      toast.error(`送信に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setStreaming(paneId, false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // SlashPalette / AtMentionPicker が開いている間は Ctrl+Enter 送信を抑制。
    // cmdk が Arrow / Enter を受けて選択するため、ここでは Escape だけ
    // 独自にハンドルする（Radix Popover が外側 Escape を取りこぼすことがあるため）。
    //
    // v3.4 Chunk B (DEC-034 Must 2): slash / at は排他 open なので、
    // どちらか片方が open 状態 = palette open と同じ扱い。
    const paletteOpen = slashOpen || atOpen;
    if (paletteOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        setAtOpen(false);
        return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // palette を閉じてから送信する（ユーザーが意図的に Ctrl+Enter するため）
        setSlashOpen(false);
        setAtOpen(false);
        e.preventDefault();
        void handleSend();
        return;
      }
      // Enter 単体 / Arrow は cmdk に任せる（cmdk が listbox として handle）
      return;
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setText(next);
    const caret = e.target.selectionStart ?? next.length;
    recomputeSlashAt(next, caret);
  }

  /**
   * caret 移動（矢印キー / クリック）時にも slash 状態を追従させる。
   * Arrow キーで `/ceo` トークンから離れたら palette を閉じたい。
   */
  function onCaretMove(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    recomputeSlashAt(ta.value, ta.selectionStart ?? ta.value.length);
  }

  /**
   * slash 選択時のコールバック。現在の `/token` 断片を選択された slash に置換し、
   * 末尾に空白を付けてカーソルを続行可能な位置に移動する。
   */
  function onSlashSelect(cmd: SlashCmd) {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const replaced = replaceSlashFragment(text, caret, cmd.name);
    setText(replaced.text);
    setSlashOpen(false);

    // カーソル位置を更新（次の micro tick で textarea の selection を書き換え）
    queueMicrotask(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(replaced.caret, replaced.caret);
    });
  }

  /**
   * v3.4 Chunk B (DEC-034 Must 2): @file / @folder 選択時のコールバック。
   *
   * 現在の caret 左方向の `@...` 断片を `@"<path>" ` に置換し、末尾空白で
   * カーソル続行可能に。既存の画像 attachment 経路（D&D で prompt 末尾に
   * `@"<path>"` 追記）はそのまま維持し、本実装は textarea 内の任意位置に
   * 挿入する点のみが差分。
   *
   * - path は project_root からの相対（Rust 側で `/` 正規化済）
   * - ダブルクォート固定で日本語 / スペース対策（DEC-011 と同じ流儀）
   * - Claude Code CLI / Agent SDK は `@"<path>"` を自動で Read tool に変換
   */
  function onAtSelect(path: string) {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const replaced = replaceAtFragment(text, caret, path);
    setText(replaced.text);
    setAtOpen(false);

    queueMicrotask(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(replaced.caret, replaced.caret);
    });
  }

  /**
   * v3.4.7: ProjectTree からのファイルパス drop を受け付けて `@"<path>"` を
   * textarea の caret 位置に注入する。既存の OS file drop（画像保存）とは
   * カスタム MIME (`CCMUX_FILE_PATH_MIME`) で区別。
   *
   * - before / after の空白を解析して過不足ない space で連結
   * - caret はメンション末尾に移動、textarea は focus
   * - path の basename を toast で通知
   */
  function insertFileMentionAtCaret(path: string) {
    const mention = formatFileMention(path);
    const textarea = textareaRef.current;
    if (!textarea) {
      // fallback: 末尾追加
      setText((prev) => {
        const sep = prev.length === 0 || /\s$/.test(prev) ? "" : " ";
        return `${prev}${sep}${mention} `;
      });
      toast.success(`${basename(path)} を追加しました`);
      return;
    }
    const current = textarea.value;
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const insert = `${needSpaceBefore ? " " : ""}${mention}${needSpaceAfter ? " " : " "}`;
    const next = before + insert + after;
    setText(next);
    // caret を挿入文字列の直後に移動
    requestAnimationFrame(() => {
      const pos = (before + insert).length;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    });
    toast.success(`${basename(path)} を追加しました`);
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);

    // v3.4.8 debug: drop 発火確認用（dogfood 後に削除予定）
    // PM-746 (2026-04-20): production gate のため logger.debug に移行。
    logger.debug("[drop] fired", {
      types: Array.from(e.dataTransfer.types ?? []),
      ccmux: e.dataTransfer.getData(CCMUX_FILE_PATH_MIME),
      plain: e.dataTransfer.getData("text/plain"),
      files: e.dataTransfer.files?.length ?? 0,
    });

    // v3.4.7: ProjectTree からの「ファイルパス drop」を優先処理。
    // DOMStringList.includes 非互換環境に備えて直接 getData を試す（空文字なら未登録）。
    const mentionPath = e.dataTransfer.getData(CCMUX_FILE_PATH_MIME);
    if (mentionPath) {
      insertFileMentionAtCaret(mentionPath);
      return;
    }
    // fallback: text/plain に @"<path>" が入っていれば（ProjectTree が必ずセット）
    // これを使って挿入する。
    const plain = e.dataTransfer.getData("text/plain");
    if (plain && plain.startsWith('@"') && plain.endsWith('"')) {
      const fromPlain = plain.slice(2, -1);
      if (fromPlain) {
        insertFileMentionAtCaret(fromPlain);
        return;
      }
    }

    // 既存: OS からの画像 file drop（先頭 1 枚）を attachment に保存
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルのみドロップできます");
      return;
    }
    try {
      const saved = await saveDroppedImage(file);
      appendAttachment(paneId, saved);
      toast.success("画像を添付しました");
    } catch (err) {
      toast.error(
        `画像の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** path の basename を取得（Windows / POSIX 両対応）。 */
  function basename(p: string): string {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
  }

  return (
    <div
      onMouseDown={() => setActivePane(paneId)}
      onFocusCapture={() => setActivePane(paneId)}
      onDragOver={(e) => {
        // v3.4.7 再修正: Tauri WebView2 の `dataTransfer.types` は DOMStringList で
        // `.includes()` が期待通り動かない実装が存在する。types チェック条件なしで
        // 無条件に preventDefault + dropEffect="copy" にすると drop target として確実に
        // 認識される。MIME の振り分けは onDrop 内で getData を試す方式で行う。
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "border-t bg-background transition-colors",
        dragOver && "bg-primary/5 ring-2 ring-inset ring-primary/40"
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
        {attachments.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-border/60 p-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 text-muted-foreground"
                    aria-label="添付画像"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden />
                    <Info className="h-3 w-3" aria-hidden />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  添付画像は現状 1 枚まで。送信で自動クリアされます。
                </TooltipContent>
              </Tooltip>
              {attachments.map((a) => {
                const size = attachmentSizes[a.id];
                const isLarge =
                  typeof size === "number" && size > LARGE_ATTACHMENT_BYTES;
                return (
                  <div key={a.id} className="flex items-center gap-1">
                    <ImageThumb attachment={a} />
                    {isLarge && typeof size === "number" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center text-amber-600 dark:text-amber-500"
                            aria-label={`大きい画像: ${humanFileSize(size)}`}
                          >
                            <AlertTriangle
                              className="h-3.5 w-3.5"
                              aria-hidden
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          大きめの画像です（{humanFileSize(size)}）。送信前に内容を確認してください。
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}
        <div className="flex items-end gap-2">
          <div ref={wrapperRef} className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={onTextChange}
              onKeyDown={onKeyDown}
              onKeyUp={onCaretMove}
              onClick={onCaretMove}
              /*
               * v3.4.7 修正: textarea は HTML5 DnD 仕様で browser default の
               * テキスト挿入が発動し、親 div の onDrop に bubble しない。
               * ProjectTree からのカスタム MIME drop をこの要素で受けるため
               * 自身に onDragOver / onDrop を配置し、parent と同じ handler で処理。
               * dragOver で `dropEffect = "copy"` を明示しないとカスタム MIME で
               * 禁止マークが出るブラウザがあるため setData 互換化。
               */
              onDragOver={(e) => {
                // v3.4.7 再修正: Tauri WebView2 の DOMStringList 互換性問題を回避。
                // 無条件 preventDefault + dropEffect="copy" で drop target を確実化。
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              // onDrop は親 div と同ロジックを共有したいため、イベント要素型を揃える。
              // React の型は要素ごとに別 handler を要求するが、内部で触るのは
              // dataTransfer のみなので cast で安全に流用する。
              onDrop={(e) =>
                onDrop(e as unknown as React.DragEvent<HTMLDivElement>)
              }
              placeholder={
                !activeProjectId
                  ? "プロジェクトを選択してください（左のレールから ＋ で追加）"
                  : streaming
                    ? "Claude が考え中です..."
                    : "メッセージを入力（Ctrl+Enter で送信、/ でコマンド、画像は D&D または Ctrl+V、ファイルは Files タブからドラッグ）"
              }
              disabled={streaming || !activeProjectId}
              rows={2}
              className="min-h-[52px] resize-none"
            />
            <SlashPalette
              open={slashOpen}
              query={slashQuery}
              onClose={() => setSlashOpen(false)}
              onSelect={onSlashSelect}
              anchorRef={wrapperRef}
            />
            {/* v3.4 Chunk B (DEC-034 Must 2): @file / @folder mention picker */}
            <AtMentionPicker
              open={atOpen}
              query={atQuery}
              onOpenChange={(v) => {
                if (!v) setAtOpen(false);
              }}
              onSelect={(p) => onAtSelect(p)}
              anchorRef={wrapperRef}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={streaming || !text.trim() || !activeProjectId}
            className="h-10 shrink-0"
            aria-label="送信"
          >
            <Send className="h-4 w-4" aria-hidden />
            <span className="ml-1 hidden sm:inline">送信</span>
          </Button>
        </div>
      </div>

      {/* PRJ-012 v4 / Chunk C: 組込 slash 用 dialog（open/close は useDialogStore） */}
      <HelpDialog />
      <ClearSessionDialog />
      <ModelPickerDialog />
      {/* v3.5.18 PM-840 派生: /effort で開く推論工数 picker */}
      <EffortPickerDialog />
    </div>
  );
}

/**
 * D&D 画像を OS 一時領域にコピー保存する。
 *
 * 保存先は `$APPLOCALDATA/ccmux-images/dnd-<timestamp>-<uuid>.<ext>`。
 * plugin-fs の `writeFile` で Uint8Array をそのまま書き出す。
 */
async function saveDroppedImage(file: File): Promise<Attachment> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const base = await appLocalDataDir();
  const dir = await join(base, "ccmux-images");
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = `dnd-${Date.now()}-${id}.${ext}`;
  const path = await join(dir, filename);
  await writeFile(path, buf);
  return { id, path };
}

// ---------------------------------------------------------------------------
// slash detection / replacement helpers（純関数、テスト容易化のため export 無しで留置）
// ---------------------------------------------------------------------------

export interface SlashMatch {
  /** `/` を含まないクエリ（`/ce` なら `ce`、`/` 単独なら ""） */
  query: string;
  /** 置換対象の開始 index（textarea 全体内の `/` の位置） */
  start: number;
  /** 置換対象の終了 index（caret 位置、exclusive） */
  end: number;
}

/**
 * caret 左方向に slash トークンを探す。
 *
 * 条件:
 *  - caret 直前の連続非空白文字列が `/` で始まる
 *  - その `/` の直前が「行頭」「空白」「改行」のいずれか（URL 中の `/` を誤検出しない）
 */
export function detectSlashFragment(
  text: string,
  caret: number
): SlashMatch | null {
  if (caret <= 0) return null;
  const left = text.slice(0, caret);
  // 左方向に空白 / 改行まで後退
  let i = left.length - 1;
  while (i >= 0) {
    const c = left[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\u3000") {
      break;
    }
    i--;
  }
  const tokenStart = i + 1;
  const token = left.slice(tokenStart);
  if (!token.startsWith("/")) return null;
  // トークン内部に更に `/` が含まれる場合（例: `a/b`）は URL/path 系なのでスキップ。
  // ただし `/` 単独 or `/ceo` 等、`/` が先頭のみなら許容。
  const innerSlashIdx = token.indexOf("/", 1);
  if (innerSlashIdx !== -1) return null;
  const query = token.slice(1);
  return { query, start: tokenStart, end: caret };
}

/**
 * `detectSlashFragment` で検出された範囲を新しい slash 名 + 空白で置換する。
 *
 * 選択後のカーソルは置換後の空白の**直後**に配置する。
 */
export function replaceSlashFragment(
  text: string,
  caret: number,
  newSlash: string
): { text: string; caret: number } {
  const match = detectSlashFragment(text, caret);
  if (!match) {
    // fallback: caret 位置にそのまま挿入
    const inserted = `${text.slice(0, caret)}${newSlash} ${text.slice(caret)}`;
    return { text: inserted, caret: caret + newSlash.length + 1 };
  }
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);
  // 末尾に空白を足して caret 続行
  const replacement = `${newSlash} `;
  const nextText = `${before}${replacement}${after}`;
  const nextCaret = match.start + replacement.length;
  return { text: nextText, caret: nextCaret };
}

// ---------------------------------------------------------------------------
// v3.4 Chunk B (DEC-034 Must 2): @file / @folder mention の detection / replacement
// ---------------------------------------------------------------------------

/**
 * caret 左方向の `@...` トークン情報。
 *
 * - `query`: `@` を含まないクエリ文字列（例: `@proj` なら `"proj"`、`@` 単独なら `""`）
 * - `start`: 置換対象の開始 index（`@` の位置）
 * - `end`  : 置換対象の終了 index（caret 位置、exclusive）
 */
export interface AtMatch {
  query: string;
  start: number;
  end: number;
}

/**
 * caret 左方向に at mention トークンを探す。
 *
 * 条件:
 *  - caret 直前の連続非空白文字列が `@` で始まる
 *  - その `@` の直前が「行頭」「空白」「改行」のいずれか（email 等の誤検出回避）
 *  - 既に `@"..."` 形式で quote 内部にある場合は検出しない（クォート途中の `@` 誤爆防止）
 *
 * 注意: `@"<path>"` で既に quote された文字列は再編集対象にしない。この関数は
 * 「quote を含まない素の `@foo`」のみを返す。
 */
export function detectAtFragment(text: string, caret: number): AtMatch | null {
  if (caret <= 0) return null;
  const left = text.slice(0, caret);
  // 左方向に空白 / 改行まで後退
  let i = left.length - 1;
  while (i >= 0) {
    const c = left[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\u3000") break;
    i--;
  }
  const tokenStart = i + 1;
  const token = left.slice(tokenStart);
  if (!token.startsWith("@")) return null;

  // `@"` で開始する token は既に quoted mention。picker を出さない。
  if (token.startsWith('@"')) return null;

  // token 内部に `"` / `/` を含む場合は URL/path 途中の `@` なので skip
  // （ただし subpath 補完も欲しくなったら将来拡張）。
  // 現実的には `@path/to/file` 相当は Rust 側 fuzzy で拾える前提で、
  // 素のユーザー入力で `/` まで自分で打つケースは稀。ここでは stricter に
  // ユーザー入力の `/` を許容する（path 絞込みに便利）ので `/` はスキップしない。
  if (token.includes('"')) return null;

  const query = token.slice(1);
  return { query, start: tokenStart, end: caret };
}

/**
 * `detectAtFragment` で検出された範囲を `@"<path>" ` に置換する。
 *
 * - path 内のダブルクォートは `\"` に escape（保険、通常のパスには含まれない）
 * - 末尾に空白を付けてカーソル続行
 *
 * 選択後のカーソルは置換後の空白の**直後**に配置する。
 */
export function replaceAtFragment(
  text: string,
  caret: number,
  path: string
): { text: string; caret: number } {
  const safePath = path.replace(/"/g, '\\"');
  const replacement = `@"${safePath}" `;
  const match = detectAtFragment(text, caret);
  if (!match) {
    const inserted = `${text.slice(0, caret)}${replacement}${text.slice(caret)}`;
    return { text: inserted, caret: caret + replacement.length };
  }
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);
  const nextText = `${before}${replacement}${after}`;
  const nextCaret = match.start + replacement.length;
  return { text: nextText, caret: nextCaret };
}
