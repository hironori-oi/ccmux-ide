/**
 * PRJ-012 Round E1: 画像メタ情報取得ユーティリティ。
 *
 * ImagePreviewDialog / ImageThumb hover Popover で表示する
 * 「ファイル名 / サイズ / 画像寸法」を 1 回の呼び出しでまとめて返す。
 *
 * - ファイル名: `path.split(/[\\/]/).pop()` で basename を抽出。
 * - ファイルサイズ: `@tauri-apps/plugin-fs` の `stat(path)` で bytes 取得し、
 *   `humanFileSize` で `1.2 MB` 形式の文字列に整形する。
 * - 画像 dimensions: `<img>` を memory に load して `naturalWidth` /
 *   `naturalHeight` を拾う（Promise wrap、失敗時は undefined）。
 *
 * エラー（ファイル不存在・読み込み失敗・画像 decode 失敗）は silent fallback
 * として `loadError` にメッセージを詰め、他フィールドは undefined のまま返す。
 * Lightbox 側で「メタ情報の取得に失敗しました」を軽く表示するだけに留める。
 */

import { stat } from "@tauri-apps/plugin-fs";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ImageMeta {
  fileName: string;
  filePath: string;
  fileSizeBytes?: number;
  /** `humanFileSize` 整形済み文字列（例: `"1.2 MB"`）。 */
  fileSizeHuman?: string;
  width?: number;
  height?: number;
  /** 取得失敗時のエラーメッセージ（UI に補助表示）。 */
  loadError?: string;
}

/**
 * bytes を `1.2 MB` 形式にフォーマット。
 *
 * - 1 KB = 1024 bytes（binary prefix）。
 * - 小数点第 1 位までで四捨五入（`B` は整数）。
 * - 負値は 0 扱い。
 */
export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  const formatted = unitIdx === 0 ? `${Math.round(value)}` : value.toFixed(1);
  return `${formatted} ${units[unitIdx]}`;
}

/**
 * basename をパスから抽出する（Windows `\` / POSIX `/` 両対応）。
 */
export function extractFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * 画像を memory に load して naturalWidth / naturalHeight を返す。
 *
 * - `convertFileSrc` で webview から参照可能な URL に変換してから load。
 * - 失敗時は reject。呼び出し元は `.catch` で silent fallback する。
 */
function loadImageDimensions(
  src: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image is not available in this environment"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      reject(new Error("failed to decode image"));
    };
    img.src = src;
  });
}

/**
 * 画像 1 枚分のメタ情報をまとめて取得する。
 *
 * - `stat` と dimension 取得は並列に走らせ、片方が失敗してももう片方の
 *   結果は返す（best-effort）。
 * - path 文字列は UI から剥がさない（full path は Lightbox 内のみ表示）。
 */
export async function getImageMeta(path: string): Promise<ImageMeta> {
  const fileName = extractFileName(path);
  const meta: ImageMeta = { fileName, filePath: path };

  const src = (() => {
    try {
      return convertFileSrc(path);
    } catch {
      return "";
    }
  })();

  const errors: string[] = [];

  const statPromise: Promise<void> = stat(path)
    .then((s) => {
      const size = typeof s.size === "number" ? s.size : undefined;
      if (typeof size === "number") {
        meta.fileSizeBytes = size;
        meta.fileSizeHuman = humanFileSize(size);
      }
    })
    .catch((e: unknown) => {
      errors.push(
        `stat: ${e instanceof Error ? e.message : String(e)}`
      );
    });

  const dimPromise: Promise<void> = src
    ? loadImageDimensions(src)
        .then(({ width, height }) => {
          meta.width = width;
          meta.height = height;
        })
        .catch((e: unknown) => {
          errors.push(
            `dimension: ${e instanceof Error ? e.message : String(e)}`
          );
        })
    : Promise.resolve();

  await Promise.all([statPromise, dimPromise]);

  if (errors.length > 0) {
    meta.loadError = errors.join(" / ");
  }
  return meta;
}
