/**
 * ccmux-ide 共通型定義。
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
  scope: "Global" | "Parent" | "Project" | "Cwd";
  depth: number;
  label: string;
  isFile: boolean;
}

/** git worktree 1 件（Rust `Worktree` と対応） */
export interface Worktree {
  id: string;
  branch: string;
  path: string;
}

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
}

/** サイドバー一覧向け。`list_sessions` 戻り値の要素。 */
export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  projectPath: string | null;
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
 * `claude-code-company` workspace 配下の 1 プロジェクトを表す軽量サマリ。
 *
 * - `id`: ディレクトリ名（例: `PRJ-012` / `COMPANY-WEBSITE`）
 * - `path`: 絶対パス（OS 依存のセパレータ）
 * - `title`: `brief.md` の 1 行目 `#` から抽出したタイトル（無ければ `undefined`）
 * - `phase`: `brief.md` 内の最初の `Phase`/`フェーズ` 記述から簡易抽出（無ければ `undefined`）
 */
export interface ProjectSummary {
  id: string;
  path: string;
  title?: string;
  phase?: string;
}

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
 * - `orange`: ccmux-ide ブランドデフォルト（light / dark 両対応）
 * - `tokyo-night` / `catppuccin` / `dracula` / `nord`: dark-only プリセット、
 *   選択時は next-themes 側も `dark` に強制切替する。
 */
export type ThemePreset = "orange" | "tokyo-night" | "catppuccin" | "dracula" | "nord";

/** Appearance 設定（`app/settings` の Appearance タブで管理）。 */
export interface AppearanceSettings {
  theme: ThemeMode;
  accentColor: AccentColor;
  /** Week 7 Chunk 2 で追加。既定 `orange`（既存 CSS variable 設定相当）。 */
  themePreset: ThemePreset;
  /** ベースフォントサイズ (px)、12〜16 の範囲。 */
  fontSize: number;
}

/**
 * アプリ全体の永続化設定。
 *
 * 永続化は `@tauri-apps/plugin-store` が未導入のため当面 `localStorage` 経由。
 * M3 PM-250/251 でテーマの本実装（CSS 変数書換え）と plugin-store 移行を実施予定。
 */
export interface AppSettings {
  appearance: AppearanceSettings;
}

/** デフォルト値（PRJ-012 DEC-030 のブランド Orange 前提）。 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: {
    theme: "system",
    accentColor: "orange",
    themePreset: "orange",
    fontSize: 14,
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
}

/**
 * Slash command 1 件（`list_slash_commands` 戻り値の要素、Rust
 * `commands::slash::SlashCmd` と 1:1）。
 */
export interface SlashCmd {
  /** 先頭 `/` を含むコマンド名（例: `/ceo`） */
  name: string;
  /** 1 行要約（frontmatter の description か、本文 1 行目から抽出） */
  description: string;
  /** 引数 placeholder（例: `{指示}`）。frontmatter に無ければ null */
  argumentHint: string | null;
  /** どのスコープから発見したか */
  source: "global" | "project" | "cwd";
  /** 絶対パス（Monaco preview 用） */
  filePath: string;
  /** 組織 role slash（`/ceo` `/dev` 等）なら true */
  isOrganization: boolean;
}
