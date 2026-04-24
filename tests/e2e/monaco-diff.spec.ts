import { test, expect } from "@playwright/test";
import { setupE2EPage, FIXTURE_WITH_ONE_SESSION } from "./helpers";
import { emitMockEvent } from "./fixtures";

/**
 * PM-290 シナリオ 5 / v3.3.1 Chunk B (S-1): Monaco Diff Viewer（Edit tool）。
 *
 * - 初期 project が登録された状態で /workspace を開く（FIXTURE_WITH_TEST_PROJECT）
 * - Edit tool の tool_use を `agent:${TEST_PROJECT_ID}:raw` で mock emit
 * - ToolUseCard が描画される → 展開ボタンをクリック → DiffViewer (Monaco) が
 *   lazy load → before / after の文字列が両方見える
 *
 * Monaco は canvas ベースなので、expect(...).toBeVisible() ではなく、DOM 上の
 * Monaco wrapper 要素（`.monaco-editor` クラス）が出現することを確認する。
 * 加えて tool 名ラベル「ファイル編集」も表示されることを確認。
 */
test.describe("Monaco Diff for Edit tool", () => {
  test.beforeEach(async ({ page }) => {
    // DEC-063 (v1.17.0): listener は session 単位 event を subscribe するため、
    // fixture に最低 1 session を含めておく必要がある。AGENT_RAW_EVENT 相当の
    // event は sess-existing-1 に向けて emit する。
    await setupE2EPage(page, FIXTURE_WITH_ONE_SESSION);
  });

  test("Edit tool renders ToolUseCard with expandable Monaco diff", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(600);

    // session を active pane に load しておく (listener が subscribe するのを待つ)
    // sess-existing-1 は FIXTURE_WITH_ONE_SESSION が seed する session。
    // SessionList の listbox option 経由で選択する (button role ではなく option role)。
    const sessionOption = page.getByRole("option", { name: /最初のセッション/ }).first();
    if (await sessionOption.count()) {
      await sessionOption.click();
    } else {
      // fallback: listbox item を tabindex で直接クリック
      await page.locator('[role="option"]').first().click().catch(() => {});
    }
    await page.waitForTimeout(400);

    // Edit tool の tool_use event を NDJSON で注入。DEC-063: event は session 単位。
    const id = "e2e-diff-1";
    const sessionRawEvent = "agent:sess-existing-1:raw";
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
    await emitMockEvent(page, sessionRawEvent, toolUseEvent);

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
    // v1.1.1 PM-946: Monaco の DOM は `<div class="monaco-editor">` を複数持つ
    // (`gutter monaco-editor` 内部 div は hidden)。`.monaco-diff-editor` を
    // target にすると diff 専用 root がヒットし、visible 判定が安定する。
    await expect(page.locator(".monaco-diff-editor").first()).toBeVisible({
      timeout: 15_000,
    });

    // file_path ラベルは open 時にも見える（ToolUseCard 本体に描画済）。
    // Monaco の canvas テキストは DOM スクレイプしにくいので、
    // 展開直後の CSS class 存在のみで diff 機能が load できたとみなす。
  });
});
