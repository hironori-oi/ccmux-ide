import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";

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
 */
test.describe("Image attach (clipboard via CommandPalette)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, {
      clipboardImagePath: "/tmp/ccmux-images/mock-clipboard.png",
    });
  });

  test("attaching clipboard image adds thumbnail to InputArea", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await page.waitForTimeout(400);

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
