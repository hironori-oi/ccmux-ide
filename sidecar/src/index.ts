/**
 * Sumi Node sidecar entrypoint.
 *
 * DEC-023: Claude Agent SDK TypeScript を primary にするため、Tauri 本体（Rust）
 * とは別プロセスの Node.js sidecar として起動する。Tauri 側から stdin/stdout 経由で
 * JSON 行ベースのプロトコルで通信する。
 *
 * ## v3.3 DEC-033 Multi-Sidecar Architecture
 * 1 project = 1 sidecar。Rust 側 `AgentState` が `HashMap<projectId, SidecarHandle>`
 * で複数 sidecar を束ねる前提で、sidecar 自身は自分の projectId を知る必要は
 * 原理上無いが、デバッグ容易性のため argv (`--project-id=<uuid>`) で受け取り、
 * stderr log と `ready` payload に含めて emit する。
 *
 * ## プロトコル (line-delimited JSON / NDJSON)
 *
 *   Tauri → sidecar:
 *     { "type": "prompt", "id": "uuid", "prompt": "...", "options": {...} }
 *
 *   sidecar → Tauri:
 *     { "type": "ready",       "id": "ready",  "payload": { "version": "0.1.0", "projectId": "..." } }
 *     { "type": "message",     "id": "uuid",   "payload": <SDKAssistantMessage> }
 *     { "type": "tool_use",    "id": "uuid",   "payload": { tool_use_id, name, input } }
 *     { "type": "tool_result", "id": "uuid",   "payload": <SDKUserMessage(tool_result)> }
 *     { "type": "system",      "id": "uuid",   "payload": <SDKSystemMessage> }
 *     { "type": "result",      "id": "uuid",   "payload": <SDKResultMessage> }
 *     { "type": "error",       "id": "uuid",   "payload": { message: "..." } }
 *     { "type": "done",        "id": "uuid",   "payload": {} }
 *
 *   Rust 側が stdout を NDJSON として受け、`agent:{projectId}:raw` event に
 *   payload を含めて frontend に転送する。sidecar 自身は event 名前空間を
 *   知らなくて良い（Rust 側 prefix で分離される）。
 *
 * 認証は SDK 側の auto-detect に委譲:
 *   1. ANTHROPIC_API_KEY 環境変数
 *   2. ~/.claude/.credentials.json（Max / Pro OAuth token）
 */

import { runAgentQuery, type AgentQueryOptions } from "./agent.js";
import { AbortError, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * v3.3 DEC-033: argv から `--project-id=<uuid>` を抽出する。
 *
 * Rust 側 `start_agent_sidecar` が `node dist/index.mjs --project-id=<projectId>`
 * で起動する前提。未指定でも sidecar は動作する（legacy fallback）。
 */
function parseProjectIdFromArgv(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--project-id=")) {
      const id = arg.slice("--project-id=".length).trim();
      if (id.length > 0) return id;
    }
  }
  return null;
}

/**
 * PM-760 / v3.4.9 Chunk A: argv から `--model=<id>` を抽出する。
 *
 * Rust 側 `start_agent_sidecar` が UI の ModelPickerPopover 選択値を
 * `--model=claude-opus-4-7` 等の形で渡す。未指定なら null を返し、
 * `handlePrompt` 側で SDK デフォルト (= CLI default) に委ねる。
 */
function parseModelFromArgv(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--model=")) {
      const m = arg.slice("--model=".length).trim();
      if (m.length > 0) return m;
    }
  }
  return null;
}

/**
 * PM-760 / v3.4.9 Chunk A: argv から `--thinking-tokens=<n>` を抽出する。
 *
 * Rust 側が UI の EffortPickerPopover 選択値 (`EFFORT_CHOICES.thinkingTokens`)
 * を 1024 / 8192 / 32768 / 65536 のいずれかで渡す。
 * parse 失敗 (非数値 / 負数) は null として扱い、SDK デフォルト (adaptive) に委ねる。
 */
function parseThinkingTokensFromArgv(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--thinking-tokens=")) {
      const raw = arg.slice("--thinking-tokens=".length).trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
        return n;
      }
    }
  }
  return null;
}

const SIDECAR_PROJECT_ID: string | null = parseProjectIdFromArgv();
/** PM-760: 起動時に選択されていた model id (`claude-opus-4-7` 等)。 */
const SIDECAR_DEFAULT_MODEL: string | null = parseModelFromArgv();
/**
 * PM-760: 起動時に選択されていた thinking budget (1024 / 8192 / 32768 / 65536)。
 *
 * SDK v0.2.x の `maxThinkingTokens` option は deprecated だが後方互換で受け付ける
 * ため、単純な固定 budget 伝達はこれで十分 (adaptive への移行は将来検討)。
 * null なら SDK デフォルト (adaptive) に委ねる。
 */
const SIDECAR_DEFAULT_THINKING_TOKENS: number | null = parseThinkingTokensFromArgv();

// --- crash diagnostics ---
// Tauri spawn 経由で Node.js が uncaught exception crash するケースの診断用。
// stack trace を短く stderr に書き出し、toast 側に流す。
process.on("uncaughtException", (err: Error) => {
  try {
    process.stderr.write(
      `UNCAUGHT: ${err?.stack ? err.stack.split("\n").slice(0, 5).join(" | ") : String(err)}\n`
    );
  } catch {
    // stderr も書けない場合はあきらめ
  }
});
process.on("unhandledRejection", (reason: unknown) => {
  try {
    process.stderr.write(`UNHANDLED_REJECTION: ${String(reason).slice(0, 500)}\n`);
  } catch {}
});
process.on("exit", (code: number) => {
  try {
    process.stderr.write(`EXIT: code=${code}\n`);
  } catch {}
});
// stdout の write 時エラー (EPIPE 等) を握りつぶさず stderr に出す
const __origStdoutWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: typeof __origStdoutWrite }).write = ((
  chunk: string | Uint8Array,
  ...rest: unknown[]
): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return __origStdoutWrite(chunk as any, ...(rest as any[]));
  } catch (err) {
    try {
      process.stderr.write(`STDOUT_WRITE_ERR: ${String(err).slice(0, 300)}\n`);
    } catch {}
    return false;
  }
}) as typeof process.stdout.write;

interface PromptRequest {
  type: "prompt";
  id: string;
  prompt: string;
  options?: AgentQueryOptions;
}

/**
 * v3.3.1 (Chunk C / /review v6 Should Fix S-2): Tauri → sidecar への中断要求。
 *
 * Rust 側 `send_agent_interrupt` command が NDJSON 1 行 `{"type":"interrupt"}`
 * を該当 sidecar の stdin に書き込む。sidecar は実行中の query すべてを
 * AbortController 経由で abort する。`requestId` は省略可（指定された場合は
 * 該当 id のみ abort、未指定なら全 in-flight query を abort）。
 */
interface InterruptRequest {
  type: "interrupt";
  /** 任意: 特定 prompt id だけを abort したい場合に指定。未指定なら全 in-flight。 */
  requestId?: string;
}

type InboundMessage = PromptRequest | InterruptRequest;

type OutboundType =
  | "ready"
  | "message"
  | "tool_use"
  | "tool_result"
  | "system"
  | "result"
  | "error"
  | "done"
  /**
   * v3.3.1 (Chunk C): query が AbortController 経由で中断完了したことを通知。
   * `error` ではなく interrupt 専用 type にすることで、frontend / Rust 側が
   * 「ユーザ意図の中断」と「実際のエラー」を判別できる。
   */
  | "interrupted"
  /**
   * PM-830 (v3.5.14): SDK 側 session が確定した時点で frontend に通知する event。
   *
   * `SDKSystemMessage(subtype:"init")` の `session_id` を payload に含める。
   * frontend は `update_session_sdk_id` を呼んで DB に保存し、次回送信時に
   * `send_agent_prompt({ resume: sdk_session_id })` で context を継続する。
   *
   * 既知の system event (`message`/`system` raw event) も別途 emit するが、
   * UI 層 (useAllProjectsSidecarListener) がこの専用 event を listen するだけで
   * sdk_session_id を抽出できるよう、shape を絞った専用 outbound として独立させる。
   */
  | "sdk_session_ready";

interface Outbound {
  type: OutboundType;
  id: string;
  payload: unknown;
}

function send(msg: Outbound): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/**
 * PRJ-012 PM-810 (v3.6 Step 1): outbound payload に必ず `requestId` を含める helper。
 *
 * frontend 側 listener (`useAllProjectsSidecarListener.resolvePaneForEvent`) が
 * `payload.requestId` を見て paneId を逆引きする前提。既存 `sdk_session_ready`
 * event は元々 `payload.requestId` を持っていたため、それに合わせて全 outbound
 * event で shape を揃える。
 *
 * - payload が plain object なら spread でマージ (既存キー保持 + requestId 追加)
 * - payload が null/undefined/primitive/array なら { requestId, data: payload } で包む
 * - 返り値は `send()` 同様 void
 *
 * ev.id (= req.id echo) は従来どおり残すため、古い frontend 互換もそのまま。
 */
function sendWithReqId(
  type: OutboundType,
  reqId: string,
  payload: unknown,
): void {
  const wrapped: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), requestId: reqId }
      : { requestId: reqId, data: payload };
  send({ type, id: reqId, payload: wrapped });
}

/**
 * v3.3.1 (Chunk C): 進行中の prompt query に紐づく AbortController を保持する map。
 *
 * `void handlePrompt(msg)` で複数 prompt が並列実行され得るため、req.id ごとに
 * 別 controller を持ち、interrupt 要求時に全部 / 特定 id を abort できる。
 *
 * - prompt 開始時: `inFlightControllers.set(reqId, controller)`
 * - prompt 完了 / abort 時: `inFlightControllers.delete(reqId)`
 * - interrupt 受信時 (requestId 指定): 該当 controller を abort
 * - interrupt 受信時 (requestId 未指定): 全 controller を abort
 */
const inFlightControllers = new Map<string, AbortController>();

/**
 * v3.3.1 (Chunk C): エラーが SDK の AbortError 由来かを判定する。
 *
 * SDK が export している `AbortError` クラスのインスタンスチェックを第一義、
 * フォールバックとして `name === "AbortError"` も受ける（DOM AbortController
 * の native abort error も検出するため）。
 */
function isAbortLikeError(err: unknown): boolean {
  if (err instanceof AbortError) return true;
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && name === "AbortError") return true;
  }
  return false;
}

/**
 * SDK の SDKAssistantMessage.message.content に含まれる tool_use ブロックを抽出し、
 * frontend に配信しやすいよう単独イベントとして emit する（オリジナルの assistant
 * message も別途 message イベントで送っているので重複情報だが、UI 側の描画が楽）。
 */
function emitToolUseBlocks(id: string, msg: SDKMessage): void {
  if (msg.type !== "assistant") return;
  // SDK の message 構造は Anthropic SDK の BetaMessage。content は ContentBlock[]。
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b && b.type === "tool_use") {
      // PM-810: payload に requestId を乗せるため sendWithReqId を使う。
      sendWithReqId("tool_use", id, {
        tool_use_id: b.id,
        name: b.name,
        input: b.input,
      });
    }
  }
}

async function handlePrompt(req: PromptRequest): Promise<void> {
  // v3.3.1 (Chunk C): この prompt 用の AbortController を作って SDK に渡す。
  // interrupt 受信時に main loop が `controller.abort()` を呼ぶことで、SDK の
  // query が `AbortError` を throw して即終了する。
  const controller = new AbortController();
  inFlightControllers.set(req.id, controller);

  // v3.5.18 PM-830 hotfix debug (2026-04-20): prompt handler 入口の req.options
  // 実体を stderr に log。Rust → sidecar の NDJSON 経路で resume が失われていない
  // か、形式が期待通りかを可視化する。dogfood 後に PM-746 でクリーンアップ予定。
  process.stderr.write(
    `[sidecar] prompt received: id=${req.id}, options=${JSON.stringify(req.options ?? {})}\n`,
  );

  // PM-830: 今回の prompt が resume 付きで投げられたかを記録 (error 時の fallback 判定用)。
  const requestedResume: string | undefined =
    typeof req.options?.resume === "string" && req.options.resume.length > 0
      ? req.options.resume
      : undefined;
  // PM-830: 同じ prompt 内で session_id を 1 度だけ frontend に通知するための guard。
  // SDK は init 後にも system event (subtype: 'init' 以外) を流すため、init 限定で
  // emit する。同 session 内の 2 通目以降の prompt では sdk_session_ready が再 emit
  // されるが、frontend 側は同値であれば update_session_sdk_id で no-op に近い処理に
  // なるため害はない。
  let sdkSessionReadyEmitted = false;

  try {
    // PM-760 / v3.4.9 Chunk A: model / maxThinkingTokens の解決順位
    //   1. prompt request 個別指定 (req.options.model / req.options.maxThinkingTokens)
    //   2. sidecar 起動時 argv (`--model=` / `--thinking-tokens=`)
    //   3. SDK デフォルト (= CLI default model / adaptive thinking)
    //
    // prompt 個別指定は現状 frontend からは行わないが、将来の slash 経由の
    // one-shot 指定を見据えて優先度 1 位に置いている。
    const resolvedModel =
      req.options?.model ?? SIDECAR_DEFAULT_MODEL ?? "claude-opus-4-7";
    const resolvedMaxThinkingTokens =
      req.options?.maxThinkingTokens ?? SIDECAR_DEFAULT_THINKING_TOKENS ?? undefined;

    // req.options を先に spread し、その後 sidecar が必ず上書きしたい項目
    // (model / maxThinkingTokens / abortController) を明示設定する形にする。
    // こうすることで「prompt 個別指定 > argv default > SDK default」の優先度を
    // 保ちつつ、object literal の duplicate key 警告 (TS1117) を避けられる。
    //
    // PM-966 / DEC-055: settingSources はデフォルトで ['user', 'project', 'local']
    // を指定する。これは Claude Code CLI と同等の自動ファイルベース設定読込を
    // 有効にするためで、CLAUDE.md / .claude/settings.json / slash commands /
    // skills / MCP servers が SDK によって自動 discover される。呼び出し側
    // (Rust `send_agent_prompt`) が明示した場合はそちらを優先する。
    const opts: AgentQueryOptions = {
      cwd: req.options?.cwd ?? process.cwd(),
      permissionMode: req.options?.permissionMode ?? "default",
      allowedTools: req.options?.allowedTools ?? [
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
      ],
      settingSources: req.options?.settingSources ?? [
        "user",
        "project",
        "local",
      ],
      ...req.options,
      // --- ここから spread で潰されないよう必ず最後に書く ---
      model: resolvedModel,
      // 呼び出し側の options で abortController が指定されていても、sidecar が
      // interrupt を受けて中断できる必要があるため、こちらで上書きする。
      abortController: controller,
    };

    // maxThinkingTokens は「指定があれば渡す、無ければキー自体を付けない」
    // 挙動にしたいので、object literal には入れず条件付きで代入する。
    if (resolvedMaxThinkingTokens !== undefined) {
      opts.maxThinkingTokens = resolvedMaxThinkingTokens;
    }

    // PM-830: resume が空文字列で渡ってきた場合は SDK にそのまま渡すと invalid に
    // なる可能性があるため未指定扱いに正規化する。req.options spread で既に opts に
    // 入っているので、空文字列のときだけ削除。
    if (typeof opts.resume === "string" && opts.resume.length === 0) {
      delete opts.resume;
    }

    // v3.5.18 PM-830 hotfix debug (2026-04-20): SDK に渡す直前の options から
    // resume / model / cwd を可視化。resume が undefined なのに user expectation では
    // set のはず、という乖離を捕捉するためのセンサ。abortController は non-serializable
    // なので除外。dogfood 後に PM-746 でクリーンアップ予定。
    // PM-966: settingSources も可視化（CLAUDE.md 自動読込が有効か確認用）。
    process.stderr.write(
      `[agent.ts] query options: resume=${String(opts.resume)}, model=${String(opts.model)}, cwd=${String(opts.cwd)}, settingSources=${JSON.stringify(opts.settingSources ?? null)}, requestedResume=${String(requestedResume)}\n`,
    );

    for await (const ev of runAgentQuery(req.prompt, opts)) {
      switch (ev.type) {
        case "assistant": {
          // PM-810: payload に requestId を乗せる版 helper を使う (以下同)。
          sendWithReqId("message", req.id, ev);
          emitToolUseBlocks(req.id, ev);
          break;
        }
        case "user": {
          // tool_result は user message に含まれる（SDK が内部で inject する）
          sendWithReqId("tool_result", req.id, ev);
          break;
        }
        case "result": {
          sendWithReqId("result", req.id, ev);
          break;
        }
        case "system": {
          sendWithReqId("system", req.id, ev);
          // PM-830: SDKSystemMessage(subtype: "init") に session_id が含まれる。
          // 初回送信時 (resume 無し) は SDK が新規 session を発行 → そこから
          // sdk_session_id を捕捉して frontend に通知する。resume 経由でも
          // 同じ uuid (or fork 時は新 uuid) が流れてくるため、毎 prompt の最初の
          // init で 1 回だけ emit して frontend 側に最新値を伝える。
          if (!sdkSessionReadyEmitted) {
            const sub = (ev as { subtype?: unknown }).subtype;
            const sid = (ev as { session_id?: unknown }).session_id;
            if (sub === "init" && typeof sid === "string" && sid.length > 0) {
              // sdk_session_ready は元々 payload.requestId を持っていたため
              // sendWithReqId でも結果的に同じ shape になる (key 重複は後勝ちで requestId)。
              sendWithReqId("sdk_session_ready", req.id, {
                sdkSessionId: sid,
                // resume 経由か否かを frontend に伝えて UI で識別できるようにする
                resumed: Boolean(requestedResume),
              });
              sdkSessionReadyEmitted = true;
            }
          }
          break;
        }
        default: {
          // その他（partial_assistant, status, hook_*, auth_status 等）は
          // raw の message イベントとして流す（将来 UI 拡張で利用）
          sendWithReqId("message", req.id, ev);
        }
      }
    }
    sendWithReqId("done", req.id, {});
  } catch (err) {
    // v3.3.1 (Chunk C): AbortError は意図的な中断なので、通常の error event は
    // emit しない。代わりに `interrupted` 専用 event を送って frontend / Rust
    // 側が「ユーザ意図の中断」と判別できるようにする。
    if (controller.signal.aborted || isAbortLikeError(err)) {
      sendWithReqId("interrupted", req.id, {
        reason: err instanceof Error ? err.message : "aborted",
      });
    } else {
      // PM-830: resume を要求していたのに throw した場合、frontend に "resume_failed"
      // を伝えて sdk_session_id を null にリセット → 次回送信は新規 session として
      // 投げられる (= context は失われるが UX は止まらない fallback)。
      // SDK が "resume" 失敗時に投げる error message は "session not found" 等の
      // 文字列だが、確実な判定のため「resume を要求した状態で error」をトリガとする。
      const message =
        err instanceof Error ? err.message : String(err);
      const looksLikeResumeFailure =
        Boolean(requestedResume) &&
        /resume|session\s*(not\s*found|missing|invalid|expired)|jsonl/i.test(
          message
        );
      sendWithReqId(
        "error",
        req.id,
        looksLikeResumeFailure
          ? { message, kind: "resume_failed", requestedResume }
          : { message },
      );
    }
  } finally {
    // 完了 / 中断 / エラーいずれでも map から除去
    inFlightControllers.delete(req.id);
  }
}

/**
 * v3.3.1 (Chunk C / /review v6 Should Fix S-2): interrupt 要求の処理。
 *
 * - `requestId` 指定あり: 該当 prompt の AbortController のみ abort
 * - `requestId` 指定なし: 進行中の全 prompt を abort
 * - 既に query が完了して controller が map に無い場合は no-op + log
 *
 * abort 自体は同期的だが、SDK 側が AbortError を throw して handlePrompt の
 * catch 節に到達するのは非同期。`interrupted` event はそちらで emit される。
 */
function handleInterrupt(req: InterruptRequest): void {
  if (req.requestId) {
    const controller = inFlightControllers.get(req.requestId);
    if (controller) {
      controller.abort();
      process.stderr.write(
        `sidecar: interrupt sent to requestId=${req.requestId}\n`
      );
    } else {
      process.stderr.write(
        `sidecar: interrupt no-op (requestId=${req.requestId} not in flight)\n`
      );
    }
    return;
  }

  // requestId 未指定: 全 in-flight を abort
  if (inFlightControllers.size === 0) {
    process.stderr.write("sidecar: interrupt no-op (no in-flight queries)\n");
    return;
  }
  const ids = Array.from(inFlightControllers.keys());
  for (const controller of inFlightControllers.values()) {
    controller.abort();
  }
  process.stderr.write(
    `sidecar: interrupt sent to all in-flight queries (ids=${ids.join(",")})\n`
  );
}

function main(): void {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as InboundMessage;
        if (msg.type === "prompt") {
          // await しない（並列実行可）
          void handlePrompt(msg);
        } else if (msg.type === "interrupt") {
          // v3.3.1 (Chunk C / /review v6 Should Fix S-2):
          // 進行中の query を AbortController 経由で中断する。
          handleInterrupt(msg);
        } else {
          process.stderr.write(
            `sidecar: unknown inbound type: ${JSON.stringify(msg)}\n`
          );
        }
      } catch (e) {
        process.stderr.write(
          `sidecar: failed to parse line: ${line} (${String(e)})\n`
        );
        send({
          type: "error",
          id: "parse",
          payload: { message: String(e) },
        });
      }
    }
  });

  // stdin EOF でも sidecar を即終了しない（Tauri 側の CommandChild.kill() or
  // プロセス親消失まで生きる）。前バージョンは end で exit(0) していたため、
  // Tauri 起動直後に「Claude sidecar が終了しました: 0」が発火していた。
  process.stdin.on("end", () => {
    process.stderr.write("sidecar: stdin closed, keeping process alive\n");
  });

  // keep-alive: Node.js の event loop に active handle を残すため、1 分ごとの
  // no-op interval を登録。これがないと `.on('data')` リスナー登録済でも EOF 後
  // に exit する可能性がある。
  setInterval(() => {
    // no-op heartbeat
  }, 60_000);

  // Tauri (親) が死んだら sidecar も終了する
  process.on("disconnect", () => {
    process.stderr.write("sidecar: parent disconnected, exiting\n");
    process.exit(0);
  });

  // ready 通知（v3.3 DEC-033: projectId を含める）
  send({
    type: "ready",
    id: "ready",
    payload: { version: "0.1.0", projectId: SIDECAR_PROJECT_ID },
  });
  process.stderr.write(
    `Sumi sidecar ready (projectId=${SIDECAR_PROJECT_ID ?? "<unset>"})\n`
  );
}

main();
