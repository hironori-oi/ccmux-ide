/**
 * ファイルツリー向け、言語別アイコン + 色の解決（v3.5.4 新規、2026-04-20）。
 *
 * ccmux 公式 docs の言語アイコン UX（https://shin-sibainu.github.io/ccmux/docs/features）
 * を参考に、拡張子 / 特殊ファイル名から lucide-react のアイコン + tailwind の色
 * クラスを決定する。
 *
 * 完全な言語アイコン集（Seti / Material Icon Theme 互換）は重量のため採用せず、
 * lucide-react の FileCode2 / FileJson / FileText / FileTerminal / FileImage /
 * FileBadge を色分けで運用。
 */

import {
  FileBadge,
  FileCode2,
  FileImage,
  FileJson,
  FileTerminal,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface FileIconSpec {
  Icon: LucideIcon;
  /** Tailwind の text-* クラス（ダーク/ライト両対応、muted-foreground も許容） */
  colorClass: string;
}

/**
 * ファイル名（basename、拡張子含む）から Icon + 色を決定する。
 * 未知の拡張子は FileText + muted-foreground にフォールバック。
 */
export function getFileIconSpec(name: string): FileIconSpec {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";

  // --- 特殊ファイル名 ---
  if (lower === "dockerfile" || lower.startsWith("dockerfile."))
    return { Icon: FileText, colorClass: "text-blue-500" };
  if (lower === "docker-compose.yml" || lower === "docker-compose.yaml")
    return { Icon: FileText, colorClass: "text-blue-500" };
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules")
    return { Icon: FileText, colorClass: "text-orange-600 dark:text-orange-400" };
  if (lower === "package.json" || lower === "package-lock.json")
    return { Icon: FileJson, colorClass: "text-red-500" };
  if (lower === "pnpm-lock.yaml" || lower === "yarn.lock" || lower === "bun.lockb")
    return { Icon: FileText, colorClass: "text-orange-500" };
  if (lower.startsWith("tsconfig") && (ext === "json" || lower.endsWith(".json")))
    return { Icon: FileJson, colorClass: "text-blue-600 dark:text-blue-400" };
  if (lower === "cargo.toml" || lower === "cargo.lock")
    return { Icon: FileText, colorClass: "text-orange-700 dark:text-orange-400" };
  if (lower === "readme.md" || lower === "readme")
    return { Icon: FileText, colorClass: "text-sky-500" };
  if (lower === "license" || lower === "license.md" || lower === "license.txt")
    return { Icon: FileBadge, colorClass: "text-amber-600" };
  if (lower === ".env" || lower.startsWith(".env."))
    return { Icon: FileBadge, colorClass: "text-yellow-600 dark:text-yellow-400" };
  if (
    lower === ".npmrc" ||
    lower === ".editorconfig" ||
    lower === ".prettierrc" ||
    lower === ".prettierrc.json" ||
    lower === ".eslintrc" ||
    lower === ".eslintrc.json" ||
    lower === ".eslintrc.js" ||
    lower === ".nvmrc" ||
    lower === ".babelrc"
  )
    return { Icon: FileText, colorClass: "text-slate-500" };
  if (lower === "makefile" || lower === "gnumakefile" || lower === "cmakelists.txt")
    return { Icon: FileTerminal, colorClass: "text-amber-700 dark:text-amber-500" };

  // --- 拡張子マッピング ---
  switch (ext) {
    // TypeScript
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return { Icon: FileCode2, colorClass: "text-blue-500 dark:text-blue-400" };
    // JavaScript
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { Icon: FileCode2, colorClass: "text-yellow-500 dark:text-yellow-400" };
    // Python
    case "py":
    case "pyi":
      return { Icon: FileCode2, colorClass: "text-emerald-500" };
    // Rust
    case "rs":
      return { Icon: FileCode2, colorClass: "text-orange-600 dark:text-orange-400" };
    // Go
    case "go":
      return { Icon: FileCode2, colorClass: "text-cyan-500 dark:text-cyan-400" };
    // Ruby
    case "rb":
      return { Icon: FileCode2, colorClass: "text-red-500" };
    // Java / Kotlin
    case "java":
    case "kt":
    case "kts":
      return { Icon: FileCode2, colorClass: "text-orange-500" };
    // C / C++ / header
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return { Icon: FileCode2, colorClass: "text-blue-700 dark:text-blue-400" };
    // C#
    case "cs":
      return { Icon: FileCode2, colorClass: "text-purple-500" };
    // Swift
    case "swift":
      return { Icon: FileCode2, colorClass: "text-orange-500" };
    // PHP
    case "php":
      return { Icon: FileCode2, colorClass: "text-indigo-500" };
    // Lua
    case "lua":
      return { Icon: FileCode2, colorClass: "text-blue-600" };
    // Scala
    case "scala":
      return { Icon: FileCode2, colorClass: "text-red-600" };
    // Dart
    case "dart":
      return { Icon: FileCode2, colorClass: "text-sky-600" };
    // Elixir
    case "ex":
    case "exs":
      return { Icon: FileCode2, colorClass: "text-violet-600" };
    // Haskell
    case "hs":
      return { Icon: FileCode2, colorClass: "text-purple-700" };
    // Zig
    case "zig":
      return { Icon: FileCode2, colorClass: "text-amber-500" };

    // JSON
    case "json":
    case "jsonc":
    case "json5":
      return { Icon: FileJson, colorClass: "text-amber-500 dark:text-amber-400" };
    // YAML
    case "yaml":
    case "yml":
      return { Icon: FileText, colorClass: "text-orange-400" };
    // TOML
    case "toml":
      return { Icon: FileText, colorClass: "text-orange-700 dark:text-orange-400" };
    // XML
    case "xml":
      return { Icon: FileText, colorClass: "text-rose-500" };
    // HTML
    case "html":
    case "htm":
      return { Icon: FileText, colorClass: "text-rose-500" };
    // CSS 系
    case "css":
    case "scss":
    case "sass":
    case "less":
      return { Icon: FileText, colorClass: "text-pink-500" };
    // Vue / Svelte
    case "vue":
      return { Icon: FileCode2, colorClass: "text-emerald-500" };
    case "svelte":
      return { Icon: FileCode2, colorClass: "text-orange-500" };

    // Markdown 系
    case "md":
    case "mdx":
    case "markdown":
      return { Icon: FileText, colorClass: "text-sky-500 dark:text-sky-400" };
    // txt
    case "txt":
    case "log":
      return { Icon: FileText, colorClass: "text-muted-foreground" };

    // Shell
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return { Icon: FileTerminal, colorClass: "text-green-500" };
    // PowerShell
    case "ps1":
    case "psm1":
      return { Icon: FileTerminal, colorClass: "text-blue-400" };
    // Windows batch
    case "bat":
    case "cmd":
      return { Icon: FileTerminal, colorClass: "text-slate-500" };
    // SQL
    case "sql":
      return { Icon: FileText, colorClass: "text-sky-600" };

    // 画像
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "ico":
    case "svg":
    case "avif":
    case "heic":
      return { Icon: FileImage, colorClass: "text-purple-400" };

    // PDF / Office
    case "pdf":
      return { Icon: FileText, colorClass: "text-red-600" };
    case "doc":
    case "docx":
      return { Icon: FileText, colorClass: "text-blue-700" };
    case "xls":
    case "xlsx":
    case "csv":
      return { Icon: FileText, colorClass: "text-green-700" };
    case "ppt":
    case "pptx":
      return { Icon: FileText, colorClass: "text-orange-700" };

    // Archive
    case "zip":
    case "tar":
    case "gz":
    case "bz2":
    case "7z":
    case "rar":
    case "xz":
      return { Icon: FileText, colorClass: "text-amber-700" };

    // Lockfile / config
    case "lock":
      return { Icon: FileText, colorClass: "text-slate-500" };
    case "ini":
    case "conf":
    case "cfg":
      return { Icon: FileText, colorClass: "text-slate-500" };

    default:
      return { Icon: FileText, colorClass: "text-muted-foreground" };
  }
}
