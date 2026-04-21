"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Sparkles,
  Loader2,
  CheckCircle2,
  Layers,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { exists } from "@tauri-apps/plugin-fs";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { WizardStep } from "@/components/onboarding/WizardStep";
import { BrandIntroStep } from "@/components/onboarding/BrandIntroStep";
import { ApiKeyStep } from "@/components/onboarding/ApiKeyStep";
import { PermissionsStep } from "@/components/onboarding/PermissionsStep";
import { SampleProjectStep } from "@/components/onboarding/SampleProjectStep";

import {
  defaultWorkspaceRoot,
  detectClaudeCodeCompanyProjects,
  useProjectStore,
} from "@/lib/stores/project";

/**
 * /setup — Welcome ウィザードのエントリポイント。
 *
 * ## v3.2 Chunk A 改修（DEC-031: Workspace 概念撤去）
 *  - 旧「Workspace 選択」ステップは **「最初のプロジェクトを追加（任意）」**
 *    に改称（スキップ可）
 *  - `~/Desktop/claude-code-company` 検出時のみ専用パネルを出し、
 *    A: そのフォルダ自体を 1 プロジェクトとして追加
 *    B: 配下の `projects/PRJ-XXX/`（brief.md あり）を一括登録
 *    C: 無視してスキップ
 *    から選択（**自動登録はしない**）
 *  - `useWorkspaceStore` は削除されたため、`useProjectStore.registerProject`
 *    を直接呼ぶ
 *
 * 構成（5 ステップ）:
 *  1. BrandIntroStep
 *  2. ApiKeyStep
 *  3. FirstProjectStep ← v3.2 Chunk A 改修
 *  4. PermissionsStep
 *  5. SampleProjectStep
 */
export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const steps = useMemo(() => {
    return [
      { key: "brand", node: <BrandIntroStep /> },
      {
        key: "apikey",
        node: <ApiKeyStep onContinue={() => setStep((s) => s + 1)} />,
      },
      {
        key: "first-project",
        node: <FirstProjectStep onContinue={() => setStep((s) => s + 1)} />,
      },
      { key: "permissions", node: <PermissionsStep /> },
      {
        key: "sample",
        node: (
          <SampleProjectStep onComplete={() => router.push("/workspace")} />
        ),
      },
    ];
  }, [router]);

  const total = steps.length;
  const isFirst = step === 0;
  const isLast = step === total - 1;
  const current = steps[step];

  function handlePrev() {
    if (!isFirst) setStep(step - 1);
  }

  function handleNext() {
    if (isLast) {
      router.push("/workspace");
    } else {
      setStep(step + 1);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-6">
      <div className="w-full max-w-3xl space-y-6">
        {/* Progress dots */}
        <div
          className="flex items-center justify-center gap-2"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`ステップ ${step + 1} / ${total}`}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step
                  ? "w-8 bg-primary"
                  : i < step
                    ? "w-1.5 bg-primary/60"
                    : "w-1.5 bg-muted-foreground/30"
              )}
            />
          ))}
        </div>

        <Card className="overflow-hidden p-8 shadow-lg md:p-10">
          {/* Step content with slide transition */}
          <AnimatePresence mode="wait" initial={false}>
            <WizardStep key={current.key} stepKey={current.key}>
              {current.node}
            </WizardStep>
          </AnimatePresence>

          {/* Navigation buttons */}
          <div className="mt-8 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrev}
              disabled={isFirst}
              className="text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              戻る
            </Button>

            <span className="text-xs text-muted-foreground">
              {step + 1} / {total}
            </span>

            <Button size="sm" onClick={handleNext}>
              {isLast ? "始める" : "次へ"}
              {!isLast && <ChevronRight className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// FirstProjectStep — 最初のプロジェクトを追加（任意、スキップ可）
// ---------------------------------------------------------------------------

interface FirstProjectStepProps {
  onContinue: () => void;
}

/**
 * 最初のプロジェクトを追加するステップ（スキップ可能）。
 *
 * - マウント時に `~/Desktop/claude-code-company` の実在を確認
 *   - 存在すれば、配下の `projects/PRJ-XXX/` 候補一覧も先読みする
 * - **自動登録は行わない**（ユーザー操作でのみ確定）
 * - 選択肢:
 *   A. 「claude-code-company 自体を 1 プロジェクトとして追加」
 *   B. 「配下の PRJ-XXX を一括で個別プロジェクトとして登録」
 *   C. 「無視してスキップ」/「自分のフォルダを選ぶ」
 */
function FirstProjectStep({ onContinue }: FirstProjectStepProps) {
  const projects = useProjectStore((s) => s.projects);
  const registerProject = useProjectStore((s) => s.registerProject);

  const [ccc, setCcc] = useState<{
    path: string;
    exists: boolean;
    prjCandidates: { path: string; name: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // suggestion: ~/Desktop/claude-code-company + PRJ-XXX 候補の先読み
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await defaultWorkspaceRoot();
        if (cancelled) return;
        const ok = await exists(path);
        if (cancelled) return;
        if (!ok) {
          setCcc({ path, exists: false, prjCandidates: [] });
          return;
        }
        const prjCandidates = await detectClaudeCodeCompanyProjects(path);
        if (cancelled) return;
        setCcc({ path, exists: true, prjCandidates });
      } catch {
        if (!cancelled) setCcc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** A. claude-code-company 自体を 1 プロジェクトとして追加 */
  async function handleAddWhole() {
    if (!ccc?.exists) return;
    setBusy(true);
    try {
      const project = await registerProject(ccc.path);
      toast.success(`プロジェクトを追加しました: ${project.title}`);
      onContinue();
    } catch (e) {
      toast.error(`追加に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** B. 配下の PRJ-XXX を一括で個別プロジェクトとして登録 */
  async function handleBulkRegisterPrj() {
    if (!ccc?.exists || ccc.prjCandidates.length === 0) return;
    setBusy(true);
    try {
      let count = 0;
      for (const c of ccc.prjCandidates) {
        try {
          await registerProject(c.path, { activate: false });
          count++;
        } catch {
          // 個別失敗は skip
        }
      }
      toast.success(`${count} 件のプロジェクトを登録しました`);
      onContinue();
    } catch (e) {
      toast.error(`一括登録に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 自分のフォルダを選ぶ（任意ディレクトリ 1 つを追加） */
  async function handlePickCustom() {
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "プロジェクトに使うフォルダを選んでください",
      });
      if (typeof selected !== "string") {
        setBusy(false);
        return;
      }
      const project = await registerProject(selected);
      toast.success(`プロジェクトを追加しました: ${project.title}`);
      onContinue();
    } catch (e) {
      toast.error(`プロジェクトの選択に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** C. スキップ（登録せずに次へ） */
  function handleSkip() {
    toast.info("プロジェクトは未登録です。あとでサイドバーから追加できます。");
    onContinue();
  }

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          最初のプロジェクトを追加
        </h2>
        <p className="text-sm text-muted-foreground">
          任意のフォルダをプロジェクトとして登録できます。あとからいつでも
          追加・削除できるので、迷ったらスキップで構いません。
        </p>
        {hasProjects && (
          <p className="text-[11px] text-muted-foreground">
            現在 {projects.length} 件のプロジェクトが登録済みです
          </p>
        )}
      </div>

      <div className="space-y-3">
        {/* claude-code-company 検出パネル（実在時のみ、DEC-031） */}
        {ccc?.exists && (
          <Card className="space-y-3 p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold">
                  claude-code-company フォルダを検出しました
                </h3>
                <p
                  className="line-clamp-1 break-all text-xs leading-relaxed text-muted-foreground"
                  title={ccc.path}
                >
                  {ccc.path}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  どのように登録するかを選んでください（自動登録はしません）
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {/* A. 自体を 1 プロジェクト */}
              <Button
                size="sm"
                onClick={() => void handleAddWhole()}
                disabled={busy}
                className="flex-1"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                )}
                このフォルダを 1 つのプロジェクトとして追加
              </Button>

              {/* B. 配下 PRJ-XXX を一括登録 */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleBulkRegisterPrj()}
                disabled={busy || ccc.prjCandidates.length === 0}
                className="flex-1"
                title={
                  ccc.prjCandidates.length === 0
                    ? "配下に brief.md 付き PRJ-XXX が見つかりません"
                    : `配下の ${ccc.prjCandidates.length} 件を一括登録`
                }
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Layers className="h-4 w-4" aria-hidden />
                )}
                PRJ-XXX を一括登録
                {ccc.prjCandidates.length > 0 && (
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {ccc.prjCandidates.length}
                  </span>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* 任意フォルダを選ぶ */}
        <Card className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FolderTree className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-sm font-semibold">自分のフォルダを選ぶ</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                プロジェクトとして扱いたいフォルダを 1 つ選んでください。後から
                サイドバーの「+」ボタンで追加もできます。
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handlePickCustom()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FolderTree className="h-4 w-4" aria-hidden />
              )}
              フォルダを選択
            </Button>
          </div>
        </Card>

        {/* C. スキップ */}
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            disabled={busy}
            className="text-muted-foreground"
          >
            <SkipForward className="h-3.5 w-3.5" aria-hidden />
            スキップして後で追加
          </Button>
        </div>
      </div>
    </div>
  );
}
