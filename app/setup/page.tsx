import { WelcomeWizard } from "@/components/onboarding/WelcomeWizard";

/**
 * /setup — Welcome ウィザードのエントリポイント。
 *
 * PM-120〜126（Chunk C）で実装した `WelcomeWizard` をそのまま描画する。
 * 旧実装（3 択の認証選択 UI）は `components/onboarding/ApiKeyStep.tsx` に
 * 統合し、本ページは薄いラッパに縮退した。
 */
export default function SetupPage() {
  return <WelcomeWizard />;
}
