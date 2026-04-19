import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { getInvokeLog } from "./fixtures";

/**
 * PM-290 シナリオ 8: Search Palette。
 *
 * - /workspace で Ctrl+Shift+F → SearchPalette（Dialog）が開く
 * - 「claude」と入力 → debounce 200ms 後に `search_messages` invoke が呼ばれる
 * - 結果リストに snippet が表示される（FIXTURE で 1 件だけ返すよう設定）
 */
test.describe("Search Palette (Ctrl+Shift+F)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, {
      searchResults: [
        {
          messageId: "m-1",
          sessionId: "sess-1",
          sessionTitle: "テストセッション",
          role: "assistant",
          snippetHtml: "これは [claude] のテスト結果です",
          createdAt: Math.floor(Date.now() / 1000) - 120,
        },
      ],
    });
  });

  test("opens on Ctrl+Shift+F and shows results after debounce", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    await page.keyboard.press("Control+Shift+F");

    const input = page.getByPlaceholder(/キーワードで会話を検索/);
    await expect(input).toBeVisible();

    await input.fill("claude");

    // debounce 200ms + setTimeout 40ms のバッファで 400ms 程度待つ
    await page.waitForTimeout(600);

    // search_messages invoke が呼ばれたはず
    const log = await getInvokeLog(page);
    const searchCalls = log.filter((l) => l.cmd === "search_messages");
    expect(searchCalls.length).toBeGreaterThan(0);
    expect((searchCalls[0].args as { query: string }).query).toBe("claude");

    // 結果リストに snippet 一部が出る（`[claude]` は <mark> でハイライト化）
    await expect(
      page.getByText(/これは/).first()
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText("テストセッション").first()
    ).toBeVisible();
  });
});
