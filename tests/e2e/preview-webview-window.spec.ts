import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import {
  FIXTURE_WITH_TEST_PROJECT,
  getInvokeLog,
} from "./fixtures";

/**
 * PRJ-012 v1.1 / PM-943 (2026-04-20): Preview Phase 4.1 — Tauri 2 secondary
 * `WebviewWindow` での in-app preview spawn smoke test。
 * PRJ-012 v1.1.1 / PM-944 / PM-946 (2026-04-20): spawn 経路を Rust 側
 * `spawn_preview_window` command に切替 (JS API `plugin:webview|create_webview_window`
 * は PM-944 で廃止)。spec も invoke 名を追随。
 *
 * E2E は `next dev` を相手にしているので Tauri 本体は存在しない。fixtures の
 * `spawn_preview_window` / `plugin:window|get_all_windows` 等を空 stub で mock し、
 * PreviewPane から「アプリ内で開く」クリックで:
 *
 * 1. `spawn_preview_window` が **呼ばれる**（= 新規 spawn 経路に入った）ことを
 *    invoke log で検証
 * 2. URL が store に commit され、`url` として Rust command に渡されることを検証
 * 3. 「ブラウザで開く」クリックで `plugin:shell|open` が呼ばれることも検証
 *    (regression を回避)
 *
 * ## Project 有効化について
 *
 * `FIXTURE_WITH_TEST_PROJECT` は `ccmux-project-registry` を localStorage へ投入
 * するが、起動時の `refreshStatus()` で `plugin:fs|exists` が `false` を返すため
 * project が drop されて `activeProjectId` が null になる (v1.1-dev 現在、
 * chat.spec.ts 等でも同 race 由来で fail 報告あり)。
 *
 * 本 spec では、`installTauriMock` の **直後**に `plugin:fs|exists` のみ true を
 * 返すパッチを追加注入し、fs 由来の drop を回避する。将来 fixture 側が直ったら
 * 本 override は不要になる。
 */

async function patchFsExistsTrue(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    // installTauriMock が既に __TAURI_INTERNALS__.invoke を設置したあとに、
    // 本 init script が評価される（addInitScript の FIFO）。先行する invoke を
    // ラップし、`plugin:fs|exists` だけ true を返すよう上書きする。
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

test.describe("PreviewPane — in-app WebviewWindow (PM-944)", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT);
    await patchFsExistsTrue(page);
  });

  test("clicking 'アプリ内で開く' invokes spawn_preview_window", async ({
    page,
  }) => {
    await page.goto("/workspace");

    // プレビュータブへ切替
    await page.getByRole("tab", { name: /プレビュー/ }).first().click();

    // URL 入力欄が visible になる (= project active, PreviewPane 本体が render)
    const urlInput = page.locator("#preview-url-input");
    await expect(urlInput).toBeVisible({ timeout: 10_000 });

    // 任意の URL に書き換え
    await urlInput.fill("http://localhost:4321");

    // 「アプリ内で開く」ボタンクリック
    await page.getByRole("button", { name: "アプリ内で開く" }).click();

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
    // PM-944: Rust command の引数は { label, url, title } の flat shape。
    // PM-943 の JS API は { options: { url, label, ... } } だったが、v1.1.1 で廃止。
    const args = (spawn?.args ?? {}) as {
      label?: string;
      url?: string;
      title?: string;
    };
    expect(args.url).toBe("http://localhost:4321");
    expect(args.label).toMatch(/^preview-/);
  });

  test("clicking 'ブラウザで開く' invokes shell open", async ({ page }) => {
    await page.goto("/workspace");

    await page.getByRole("tab", { name: /プレビュー/ }).first().click();

    const urlInput = page.locator("#preview-url-input");
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    await urlInput.fill("https://example.com");

    await page.getByRole("button", { name: "外部ブラウザで開く" }).click();

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
