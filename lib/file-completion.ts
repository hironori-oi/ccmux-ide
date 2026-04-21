/**
 * File completion helper for `@file` / `@folder` mention picker
 * (PRJ-012 v3.4 / Chunk B / DEC-034 Must 2).
 *
 * - Rust `list_project_files` を呼出し、project_root 配下のファイル一覧を取得
 * - 同一 (projectRoot, query) に対する重複 invoke を LRU + TTL キャッシュで削減
 * - fuzzy scoring（優先度: 完全一致 > prefix > substring > subsequence）
 *
 * **大規模リポ配慮**: Rust 側が `.gitignore` 尊重 + `ALWAYS_EXCLUDE_DIRS` で
 * 爆発を抑え、default 500 件で打切り。さらに本ファイルの cache で同一 query
 * への repeated invoke を 1 回に集約する。
 */

import { callTauri } from "@/lib/tauri-api";

/**
 * Rust `commands::file_list::FileEntry` と 1:1 対応（camelCase）。
 */
export interface FileEntry {
  /** project_root からの相対パス（`/` 区切りに正規化済） */
  path: string;
  /** 絶対パス（OS 依存 separator のまま） */
  absPath: string;
  /** basename（例: `project.ts`） */
  name: string;
  /** ディレクトリなら true */
  isDirectory: boolean;
  /** ファイルサイズ（ディレクトリは 0） */
  sizeBytes: number;
}

/** fuzzy scoring 後の行（UI で使う）。score 降順で並べ替える。 */
export interface ScoredFileEntry extends FileEntry {
  /** スコア（0..1000 の整数、大きいほど上位）。0 は非マッチ、UI には出さない */
  score: number;
  /** 表示用にハイライトする文字 index 集合（path 上の 0-indexed 位置）。空なら装飾なし */
  matchIndices: number[];
}

// ---------------------------------------------------------------------------
// LRU + TTL キャッシュ
// ---------------------------------------------------------------------------

/** LRU の最大エントリ数（projectRoot × query の組）。 */
const CACHE_MAX_ENTRIES = 64;
/** 1 エントリの有効期間（ms）。経過後は再 fetch。 */
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  entries: FileEntry[];
  fetchedAt: number;
}

/**
 * Map を LRU として使う（Map は ES2015+ で insertion order を保持するため、
 * 再 set = promote で reorder、size 上限で oldest を drop できる）。
 */
const cache: Map<string, CacheEntry> = new Map();

/** 進行中 fetch の dedup（同一 key の並行 fetch を 1 本化）。 */
const inflight: Map<string, Promise<FileEntry[]>> = new Map();

function cacheKey(projectRoot: string, query: string): string {
  return `${projectRoot}\u0000${query.trim().toLowerCase()}`;
}

/**
 * LRU に put（既存 key は remove → insert で順序を更新）。
 */
function cachePut(key: string, entries: FileEntry[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { entries, fetchedAt: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/**
 * TTL 内なら cache hit を返す（副作用: hit した場合も LRU promote）。
 */
function cacheGet(key: string): FileEntry[] | null {
  const ent = cache.get(key);
  if (!ent) return null;
  if (Date.now() - ent.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU promote（Map の順序を最新側へ）
  cache.delete(key);
  cache.set(key, ent);
  return ent.entries;
}

/**
 * キャッシュ全消去（project 切替時などに呼ぶ）。現状は UI 側で明示的に
 * 呼ばずとも TTL で expire するため未使用だが、将来拡張用に公開。
 */
export function clearFileCompletionCache(): void {
  cache.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Fetch（Rust invoke + キャッシュ）
// ---------------------------------------------------------------------------

/**
 * project_root 配下のファイル候補を取得する。
 *
 * - 同一 (projectRoot, query) が TTL 内なら Rust invoke を skip
 * - 並行呼出しは 1 本に dedup
 * - query は Rust 側で case-insensitive substring filter され、
 *   本関数の戻り値は「粗い候補」のまま（最終順位付けは `fuzzyScore`）
 *
 * @param projectRoot 絶対パス。null/空文字なら空配列を返す
 * @param query       `@` 以降のユーザー入力（空文字 OK）
 * @param limit       Rust 側打切り件数（既定 500）
 */
export async function fetchFiles(
  projectRoot: string | null | undefined,
  query: string,
  limit = 500
): Promise<FileEntry[]> {
  if (!projectRoot) return [];
  const key = cacheKey(projectRoot, query);

  const hit = cacheGet(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const entries = await callTauri<FileEntry[]>("list_project_files", {
        projectRoot,
        query: query.trim() || null,
        limit,
      });
      cachePut(key, entries);
      return entries;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Fuzzy scoring
// ---------------------------------------------------------------------------

/**
 * fuzzy match スコアを算出する（優先度: 完全一致 > prefix > substring > subsequence）。
 *
 * スコア設計（大きいほど上位）:
 *   1000  : path 完全一致（rare）
 *   900   : basename 完全一致
 *   800+  : basename prefix match（長さ一致に近いほど高）
 *   700+  : path prefix match
 *   500+  : basename substring match（前方優先）
 *   400+  : path substring match（前方優先）
 *   100+  : subsequence match（隙間が狭いほど高）
 *   0     : 非マッチ
 *
 * `matchIndices` には path 上のマッチ位置を詰める（UI の強調表示用）。
 *
 * @param entry FileEntry
 * @param query ユーザー入力（trim 済、空なら score=1、全件を弱く上げる）
 */
export function fuzzyScore(entry: FileEntry, query: string): {
  score: number;
  matchIndices: number[];
} {
  const q = query.trim();
  if (!q) {
    // query 空時は全件低スコアで通す（UI は最近開いた等で別途並べ替え）
    return { score: 1, matchIndices: [] };
  }
  const qLower = q.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const nameLower = entry.name.toLowerCase();

  // 完全一致
  if (pathLower === qLower) {
    return { score: 1000, matchIndices: rangeIndices(0, entry.path.length) };
  }
  if (nameLower === qLower) {
    const start = entry.path.length - entry.name.length;
    return { score: 900, matchIndices: rangeIndices(start, entry.path.length) };
  }

  // prefix
  if (nameLower.startsWith(qLower)) {
    // 短い name ほど上位（完全一致に近い）
    const bonus = Math.max(0, 100 - (entry.name.length - qLower.length));
    const start = entry.path.length - entry.name.length;
    return {
      score: 800 + bonus,
      matchIndices: rangeIndices(start, start + qLower.length),
    };
  }
  if (pathLower.startsWith(qLower)) {
    const bonus = Math.max(0, 100 - (entry.path.length - qLower.length));
    return {
      score: 700 + bonus,
      matchIndices: rangeIndices(0, qLower.length),
    };
  }

  // substring（basename 優先）
  const nameIdx = nameLower.indexOf(qLower);
  if (nameIdx !== -1) {
    // 前方 (nameIdx 小さい) ほど上位
    const bonus = Math.max(0, 100 - nameIdx * 5);
    const start = entry.path.length - entry.name.length + nameIdx;
    return {
      score: 500 + bonus,
      matchIndices: rangeIndices(start, start + qLower.length),
    };
  }
  const pathIdx = pathLower.indexOf(qLower);
  if (pathIdx !== -1) {
    const bonus = Math.max(0, 100 - pathIdx * 2);
    return {
      score: 400 + bonus,
      matchIndices: rangeIndices(pathIdx, pathIdx + qLower.length),
    };
  }

  // subsequence（連続しない順序マッチ）
  const subseq = subsequenceIndices(pathLower, qLower);
  if (subseq) {
    // 隙間の総和が小さいほど上位
    const span = subseq[subseq.length - 1] - subseq[0];
    const density = Math.max(0, 100 - (span - qLower.length) * 2);
    return { score: 100 + density, matchIndices: subseq };
  }

  return { score: 0, matchIndices: [] };
}

/**
 * `query` の各文字が `text` 中に順序通り（連続しなくてよい）に出現するかを
 * 判定し、見つかった index 配列を返す（見つからなければ null）。
 *
 * 両者は小文字で渡すこと。
 */
function subsequenceIndices(text: string, query: string): number[] | null {
  const idxs: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const c = query[qi];
    let found = -1;
    while (ti < text.length) {
      if (text[ti] === c) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    idxs.push(found);
  }
  return idxs;
}

function rangeIndices(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let i = start; i < endExclusive; i++) out.push(i);
  return out;
}

/**
 * `fetchFiles` 結果を fuzzy scoring で並べ替え、非マッチを除外して上位 N 件を返す。
 *
 * ディレクトリ / ファイルの先頭優先は呼出側で決定（同スコア時 `isDirectory === false`
 * を上位とするかは UI 側の UX 判断）。本関数は score 降順 + ties は path asc で安定。
 */
export function rankFuzzy(
  entries: FileEntry[],
  query: string,
  topN = 20
): ScoredFileEntry[] {
  const scored: ScoredFileEntry[] = [];
  for (const e of entries) {
    const { score, matchIndices } = fuzzyScore(e, query);
    if (score <= 0) continue;
    scored.push({ ...e, score, matchIndices });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });
  return scored.slice(0, topN);
}
