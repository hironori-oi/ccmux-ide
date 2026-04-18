/**
 * ccmux-ide 共通型定義。
 *
 * Rust backend の `Serialize` struct と 1:1 対応。将来は specta 等で自動生成
 * する想定（付録A.2 の optional feature）。現段階は手書きで整合性を取る。
 */

/** チャット 1 メッセージ */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  content: string;
  /** ISO 8601 UTC timestamp */
  timestamp: string;
  /** 添付画像（PNG のローカル絶対パス） */
  images?: string[];
  /** tool_use の場合のみ */
  tool?: {
    name: string;
    input: Record<string, unknown>;
  };
}

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
