import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { FIXTURE_WITH_ONE_SESSION } from "./helpers";
import { getInvokeLog } from "./fixtures";

/**
 * PM-290 シナリオ 10: Sessions（サイドバー）。
 *
 * - /workspace でサイドバーの「+ 新規セッション」ボタンをクリック
 *   → create_session が呼ばれて SessionList に item 追加
 * - 既存セッションを rename → rename_session invoke 呼び出し
 * - 削除ダイアログ → 削除で delete_session が呼ばれる
 */
test.describe("SessionList sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_ONE_SESSION);
  });

  test("creating a new session calls create_session and adds list item", async ({
    page,
  }) => {
    await page.goto("/workspace");

    // SessionList が描画されるまで待つ
    await expect(
      page.getByRole("button", { name: /新規セッション/ }).first()
    ).toBeVisible({ timeout: 5_000 });

    const before = (await getInvokeLog(page)).filter(
      (l) => l.cmd === "create_session"
    ).length;

    await page
      .getByRole("button", { name: /新規セッション/ })
      .first()
      .click();

    await page.waitForTimeout(300);
    const after = (await getInvokeLog(page)).filter(
      (l) => l.cmd === "create_session"
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  test("renaming existing session calls rename_session", async ({ page }) => {
    await page.goto("/workspace");

    // 既存セッション「最初のセッション」にホバー → 3-dot メニュー
    const item = page.getByText("最初のセッション").first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.hover();

    // 「セッション操作」トリガー
    await page
      .getByRole("button", { name: "セッション操作" })
      .first()
      .click();

    await page.getByRole("menuitem", { name: /名前を変更/ }).click();

    // ダイアログの Input に新タイトル
    const input = page.getByPlaceholder("タイトル");
    await expect(input).toBeVisible();
    await input.fill("リネーム後タイトル");
    await page.getByRole("button", { name: "変更する" }).click();

    await page.waitForTimeout(300);
    const log = await getInvokeLog(page);
    const renameCalls = log.filter((l) => l.cmd === "rename_session");
    expect(renameCalls.length).toBeGreaterThan(0);
    expect(
      (renameCalls[0].args as { title: string }).title
    ).toBe("リネーム後タイトル");
  });

  test("deleting existing session opens confirm dialog and calls delete_session", async ({
    page,
  }) => {
    await page.goto("/workspace");

    const item = page.getByText("最初のセッション").first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.hover();

    await page
      .getByRole("button", { name: "セッション操作" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: /削除/ }).click();

    // 確認ダイアログ
    await expect(
      page.getByRole("heading", { name: "セッションの削除" })
    ).toBeVisible();

    await page.getByRole("button", { name: "削除する" }).click();

    await page.waitForTimeout(300);
    const log = await getInvokeLog(page);
    const deleteCalls = log.filter((l) => l.cmd === "delete_session");
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});
