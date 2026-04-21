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

/**
 * 共通 fixture: 最低限 1 セッションが既に存在する状態 + active project 登録済。
 *
 * v1.1 PM-939 / v1.1.1 PM-946: `create_session` は activeProjectId 必須
 * (UI 側 disabled + Store 側 reject) になったので、sessions spec でも
 * `initialProjects` / `activeProjectId` を投入する。既存 session の
 * `projectPath` は TEST_PROJECT_PATH に揃えておく (active project 配下の
 * session として SessionList に表示される)。
 */
import {
  TEST_PROJECT_ID,
  TEST_PROJECT_PATH,
} from "./fixtures";

export const FIXTURE_WITH_ONE_SESSION: TauriFixtureOptions = {
  sessions: [
    {
      id: "sess-existing-1",
      title: "最初のセッション",
      createdAt: Math.floor(Date.now() / 1000) - 3600,
      updatedAt: Math.floor(Date.now() / 1000) - 1800,
      projectPath: TEST_PROJECT_PATH,
      // v1.1.1 PM-946 (v5 Chunk B / DEC-032): SessionList は activeProjectId と
      // session.projectId が一致するものだけを表示する。TEST_PROJECT_ID と揃える
      // ことで「最初のセッション」が sidebar に表示される状態を保証する。
      projectId: TEST_PROJECT_ID,
      sdkSessionId: null,
      lastMessageExcerpt: "こんにちは",
      lastMessageRole: "assistant",
    },
  ],
  initialProjects: [
    {
      id: TEST_PROJECT_ID,
      path: TEST_PROJECT_PATH,
      title: "E2E テスト用プロジェクト",
      colorIdx: 0,
      lastSessionId: null,
      addedAt: Date.now(),
    },
  ],
  activeProjectId: TEST_PROJECT_ID,
};
