import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { getInvokeLog } from "./fixtures";

/**
 * PM-290 シナリオ 6: Command Palette。
 *
 * - /workspace で Ctrl+K → Dialog が開く
 * - 「新規セッション」項目が見える
 * - クリックで `create_session` invoke が呼ばれる
 */
test.describe("Command Palette (Ctrl+K)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("opens on Ctrl+K and invokes create_session from 新規セッション", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    // Ctrl+K
    await page.keyboard.press("Control+K");

    // Dialog 内に CommandInput placeholder があるのを確認
    await expect(
      page.getByPlaceholder(/操作を検索/)
    ).toBeVisible();

    // 「新規セッション」項目（CommandShortcut ⌘⇧N が付く）
    await expect(page.getByText("新規セッション").first()).toBeVisible();

    await page.getByText("新規セッション").first().click();

    // create_session が呼ばれたはず
    await page.waitForTimeout(300);
    const log = await getInvokeLog(page);
    const names = log.map((l) => l.cmd);
    expect(names).toContain("create_session");
  });

  test("Escape closes the dialog", async ({ page }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    await page.keyboard.press("Control+K");
    await expect(page.getByPlaceholder(/操作を検索/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder(/操作を検索/)).not.toBeVisible();
  });
});
