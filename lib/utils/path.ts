/**
 * PRJ-012 v1.14.0 (DEC-060): パス判定ユーティリティ。
 *
 * Frontend (PermissionDialog) が「Write/Edit/NotebookEdit で指定された
 * ファイルパスが project cwd の外側を指していないか」を検査するために使う。
 *
 * ## 設計方針
 * - pure function のみ (Node.js path / tauri path API に依存しない)
 * - Windows + POSIX 両対応
 *   - Windows: `C:\Users\foo` / `C:/Users/foo` / UNC `\\server\share` / long path `\\?\C:\...`
 *   - POSIX  : `/home/foo` / `/tmp/bar`
 * - Windows のパスは大文字小文字を区別しない（NTFS case-insensitive 前提）
 * - POSIX は大文字小文字を区別する
 * - 相対パス (`./foo` / `../bar` / `foo/bar`) は常に「cwd 内扱い」として true を返す
 *   （SDK は相対パスを cwd 基準で解決する想定。絶対パスのみが cwd 外漏洩の対象）
 */

/**
 * 渡された文字列が絶対パスであるか判定する。
 *
 * - Windows: `C:\...` / `c:/...` / `\\server\share` (UNC) / `\\?\C:\...` (extended)
 * - POSIX  : `/home/...`
 *
 * 判定は正規表現ベースで純粋 (OS 検出なし)。Windows でも POSIX スタイル絶対
 * パス (`/tmp/x`) を絶対パスと見なす (WSL / Git Bash パス混入対応)。
 */
export function isAbsolutePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  // Windows drive letter: `C:\...` / `C:/...`
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  // Windows UNC or extended-length path: `\\server\share` / `\\?\C:\...`
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  // POSIX 絶対パス (Windows 上の WSL / Git Bash 経由も考慮)
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  return false;
}

/**
 * `p` と `cwd` を比較し、`p` が `cwd` 配下 (prefix として一致) かを返す。
 *
 * ## 挙動
 * - `p` が相対パスなら常に `true` (SDK が cwd 基準で解決する前提)
 * - `p` / `cwd` をそれぞれ normalize (`\` → `/` に統一、末尾 `/` 除去) した上で
 *   prefix 比較する
 * - Windows ドライブ文字が含まれている場合 (または両方 UNC 風) は大文字小文字を
 *   無視して比較する (NTFS は case-insensitive)
 * - POSIX スタイルは大文字小文字を区別する
 *
 * ## 境界
 * - `cwd` が空文字列 / undefined → `true` (判定不能、呼出側が警告抑制する想定)
 * - `p === cwd` → `true` (cwd そのものへの書込みは「内側」扱い)
 * - `p` が `cwd` の prefix だが別ディレクトリ (例: cwd=`/a/b`, p=`/a/bc`) → `false`
 *   (区切り文字の境界もチェック)
 *
 * ## 実装メモ
 * Node の `path.relative` / `path.resolve` は OS 依存の挙動をするため使わない。
 * Frontend は Web 環境 + Tauri 混在で node:path が無い前提のため、純粋な
 * string 操作で実装する。
 */
export function isPathWithinCwd(p: string, cwd: string): boolean {
  if (typeof p !== "string" || p.length === 0) return true;
  if (typeof cwd !== "string" || cwd.length === 0) return true;
  // 相対パスは cwd 基準で解決される想定なので常に「内側」
  if (!isAbsolutePath(p)) return true;

  const np = normalizePath(p);
  const nc = normalizePath(cwd);

  // Windows 風 (ドライブ文字 / UNC) が片方でも含まれていれば case-insensitive 比較
  const useCaseInsensitive = isWindowsLikePath(np) || isWindowsLikePath(nc);
  const a = useCaseInsensitive ? np.toLowerCase() : np;
  const b = useCaseInsensitive ? nc.toLowerCase() : nc;

  if (a === b) return true;
  // prefix + 区切り文字の境界一致を要求 (/a/b は /a/bc を含まない)
  if (a.startsWith(b + "/")) return true;
  return false;
}

/**
 * パスを比較用に正規化する。
 *
 * - `\` を `/` に統一
 * - 連続する `/` を 1 つにまとめる (例: `C:\\\\Users` → `C:/Users`)
 * - 末尾の `/` を除去 (ルート `/` / `C:/` 単体は保持)
 *
 * ※ `.` / `..` の解決は行わない (通常 Write/Edit ツールは絶対パスで来る前提、
 *    また `..` 解決は Frontend 側で正確に行うのが難しいため SDK / OS に任せる)。
 */
function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  // 連続 `/` を 1 つに (ただし先頭の `//` = UNC は残す)
  if (s.startsWith("//")) {
    s = "//" + s.slice(2).replace(/\/+/g, "/");
  } else {
    s = s.replace(/\/+/g, "/");
  }
  // 末尾 `/` 除去 (ルート単体は保持)
  if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) {
    s = s.slice(0, -1);
  }
  return s;
}

/** Windows 風パス (ドライブ文字 or UNC) かを簡易判定。case-insensitive 比較の切替用。 */
function isWindowsLikePath(p: string): boolean {
  return /^[A-Za-z]:\//.test(p) || p.startsWith("//");
}
