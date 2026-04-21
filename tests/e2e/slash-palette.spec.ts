import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { FIXTURE_WITH_TEST_PROJECT } from "./fixtures";

/**
 * PM-290 シナリオ 7: Slash Palette。
 *
 * - /workspace で textarea に `/` を入力 → SlashPalette（Popover）が開く
 * - mock 側の slash（/ceo / /dev / /pm、いずれも source=global）が表示される
 * - `/ceo` を選択 → textarea が `/ceo ` に置換される（末尾空白あり）
 *
 * DEC-027 v4 Chunk B 以降、グルーピングは「組織」/「その他」ではなく
 * スコープ（カレント / プロジェクト / グローバル）のみ。fixture が global
 * 固定なので「グローバル (~/.claude)」見出しが出る前提で検証する。
 *
 * v1.1 PM-938 / v1.1.1 PM-946: Welcome 撤去後、textarea の placeholder は
 * activeProjectId が null だと「プロジェクトを選択してください...」に切替わり
 * `/メッセージを入力/` 正規表現に match しない。`FIXTURE_WITH_TEST_PROJECT` で
 * project 登録 + active を事前に行うことで textarea を正規形に固定する。
 */
test.describe("Slash Palette", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT);
  });

  test("typing / opens palette, selecting /ceo injects into textarea", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    const textarea = page.getByPlaceholder(/メッセージを入力/);
    await expect(textarea).toBeVisible();

    await textarea.click();
    // pressSequentially で 1 文字ずつ入力することで、React の onChange / caret
    // 更新を確実に発火させる（fill は元の value を一括置換するため、
    // `onCaretMove` が拾いきれないケースがある）。
    await textarea.pressSequentially("/");

    // Popover の中身を待つ。スコープ見出し「グローバル」が見える。
    await expect(page.getByText(/グローバル/).first()).toBeVisible({
      timeout: 5_000,
    });

    // /ceo 行がある
    const ceoRow = page.getByText("/ceo", { exact: true }).first();
    await expect(ceoRow).toBeVisible();

    // ⌨ Arrow Down + Enter だと cmdk の item value mapping が必要で不安定。
    // CommandItem（parent）をクリックして選択させる。
    await ceoRow.click();

    // textarea が /ceo  で始まる（末尾空白あり）
    await expect(textarea).toHaveValue(/^\/ceo /);
  });
});
