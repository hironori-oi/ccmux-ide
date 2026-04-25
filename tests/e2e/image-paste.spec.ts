import { test, expect } from "@playwright/test";
import { setupE2EPage, FIXTURE_WITH_ONE_SESSION } from "./helpers";

/**
 * PM-290 シナリオ 4: 画像 D&D / Ctrl+V。
 *
 * - /workspace で InputArea が表示される
 * - Command Palette 経由の "画像を添付（クリップボードから）" を実行 → mock
 *   `save_clipboard_image` が `/tmp/ccmux-images/mock-clipboard.png` を返す
 * - 結果、attachment セクション（Paperclip アイコン）が表示される
 *
 * 注: Playwright の `dispatchEvent('drop')` で File ドロップを完全再現するのは
 *     難しいため（`DataTransfer` が `@tauri-apps/plugin-fs` 書込みとの interplay
 *     になる）、シナリオ 4 は CommandPalette → クリップボード画像の経路を
 *     正とする。実 D&D は手動検収（PM-291 AC-7）でカバー。
 *
 * v1.28.2: v1.18.0 (DEC-064) 以降、`save_clipboard_image` の呼出側 (CommandPalette)
 * は session 単位 attachment へ移行し「セッションが選択されていません」guard が
 * 入った。test fixture を FIXTURE_WITH_ONE_SESSION ベース + currentSessionId
 * 投入に変更して、attach 経路が走る前提を整える。
 */
test.describe("Image attach (clipboard via CommandPalette)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, {
      ...FIXTURE_WITH_ONE_SESSION,
      clipboardImagePath: "/tmp/ccmux-images/mock-clipboard.png",
    });
  });

  test("attaching clipboard image adds thumbnail to InputArea", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

    // v1.28.2: DEC-064 attach guard 通過のため、SessionList から既存 session を
    // クリックして currentSessionId にセットする (UI 経路)。
    // FIXTURE_WITH_ONE_SESSION で投入された "最初のセッション" タイトルを使う。
    const sessionItem = page
      .getByRole("option", { name: /最初のセッション/ })
      .first();
    if (await sessionItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sessionItem.click();
      await page.waitForTimeout(300);
    }

    // Ctrl+K で CommandPalette を開く
    await page.keyboard.press("Control+K");

    // 「画像を添付（クリップボードから）」項目を選ぶ
    await expect(
      page.getByText("画像を添付（クリップボードから）")
    ).toBeVisible();
    await page.getByText("画像を添付（クリップボードから）").click();

    // InputArea の attachment 領域に 1 件追加されたはず
    // ImageThumb の削除ボタンに aria-label="画像を削除" が付くので、それで検索する
    await expect(
      page.getByRole("button", { name: "画像を削除" }).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
