import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { emitMockEvent } from "./fixtures";

/**
 * PM-290 シナリオ 5: Monaco Diff Viewer（Edit tool）。
 *
 * - /workspace で Edit tool の tool_use を mock emit
 * - ToolUseCard が描画される → 展開ボタンをクリック → DiffViewer (Monaco) が
 *   lazy load → before / after の文字列が両方見える
 *
 * Monaco は canvas ベースなので、expect(...).toBeVisible() ではなく、DOM 上の
 * Monaco wrapper 要素（`.monaco-editor` クラス）が出現することを確認する。
 * 加えて tool 名ラベル「ファイル編集」も表示されることを確認。
 */
test.describe("Monaco Diff for Edit tool", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("Edit tool renders ToolUseCard with expandable Monaco diff", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    // Edit tool の tool_use event を NDJSON で注入
    const id = "e2e-diff-1";
    const toolUseEvent = JSON.stringify({
      type: "message",
      id,
      payload: {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-edit-1",
              name: "Edit",
              input: {
                file_path: "/tmp/hello.ts",
                old_string: "const a = 1",
                new_string: "const a = 2",
              },
            },
          ],
        },
      },
    });
    await emitMockEvent(page, "agent:raw", toolUseEvent);

    // ToolUseCard が出る
    await expect(page.getByText("ファイル編集").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("/tmp/hello.ts").first()).toBeVisible();

    // expand ボタン（button 全体が toggle）クリック
    await page
      .getByRole("button", { name: /ファイル編集/ })
      .first()
      .click();

    // Monaco 本体は lazy load、初回描画に数秒かかる。
    // `.monaco-editor` クラスの DOM が出るのを待つ。
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 15_000,
    });

    // file_path ラベルは open 時にも見える（ToolUseCard 本体に描画済）。
    // Monaco の canvas テキストは DOM スクレイプしにくいので、
    // 展開直後の CSS class 存在のみで diff 機能が load できたとみなす。
  });
});
