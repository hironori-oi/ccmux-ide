import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";

/**
 * PM-290 シナリオ 9: Settings（`/settings`）。
 *
 * - 3 タブ（外観 / API Key / キーバインド）が並ぶ
 * - それぞれクリックで該当 SectionHeading が見える
 * - 外観タブの「ダーク」ラジオをクリック → `<html>` に `class="dark"` が付く
 */
test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("shows 3 tabs and switches content", async ({ page }) => {
    await page.goto("/settings");

    // 3 タブ
    await expect(page.getByRole("tab", { name: /外観/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /API Key/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /キーバインド/ })).toBeVisible();

    // 初期は外観
    await expect(
      page.getByRole("heading", { name: "外観" }).first()
    ).toBeVisible();

    // API Key タブへ
    await page.getByRole("tab", { name: /API Key/ }).click();
    await expect(
      page.getByRole("heading", { name: "API Key" }).first()
    ).toBeVisible();

    // キーバインドタブへ
    await page.getByRole("tab", { name: /キーバインド/ }).click();
    await expect(
      page.getByRole("heading", { name: "キーバインド" }).first()
    ).toBeVisible();
  });

  test("toggling theme to dark adds dark class to <html>", async ({ page }) => {
    await page.goto("/settings");

    // 外観タブに戻る（initial default だが念のため）
    await page.getByRole("tab", { name: /外観/ }).click();

    // 「ダーク」ボタンを押す
    await page.getByRole("radio", { name: /ダーク/ }).click();

    // next-themes が <html class="dark"> を設定するまで待つ
    await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 5_000 });
  });
});
