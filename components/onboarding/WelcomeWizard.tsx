"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WizardStep } from "./WizardStep";
import { BrandIntroStep } from "./BrandIntroStep";
import { ApiKeyStep } from "./ApiKeyStep";
import { PermissionsStep } from "./PermissionsStep";
import { SampleProjectStep } from "./SampleProjectStep";

/**
 * WelcomeWizard — PM-120〜126 の Welcome 4 ステップ onboarding。
 *
 * 構成:
 *  1. BrandIntroStep   — ccmux-ide の 3 大価値
 *  2. ApiKeyStep       — Anthropic サインイン / API Key / スキップ
 *  3. PermissionsStep  — 操作範囲の確認
 *  4. SampleProjectStep— サンプル作成 or スキップ
 *
 * - framer-motion `AnimatePresence` で左右スライドのページ遷移。
 * - 進捗ドットを上部に表示（4 個）。
 * - 最終ステップでは Next ボタンを「始める」に切替。
 * - 最終ステップ完了で `/workspace` に遷移する。
 *
 * state は Zustand ではなく useState（DEC-026 準拠、揮発性のため）。
 */
export function WelcomeWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const steps = useMemo(() => {
    return [
      { key: "brand", node: <BrandIntroStep /> },
      {
        key: "apikey",
        node: <ApiKeyStep onContinue={() => setStep((s) => s + 1)} />,
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
