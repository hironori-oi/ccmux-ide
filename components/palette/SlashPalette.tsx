"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Command as CommandIcon, Sparkles, Wrench, Package, Plug } from "lucide-react";

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
import { useEditorStore } from "@/lib/stores/editor";
import {
  handleBuiltinSlash,
  type BuiltinSlash,
} from "@/lib/builtin-slash";
import { cn } from "@/lib/utils";
import type { McpServerDef, PluginDef, SkillDef, SlashCmd } from "@/lib/types";

/**
 * PM-201 / PM-202: Slash command palette（`/` 検出時に InputArea の上に出す popup）。
 *
 * ## DEC-027 汎用化（v4 Chunk B）
 *
 * 旧版で持っていた **組織ロール（/ceo /dev 等）の特別扱い** は完全に削除した。
 * グルーピングは「スコープ（Cwd / Project / Global）」のみ、上から順に
 * Cwd → Project → Global で表示し、各グループ内は alphabetical（Rust 側で
 * source_rank → name ASC に sort 済）。
 *
 * ## v3.4.9: 組込 slash merge
 *
 * Claude Code の組込 slash（`/mcp` `/clear` `/model` `/init` `/help` `/compact`
 * `/config`）を最上部の「組込コマンド」group として常に表示する。従来は
 * `InputArea.handleSend` の `handleBuiltinSlash` intercept でしか発火しないため
 * 素人ユーザーには発見性が無かった問題の解消（PM-760 候補からの先行着手）。
 *
 * - 取得: `invoke("list_builtin_slashes")` を open 時に 1 回（cache）
 * - 分類: source="builtin" の専用 group、scope 2 種（project/global）より上
 * - 選択時の挙動:
 *   - builtin → `handleBuiltinSlash("/name", ctx)` を呼び、成功なら palette を
 *     close（textarea クリアは InputArea 側で既存経路が必要。今回は palette 側で
 *     dispatch するため、SlashPalette の `onSelect` は builtin では **呼ばない**
 *     パターンに分岐。InputArea の挿入経路は走らない）
 *   - custom → 従来通り `onSelect(cmd)` で InputArea に挿入（`/` 断片を置換）
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
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anchorRef: React.RefObject<any>;
}

/**
 * source 表示メタ（badge ラベル + 色クラス + グループ見出し）。
 *
 * v3.4.9: `"builtin"` を追加（組込 slash、`BuiltinSlash` を custom と統一表示するため）。
 * v1.3 PM-953: `"skill"` を追加（Claude Code skill の section、選択で SKILL.md preview）。
 * v1.3 PM-954: `"plugin"` を追加（Claude Code plugin の section、選択で plugin.json preview）。
 * v1.4 PM-955: `"mcp"` を追加（Claude Code MCP server の section、選択で設定ファイル preview）。
 */
type SlashSource = SlashCmd["source"] | "builtin" | "skill" | "plugin" | "mcp";

const SOURCE_META: Record<
  SlashSource,
  { badge: string; heading: string; className: string }
> = {
  builtin: {
    badge: "builtin",
    heading: "組込コマンド",
    className:
      "border-orange-400/40 bg-orange-500/10 text-orange-600 dark:text-orange-300",
  },
  skill: {
    badge: "skill",
    heading: "スキル (Claude Code skills)",
    className:
      "border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  plugin: {
    badge: "plugin",
    heading: "プラグイン (Claude Code plugins)",
    className:
      "border-sky-400/40 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  mcp: {
    badge: "mcp",
    heading: "MCP サーバ (Model Context Protocol)",
    className:
      "border-emerald-400/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  project: {
    badge: "project",
    heading: "プロジェクト",
    className:
      "border-green-400/40 bg-green-500/10 text-green-600 dark:text-green-300",
  },
  global: {
    badge: "global",
    heading: "グローバル (~/.claude)",
    className:
      "border-blue-400/40 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
};

/**
 * PM-955: MCP server の scope 表示ラベル（日本語）。description 合成で使う。
 * McpServerDef.scope は Rust 側 5 値のいずれか。
 */
const MCP_SCOPE_LABEL: Record<McpServerDef["scope"], string> = {
  global: "グローバル",
  user: "ユーザー",
  "user-project": "ユーザー(プロジェクト別)",
  plugin: "プラグイン",
  project: "プロジェクト",
};

/** スコープ表示順（builtin → skill → plugin → mcp → project → global）。
 *  DEC-051: "cwd" scope は廃止。 */
const SCOPE_ORDER: SlashSource[] = [
  "builtin",
  "skill",
  "plugin",
  "mcp",
  "project",
  "global",
];

/**
 * パレット表示上限（builtin / custom 合算）。
 *
 * 10 件を超える場合は「...」行を末尾に出す（v3.4.9 要件）。
 */
const PALETTE_LIMIT = 10;

/** builtin を SlashCmd 互換に正規化したアイテム。 */
interface BuiltinSlashItem {
  name: string;
  description: string;
  action: BuiltinSlash["action"];
  source: "builtin";
}

/**
 * PM-953: skill アイテム（SkillDef を Palette 内部表現に包む）。
 *
 * name は `/` プレフィックスを付けず skill 名そのまま（`/slash` と区別するため）。
 * Phase 1 では選択時に SKILL.md を Monaco で preview するだけで、textarea への
 * 挿入や sidecar への命令は行わない。
 */
interface SkillItem {
  /** skill 識別名（`/` プレフィックス無し） */
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  /** skill の出自スコープ（badge には使わないが、検索やログ出力用に保持） */
  originalSource: SkillDef["source"];
  source: "skill";
}

/**
 * PM-954: plugin アイテム（PluginDef を Palette 内部表現に包む）。
 *
 * plugin は `<name>@<marketplace>` の ID を持ち、内部に slash / skill / agent /
 * MCP / hooks をバンドルする。Phase 1 では選択時に plugin.json を Monaco で
 * preview し、toast で件数概況を表示するだけ。Phase 2 で enable/disable toggle
 * や内部 commands のドリルダウン UI を予定。
 */
interface PluginItem {
  /** plugin ID（`<name>@<marketplace>`、表示は `name`）*/
  id: string;
  /** plugin 名（description と区別して badge 脇に表示） */
  name: string;
  /** 1 行要約 */
  description: string;
  /** manifest の絶対パス（click で Monaco 表示） */
  manifestPath: string;
  /** 有効無効（disabled は行を dimm する） */
  enabled: boolean;
  /** 内部件数（commands / skills / agents / mcp / hooks） */
  commandCount: number;
  skillCount: number;
  agentCount: number;
  hasMcp: boolean;
  hasHooks: boolean;
  source: "plugin";
}

/**
 * PM-955: MCP server アイテム（McpServerDef を Palette 内部表現に包む）。
 *
 * MCP server は Claude Code が外部 tool に接続する仕組み。Phase 1 では選択時に
 * 設定ファイル (configPath) を Monaco で preview し、toast で scope / transport /
 * enabled 状態を表示する（実接続・tool 一覧の取得は Agent SDK の自動 load に
 * 委譲）。Phase 2 で sidecar 経由 `query.mcpServerStatus()` の live 表示、
 * Phase 3 で toggle UI / Add Server UI を追加予定。
 */
interface McpItem {
  name: string;
  /** UI 用の 1 行要約（transport + scope + plugin ID 等を合成） */
  description: string;
  /** scope / transport / 設定ファイル path（選択時 Monaco 対象） */
  originalScope: McpServerDef["scope"];
  transport: McpServerDef["transport"];
  configPath: string;
  url: string | null;
  command: string | null;
  pluginId: string | null;
  enabled: boolean;
  source: "mcp";
}

/**
 * 表示用の union item（builtin / skill / plugin / mcp / custom slash）。
 * 内部で filter / group に使う。
 */
type PaletteItem =
  | (SlashCmd & { kind: "custom" })
  | (BuiltinSlashItem & { kind: "builtin" })
  | (SkillItem & { kind: "skill" })
  | (PluginItem & { kind: "plugin" })
  | (McpItem & { kind: "mcp" });

interface GroupedItems {
  builtin: PaletteItem[];
  skill: PaletteItem[];
  plugin: PaletteItem[];
  mcp: PaletteItem[];
  project: PaletteItem[];
  global: PaletteItem[];
}

/**
 * スコープ別にグルーピングし、合計件数を上限 `limit` に抑える。
 *
 * 上限を超える場合は SCOPE_ORDER の優先度で詰める。
 * 戻り値には overflow（表示省略件数）も含める。
 */
function groupAndLimit(
  items: PaletteItem[],
  limit = PALETTE_LIMIT
): { grouped: GroupedItems; overflow: number } {
  const out: GroupedItems = {
    builtin: [],
    skill: [],
    plugin: [],
    mcp: [],
    project: [],
    global: [],
  };
  let remaining = limit;
  for (const scope of SCOPE_ORDER) {
    if (remaining <= 0) break;
    const bucket = items.filter((c) => {
      if (c.kind === "builtin") return scope === "builtin";
      if (c.kind === "skill") return scope === "skill";
      if (c.kind === "plugin") return scope === "plugin";
      if (c.kind === "mcp") return scope === "mcp";
      return c.source === scope;
    });
    const taken = bucket.slice(0, remaining);
    out[scope] = taken;
    remaining -= taken.length;
  }
  const shown = items.length > limit ? limit : items.length;
  const overflow = Math.max(0, items.length - shown);
  return { grouped: out, overflow };
}

/**
 * query にマッチするかの軽量判定（case-insensitive substring）。
 * builtin / skill / plugin / custom すべて name / description で hit 判定。
 * plugin は marketplace や keywords でも引っかかると便利なので id も拾う。
 */
function matchesQuery(item: PaletteItem, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const name = item.name.replace(/^\//, "").toLowerCase();
  let extra = "";
  if (item.kind === "plugin") {
    extra = item.id.toLowerCase();
  } else if (item.kind === "mcp") {
    // mcp は transport / scope / pluginId も fuzzy search で引っかかると便利
    extra = `${item.transport} ${item.originalScope} ${item.pluginId ?? ""}`.toLowerCase();
  }
  return (
    name.includes(lower) ||
    item.description.toLowerCase().includes(lower) ||
    item.name.toLowerCase().includes(lower) ||
    (extra.length > 0 && extra.includes(lower))
  );
}

export function SlashPalette({
  query,
  open,
  onClose,
  onSelect,
  anchorRef,
}: SlashPaletteProps) {
  const [customCmds, setCustomCmds] = useState<SlashCmd[]>([]);
  const [builtinCmds, setBuiltinCmds] = useState<BuiltinSlashItem[]>([]);
  // PM-953: Claude Code skills（~/.claude/skills/ + project .claude/skills/）
  const [skills, setSkills] = useState<SkillItem[]>([]);
  // PM-954: Claude Code plugins（~/.claude/plugins/installed_plugins.json 経由）
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  // PM-955: Claude Code MCP servers（5 スコープ統合、Phase 1 = 表示のみ）
  const [mcpServers, setMcpServers] = useState<McpItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // active project path を slash scan の `project_path` 引数として渡す。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath = useMemo(() => {
    const found = findProjectById(projects, activeProjectId);
    return found?.path ?? null;
  }, [projects, activeProjectId]);

  // builtin dispatcher が要求する context
  const router = useRouter();

  // PM-953: skill 選択時は Monaco で SKILL.md を preview する（Phase 1）
  const openFileInEditor = useEditorStore((s) => s.openFile);

  // キャッシュ invalidation キー: activeProjectPath が変わったら再取得。
  const lastFetchKeyRef = useRef<string | null>(null);
  // builtin は project 非依存なので 1 回だけ取得
  const builtinLoadedRef = useRef(false);
  // skill も slash と同じく activeProjectPath に依存するので cache key を持つ
  const lastSkillFetchKeyRef = useRef<string | null>(null);
  // PM-954: plugin cache key（project 非依存だが、将来 project-level plugin を
  // 扱う余地を残すため skill と同型で管理する）
  const lastPluginFetchKeyRef = useRef<string | null>(null);
  // PM-955: MCP server cache key（activeProjectPath 依存 — project-local .mcp.json
  // と ~/.claude.json の projects[abs].mcpServers が project 別に変わるため）
  const lastMcpFetchKeyRef = useRef<string | null>(null);

  // builtin は open 初回のみ取得（project に依存しない固定 7 件 + frontend 追加分）
  useEffect(() => {
    if (!open || builtinLoadedRef.current) return;
    let cancelled = false;
    callTauri<BuiltinSlash[]>("list_builtin_slashes")
      .then((list) => {
        if (cancelled) return;
        const fromRust: BuiltinSlashItem[] = list.map((b) => ({
          name: b.name,
          description: b.description,
          action: b.action,
          source: "builtin" as const,
        }));
        // v3.5.18 PM-840 派生: `/effort` は frontend 限定の builtin として追加
        // （Rust 側 `list_builtin_slashes` には含めず、handler は handleBuiltinSlash で routing）
        const frontendOnly: BuiltinSlashItem[] = [
          {
            name: "/effort",
            description: "推論工数（thinking tokens）を切替",
            action: "open_effort_picker",
            source: "builtin" as const,
          },
        ];
        // 既に Rust 側にも `/effort` があれば重複を避ける（将来 backend に移管した場合の保険）
        const existing = new Set(fromRust.map((b) => b.name));
        const merged = [
          ...fromRust,
          ...frontendOnly.filter((b) => !existing.has(b.name)),
        ];
        setBuiltinCmds(merged);
        builtinLoadedRef.current = true;
      })
      .catch(() => {
        // builtin 取得失敗は UI 上は silent（custom だけ表示継続）
        // Tauri 未対応環境（SSR 等）でも frontend 追加分だけは見せる
        if (cancelled) return;
        setBuiltinCmds([
          {
            name: "/effort",
            description: "推論工数（thinking tokens）を切替",
            action: "open_effort_picker",
            source: "builtin" as const,
          },
        ]);
        builtinLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const key = activeProjectPath ?? "__no_project__";
    // キャッシュがあって key 不変なら再取得しない
    if (customCmds.length > 0 && lastFetchKeyRef.current === key) {
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
        setCustomCmds(list);
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
    // customCmds を deps に含めると無限ループ、意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectPath]);

  // PM-953: Claude Code skills を取得。slash と同じく activeProjectPath が
  // 変わるたびに再取得する。失敗時は silent（UI 側で空として扱う）。
  useEffect(() => {
    if (!open) return;

    const key = activeProjectPath ?? "__no_project__";
    if (skills.length > 0 && lastSkillFetchKeyRef.current === key) {
      return;
    }

    let cancelled = false;
    callTauri<SkillDef[]>("list_skills", {
      projectPath: activeProjectPath,
    })
      .then((list) => {
        if (cancelled) return;
        const normalized: SkillItem[] = list.map((s) => ({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          dirPath: s.dirPath,
          originalSource: s.source,
          source: "skill" as const,
        }));
        setSkills(normalized);
        lastSkillFetchKeyRef.current = key;
      })
      .catch(() => {
        // skill 取得失敗は silent。builtin / custom slash の機能は継続する。
        if (cancelled) return;
        setSkills([]);
        lastSkillFetchKeyRef.current = key;
      });

    return () => {
      cancelled = true;
    };
    // skills を deps に含めると無限ループ、意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectPath]);

  // PM-954: Claude Code plugins を取得。`~/.claude/plugins/installed_plugins.json`
  // は project 非依存だが、将来 project-level plugin をサポートする余地のため
  // skill と同じパターンで invalidate する。失敗時は silent（UI 側で空扱い）。
  useEffect(() => {
    if (!open) return;

    const key = activeProjectPath ?? "__no_project__";
    if (plugins.length > 0 && lastPluginFetchKeyRef.current === key) {
      return;
    }

    let cancelled = false;
    callTauri<PluginDef[]>("list_plugins", {
      projectPath: activeProjectPath,
    })
      .then((list) => {
        if (cancelled) return;
        const normalized: PluginItem[] = list.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          manifestPath: p.manifestPath,
          enabled: p.enabled,
          commandCount: p.commandCount,
          skillCount: p.skillCount,
          agentCount: p.agentCount,
          hasMcp: p.hasMcp,
          hasHooks: p.hasHooks,
          source: "plugin" as const,
        }));
        setPlugins(normalized);
        lastPluginFetchKeyRef.current = key;
      })
      .catch(() => {
        // plugin 取得失敗は silent（slash / skill / builtin は継続表示）
        if (cancelled) return;
        setPlugins([]);
        lastPluginFetchKeyRef.current = key;
      });

    return () => {
      cancelled = true;
    };
    // plugins を deps に含めると無限ループ、意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectPath]);

  // PM-955: Claude Code MCP servers を取得。plugin と同じく、project 依存のため
  // activeProjectPath ごとに invalidate する。失敗時は silent（UI 側で空扱い）。
  useEffect(() => {
    if (!open) return;

    const key = activeProjectPath ?? "__no_project__";
    if (mcpServers.length > 0 && lastMcpFetchKeyRef.current === key) {
      return;
    }

    let cancelled = false;
    callTauri<McpServerDef[]>("list_mcp_servers", {
      projectPath: activeProjectPath,
    })
      .then((list) => {
        if (cancelled) return;
        const normalized: McpItem[] = list.map((m) => {
          // description 合成: transport + scope + (stdio なら command、http/sse なら url)
          const scopeLabel = MCP_SCOPE_LABEL[m.scope] ?? m.scope;
          const dest =
            m.transport === "stdio"
              ? m.command ?? "(no command)"
              : m.url ?? "(no url)";
          const pluginSuffix = m.pluginId ? ` · ${m.pluginId}` : "";
          const description = `${m.transport} · ${scopeLabel} · ${dest}${pluginSuffix}`;
          return {
            name: m.name,
            description,
            originalScope: m.scope,
            transport: m.transport,
            configPath: m.configPath,
            url: m.url,
            command: m.command,
            pluginId: m.pluginId,
            enabled: m.enabled,
            source: "mcp" as const,
          };
        });
        setMcpServers(normalized);
        lastMcpFetchKeyRef.current = key;
      })
      .catch(() => {
        // MCP 取得失敗は silent（他 section は継続表示）
        if (cancelled) return;
        setMcpServers([]);
        lastMcpFetchKeyRef.current = key;
      });

    return () => {
      cancelled = true;
    };
    // mcpServers を deps に含めると無限ループ、意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectPath]);

  // builtin + skill + plugin + mcp + custom を PaletteItem に正規化し、query filter → group → limit
  const { grouped, overflow } = useMemo(() => {
    const merged: PaletteItem[] = [
      ...builtinCmds.map((b) => ({ ...b, kind: "builtin" as const })),
      ...skills.map((s) => ({ ...s, kind: "skill" as const })),
      ...plugins.map((p) => ({ ...p, kind: "plugin" as const })),
      ...mcpServers.map((m) => ({ ...m, kind: "mcp" as const })),
      ...customCmds.map((c) => ({ ...c, kind: "custom" as const })),
    ];
    const filtered = merged.filter((c) => matchesQuery(c, query));
    return groupAndLimit(filtered, PALETTE_LIMIT);
  }, [builtinCmds, skills, plugins, mcpServers, customCmds, query]);

  const totalShown =
    grouped.builtin.length +
    grouped.skill.length +
    grouped.plugin.length +
    grouped.mcp.length +
    grouped.project.length +
    grouped.global.length;
  const isEmpty = totalShown === 0;

  /**
   * builtin 選択時: `handleBuiltinSlash` を直接呼んで action を発火。
   *
   * - `workspaceRoot` は activeProjectPath を採用（/init で必須、未選択なら
   *   dispatcher 側が toast error を出す設計）
   * - 成功 / 失敗の両方で palette は close する（dispatcher 内で toast 発火）
   * - InputArea の textarea クリアは呼ばない（`/`断片がそのまま残るが、
   *   slash が intercept 相当で画面遷移 / dialog が出るため違和感は最小）。
   *   将来 `onSelect` を builtin 用に拡張したい場合は勘案。
   *
   * v1.24.0 (DEC-070): `passthrough_to_sdk` action（例: `/chrome`）は intercept
   * せず、通常 prompt として送信させたいため textarea に slash 名を挿入する
   * （カスタム slash と同じ経路、`onSelect` 呼出で `/chrome ` に置換）。
   */
  function handleBuiltinClick(item: BuiltinSlashItem) {
    if (item.action === "passthrough_to_sdk") {
      // textarea に slash 名を挿入して、ユーザーが Ctrl+Enter で sidecar に送る。
      // SlashCmd 互換 shape を渡せば InputArea 側 `onSlashSelect` が適切に動く。
      // 実際に使われるのは name のみ（replaceSlashFragment は name で置換する）。
      const insertable: SlashCmd = {
        name: item.name,
        description: item.description,
        source: "global",
        filePath: "",
        argumentHint: null,
      };
      onSelect(insertable);
      onClose();
      return;
    }
    try {
      const consumed = handleBuiltinSlash(item.name, {
        router,
        toast,
        workspaceRoot: activeProjectPath,
      });
      if (!consumed) {
        toast.message(
          `組込コマンド ${item.name} はまだ対応していません（近日対応予定）。`
        );
      }
    } catch (e) {
      toast.error(
        `組込コマンドの実行に失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      onClose();
    }
  }

  /**
   * PM-953 (Phase 1): skill 選択時のハンドラ。
   *
   * PM-966 / DEC-055: Claude Agent SDK の `settingSources: ['user', 'project', 'local']`
   * オプション（Rust `send_agent_prompt` から毎回注入）により、SDK が
   * `~/.claude/skills/` と `<project>/.claude/skills/` を自動で discover して
   * session に登録する。Sumi 側ではこのクリックで:
   *  - SKILL.md を Monaco で開いて内容を確認できるようにする
   *  - toast で「次回プロンプト送信時に Claude が読み込みます」と案内
   *
   * そのため skill を事前にクリックしなくても、チャットで `/ceo` のような呼び出し
   * をすれば SDK 側が skill を識別してくれる。クリックは「中身を確認したい時」用。
   */
  function handleSkillClick(item: SkillItem) {
    try {
      void openFileInEditor(item.filePath);
      toast.message(
        `スキル「${item.name}」の SKILL.md を開きました。次のプロンプト送信時に Claude が自動で読み込みます。`
      );
    } catch (e) {
      toast.error(
        `スキル定義ファイルを開けませんでした: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      onClose();
    }
  }

  /**
   * PM-954 (Phase 1): plugin 選択時のハンドラ。
   *
   * MVP では **実行しない**。Claude Agent SDK は `SdkPluginConfig` と
   * `reloadPlugins()` により plugin を first-class support するため、
   * 実行経路は sidecar 起動時の自動 load に委譲する。UI は:
   *  - plugin.json を Monaco で開いて内容を確認できるようにする
   *  - toast で enabled 状態 + 内部件数（commands / skills / agents / MCP /
   *    hooks の概況）を案内
   *
   * Phase 2（v1.4+）では enable/disable toggle、install/uninstall UI、plugin
   * 内部 commands のドリルダウン表示を追加する。
   */
  /**
   * PM-955 (Phase 1): MCP server 選択時のハンドラ。
   *
   * Phase 1 では **実行しない**。Claude Agent SDK が session 起動時に
   * `mcpServers` option 経由で自動 load するため、Sumi 側の役割は:
   *  - 設定ファイル (configPath) を Monaco で開いて内容確認
   *  - toast で scope / transport / enabled 状態 / 接続先を案内
   *
   * Phase 2 以降（v1.5+）では `query.mcpServerStatus()` を sidecar 経由で呼び、
   * 実接続の状態 (connected / failed / needs-auth / pending) と tool 一覧を
   * live で表示する。Phase 3 で enable/disable toggle / Add Server UI を追加。
   *
   * plugin 由来の MCP server は plugin manifest を同時に開くのが親切だが、
   * 現状 `configPath` が plugin の `.mcp.json` を指すため、その file を開くだけ
   * で plugin 構造も見えるため追加アクション不要。
   */
  function handleMcpClick(item: McpItem) {
    try {
      void openFileInEditor(item.configPath);
      const scopeLabel = MCP_SCOPE_LABEL[item.originalScope] ?? item.originalScope;
      const state = item.enabled ? "有効" : "無効";
      const dest =
        item.transport === "stdio"
          ? item.command ?? "(no command)"
          : item.url ?? "(no url)";
      const pluginSuffix = item.pluginId ? ` · plugin: ${item.pluginId}` : "";
      toast.message(
        `MCP「${item.name}」(${state} / ${item.transport} / ${scopeLabel}) を開きました [${dest}]${pluginSuffix}`
      );
    } catch (e) {
      toast.error(
        `MCP 設定ファイルを開けませんでした: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      onClose();
    }
  }

  function handlePluginClick(item: PluginItem) {
    try {
      void openFileInEditor(item.manifestPath);
      const parts: string[] = [];
      if (item.commandCount > 0) parts.push(`${item.commandCount} commands`);
      if (item.skillCount > 0) parts.push(`${item.skillCount} skills`);
      if (item.agentCount > 0) parts.push(`${item.agentCount} agents`);
      if (item.hasMcp) parts.push("MCP");
      if (item.hasHooks) parts.push("hooks");
      const detail = parts.length > 0 ? parts.join(", ") : "metadata only";
      const state = item.enabled ? "有効" : "無効";
      toast.message(
        `プラグイン「${item.name}」(${state}) の plugin.json を開きました [${detail}]`
      );
    } catch (e) {
      toast.error(
        `プラグイン manifest を開けませんでした: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      onClose();
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
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
            {loading && customCmds.length === 0 && builtinCmds.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                読込中...
              </div>
            )}
            {error && (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            )}
            {isEmpty &&
              !loading &&
              !error &&
              (customCmds.length > 0 ||
                builtinCmds.length > 0 ||
                skills.length > 0 ||
                plugins.length > 0 ||
                mcpServers.length > 0) && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  一致するコマンドはありません
                </div>
              )}
            {isEmpty &&
              !loading &&
              !error &&
              customCmds.length === 0 &&
              builtinCmds.length === 0 &&
              skills.length === 0 &&
              plugins.length === 0 &&
              mcpServers.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  コマンド / スキル / プラグイン / MCP が見つかりません（~/.claude/commands/ に .md、~/.claude/skills/&lt;name&gt;/SKILL.md、~/.claude/plugins/installed_plugins.json、または .mcp.json を配置してください）
                </div>
              )}

            {SCOPE_ORDER.map((scope, idx) => {
              const items = grouped[scope];
              if (items.length === 0) return null;
              const meta = SOURCE_META[scope];
              const showSep =
                idx > 0 &&
                SCOPE_ORDER.slice(0, idx).some(
                  (s) => grouped[s].length > 0
                );
              return (
                <div key={scope}>
                  {showSep && <CommandSeparator />}
                  <CommandGroup heading={meta.heading}>
                    {items.map((item) => (
                      <PaletteRow
                        key={`${item.kind}:${item.name}`}
                        item={item}
                        onSelect={() => {
                          if (item.kind === "builtin") {
                            handleBuiltinClick(item);
                          } else if (item.kind === "skill") {
                            handleSkillClick(item);
                          } else if (item.kind === "plugin") {
                            handlePluginClick(item);
                          } else if (item.kind === "mcp") {
                            handleMcpClick(item);
                          } else {
                            onSelect(item);
                            onClose();
                          }
                        }}
                      />
                    ))}
                  </CommandGroup>
                </div>
              );
            })}

            {overflow > 0 && (
              <div className="px-3 py-2 text-center text-[10px] text-muted-foreground/70">
                ほか {overflow} 件...（絞り込みで検索）
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 1 行分の CommandItem。アイコン / name / description / argument-hint / source badge。
 *
 * builtin / custom 両方を 1 コンポーネントで描画する（badge 色だけ変わる）。
 */
function PaletteRow({
  item,
  onSelect,
}: {
  item: PaletteItem;
  onSelect: () => void;
}) {
  const simple = item.name.replace(/^\//, "");
  const isBuiltin = item.kind === "builtin";
  const isSkill = item.kind === "skill";
  const isPlugin = item.kind === "plugin";
  const isMcp = item.kind === "mcp";
  // source badge: skill / plugin / mcp は scope 非表示で固定 label を使う
  const source: SlashSource = isBuiltin
    ? "builtin"
    : isSkill
    ? "skill"
    : isPlugin
    ? "plugin"
    : isMcp
    ? "mcp"
    : item.source;
  const meta = SOURCE_META[source];

  // PM-954: plugin の場合は id（marketplace 含む）も cmdk value に入れて fuzzy
  // search を効かせる。PM-955: mcp は transport / scope / pluginId も cmdk value に。
  let cmdkValue: string;
  if (isPlugin) {
    cmdkValue = `${item.id} ${item.name} ${item.description}`;
  } else if (isMcp) {
    cmdkValue = `${item.name} ${item.transport} ${item.originalScope} ${item.pluginId ?? ""} ${item.description}`;
  } else {
    cmdkValue = `${item.name} ${simple} ${item.description}`;
  }

  // argument-hint は custom のみ（builtin / skill / plugin / mcp は引数なし）
  const argumentHint =
    item.kind === "custom" ? item.argumentHint ?? null : null;

  // PM-953: skill は `/` プレフィックス無しで表示する（slash と区別するため）
  // PM-954: plugin も `/` プレフィックス無し（marketplace 付き ID ではなく短い name を表示）
  // PM-955: mcp も `/` プレフィックス無し（server 名そのまま）
  const displayName = item.name;

  // PM-954: plugin の description が空の場合、内部件数や keywords で補助する
  let descriptionLine = item.description;
  if (isPlugin && !descriptionLine) {
    const parts: string[] = [];
    if (item.commandCount > 0) parts.push(`${item.commandCount} commands`);
    if (item.skillCount > 0) parts.push(`${item.skillCount} skills`);
    if (item.agentCount > 0) parts.push(`${item.agentCount} agents`);
    if (item.hasMcp) parts.push("MCP");
    if (item.hasHooks) parts.push("hooks");
    descriptionLine = parts.length > 0 ? parts.join(" · ") : "";
  }

  // icon: builtin=Wrench / skill=Sparkles / plugin=Package / mcp=Plug / slash=Command
  const Icon = isBuiltin
    ? Wrench
    : isSkill
    ? Sparkles
    : isPlugin
    ? Package
    : isMcp
    ? Plug
    : CommandIcon;

  // accent color: plugin=sky / mcp=emerald（badge と統一）
  const iconColorClass = isBuiltin
    ? "text-orange-600 dark:text-orange-400"
    : isSkill
    ? "text-amber-600 dark:text-amber-400"
    : isPlugin
    ? "text-sky-600 dark:text-sky-400"
    : isMcp
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-orange-500";
  const nameColorClass = isSkill
    ? "text-amber-600 dark:text-amber-400"
    : isPlugin
    ? "text-sky-600 dark:text-sky-400"
    : isMcp
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-orange-500";

  // PM-954: disabled plugin、PM-955: disabled mcp を UI 上で dimm する。
  // 選択は可能、Agent SDK は session 起動時に load しない / tool を call しない。
  const disabledDimm =
    (isPlugin && !item.enabled) || (isMcp && !item.enabled);

  return (
    <CommandItem
      value={cmdkValue}
      onSelect={onSelect}
      className={cn(
        "items-start gap-2 py-2",
        disabledDimm && "opacity-60"
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", iconColorClass)}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn("font-mono text-sm font-semibold", nameColorClass)}
          >
            {displayName}
          </span>
          {argumentHint && (
            <span className="truncate text-xs text-muted-foreground">
              {argumentHint}
            </span>
          )}
          {((isPlugin && !item.enabled) || (isMcp && !item.enabled)) && (
            <span className="shrink-0 rounded border border-muted-foreground/30 px-1 py-0 text-[9px] uppercase text-muted-foreground">
              disabled
            </span>
          )}
        </div>
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {descriptionLine || "（説明なし）"}
        </span>
      </div>
      <span
        className={cn(
          "ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          meta.className
        )}
      >
        {meta.badge}
      </span>
    </CommandItem>
  );
}
