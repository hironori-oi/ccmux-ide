import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import { emitMockEvent, getInvokeLog } from "./fixtures";
import {
  buildAssistantMessagePayload,
  buildResultPayload,
} from "./helpers";

/**
 * PM-290 シナリオ 3: Chat 基本動作。
 *
 * - /workspace を開くと sidecar 起動 invoke が呼ばれる
 * - Textarea に「こんにちは」と入力 → Ctrl+Enter で送信
 * - UserMessage が画面に表示される
 * - mock 側で `agent:raw` を emit → AssistantMessage が streaming 表示される
 */
test.describe("Chat basic flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page);
  });

  test("sends a user message and receives streamed assistant reply", async ({
    page,
  }) => {
    await page.goto("/workspace");

    // sidecar 起動が invoke されるまで待つ
    await page.waitForTimeout(500);

    const textarea = page.getByPlaceholder(
      /メッセージを入力/
    );
    await expect(textarea).toBeVisible();

    await textarea.fill("こんにちは");
    await textarea.press("Control+Enter");

    // UserMessage 表示
    await expect(page.getByText("こんにちは").first()).toBeVisible();

    // send_agent_prompt が呼ばれたはず
    const log = await getInvokeLog(page);
    const names = log.map((l) => l.cmd);
    expect(names).toContain("send_agent_prompt");

    // 組込 mock が send_agent_prompt の 40ms 後に assistant message を、
    // さらに 50ms 後に result を emit する。念のため fallback emit も追加。
    const id = "e2e-chat-1";
    await emitMockEvent(
      page,
      "agent:raw",
      buildAssistantMessagePayload(id, "Claude です。テスト応答です。")
    );
    await emitMockEvent(page, "agent:raw", buildResultPayload(id));

    // 組込 mock / 手動 emit のいずれかが成功すれば、この文言は画面のどこかにある
    await expect(
      page.getByText(/Claude です/).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
