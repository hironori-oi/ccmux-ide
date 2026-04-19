"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * WizardStep — WelcomeWizard の各ステップを包む共通ラッパ。
 *
 * - framer-motion の `motion.div` で左右スライド＋フェードのアニメーションを実現。
 * - enter: x=40 → 0、exit: x=0 → -40、duration 250ms（DEC-021 差別化軸 B「おしゃれ」
 *   を意識して控えめに）。
 * - 実際の `AnimatePresence` は親（WelcomeWizard）側に置き、ここはキー付き wrapper として
 *   振る舞う。
 */
export interface WizardStepProps {
  /** 一意キー（AnimatePresence 用） */
  stepKey: string;
  className?: string;
  children: React.ReactNode;
}

export function WizardStep({ stepKey, className, children }: WizardStepProps) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("w-full", className)}
    >
      {children}
    </motion.div>
  );
}
