import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";

/**
 * PM-290 シナリオ 1: Welcome 画面。
 *
 * - `/` に見出し「ccmux-ide へようこそ」が表示される
 * - 3 つの機能カード（API Key / 権限 / サンプルプロジェクト）が見える
 * - 「始める」ボタンクリックで `/setup` に遷移する
 */
test.describe("Welcome", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("displays heading and 3 feature cards", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "ccmux-ide へようこそ" })
    ).toBeVisible();

    await expect(page.getByText("1. API Key を設定")).toBeVisible();
    await expect(page.getByText("2. 権限を確認")).toBeVisible();
    await expect(page.getByText("3. サンプルプロジェクトで試す")).toBeVisible();
  });

  test("clicking 始める navigates to /setup", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "始める" }).click();

    await expect(page).toHaveURL(/\/setup\/?$/);
  });
});
