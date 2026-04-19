import { defineConfig, devices } from "@playwright/test";

/**
 * PM-290 / Week 8 Chunk 2: Playwright E2E 10 シナリオ設定。
 *
 * ## 方式
 * Tauri 2 公式推奨は `tauri-driver` + WebDriver だが、Linux CI でセットアップが
 * 複雑（WebKit2GTK の WebDriver 周り）なため、本 Chunk では Next.js dev server
 * (`http://localhost:3000`) を Chromium で叩き、Tauri `invoke` / event を fixtures
 * 側で window.__TAURI_INTERNALS__ にモック注入する方式を採用する。
 *
 * - Tauri binary そのものの smoke test は M3 将来拡張（DEC-033 候補、本 Chunk 外）。
 * - web 層の UI 動線（shadcn / zustand / cmdk / Monaco）だけを網羅する。
 * - 各 spec は独立。beforeEach で fixtures 初期化、afterEach で自動 cleanup。
 *
 * ## reporter / retries
 * - `html` + `line` を並行生成（失敗時に `playwright-report/` で HTML を開く）
 * - retries: local=0, CI=1（flakiness 抑制、monaco-diff 等 lazy load のため）
 *
 * ## webServer
 * - `pnpm dev` だと OS 依存のため `npm run dev` 固定。
 * - `reuseExistingServer: !process.env.CI` でローカル dev server 使い回し可能。
 * - timeout 120s: Next.js 15 + monaco-editor の初回 compile が遅い。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["line"], ["github"]]
    : [["html", { open: "never" }], ["line"]],

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // 日本語 UI のため locale を固定
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
