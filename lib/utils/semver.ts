/**
 * PM-XXX / v1.18.1 DEC-065: UpdateNotifier の同一バージョン誤判定修正で使用する
 * 軽量 semver 比較ヘルパ。
 *
 * 目的:
 *   tauri-plugin-updater の `check()` が返す `update.version` と、アプリの
 *   `getVersion()` で得た現在バージョンを数値比較し、`current >= latest` なら
 *   「更新あり」の UI 表示を抑制する。server 側 latest.json の誤りや
 *   plugin-updater の比較漏れに対する防御線。
 *
 * 仕様:
 *   - `MAJOR.MINOR.PATCH` の 3 要素を数値比較
 *   - pre-release suffix（`-beta.1`, `-rc.2` 等）は現状無視して core のみ比較
 *   - 桁欠け（`1.18` 等）は欠けた桁を 0 として扱う
 *   - 数値化できない部分は 0 として扱う（防御寄り、updater を誤爆させない）
 *   - 先頭 `v` prefix（`v1.18.0`）は自動で除去
 *
 * 戻り値:
 *   -1 | 0 | 1  （a < b / a == b / a > b）
 *
 * test は軽量のため省略（PRJ-012 dev 方針: trivial util は typecheck で十分）。
 */

function parseCore(version: string): [number, number, number] {
  if (!version) return [0, 0, 0];
  // 先頭 v を剥がす + pre-release を除外
  const core = version
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/, 1)[0]
    .split(".");
  const major = Number.parseInt(core[0] ?? "0", 10);
  const minor = Number.parseInt(core[1] ?? "0", 10);
  const patch = Number.parseInt(core[2] ?? "0", 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ];
}

/**
 * 2 つのバージョン文字列を比較する。
 * @returns -1 (a<b) | 0 (a==b) | 1 (a>b)
 */
export function compareVersion(a: string, b: string): -1 | 0 | 1 {
  const [am, an, ap] = parseCore(a);
  const [bm, bn, bp] = parseCore(b);
  if (am !== bm) return am < bm ? -1 : 1;
  if (an !== bn) return an < bn ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

/**
 * `latest` が `current` より新しいか（MAJOR.MINOR.PATCH で数値比較）。
 * 同一 / 古い場合は false を返す。
 */
export function isNewerVersion(current: string, latest: string): boolean {
  return compareVersion(latest, current) === 1;
}
