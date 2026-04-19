// ============================================================================
// ccmux-ide / sidecar bundler
// ----------------------------------------------------------------------------
// 目的:
//   `sidecar/src/index.ts` (Agent SDK を呼ぶ TypeScript entrypoint) を
//   `sidecar/dist/index.mjs` として単一 ESM ファイルに bundle する。
//
//   dev では `tsx` でトランスパイルしながら src/index.ts を直接実行しているが、
//   production (Tauri 配布) では:
//     - tsx がユーザ PATH 上の node_modules に無い可能性が高い
//     - 起動を速くしたい (tsx のコールドスタートは 100-300ms 追加される)
//     - Tauri の bundle resources 指定を単純化したい
//   という理由で pure node が読める .mjs を 1 ファイルに纏める。
//
// 方針 (DEC-026 案):
//   external: [] — Agent SDK 含め全依存を inline する。
//   →  sidecar/dist/index.mjs 1 ファイルだけを Tauri resources に登録すれば良い。
//   →  sidecar/node_modules を配布物に含めなくて済む (bundle size ~数MB 増だが
//      Tauri 全体 40MB 程度なので許容範囲)。
//
//   もし external が必要になる依存が現れた場合 (例: ネイティブバインディング
//   を含む node-keytar 等) は、下記 `EXTERNAL` 配列に追記すればよい。
//   初回は空で試す。
// ----------------------------------------------------------------------------

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// 設定
// ----------------------------------------------------------------------------

/**
 * bundle 対象外にする module 名。
 *
 * @anthropic-ai/claude-agent-sdk は platform 固有の native CLI binary
 * (@anthropic-ai/claude-agent-sdk-linux-x64 等、各 73MB) を
 * optionalDependencies で持つため、esbuild で inline bundle すると
 * 実行時に「Native CLI binary for linux-x64 not found」エラーになる。
 *
 * Node の module resolution に委ねる方が確実なので external 扱い。
 * この場合 Tauri resources には sidecar/node_modules も含める必要があるが、
 * dev (tauri dev) では Node が sidecar/node_modules を直接参照するため動く。
 * production bundle 時の対応は M3 (PM-282 配布 CI) で改めて検討。
 */
const EXTERNAL = [
  "@anthropic-ai/claude-agent-sdk",
];

const ENTRY = path.join(__dirname, "src", "index.ts");
const OUTFILE = path.join(__dirname, "dist", "index.mjs");

// ----------------------------------------------------------------------------
// pre-flight チェック
// ----------------------------------------------------------------------------

if (!fs.existsSync(ENTRY)) {
  console.error(`[sidecar/build] entry not found: ${ENTRY}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });

// ----------------------------------------------------------------------------
// esbuild 実行
// ----------------------------------------------------------------------------

const start = Date.now();

try {
  const result = await build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22", // Node 22 / 24 どちらでも動くように保守的に node22
    external: EXTERNAL,
    // minify: false — sidecar は stdout/stderr のログが読める方が
    //   production デバッグで助かる。bundle size より可読性優先。
    minify: false,
    // sourcemap: inline は debug 時だけ欲しいが、.mjs のサイズを増やすので外す。
    sourcemap: false,
    // ESM top-level await を維持
    keepNames: true,
    // Agent SDK は動的 require/import を使っている可能性があるため、念のため
    // Node の builtin は external 扱いにせず esbuild デフォルトに任せる。
    // (platform: "node" なら fs / path 等は自動で external 扱い)
    // 警告をビルドログに出す
    logLevel: "info",
    metafile: true,
    // Tauri の resource としてコピーされる前提で shebang は不要
    // banner は追加しない (esbuild の ESM 出力そのままで node が読める)
    // ----------------------------------------------------------------
    // .node ネイティブモジュールへの対応:
    //   esbuild はデフォルトで .node ファイルを解決できないため、
    //   万一 Agent SDK が bindings を使っていたら loader 設定が必要。
    //   現状 @anthropic-ai/claude-agent-sdk は pure JS のみなので不要。
    // ----------------------------------------------------------------
  });

  if (result.warnings.length > 0) {
    console.warn(`[sidecar/build] ${result.warnings.length} warnings emitted`);
  }

  const stat = fs.statSync(OUTFILE);
  const kb = (stat.size / 1024).toFixed(1);
  const ms = Date.now() - start;
  console.log(
    `[sidecar/build] OK: ${path.relative(__dirname, OUTFILE)} (${kb} KB) in ${ms} ms`
  );
} catch (err) {
  console.error("[sidecar/build] FAILED:", err);
  process.exit(1);
}
