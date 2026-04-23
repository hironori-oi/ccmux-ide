/**
 * Sumi 共通型定義。
 *
 * Rust backend の `Serialize` struct と 1:1 対応。将来は specta 等で自動生成
 * する想定（付録A.2 の optional feature）。現段階は手書きで整合性を取る。
 */

/**
 * チャット 1 メッセージの型は `lib/stores/chat.ts` の `ChatMessage` に一本化。
 * 旧定義（role が 5 種 + images/tool）は dead code だったため削除した。
 * 新規利用は `import type { ChatMessage } from "@/lib/stores/chat";`。
 */

/** CLAUDE.md ツリーの 1 ノード（Rust `TreeNode` と対応） */
export interface TreeNode {
  path: string;
  scope: "Global" | "Parent" | "Project";
  depth: number;
  label: string;
  isFile: boolean;
}

// v3.5.3 (2026-04-20): `Worktree` interface は UI 層撤去と同時に削除（PM-770）。
// Rust side の `Worktree` struct は src-tauri に残置（将来再導入時の参照用）。

/** 画像ペースト結果（Rust `paste_image_from_clipboard` 戻り値） */
export interface ImagePasteResult {
  /** 保存された PNG の絶対パス。null は「クリップボードに画像がない」 */
  savedPath: string | null;
}

/** 設定（Rust `Config` と対応） */
export interface AppConfig {
  theme: "auto" | "dark" | "light";
  cleanupHours: number;
  ftsAutoReindex: boolean;
}

// ---------------------------------------------------------------------------
// 会話履歴（Rust `commands::history` の struct と 1:1）
// ---------------------------------------------------------------------------

/** Rust `Session` と対応（create_session 戻り値）。 */
export interface Session {
  id: string;
  title: string | null;
  /** Unix epoch seconds (UTC) */
  createdAt: number;
  /** Unix epoch seconds (UTC) */
  updatedAt: number;
  projectPath: string | null;
  /**
   * v5 Chunk B / DEC-032: session を登録した project registry (RegisteredProject.id)。
   * null は未分類（既存 session は後方互換のため NULL で保持される）。
   */
  projectId: string | null;
  /**
   * PM-830 (v3.5.14): Claude Agent SDK 側 session UUID（context 継続用）。
   *
   * 初回送信時は null。sidecar が `system.subtype === "init"` event の `session_id`
   * を `sdk_session_ready` outbound event で frontend に通知し、frontend が
   * `update_session_sdk_id` を呼んで DB に保存する。2 回目以降の送信時に session
   * store からこの値を引き、`send_agent_prompt({ resume: sdkSessionId })` で
   * SDK に渡すことで Claude が前回会話の context を覚えた状態で応答する。
   */
  sdkSessionId: string | null;
}

/** サイドバー一覧向け。`list_sessions` 戻り値の要素。 */
export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  projectPath: string | null;
  /**
   * v5 Chunk B / DEC-032: session を登録した project registry (RegisteredProject.id)。
   * null は未分類。SessionList はこれで activeProjectId filter を行う。
   */
  projectId: string | null;
  /**
   * PM-830 (v3.5.14): Claude Agent SDK 側 session UUID（context 継続用）。
   * 初回送信前 / レガシー session では null。送信時 resume の引数に使う。
   */
  sdkSessionId: string | null;
  /** 直近 messages.content を 80 文字 trunc（UI 省略表示用） */
  lastMessageExcerpt: string | null;
  /** 直近 messages.role */
  lastMessageRole: string | null;
}

/** 1 メッセージ（添付込み）。`get_session_messages` 戻り値の要素。 */
export interface StoredMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
  attachments: StoredAttachment[];
}

/** 1 添付。 */
export interface StoredAttachment {
  id: string;
  messageId: string;
  path: string;
  mimeType: string | null;
}

/** append_message 時のみ送る軽量型。 */
export interface AttachmentInput {
  path: string;
  mimeType: string | null;
}

// ---------------------------------------------------------------------------
// PRJ-XXX 管理（Week 6 Chunk 2 / PM-203 & PM-204）
// ---------------------------------------------------------------------------

/**
 * **DEPRECATED — v3.2 DEC-031 で `RegisteredProject` に置換。**
 *
 * 後方互換のため `RegisteredProject` の alias として残す（ファイル末尾の
 * type export を参照）。新規コードは必ず `RegisteredProject` を使用すること。
 *
 * かつて: 固定 workspace ルート配下の 1 プロジェクトを表す軽量サマリ
 * 現在:   任意ディレクトリ project registry の 1 エントリ（`RegisteredProject`）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- alias は末尾で宣言
export type ProjectSummary = RegisteredProject;

/**
 * ProjectTree が扱うファイルエントリ。
 *
 * - `label`: UI 表示用（例: `brief.md` / `reports/dev-week6-chunk2-report.md`）
 * - `path`: 絶対パス（`invoke("plugin:fs|read_text_file", ...)` 等で利用）
 * - `category`: 固定 4 ファイルか reports/ 配下か
 */
export interface ProjectFileEntry {
  label: string;
  path: string;
  category: "root" | "report";
}

// ---------------------------------------------------------------------------
// 設定 (Week 6 Chunk 3 / PM-210〜213)
// ---------------------------------------------------------------------------

/** アクセントカラーのプリセット（Week 7 Chunk 2 / PM-250 で CSS 変数反映）。 */
export type AccentColor = "orange" | "blue" | "green" | "purple" | "pink";

/** テーマ設定（next-themes の `setTheme` に渡す値）。 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * テーマプリセット（Week 7 Chunk 2 / PM-251）。
 *
 * - `orange`: Sumi ブランドデフォルト（light / dark 両対応）
 * - `tokyo-night` / `catppuccin` / `dracula` / `nord`: dark-only プリセット、
 *   選択時は next-themes 側も `dark` に強制切替する。
 */
export type ThemePreset = "orange" | "tokyo-night" | "catppuccin" | "dracula" | "nord";

// ---------------------------------------------------------------------------
// PRJ-012 v4 / Chunk C: モデル選択（/model 用）
// ---------------------------------------------------------------------------

/**
 * /model picker の選択肢。Anthropic の正式モデル ID。
 *
 * - `claude-opus-4-7[1m]`     : Opus 4.7（1M context）
 * - `claude-sonnet-4-6`       : Sonnet 4.6（既定 200k context）
 * - `claude-haiku-4-5`        : Haiku 4.5（最速・低コスト）
 *
 * 現状は Settings 永続化のみで、sidecar 側との配線は M3 後 (v4) 候補。
 * ChatPanel が起動時に sidecar へ model を渡す経路を `start_agent_sidecar`
 * の args 拡張で繋ぐところまで実装済になり次第、本値を反映する。
 */
export type ModelId =
  | "claude-opus-4-7[1m]"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

/** ModelId の表示名 / 役割の組（dialog 用）。 */
export interface ModelMeta {
  id: ModelId;
  /** 短縮表示名（例: "Opus 4.7"） */
  label: string;
  /** 1 行説明（日本語） */
  description: string;
}

export const MODEL_CHOICES: readonly ModelMeta[] = [
  {
    id: "claude-opus-4-7[1m]",
    label: "Opus 4.7 (1M)",
    description: "最高性能。複雑な推論や長文コンテキスト向け。",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "速度と性能のバランス型。日常的な開発作業に最適。",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "最速・低コスト。短い質問や軽量タスク向け。",
  },
] as const;

/**
 * PM-760 / v3.4.9 Chunk A: UI `ModelId` を Anthropic SDK `model` 文字列に変換する。
 *
 * - `"claude-opus-4-7[1m]"` → `"claude-opus-4-7"` （`[1m]` は UI 上の 1M context
 *   マーカーで、SDK / API の model id としては同じ `claude-opus-4-7` を使う。
 *   1M context 利用は将来 beta header で切替予定、PM-761 で再検討）
 * - `"claude-sonnet-4-6"` / `"claude-haiku-4-5"` はそのまま
 *
 * Rust 側 `start_agent_sidecar(model: Option<String>, ...)` と sidecar 側
 * `parseModelFromArgv` の両方がこの正規化後の ID を受け取る前提。
 */
export function modelIdToSdkId(id: ModelId | null | undefined): string | null {
  if (!id) return null;
  if (id === "claude-opus-4-7[1m]") return "claude-opus-4-7";
  return id;
}

/** Appearance 設定（`app/settings` の Appearance タブで管理）。 */
export interface AppearanceSettings {
  theme: ThemeMode;
  accentColor: AccentColor;
  /** Week 7 Chunk 2 で追加。既定 `orange`（既存 CSS variable 設定相当）。 */
  themePreset: ThemePreset;
  /** ベースフォントサイズ (px)、12〜16 の範囲。 */
  fontSize: number;
  /**
   * Round E2 で追加。Warp 風の背景画像カスタマイズ設定。
   * 既定 `DEFAULT_BACKGROUND_IMAGE`（path=null = 背景画像なし）。
   */
  backgroundImage: BackgroundImageSettings;
}

/**
 * Round E2: 背景画像カスタマイズ設定（Warp ターミナル風）。
 *
 * アプリ全体の body 背景に画像を表示し、透過度・ぼかし・オーバーレイで
 * UI の視認性を担保する。path は localStorage に絶対パスで保存し、
 * 起動時に `@tauri-apps/api/core::convertFileSrc` で asset:// URL に変換する。
 */
export interface BackgroundImageSettings {
  /** local file の絶対パス（null = 背景画像なし） */
  path: string | null;
  /** 0..1（0 = 透明、1 = 完全表示） */
  opacity: number;
  /** 0..20 (px)、UI レイヤーの backdrop-filter blur */
  blur: number;
  /** 表示モード */
  fit: "cover" | "contain" | "tile" | "center";
  /** 0..1、UI 上に重ねる背景色レイヤーの濃さ（高いほど画像が薄く、UI 視認性 up） */
  overlayOpacity: number;
}

/** 背景画像設定のデフォルト（背景画像なし、Overlay やや濃いめ）。 */
export const DEFAULT_BACKGROUND_IMAGE: BackgroundImageSettings = {
  path: null,
  opacity: 0.85,
  blur: 0,
  fit: "cover",
  overlayOpacity: 0.7,
};

/**
 * PM-967: チャット表示まわりの設定。
 *
 * ツール呼び出し（Read / Edit / Bash 等）を折り畳み表示するかの制御。デフォルトは
 * **折り畳み ON**（= Claude の回答テキストだけを表示し、tool 操作はグループで集約）。
 * オーナーが詳細を見たい時だけヘッダの toggle で切替可能。
 */
export interface ChatDisplaySettings {
  /** true = 各 tool use を個別カードで表示 / false = 連続する tool を折り畳み */
  showToolDetails: boolean;
}

/**
 * アプリ全体の永続化設定。
 *
 * 永続化は `@tauri-apps/plugin-store` が未導入のため当面 `localStorage` 経由。
 * M3 PM-250/251 でテーマの本実装（CSS 変数書換え）と plugin-store 移行を実施予定。
 */
export interface AppSettings {
  appearance: AppearanceSettings;
  /** PM-967: チャット表示設定 */
  chatDisplay: ChatDisplaySettings;
}

/** デフォルト値（PRJ-012 DEC-030 のブランド Orange 前提）。 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: {
    theme: "system",
    accentColor: "orange",
    themePreset: "orange",
    fontSize: 14,
    backgroundImage: DEFAULT_BACKGROUND_IMAGE,
  },
  chatDisplay: {
    showToolDetails: false,
  },
};

// ---------------------------------------------------------------------------
// Slash commands（Week 6 Chunk 1 / PM-200〜202）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Usage stats（PRJ-012 Stage B）
//
// Rust `commands::usage` の struct と 1:1 対応（camelCase）。
// ~/.claude/projects/**/*.jsonl を集計して Claude Pro/Max の 5h / 7d 使用量を
// 推定する。公式 API では取得できないため、あくまで「実測値」として扱う。
// ---------------------------------------------------------------------------

/** JSONL 1 行分の usage entry（現状は frontend では未使用、将来拡張用）。 */
export interface UsageEntry {
  /** ISO8601 UTC */
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * モデル別内訳 1 要素（Round C 追加）。
 *
 * `UsageWindow.byModel` に session / weekly それぞれ top 5 + `"others"`
 * のリストで入る。cost_usd 降順。`model` は正規化済み名前
 * （例: `"opus-4.7"` / `"sonnet-4.6"` / `"haiku-4"` / `"others"`）。
 */
export interface ModelBreakdown {
  model: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/** 1 ウィンドウ分の集計値。 */
export interface UsageWindow {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** ISO8601 UTC */
  windowStart: string;
  /** ISO8601 UTC */
  windowEnd: string;
  /**
   * top 5 + "others" に集約した model 別内訳（cost 降順）。
   * Round C で追加。空配列なら model 情報なし（古い backend）。
   */
  byModel: ModelBreakdown[];
}

/**
 * 直近 24h セッション detail（Round C 追加）。
 *
 * Heuristic ベース:
 *  - `longSessions`: 1 JSONL 内の最古〜最新 timestamp 差 >= 30 分
 *  - `backgroundSessions`: 連続メッセージ間隔 <= 5 分のペアが 10 組以上
 *  - `subagentMessages`: `parentToolUseId` or `tool_use.name=="Task"` 検出
 */
export interface Last24h {
  sessionCount: number;
  messageCount: number;
  longSessions: number;
  backgroundSessions: number;
  subagentMessages: number;
  costUsd: number;
}

/** 1 日分の集計値（日別 bar chart 用）。 */
export interface DailyUsage {
  /** "YYYY-MM-DD" */
  date: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// PRJ-012 v3.4 / Chunk A (DEC-034 Must 1): File Editor Integration
//
// `lib/stores/editor.ts` から import / re-export される OpenFile 型。
// 型定義は types.ts に集約する方針に従い、store は実装ロジックのみ保持する
// （ただし store ファイル側でも同名の export を持ち、どちらから import しても
//  同じ shape になるよう structural type で一致させる）。
// ---------------------------------------------------------------------------

/**
 * エディタに open されている 1 ファイルの状態。
 *
 * - `id`: `crypto.randomUUID()`、UI key 用の安定識別子
 * - `path`: 絶対パス（重複 open 判定 / savefile のキー）
 * - `title`: タブラベル（basename）
 * - `language`: Monaco 言語 ID（`lib/detect-lang.ts`）
 * - `content`: 現在バッファ（編集中）
 * - `savedContent`: 最後に writeTextFile 成功時のスナップショット
 * - `dirty`: content !== savedContent の cached 真偽値
 * - `loading`: 初回 load / reload 中フラグ
 * - `error`: load / save エラーメッセージ（Alert 表示）
 */
export interface OpenFile {
  id: string;
  path: string;
  title: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}

/** `get_usage_stats` 戻り値。 */
export interface UsageStats {
  /** 直近 5 時間ウィンドウ */
  session5h: UsageWindow;
  /** 直近 7 日ウィンドウ（ローリング） */
  weekly7d: UsageWindow;
  /** 過去 7 日分の日別集計（古い→新しい、末尾が今日） */
  daily: DailyUsage[];
  /** 5 時間ウィンドウのリセット時刻（window_start + 5h） */
  sessionResetAt: string | null;
  /** 集計対象 JSONL ファイル数（デバッグ用） */
  sourceFiles: number;
  /** 直近 24h の detail（Round C 追加） */
  last24h: Last24h;
}

// ---------------------------------------------------------------------------
// Claude OAuth Usage API（PRJ-012 Round D'）
//
// Rust `commands::oauth_usage::*` と 1:1 対応（camelCase）。
//
// Anthropic 公式 Beta API (`GET https://api.anthropic.com/api/oauth/usage`,
// header `anthropic-beta: oauth-2025-04-20`) から取得した Pro/Max プランの
// 5 時間ウィンドウ / 週次ウィンドウ / 追加クレジットの使用率。
//
// - Round A の `ClaudeRateLimits` (CLI TUI parse) は廃止。
// - Stage B の `UsageStats` が「local JSONL 集計の実測値」を提供するのに対し、
//   こちらは Anthropic 側で計算済みの **正規値**（全デバイス合算）。
// ---------------------------------------------------------------------------

/** 5 時間 / 7 日 共通の 1 ウィンドウ分。 */
export interface OAuthUsageWindow {
  /** 使用率 0.0 〜 100.0 */
  utilization: number;
  /** ISO8601 UTC（例: `"2026-04-19T10:00:00Z"`）、欠落時 null */
  resetsAt: string | null;
}

/** 追加クレジット（Pro/Max 上位プラン or 追加課金時のみ `isEnabled === true`）。 */
export interface OAuthExtraUsage {
  /** 利用率 %（無効時は null） */
  utilization: number | null;
  /** 使用済みクレジット (USD) */
  usedCredits: number | null;
  /** 月次上限 (USD) */
  monthlyLimit: number | null;
  /** 有効フラグ */
  isEnabled: boolean;
}

/** `get_oauth_usage` 戻り値（Rust `ClaudeOAuthUsage` と 1:1）。 */
export interface ClaudeOAuthUsage {
  fiveHour: OAuthUsageWindow | null;
  sevenDay: OAuthUsageWindow | null;
  extraUsage: OAuthExtraUsage | null;
  /** 取得時刻 (ISO8601 UTC)、UI の "N 分前取得" 表示に利用 */
  fetchedAt: string;
}

/**
 * Slash command 1 件（`list_slash_commands` 戻り値の要素、Rust
 * `commands::slash::SlashCmd` と 1:1）。
 *
 * DEC-027 v4 Chunk B: 旧 `isOrganization` フィールドは削除。組織ロールの
 * 特別扱いは行わず、純粋なスコープベースのグルーピングに統一した。
 */
export interface SlashCmd {
  /** 先頭 `/` を含むコマンド名（例: `/ceo`） */
  name: string;
  /** 1 行要約（frontmatter の description か、本文 1 行目から抽出） */
  description: string;
  /** 引数 placeholder（例: `{指示}`）。frontmatter に無ければ null */
  argumentHint: string | null;
  /** どのスコープから発見したか（DEC-051 で "cwd" は廃止） */
  source: "global" | "project";
  /** 絶対パス（Monaco preview 用） */
  filePath: string;
}

/**
 * PRJ-012 v1.3 / PM-953: Claude Code skill 1 件（`list_skills` 戻り値の要素、
 * Rust `commands::skills::SkillDef` と 1:1）。
 *
 * 公式 Claude Code の skill 機能（`skills-2025-10-02` beta）に対応し、
 * `~/.claude/skills/<name>/SKILL.md` + `<project>/.claude/skills/<name>/SKILL.md`
 * を走査して得た skill metadata。
 *
 * - `name` はディレクトリ名 or SKILL.md frontmatter の `name`
 * - `description` は SKILL.md frontmatter の `description`（無ければ本文抽出）
 * - 実行機構は Phase 2 以降（v1.4+）で検討。本 MVP では Palette 上の一覧表示のみ。
 */
export interface SkillDef {
  /** skill 識別名（`/` プレフィックス無し。例: `pdf-form-filler`） */
  name: string;
  /** 1 行要約（SKILL.md frontmatter の description か、本文から抽出） */
  description: string;
  /** どのスコープから発見したか（DEC-051 で "cwd" は廃止） */
  source: "global" | "project";
  /** SKILL.md の絶対パス（Monaco preview 用） */
  filePath: string;
  /** skill ディレクトリの絶対パス */
  dirPath: string;
}

/**
 * PRJ-012 v1.3 / PM-954: Claude Code plugin 1 件（`list_plugins` 戻り値の要素、
 * Rust `commands::plugins::PluginDef` と 1:1）。
 *
 * Claude Code の公式 plugin 機能（2026-01 公開）に対応。`~/.claude/plugins/`
 * 配下にインストールされた plugin（`<name>@<marketplace>` 単位）を列挙する。
 * Plugin は **slash / skill / agent / MCP / hooks をバンドルした上位概念** で、
 * `.claude-plugin/plugin.json` に metadata を持つ。
 *
 * - Agent SDK は `SdkPluginConfig` + `reloadPlugins()` で plugin を first-class
 *   support するため、実行経路は sidecar 側に委譲する（Phase 1 では UI 表示のみ）
 * - `enabled` は `~/.claude/settings.json` の `enabledPlugins[id]` に由来
 * - 内部 commands / skills / agents の件数を返すので、Palette では "N commands,
 *   M skills" のような概況を表示できる
 */
/**
 * PRJ-012 v1.4 / PM-955: Claude Code MCP server 1 件（`list_mcp_servers` 戻り値の
 * 要素、Rust `commands::mcp::McpServerDef` と 1:1）。
 *
 * Model Context Protocol (MCP) は Claude Code が外部サービス（github / playwright /
 * supabase / vercel / pencil / stitch / aidesigner / Gmail 等）と tool 経由で
 * 接続する仕組み。Agent SDK は `Options.mcpServers` で起動時に渡す他、
 * `query.mcpServerStatus()` / `toggleMcpServer()` / `setMcpServers()` で
 * dynamic に操作できる。
 *
 * Sumi (Phase 1) は disk 上の設定を **5 スコープ統合で走査**し、
 * SlashPalette に一覧表示する。実接続・tool 取得は Agent SDK の自動 load に
 * 委譲する（Phase 2 で sidecar 経由 `mcpServerStatus()` の live 表示を予定）。
 */
export interface McpServerDef {
  /** server 名（設定 map の key。例: `github` / `vercel` / `stitch`） */
  name: string;
  /**
   * 由来スコープ。
   * - `"global"`       : `~/.claude/settings.json` の `mcpServers`
   * - `"user"`         : `~/.claude.json` 直下の `mcpServers` (全 project 共通)
   * - `"user-project"` : `~/.claude.json` の `projects["<abs>"].mcpServers`
   * - `"plugin"`       : `<plugin-install>/.mcp.json` の `mcpServers`
   * - `"project"`      : `<project>/.mcp.json` の `mcpServers`
   */
  scope: "global" | "user" | "user-project" | "plugin" | "project";
  /** transport 種別。`command` ありで `type` 無しの場合は `stdio` 扱い */
  transport: "stdio" | "sse" | "http" | "unknown";
  /** stdio の実行コマンド（`command` field）。stdio 以外では null */
  command: string | null;
  /** stdio の引数配列。stdio 以外では空配列 */
  args: string[];
  /** sse / http の endpoint URL（`url` field）。stdio では null */
  url: string | null;
  /** plugin 由来時の plugin ID (`<name>@<marketplace>`)、それ以外 null */
  pluginId: string | null;
  /** 設定ファイルの絶対パス（Monaco preview 用） */
  configPath: string;
  /**
   * 有効無効。以下のいずれかで false になる:
   * - `~/.claude.json` の project entry `disabledMcpServers` に含まれる
   * - `~/.claude.json` の project entry `disabledMcpjsonServers` に含まれる
   *   (project 所属 .mcp.json 由来のみ)
   * - plugin 由来 かつ `enabledPlugins["<plugin-id>"] === false`
   */
  enabled: boolean;
  /** env key 一覧（secret 値は含まない、key のみ返す） */
  envKeys: string[];
}

export interface PluginDef {
  /** plugin ID (`<name>@<marketplace>` 形式、例: `vercel@claude-plugins-official`) */
  id: string;
  /** plugin 名（`plugin.json` の name、例: `vercel`） */
  name: string;
  /** marketplace 名（ID の `@` 以降、local の場合は `"local"`） */
  marketplace: string;
  /** version 文字列（例: `0.40.0` / `unknown`） */
  version: string;
  /** 1 行要約（plugin.json の description、無ければ空文字） */
  description: string;
  /** author 名（plugin.json の author.name） */
  author: string | null;
  /** repository URL（plugin.json の repository） */
  repository: string | null;
  /** license（plugin.json の license、例: `Apache-2.0`） */
  license: string | null;
  /** keywords 配列（plugin.json の keywords、無ければ空配列） */
  keywords: string[];
  /** `~/.claude/settings.json` の `enabledPlugins[id]`。未指定は true */
  enabled: boolean;
  /** plugin 本体ディレクトリの絶対パス */
  installPath: string;
  /** `.claude-plugin/plugin.json` の絶対パス（Monaco preview 用） */
  manifestPath: string;
  /** plugin 内部の commands 配下 .md 件数 */
  commandCount: number;
  /** plugin 内部の skills サブディレクトリ内 SKILL.md 件数 */
  skillCount: number;
  /** plugin 内部の agents 配下 .md 件数 */
  agentCount: number;
  /** `.mcp.json` を持つか */
  hasMcp: boolean;
  /** `hooks/hooks.json` を持つか */
  hasHooks: boolean;
}

// v3.5.3 (2026-04-20): Status pane / StatusFile interface は UI 層撤去と同時に削除（PM-770）。
// Rust side の `StatusFile` struct / `list_status_candidates` / `read_status_file`
// command は src-tauri に残置（frontend からは未呼出、将来再導入時の参照用）。

// ---------------------------------------------------------------------------
// PRJ-012 v3.2 / Chunk A (DEC-031): Project registry 型
//
// Workspace 概念を撤去し、すべて「Project = 任意ディレクトリ」に統一。
// `useProjectStore` (lib/stores/project.ts) の registry エントリ型。
//
// Chunk B / C が参照するので本ファイルの末尾 append で共存する。
// ---------------------------------------------------------------------------

/**
 * ModelId の抜粋エイリアス（Settings 未連動の preferredModel 用）。
 *
 * 既存 `ModelId` と同値だが、RegisteredProject のオプショナルフィールドとして
 * 明示的に 3 択を型レベルで絞り込むため別名で再宣言する。
 */
export type PreferredModelId =
  | "opus-4-7"
  | "sonnet-4-6"
  | "haiku-4-5";

/**
 * Project registry の 1 エントリ。
 *
 * - `id`: `crypto.randomUUID()` で生成。path 変更に追従するため path hash ではなく UUID
 * - `path`: 絶対パス（OS 依存セパレータ）
 * - `title`: brief.md frontmatter `title` 優先、なければ `# ` 見出し、最終的に basename
 * - `phase`: brief.md frontmatter `phase` or 本文 `Phase N` 抽出（任意）
 * - `colorIdx`: 0..7（ProjectRail ACCENT_CLASSES のインデックス、path hash）
 * - `lastSessionId`: Chunk C が session 切替時に更新する「最後に開いていた」session id
 * - `preferredModel`: 将来 ModelPickerDialog と連動、未連動時 undefined
 * - `addedAt`: 登録時刻（epoch ms）。UI での並び替え / デバッグ用
 *
 * ## v3.5.16 PM-840 (Claude Desktop 風 Live Model/Effort 切替)
 *
 * - `runningModel`  : 「今この project の sidecar が起動している model（ModelId）」。
 *   StatusBar の `ModelPickerPopover` は active project の本値を表示することで、
 *   Claude Desktop と同等の「実態追従」UX を実現する（dialog store の
 *   `selectedModel` は「次回起動 default」に役割変更）。
 * - `runningEffort` : 同じく「今この project の sidecar が起動している effort」。
 *
 * 両者は sidecar 起動成功時に `project.ts::ensureSidecarRunning` から
 * `updateProject(id, { runningModel, runningEffort })` で記録され、
 * `stopSidecar` / `restartSidecarWithModel` で reset / 更新される。
 *
 * **persist 対象外**（partialize で除外）。sidecar は再起動で空 map 化するため、
 * runningModel / runningEffort も揮発させて乖離を防ぐ。
 */
export interface RegisteredProject {
  id: string;
  path: string;
  title: string;
  phase?: string;
  colorIdx?: number;
  lastSessionId?: string | null;
  preferredModel?: PreferredModelId;
  addedAt: number;
  /**
   * v3.5.16 PM-840: 現在起動中 sidecar の model。null / undefined は「未起動」。
   * persist 対象外（project.ts の partialize で除外）。
   */
  runningModel?: ModelId | null;
  /**
   * v3.5.16 PM-840: 現在起動中 sidecar の effort。null / undefined は「未起動」。
   * persist 対象外（project.ts の partialize で除外）。
   */
  runningEffort?: EffortLevel | null;
}

// v3.5.3 (2026-04-20): Git 統合パネル関連 interface（GitFileEntry / GitStatus /
// GitDiffContent）は UI 層撤去と同時に削除（PM-770）。Rust side の struct / command
// は src-tauri に残置（frontend からは未呼出、将来再導入時の参照用）。

// ---------------------------------------------------------------------------
// PRJ-012 v3.4.9: 推論工数（effort）レベル（StatusBar の EffortPickerPopover 用）
//
// Claude Desktop 風の 4 段階工数切替。現段階では UI 上の選択保持のみで、
// sidecar / Rust agent への反映は PM-760 候補として別途実装（`start_agent_sidecar`
// の options 拡張が必要）。
// ---------------------------------------------------------------------------

/**
 * 推論工数レベル（4 段階）。
 *
 * - `low`    : 素早い応答向け、thinking トークン 1,024
 * - `medium` : バランス型（既定）、thinking トークン 8,192
 * - `high`   : 複雑な設計・分析向け、thinking トークン 32,768
 * - `max`    : 最長推論、thinking トークン 65,536（時間・コスト増）
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * EffortLevel の表示メタ（EffortPickerPopover 用）。
 *
 * v3.4.11: Anthropic 公式の 5 段階（low / medium / high / xhigh / max）に合わせて
 * xhigh（超高）を medium と high の上位として追加。thinkingTokens は Claude Desktop の
 * 挙動を踏まえ、以下の対応:
 *  - low    :  1,024 tokens（素早い応答）
 *  - medium :  8,192 tokens（推奨、バランス型）
 *  - high   : 16,384 tokens（複雑な設計・分析）
 *  - xhigh  : 32,768 tokens（高難度のリファクタ / デバッグ）
 *  - max    : 65,536 tokens（SDK 上限、最長推論）
 */
export const EFFORT_CHOICES: Array<{
  id: EffortLevel;
  label: string;
  description: string;
  thinkingTokens: number;
}> = [
  { id: "low", label: "低", description: "素早い応答、単純な質問向け", thinkingTokens: 1024 },
  { id: "medium", label: "中", description: "バランス型（推奨）", thinkingTokens: 8192 },
  { id: "high", label: "高", description: "複雑な設計・分析向け", thinkingTokens: 16384 },
  { id: "xhigh", label: "超高", description: "高難度のリファクタ / デバッグ向け", thinkingTokens: 32768 },
  { id: "max", label: "最大", description: "最長推論、時間・コスト増", thinkingTokens: 65536 },
];
