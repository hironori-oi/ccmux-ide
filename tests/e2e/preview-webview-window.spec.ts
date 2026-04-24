import { test, expect, type Page } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import {
  FIXTURE_WITH_TEST_PROJECT,
  getInvokeLog,
} from "./fixtures";

/**
 * PRJ-012 v1.1 / PM-943 / PM-944 (2026-04-20): Preview Phase 4.1 — Tauri 2 secondary
 * `WebviewWindow` での in-app preview spawn smoke test。
 *
 * PRJ-012 v1.16.1 (2026-04-24): v1.8 (PM-982 TrayBar Fixed 3 chips + ドラッグ配置
 * 方式) と v1.10.0 (DEC-056 localhost iframe / external 別ウィンドウ分岐) で
 * preview UI が大幅に変更されたため、テストを現行 UI に追従。
 *
 * ## 現行 UI (v1.16.1 時点)
 *
 * 1. TrayBar には「プレビュー」チップ (aria-label="プレビュー（…）") が固定配置
 *    されており、明示的な「プレビューを配置」ボタンは存在しない。
 *    チップを Slot にドラッグ & ドロップすると `WorkspaceView.handleDragEnd()`
 *    が `usePreviewInstances.addInstance()` で lazy 生成し、該当 slot に配置する。
 * 2. PreviewPane はインスタンスの URL が localhost 系 (isLocalUrl) なら
 *    slot 内 iframe を描画し、外部 URL なら「別ウィンドウで開く」「ブラウザで
 *    開く」の 2 ボタンを中央に表示する。URL 入力バーは常時上部に表示。
 * 3. ボタン aria-label:
 *    - `別ウィンドウで開く` → `spawn_preview_window` (Rust command) を invoke
 *    - `外部ブラウザで開く` → `plugin:shell|open` を invoke
 *
 * ## テスト仕様（v1.16.1 再設計）
 *
 * - Test A: external URL を入力 → 「別ウィンドウで開く」クリック →
 *   `spawn_preview_window` invoke + args.url / args.label を検証
 * - Test B: localhost URL を入力 → slot 内 iframe が描画される
 *   (`spawn_preview_window` は自動発火しないことを確認)
 * - Test C: external URL で「外部ブラウザで開く」クリック →
 *   `plugin:shell|open` invoke を検証
 *
 * 旧テスト (`'アプリ内で開く'` / `'ブラウザで開く'`) は v1.8 以前のラベル。
 * 新 UI では `別ウィンドウで開く` / `外部ブラウザで開く` に変わっており、
 * ボタンを表に出すトリガー (プレビュー chip を slot にドロップ) も別物。
 */

async function patchFsExistsTrue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const g = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const internals = g.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") return;
    const origInvoke = internals.invoke.bind(internals);
    internals.invoke = async (cmd: string, args?: unknown) => {
      if (cmd === "plugin:fs|exists") return true;
      return origInvoke(cmd, args);
    };
  });
}

/**
 * TrayBar の「プレビュー」チップを指定 slot にドラッグ & ドロップする。
 *
 * @dnd-kit の `MouseSensor` は `activationConstraint: { distance: 4 }` で
 * 4px 以上動かないと drag start しないため、Playwright 側で複数 step で
 * mouse.move を発火する必要がある。
 *
 * @param slotIndex layout "2h" は slot0/slot1 が可視。初期状態では slot0 が
 *   chat 自動配置済 / slot1 が空。slot1 に drop すると chat を残したまま
 *   preview を追加配置できるため推奨。
 */
async function dragPreviewChipToSlot(
  page: Page,
  slotIndex: number
): Promise<void> {
  // 固定チップ: aria-label は「プレビュー（…）」と可変。`/^プレビュー/` で
  // 先頭一致させる。将来 label 変更があっても『プレビュー』接頭辞は維持される前提。
  const chip = page.getByRole("button", { name: /^プレビュー/ });
  await expect(chip).toBeVisible({ timeout: 10_000 });

  // SlotContainer の外側 `<div>` が droppable。空 slot では中央に
  // 「ドラッグして配置」placeholder が出る。SlotHeader の label 文字
  // ("A"/"B"/"C"/"D") を起点に祖先 div を取得して target boundingBox を得る。
  const letter = ["A", "B", "C", "D"][slotIndex];
  // "<span class='...'>A</span>" は slot header 内にのみ存在するので exact-text で特定。
  const slotLabelSpan = page
    .locator("span", { hasText: new RegExp(`^${letter}$`) })
    .first();
  await expect(slotLabelSpan).toBeVisible({ timeout: 10_000 });
  // 祖先の slot 外枠 (ref={setNodeRef}) は 3 階層上: span → div(left cluster) →
  //   div(SlotHeader) → div(SlotContainer root)
  const slotBox = slotLabelSpan.locator("xpath=ancestor::div[3]");
  await expect(slotBox).toBeVisible();

  const chipBox = await chip.boundingBox();
  const slotTarget = await slotBox.boundingBox();
  if (!chipBox || !slotTarget) {
    throw new Error(
      `drag source/target bounding box not found: chip=${chipBox} slot=${slotTarget}`
    );
  }

  const from = {
    x: chipBox.x + chipBox.width / 2,
    y: chipBox.y + chipBox.height / 2,
  };
  const to = {
    x: slotTarget.x + slotTarget.width / 2,
    y: slotTarget.y + slotTarget.height / 2,
  };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // activationConstraint.distance=4 を超えるため 2+ step で移動
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.describe("PreviewPane — in-app WebviewWindow (v1.16.1 regression fix)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT);
    await patchFsExistsTrue(page);
  });

  test("external URL 入力 + 『別ウィンドウで開く』で spawn_preview_window が invoke される", async ({
    page,
  }) => {
    await page.goto("/workspace");

    // v1.8 (PM-982) 以降: TrayBar の Preview chip を空 slot にドラッグして配置。
    // layout "2h" の slot1 (label "B") は初期空なので drop 先として理想。
    await dragPreviewChipToSlot(page, 1);

    // URL 入力欄が visible になる (= preview slot が active、PreviewPane が描画済)
    const urlInput = page.locator("#preview-url-input");
    await expect(urlInput).toBeVisible({ timeout: 10_000 });

    // v1.10.0 DEC-056 分岐: 外部 URL を入力 → 「別ウィンドウ」CTA が primary に
    await urlInput.fill("https://example.com");
    await urlInput.blur();

    // Test A: external URL では「別ウィンドウで開く」ボタンが 2 箇所に出る
    // (上部バー + 本体中央カード)。いずれも同じ handler を呼ぶので 1 つ目でよい。
    await page
      .getByRole("button", { name: "別ウィンドウで開く" })
      .first()
      .click();

    // invoke log に spawn_preview_window が乗っていること (PM-944 Rust command)
    await expect
      .poll(
        async () => {
          const log = await getInvokeLog(page);
          return log.some((l) => l.cmd === "spawn_preview_window");
        },
        { timeout: 5_000 }
      )
      .toBe(true);

    // spawn 時に渡された url / label が入力値と一致すること
    const log = await getInvokeLog(page);
    const spawn = log.find((l) => l.cmd === "spawn_preview_window");
    expect(spawn).toBeTruthy();
    const args = (spawn?.args ?? {}) as {
      label?: string;
      url?: string;
      title?: string;
    };
    expect(args.url).toBe("https://example.com");
    expect(args.label).toMatch(/^preview-/);
  });

  test("localhost URL 入力で iframe が slot 内に描画される (spawn_preview_window は自動発火しない)", async ({
    page,
  }) => {
    await page.goto("/workspace");

    await dragPreviewChipToSlot(page, 1);

    const urlInput = page.locator("#preview-url-input");
    await expect(urlInput).toBeVisible({ timeout: 10_000 });

    // localhost 系 URL を入力 (isLocalUrl=true → iframe 分岐)。
    // 初期値が既に http://localhost:3000 の可能性が高いが、明示 commit のため
    // 別 port に書き換えて blur で setCurrentUrl をトリガーする。
    await urlInput.fill("http://localhost:4321");
    await urlInput.blur();

    // DEC-056: iframe が描画されること (src 属性に localhost:4321 を含む)
    const iframe = page.locator("iframe[src*='localhost:4321']");
    await expect(iframe).toBeVisible({ timeout: 5_000 });

    // spawn_preview_window が "自動では" 呼ばれていないこと
    // (ユーザーが明示的にボタンを押さない限り internal URL では発火しない)
    const log = await getInvokeLog(page);
    expect(log.some((l) => l.cmd === "spawn_preview_window")).toBe(false);
  });

  test("『外部ブラウザで開く』で plugin:shell|open が invoke される", async ({
    page,
  }) => {
    await page.goto("/workspace");

    await dragPreviewChipToSlot(page, 1);

    const urlInput = page.locator("#preview-url-input");
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    await urlInput.fill("https://example.com");
    await urlInput.blur();

    // DEC-056: external URL では中央カードにも「外部ブラウザで開く」ボタンが
    // 出る。上部バーの同 label ボタンでも handler は同一。first() で取り、
    // disambiguation をしない (テストの意図は handler 発火の確認)。
    await page
      .getByRole("button", { name: "外部ブラウザで開く" })
      .first()
      .click();

    await expect
      .poll(
        async () => {
          const log = await getInvokeLog(page);
          return log.some((l) => l.cmd === "plugin:shell|open");
        },
        { timeout: 5_000 }
      )
      .toBe(true);
  });
});
