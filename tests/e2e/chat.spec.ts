import { test, expect } from "@playwright/test";
import { setupE2EPage } from "./helpers";
import {
  emitMockEvent,
  getInvokeLog,
  FIXTURE_WITH_TEST_PROJECT,
  AGENT_RAW_EVENT,
} from "./fixtures";
import {
  buildAssistantMessagePayload,
  buildResultPayload,
} from "./helpers";

/**
 * PM-290 シナリオ 3 / v3.3.1 Chunk B (S-1): Chat 基本動作。
 *
 * - 初期 project が登録された状態で /workspace を開く
 *   （`FIXTURE_WITH_TEST_PROJECT` が `localStorage["ccmux-project-registry"]`
 *    に固定 id `TEST_PROJECT_ID` の project を 1 件投入する）
 * - Textarea に「こんにちは」と入力 → Ctrl+Enter で送信
 * - UserMessage が画面に表示される
 * - mock 側で `agent:${TEST_PROJECT_ID}:raw` を emit → AssistantMessage が
 *   streaming 表示される（Multi-Sidecar 化以降は projectId 付き event のみ
 *   ChatPanel の listener に届く）
 */
test.describe("Chat basic flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT);
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
    // さらに 50ms 後に result を emit する（mock 側で projectId が argv に
    // 含まれていれば `agent:${projectId}:raw` を選択して emit する）。
    // 念のため fallback として、spec 側からも projectId 付き event を直接 emit。
    const id = "e2e-chat-1";
    await emitMockEvent(
      page,
      AGENT_RAW_EVENT,
      buildAssistantMessagePayload(id, "Claude です。テスト応答です。")
    );
    await emitMockEvent(page, AGENT_RAW_EVENT, buildResultPayload(id));

    // 組込 mock / 手動 emit のいずれかが成功すれば、この文言は画面のどこかにある
    await expect(
      page.getByText(/Claude です/).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
