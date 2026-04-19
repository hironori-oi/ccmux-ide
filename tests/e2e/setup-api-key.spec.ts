import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { getInvokeLog } from "./fixtures";

/**
 * PM-290 シナリオ 2: Setup / API Key。
 *
 * - `/setup` を開く → BrandIntroStep が見える
 * - 「次へ」で ApiKeyStep へ
 * - 「スキップ」で PermissionsStep へ進み、最終的に /workspace へ
 *
 * Anthropic API への fetch は本物の verifyApiKey が発火するので、ApiKey 保存
 * そのものは「スキップ」経路で検証する（fetch mock は別途未対応 / OAuth もスキップ）。
 */
test.describe("Setup wizard / API Key", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("BrandIntro → ApiKey → Skip → Permissions → Sample → /workspace", async ({
    page,
  }) => {
    await page.goto("/setup");

    // Step 1: BrandIntro
    await expect(
      page.getByRole("heading", { name: "ccmux-ide でできること" })
    ).toBeVisible();

    // 「次へ」で ApiKeyStep
    await page.getByRole("button", { name: /次へ/ }).click();

    // Step 2: ApiKey
    await expect(
      page.getByRole("heading", { name: "Claude に接続する" })
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("sk-ant-...")
    ).toBeVisible();

    // スキップで次のステップへ
    await page.getByRole("button", { name: /スキップ/ }).click();

    // Step 3: Permissions
    await expect(
      page.getByRole("heading", { name: "Claude の操作範囲を確認" })
    ).toBeVisible();

    // 「次へ」で SampleProjectStep
    await page.getByRole("button", { name: /次へ/ }).click();

    // 最後のステップ → 「始める」で /workspace
    // SampleProjectStep は onComplete で router.push("/workspace")
    // 「始める」ボタンも同じ効果（WelcomeWizard の handleNext）
    await page.getByRole("button", { name: /始める/ }).click();

    await expect(page).toHaveURL(/\/workspace\/?$/);
  });

  test("saves API key via set_api_key when input matches sk-ant- prefix", async ({
    page,
  }) => {
    await page.goto("/setup");

    // Step 1 → Step 2
    await page.getByRole("button", { name: /次へ/ }).click();

    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-mock-test-key-12345");

    // 「接続テストして保存」押下 → set_api_key / get_api_key が呼ばれる
    // （Anthropic API fetch は実ネットで失敗するが、少なくとも set_api_key は先に呼ばれる）
    await page.getByRole("button", { name: /接続テスト|接続できました/ }).click();

    // set_api_key invocation のログを確認
    // 送信後すぐ fetch で失敗するため、その前に invoke が記録されているかを確認
    await page.waitForTimeout(500);
    const log = await getInvokeLog(page);
    const names = log.map((l) => l.cmd);
    expect(names).toContain("set_api_key");
  });
});
