"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowLeft, FolderTree, Globe, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SafeMonacoEditor } from "@/components/common/SafeMonacoEditor";
import { callTauri } from "@/lib/tauri-api";
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v4 / Chunk C / DEC-028: MCP サーバ設定画面（`/mcp` 遷移先）。
 *
 * 構成:
 * - shadcn `Tabs` で Global / Project を切替
 * - Monaco Editor で JSON を直接編集（DiffViewer と同じ dynamic import 戦略）
 * - 保存時にバリデーション（JSON.parse + Object 型チェック）→ Rust command に渡す
 *
 * Global は `~/.claude.json` の `mcpServers` セクション、
 * Project は `<workspace>/.mcp.json` 全体を編集する。
 *
 * ## 制約 / 申し送り
 * - Project タブは workspace 未選択時 disable（toast 案内）
 * - JSON parse エラー時は保存ボタンを無効化、編集中もリアルタイムでエラー表示
 * - 「ヘルパボタン（追加 / 削除）」は nice-to-have、JSON 直接編集で十分なため M3 後候補
 */

type Scope = "global" | "project";

const PLACEHOLDER_GLOBAL = `{
  "example-server": {
    "command": "node",
    "args": ["server.js"]
  }
}`;

const PLACEHOLDER_PROJECT = `{
  "mcpServers": {
    "example-server": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}`;

export default function McpSettingsPage() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs-light";

  // workspace_root の解決（プロジェクト未選択なら null）
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const workspaceRoot = useMemo(() => {
    const p = findProjectById(projects, activeProjectId);
    return p?.path ?? null;
  }, [projects, activeProjectId]);

  const [scope, setScope] = useState<Scope>("global");
  const [globalText, setGlobalText] = useState<string>("");
  const [projectText, setProjectText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // ---- 初期 load: Global は常に、Project は workspace 確定後に追加 fetch ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const g = await callTauri<unknown>("read_mcp_config", {
          scope: "global",
          workspaceRoot: null,
        });
        if (cancelled) return;
        setGlobalText(JSON.stringify(g ?? {}, null, 2));
      } catch (e) {
        if (!cancelled) {
          toast.error(`Global MCP 設定の読み込みに失敗: ${String(e)}`);
          setGlobalText(PLACEHOLDER_GLOBAL);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceRoot) {
      setProjectText("");
      return;
    }
    (async () => {
      try {
        const p = await callTauri<unknown>("read_mcp_config", {
          scope: "project",
          workspaceRoot,
        });
        if (cancelled) return;
        setProjectText(JSON.stringify(p ?? {}, null, 2));
      } catch (e) {
        if (!cancelled) {
          toast.error(`Project MCP 設定の読み込みに失敗: ${String(e)}`);
          setProjectText(PLACEHOLDER_PROJECT);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  // ---- バリデーション ----
  const currentText = scope === "global" ? globalText : projectText;
  const parseError = useMemo(() => validateJson(currentText), [currentText]);
  const canSave = !parseError && !loading && !busy;

  // Project タブが選ばれたが workspace 未選択 → toast 案内 & global へ戻す
  useEffect(() => {
    if (scope === "project" && !workspaceRoot) {
      toast.error(
        "プロジェクトが選択されていません。サイドバーからプロジェクトを開いてください。"
      );
      setScope("global");
    }
  }, [scope, workspaceRoot]);

  async function handleSave() {
    if (parseError) {
      toast.error(`JSON が不正です: ${parseError}`);
      return;
    }
    setBusy(true);
    try {
      const config = JSON.parse(currentText) as unknown;
      await callTauri<void>("write_mcp_config", {
        scope,
        workspaceRoot: scope === "project" ? workspaceRoot : null,
        config,
      });
      toast.success(
        `${scope === "global" ? "Global" : "Project"} MCP 設定を保存しました`
      );
    } catch (e) {
      toast.error(`保存に失敗: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    // PM-870: 背景画像 html::before を見せるため bg-background → bg-transparent。
    <div className="flex h-screen flex-col bg-transparent">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/settings");
            }
          }}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          戻る
        </Button>
        <h1 className="text-base font-semibold">MCP サーバ設定</h1>
      </header>

      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <p className="text-xs text-muted-foreground">
            Model Context Protocol サーバの設定を JSON で編集します。Global は{" "}
            <code className="rounded bg-muted px-1 py-0.5">~/.claude.json</code> の{" "}
            <code className="rounded bg-muted px-1 py-0.5">mcpServers</code> セクション、Project は{" "}
            <code className="rounded bg-muted px-1 py-0.5">&lt;workspace&gt;/.mcp.json</code> を対象とします。
          </p>

          <Tabs
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
            className="w-full"
          >
            <TabsList className="inline-flex">
              <TabsTrigger value="global" className="gap-2">
                <Globe className="h-4 w-4" aria-hidden />
                Global
              </TabsTrigger>
              <TabsTrigger
                value="project"
                disabled={!workspaceRoot}
                className="gap-2"
                title={workspaceRoot ?? "プロジェクト未選択（サイドバーから選択してください）"}
              >
                <FolderTree className="h-4 w-4" aria-hidden />
                Project
              </TabsTrigger>
            </TabsList>

            <TabsContent value="global" className="mt-4">
              <Card className="space-y-3 p-4">
                <SectionTitle
                  title={`~/.claude.json → mcpServers`}
                  hint="このファイルの mcpServers セクションだけを書き換えます。他キー（projects 等）は保持されます。"
                />
                <EditorWrap
                  loading={loading}
                  value={globalText}
                  onChange={setGlobalText}
                  theme={monacoTheme}
                  parseError={parseError}
                  scope="global"
                />
              </Card>
            </TabsContent>

            <TabsContent value="project" className="mt-4">
              <Card className="space-y-3 p-4">
                <SectionTitle
                  title={
                    workspaceRoot
                      ? `${workspaceRoot}/.mcp.json`
                      : ".mcp.json（プロジェクト未選択）"
                  }
                  hint="このファイルの全体を上書きします。新規作成も可能です。"
                />
                {workspaceRoot ? (
                  <EditorWrap
                    loading={loading}
                    value={projectText}
                    onChange={setProjectText}
                    theme={monacoTheme}
                    parseError={parseError}
                    scope="project"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    サイドバーからプロジェクトを開いてください。
                  </p>
                )}
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleSave} disabled={!canSave}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="break-all text-sm font-semibold">{title}</h2>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditorWrap({
  loading,
  value,
  onChange,
  theme,
  parseError,
  scope,
}: {
  loading: boolean;
  value: string;
  onChange: (v: string) => void;
  theme: string;
  parseError: string | null;
  scope: Scope;
}) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "overflow-hidden rounded border",
          parseError ? "border-destructive/50" : "border-border/50"
        )}
        style={{ height: 360 }}
      >
        {loading ? (
          <EditorSkeleton />
        ) : (
          <Suspense fallback={<EditorSkeleton />}>
            <SafeMonacoEditor
              height={360}
              language="json"
              value={value}
              theme={theme}
              onChange={(v) => onChange(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                tabSize: 2,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                wordWrap: "on",
              }}
            />
          </Suspense>
        )}
      </div>
      {parseError ? (
        <p className="text-xs text-destructive">JSON エラー: {parseError}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {scope === "global"
            ? "JSON Object（{ サーバ名: { command, args } }）形式で記述"
            : "JSON Object（mcpServers キーを内包）形式で記述"}
        </p>
      )}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-1/4" />
      <p className="mt-auto text-center text-xs text-muted-foreground">
        エディタを読み込み中...
      </p>
    </div>
  );
}

/**
 * 入力テキストが JSON Object として valid かを返す。
 *
 * - 戻り値 `null`  : OK
 * - 戻り値 string : エラー文言（UI に表示）
 *
 * 空文字は `{}` 扱い（保存時に Rust 側でも Object 必須なので `null` を返さない）。
 */
function validateJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null; // 空 = `{}` で良い
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "JSON Object（{ ... }）でなければなりません";
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
