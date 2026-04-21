import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { FIXTURE_WITH_TEST_PROJECT, getInvokeLog } from "./fixtures";

/**
 * PM-290 シナリオ 6: Command Palette。
 *
 * - /workspace で Ctrl+K → Dialog が開く
 * - 「新規セッション」項目が見える
 * - クリックで `create_session` invoke が呼ばれる
 *
 * v1.1 PM-939 / v1.1.1 PM-946: `create_session` は activeProjectId が null だと
 * CommandItem 自体が disabled + Store 側で reject される。本 spec でも
 * `FIXTURE_WITH_TEST_PROJECT` を渡して project を登録済 / active 状態にする。
 */
test.describe("Command Palette (Ctrl+K)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT);
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

    // v1.1.1 PM-946: Welcome 撤去 + activeProjectId 登録後、sidebar の「新規
    // セッション」ボタンも enabled になるため、`getByText("新規セッション").first()`
    // は sidebar button を先に拾ってしまい、上に open しているコマンドパレット
    // dialog の overlay (`bg-black/80`) に pointer event を block される。
    // CommandPalette 内の CommandItem (role=option) に限定する。
    const paletteItem = page
      .getByRole("dialog")
      .getByRole("option", { name: /新規セッション/ });
    await expect(paletteItem).toBeVisible();
    await paletteItem.click();

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
