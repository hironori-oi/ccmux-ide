"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Code,
  Command as CommandIcon,
  Crown,
  Eye,
  FileText,
  Globe,
  Megaphone,
  Search,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { callTauri } from "@/lib/tauri-api";
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import { cn } from "@/lib/utils";
import type { SlashCmd } from "@/lib/types";

/**
 * PM-201 / PM-202: Slash command palette（`/` 検出時に InputArea の上に出す popup）。
 *
 * 親が管理する `open` / `query` / `onSelect` を素直に受け取り、cmdk の fuzzy filter
 * で候補を絞る。以下の 2 軸でグループ化する:
 *  - **組織**: `ORGANIZATION_SLASHES`（`/ceo` `/dev` 等）を上段にまとめて表示、
 *    lucide アイコン + role 毎の色付けで識別しやすく
 *  - **その他**: グローバル / プロジェクト / cwd の .md ファイルから拾った slash
 *
 * cmdk の `value` には slash 名 + description を結合した文字列を入れておき、
 * キーワード検索時に description も match するようにする。filter は
 * shadcn/cmdk デフォルト（cmdk の commandScore）で十分。
 *
 * a11y: Radix Popover が `role="dialog"` + focus trap を提供する。Escape クローズ
 * は Popover onOpenChange 経由で親に通知する。
 */
export interface SlashPaletteProps {
  /** 現在の検索クエリ（InputArea の `/` 以降のフラグメント） */
  query: string;
  /** popup の open/close */
  open: boolean;
  /** close 要求（Esc or 外側クリック、or 選択後） */
  onClose: () => void;
  /** slash 選択時（InputArea 側で置換を行う） */
  onSelect: (cmd: SlashCmd) => void;
  /**
   * Popover の anchor（InputArea の textarea ラッパー要素）。
   *
   * 注意: Radix の `PopoverAnchor` は DOM element を `current` に持つ ref を期待する。
   * HTMLDivElement など具体型で OK、ここは最も緩い `HTMLElement` で受ける。
   * `null` 込みでも実行時に問題は出ない（Radix は `ref.current?.getBoundingClientRect`
   * として参照する）が、型的には RefObject の不変性で厳密一致が必要。
   * -> InputArea 側で `useRef<HTMLDivElement | null>(null)` を `as any` で
   * 渡しても良いが、ここでは型的に寛容なまま受ける。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anchorRef: React.RefObject<any>;
}

/** 組織 slash name → lucide アイコン のマッピング（name は先頭 `/` を除く）。 */
const ORG_ICONS: Record<string, LucideIcon> = {
  ceo: Crown,
  dev: Code,
  pm: ClipboardList,
  research: Search,
  review: Eye,
  secretary: FileText,
  marketing: Megaphone,
  "web-ops": Globe,
};

/** source badge の見た目（色クラス）。 */
const SOURCE_BADGE: Record<SlashCmd["source"], { label: string; className: string }> = {
  global: {
    label: "global",
    className:
      "border-blue-400/40 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  project: {
    label: "project",
    className:
      "border-green-400/40 bg-green-500/10 text-green-600 dark:text-green-300",
  },
  cwd: {
    label: "cwd",
    className:
      "border-purple-400/40 bg-purple-500/10 text-purple-600 dark:text-purple-300",
  },
};

/**
 * 組織 slash を先頭、その他を下段に分けたビュー用データ。
 * name は Rust 側で既に `/xxx` 形式、`is_organization` も埋まっている。
 */
interface GroupedCmds {
  org: SlashCmd[];
  other: SlashCmd[];
}

function groupAndLimit(cmds: SlashCmd[], limit = 10): GroupedCmds {
  const org = cmds.filter((c) => c.isOrganization);
  const other = cmds.filter((c) => !c.isOrganization);
  // PM-202: 組織 slash の並びは Rust 側で 8 役順に安定化済。
  // その他は alphabetical（Rust 側で name ASC）。
  // 組織で足切りせず、その他側のみ limit で抑える。組織 8 + その他 10 - 8 = min 10 を
  // 超えないように upper cap する。
  const capped = other.slice(0, Math.max(0, limit - org.length));
  return { org, other: capped };
}

/**
 * query にマッチするかの軽量判定（case-insensitive substring）。
 *
 * cmdk の内部 filter ではなく手動 filter を採用する理由:
 *  - `CommandInput` は sr-only で「表示しないが cmdk が active 扱いする」挙動
 *    を持たせるのが難しい（controlled にすると onValueChange を `setState` と
 *    合わせないと反映されず、state 二重管理になる）
 *  - query は親の textarea から来るので、ここでシンプルに絞り込んで渡す方が
 *    予測可能
 */
function matchesQuery(cmd: SlashCmd, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const name = cmd.name.replace(/^\//, "").toLowerCase();
  return (
    name.includes(lower) ||
    cmd.description.toLowerCase().includes(lower) ||
    cmd.name.toLowerCase().includes(lower)
  );
}

export function SlashPalette({
  query,
  open,
  onClose,
  onSelect,
  anchorRef,
}: SlashPaletteProps) {
  const [allCmds, setAllCmds] = useState<SlashCmd[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // active project path を slash scan の `project_path` 引数として渡す。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath = useMemo(() => {
    const found = findProjectById(projects, activeProjectId);
    return found?.path ?? null;
  }, [projects, activeProjectId]);

  // キャッシュ invalidation キー: activeProjectPath が変わったら再取得。
  const lastFetchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const key = activeProjectPath ?? "__no_project__";
    // キャッシュがあって key 不変なら再取得しない
    if (allCmds.length > 0 && lastFetchKeyRef.current === key) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    callTauri<SlashCmd[]>("list_slash_commands", {
      projectPath: activeProjectPath,
    })
      .then((list) => {
        if (cancelled) return;
        setAllCmds(list);
        lastFetchKeyRef.current = key;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // allCmds を deps に含めると無限ループ、意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectPath]);

  // 手動で query フィルタ → グループ化 → 件数カップを適用。
  const grouped = useMemo(() => {
    const filtered = allCmds.filter((c) => matchesQuery(c, query));
    return groupAndLimit(filtered, 10);
  }, [allCmds, query]);

  const isEmpty = grouped.org.length === 0 && grouped.other.length === 0;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      {/* anchorRef（InputArea の textarea wrapper）の bounding rect に対して
          popup を positioning する。`virtualRef` は Radix Popper の仕様どおり
          `getBoundingClientRect` を持つオブジェクトの ref を取る。 */}
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => {
          // textarea にフォーカスを残すため、popup 側にフォーカスを奪わせない
          e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          // 閉じるときも textarea フォーカスを維持する（InputArea 側で管理）
          e.preventDefault();
        }}
        className="w-[420px] max-w-[90vw] overflow-hidden p-0"
        aria-label="スラッシュコマンド候補"
      >
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2"
        >
          <CommandList className="max-h-[320px]">
            {loading && allCmds.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                読込中...
              </div>
            )}
            {error && (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            )}
            {isEmpty && !loading && !error && allCmds.length > 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                一致するコマンドはありません
              </div>
            )}
            {isEmpty && !loading && !error && allCmds.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                コマンドが見つかりません（~/.claude/commands/ に .md を配置してください）
              </div>
            )}

            {grouped.org.length > 0 && (
              <CommandGroup heading="組織">
                {grouped.org.map((cmd) => (
                  <SlashRow
                    key={`${cmd.source}:${cmd.name}`}
                    cmd={cmd}
                    onSelect={() => {
                      onSelect(cmd);
                      onClose();
                    }}
                  />
                ))}
              </CommandGroup>
            )}

            {grouped.org.length > 0 && grouped.other.length > 0 && (
              <CommandSeparator />
            )}

            {grouped.other.length > 0 && (
              <CommandGroup heading="その他">
                {grouped.other.map((cmd) => (
                  <SlashRow
                    key={`${cmd.source}:${cmd.name}`}
                    cmd={cmd}
                    onSelect={() => {
                      onSelect(cmd);
                      onClose();
                    }}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 1 行分の CommandItem。アイコン / name / description / argument-hint / source badge。
 */
function SlashRow({
  cmd,
  onSelect,
}: {
  cmd: SlashCmd;
  onSelect: () => void;
}) {
  const simple = cmd.name.replace(/^\//, "");
  const Icon: LucideIcon =
    (cmd.isOrganization && ORG_ICONS[simple]) || CommandIcon;
  const badge = SOURCE_BADGE[cmd.source];

  // cmdk の内部 fuzzy filter では `value` を対象にする。name と description の
  // 両方を結合して詰めることで description 含むキーワードでも hit する。
  const cmdkValue = `${cmd.name} ${simple} ${cmd.description}`;

  return (
    <CommandItem
      value={cmdkValue}
      onSelect={onSelect}
      className="items-start gap-2 py-2"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-orange-500"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-orange-500">
            {cmd.name}
          </span>
          {cmd.argumentHint && (
            <span className="truncate text-xs text-muted-foreground">
              {cmd.argumentHint}
            </span>
          )}
        </div>
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {cmd.description || "（説明なし）"}
        </span>
      </div>
      <span
        className={cn(
          "ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          badge.className
        )}
      >
        {badge.label}
      </span>
    </CommandItem>
  );
}
