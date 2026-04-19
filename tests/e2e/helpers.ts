import type { Page } from "@playwright/test";
import { installTauriMock, type TauriFixtureOptions } from "./fixtures";

/**
 * 全 spec 共通の beforeEach で呼ぶ準備関数。
 *
 * - Tauri モック注入
 * - localStorage の設定値を初期化（`hasSeenWelcome` は fixture 側で設定済）
 */
export async function setupE2EPage(
  page: Page,
  options: TauriFixtureOptions = {}
): Promise<void> {
  await installTauriMock(page, options);
}

/**
 * Agent SDK の NDJSON 1 行分を送る便利関数。
 *
 * ChatPanel は `agent:raw` payload を split("\n") でパースしているため、
 * 1 レコードずつ発火するのが安全。
 */
export function buildAssistantMessagePayload(
  id: string,
  text: string
): string {
  return JSON.stringify({
    type: "message",
    id,
    payload: {
      type: "assistant",
      message: {
        content: [{ type: "text", text }],
      },
    },
  });
}

export function buildToolUsePayload(
  id: string,
  toolId: string,
  name: string,
  input: Record<string, unknown>
): string {
  return JSON.stringify({
    type: "message",
    id,
    payload: {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: toolId, name, input }],
      },
    },
  });
}

export function buildResultPayload(id: string): string {
  return JSON.stringify({ type: "result", id, payload: {} });
}

/** 共通 fixture: 最低限 1 セッションが既に存在する状態 */
export const FIXTURE_WITH_ONE_SESSION: TauriFixtureOptions = {
  sessions: [
    {
      id: "sess-existing-1",
      title: "最初のセッション",
      createdAt: Math.floor(Date.now() / 1000) - 3600,
      updatedAt: Math.floor(Date.now() / 1000) - 1800,
      projectPath: null,
      lastMessageExcerpt: "こんにちは",
      lastMessageRole: "assistant",
    },
  ],
};
