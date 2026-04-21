/**
 * Claude Agent SDK TypeScript wrapper.
 *
 * `@anthropic-ai/claude-agent-sdk` の `query()` を薄くラップして、sidecar から
 * `AsyncIterable<SDKMessage>` として消費できるようにする。
 *
 * DEC-023 で採用した Agent SDK TS 経路。Quick Win 実装（M1 前半）:
 *
 * - `options.apiKey` は存在しない（Options 型にそのフィールドは無い）。
 *   代わりに SDK は自動で以下の順に認証情報を解決する:
 *     1. `ANTHROPIC_API_KEY` 環境変数
 *     2. `~/.claude/.credentials.json`（Claude Code CLI の `claude login` で作成される
 *        OAuth credentials / Max / Pro プランの token）
 *
 * - SDK は内部で `claude` CLI バイナリを subprocess として spawn する。
 *   `pathToClaudeCodeExecutable` / `executable` option で実行系を指定できるが、
 *   PATH 上に `claude` があれば未指定で動作する。オーナー環境（WSL2 / Ubuntu-24.04）
 *   では `claude` v2.1.113 がインストール済。
 */

import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import fs from "node:fs";

/**
 * Claude Code native binary の実パスを解決する。
 *
 * Agent SDK v0.2.114 は platform-specific optional deps
 * `@anthropic-ai/claude-agent-sdk-{platform}-{arch}[-musl]` として native binary
 * (Linux=`claude` ELF / Windows=`claude.exe`) を同梱する。
 * esbuild で JS バンドルしてもこの binary は bundle 内に含められないため、
 * packaged app では Tauri resources 経由で sidecar/node_modules に物理配置し、
 * ここで絶対パスを解決して SDK に `pathToClaudeCodeExecutable` で明示渡しする。
 *
 * 解決順:
 *   1. CLAUDE_CODE_EXECUTABLE 環境変数
 *   2. sidecar/node_modules/@anthropic-ai/claude-agent-sdk-{platform}-{arch}[-musl]/claude
 *   3. sidecar/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-<...>/node_modules/.../claude
 *   4. 親 workspace の node_modules（monorepo hoist ケース）
 *   5. $PATH 上の claude CLI (execFile で shell 経由させない)
 *   6. 一般的なインストール場所 (/usr/local/bin, ~/.local/bin, ~/.npm/bin)
 */
async function findClaudeExecutable(): Promise<string | undefined> {
  // 1. 環境変数で明示指定
  const envPath = process.env.CLAUDE_CODE_EXECUTABLE;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const platform = process.platform; // "win32" | "darwin" | "linux"
  const arch = process.arch;         // "x64" | "arm64"
  const ext = platform === "win32" ? ".exe" : "";
  // Linux は glibc/musl の両方を候補に (pnpm は libc を自動選択するが誤検出あり)
  const libcVariants = platform === "linux" ? ["", "-musl"] : [""];

  for (const variant of libcVariants) {
    const pkgDir = `claude-agent-sdk-${platform}-${arch}${variant}`;

    // 2. sidecar/node_modules 直下
    const direct = path.join(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      pkgDir,
      `claude${ext}`
    );
    if (fs.existsSync(direct)) return direct;

    // 3. pnpm の .pnpm ストア配下
    const pnpmStore = path.join(process.cwd(), "node_modules", ".pnpm");
    try {
      if (fs.existsSync(pnpmStore)) {
        const entries = fs.readdirSync(pnpmStore);
        const prefix = `@anthropic-ai+${pkgDir}@`;
        const match = entries.find((e) => e.startsWith(prefix));
        if (match) {
          const pnpmPath = path.join(
            pnpmStore,
            match,
            "node_modules",
            "@anthropic-ai",
            pkgDir,
            `claude${ext}`
          );
          if (fs.existsSync(pnpmPath)) return pnpmPath;
        }
      }
    } catch {
      // 無視して次の候補へ
    }

    // 4. 親 workspace の node_modules（例: monorepo root）
    const parentCandidate = path.join(
      process.cwd(),
      "..",
      "node_modules",
      "@anthropic-ai",
      pkgDir,
      `claude${ext}`
    );
    if (fs.existsSync(parentCandidate)) return parentCandidate;
  }

  // 5. $PATH 上の claude CLI を execFile で探す (shell 経由しないため安全)
  try {
    const { execFileSync } = await import("node:child_process");
    const finder = platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, ["claude"], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const firstLine = out.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // PATH に claude が無いだけ、次の候補へ
  }

  // 6. 一般的なインストール場所（Linux/macOS）
  const home = process.env.HOME;
  const commonPaths: string[] = [];
  if (platform !== "win32") {
    commonPaths.push("/usr/local/bin/claude", "/usr/bin/claude");
    if (home) {
      commonPaths.push(
        path.join(home, ".local", "bin", "claude"),
        path.join(home, ".npm", "bin", "claude"),
        path.join(home, ".npm-global", "bin", "claude"),
        path.join(home, ".bun", "bin", "claude")
      );
    }
  }
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return undefined;
}

export type AgentQueryOptions = Pick<
  Options,
  | "model"
  | "fallbackModel"
  | "cwd"
  | "env"
  | "permissionMode"
  | "allowedTools"
  | "disallowedTools"
  | "maxTurns"
  | "systemPrompt"
  | "pathToClaudeCodeExecutable"
  | "executable"
  | "additionalDirectories"
  | "settingSources"
  /**
   * v3.3.1 (Chunk C): query 中断用の AbortController。
   * sidecar 側 main loop が `{type:"interrupt"}` 受信時に `abort()` を呼ぶことで
   * 進行中の SDK query が即座に終了する。
   */
  | "abortController"
  /**
   * PM-760 / v3.4.9 Chunk A: 推論 (extended thinking) budget の上限。
   *
   * StatusBar の EffortPickerPopover 選択値 (`EFFORT_CHOICES.thinkingTokens`:
   * 1024 / 8192 / 32768 / 65536) を argv 経由で sidecar に渡し、SDK の
   * `query({ options: { maxThinkingTokens: N } })` に流し込む。
   *
   * SDK 0.2.x では adaptive thinking (`thinking: { type: 'adaptive' }`) が推奨だが、
   * `maxThinkingTokens` も引き続き後方互換で受け付けるため、まずは UI の
   * 4 段階選択に素直に対応するこちらを採用する (将来 adaptive + effort 文字列に
   * 切り替える場合は PM-761 として別チケット化)。
   */
  | "maxThinkingTokens"
  /**
   * PM-830 (v3.5.14): Claude Agent SDK 側 session を継続するための resume option。
   *
   * `query({ resume: sdk_session_id })` で過去会話 history を SDK 側がロードし、
   * 同一 session として返答する (Claude が前回会話の context を覚えている状態)。
   * sdk_session_id は `SDKSystemMessage(subtype:"init").session_id` から取得し、
   * 初回送信完了時に sidecar から `sdk_session_ready` outbound event で frontend
   * に通知 → frontend が DB の sessions.sdk_session_id に保存 → 2 回目以降の送信
   * 時に `send_agent_prompt(resume: sdk_session_id)` として渡されてここに到達する。
   *
   * SDK 仕様: `resume` 指定時は `sessionId` / `continue` と排他。SDK が history
   * を見つけられない (jsonl 削除済 等) 場合は throw するため、sidecar 側で catch
   * して `error` event の payload に `kind: "resume_failed"` を含めて frontend に
   * 通知し、frontend は次回送信時に sdk_session_id を null にして fallback する。
   */
  | "resume"
>;

/**
 * Agent SDK に 1 回の query を投げて、SDK が返すイベントストリームを
 * そのまま yield する。
 *
 * prompt は文字列（one-shot）を想定。streaming input（AsyncIterable<SDKUserMessage>）
 * は PM-113 で対応。
 */
export async function* runAgentQuery(
  prompt: string,
  options: AgentQueryOptions
): AsyncGenerator<SDKMessage, void, unknown> {
  // pathToClaudeCodeExecutable が未指定なら auto-detect して明示設定する。
  // これがないと packaged app で "Native CLI binary for ... not found" エラー。
  const opts: AgentQueryOptions = { ...options };
  if (!opts.pathToClaudeCodeExecutable) {
    const claudePath = await findClaudeExecutable();
    if (claudePath) {
      opts.pathToClaudeCodeExecutable = claudePath;
      try {
        process.stderr.write(`AUTO_CLAUDE_PATH: ${claudePath}\n`);
      } catch {}
    } else {
      try {
        process.stderr.write(
          `AUTO_CLAUDE_PATH: not found (cwd=${process.cwd()}, platform=${process.platform}-${process.arch})\n`
        );
      } catch {}
    }
  }

  const stream = query({ prompt, options: opts });
  for await (const ev of stream) {
    yield ev;
  }
}
