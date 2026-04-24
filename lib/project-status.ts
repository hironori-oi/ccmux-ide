/**
 * PRJ-012 v1.20.0 (DEC-066) — Project status の集約型とヘルパ。
 *
 * ## 背景
 *
 * v1.18.0 (DEC-064) で「session status」の揮発状態が session store に入った。
 * 一方、ProjectRail は「その project が今何をしているか」を 1 つのアイコンで
 * 表すため、同じ project に属する **全 session の status を集約** して
 * 表示する必要がある。さらに応答完了は「ユーザーが該当 session を pane で
 * 開くまで未読として継続表示」する要件 (DEC-066) が加わったため、
 * project 側にも揮発な status / hasUnread を別途もたせる。
 *
 * ## Project status の 5 値
 *
 *  - `idle`       : 全 session 待機中、未読もなし
 *  - `thinking`   : 任意 session が推論中 (sessionStatus === "thinking" or
 *                   sessionActivity.kind === "thinking")
 *  - `streaming`  : 任意 session がテキスト生成中 / tool 実行中
 *  - `completed`  : 全 session idle、ただし少なくとも 1 session が hasUnread
 *                   (= 完了後まだ pane で開かれていない)
 *  - `error`      : 任意 session で error (最優先)
 *
 * ## 優先度
 *
 * error > thinking > streaming > completed > idle
 *
 * session の thinking を streaming より上に倒したのは「思考中は UI 的に
 * 待たせていいステータス」で、streaming はその延長と位置付けるため。
 * (activity 側の優先順とは微妙に異なる: activity は tool_use を強調したい
 *  文脈だったが、project 集約では「何をしているかの種別」より「応答が
 *  動いているか」の方が重要なのでまとめる)
 */

/** Project 単位の集約 status。 */
export type ProjectStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "completed"
  | "error";

/**
 * session 側の status / activity kind から project 集約のための軽量 bucket
 * を返す。session store を直接 import すると型循環するため、caller が値を
 * string で渡す形に留める。
 */
export type SessionStatusBucket =
  | "idle"
  | "thinking"
  | "streaming"
  | "error";

/**
 * 集約ロジック。
 *
 * @param buckets  各 session の status bucket 配列
 * @param hasAnyUnread 任意 session が hasUnread=true か
 */
export function aggregateProjectStatus(
  buckets: SessionStatusBucket[],
  hasAnyUnread: boolean
): ProjectStatus {
  let hasError = false;
  let hasThinking = false;
  let hasStreaming = false;
  for (const b of buckets) {
    if (b === "error") hasError = true;
    else if (b === "thinking") hasThinking = true;
    else if (b === "streaming") hasStreaming = true;
  }
  if (hasError) return "error";
  if (hasThinking) return "thinking";
  if (hasStreaming) return "streaming";
  if (hasAnyUnread) return "completed";
  return "idle";
}
