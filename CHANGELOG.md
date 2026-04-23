# Changelog

All notable changes to Sumi (formerly ccmux-ide through v1.3.1) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release body 自動生成は `.github/workflows/release.yml` が awk でタグ chunk
（`## [v0.1.0] - ...` 〜 次の `## [` 行の直前）を抽出して使用します。タグ名と
見出しのバージョン表記を一致させてください（例: tag `v0.1.0` → 見出し `[v0.1.0]`）。

## [Unreleased]

## [v1.13.0] - 2026-04-24

**ツール実行の承認 UI + デフォルト allowedTools 拡張** — Claude が未許可ツール
を呼ぼうとした際、Sumi 側に承認ダイアログが無かったため `canUseTool` 未実装で
SDK が無限待機し、リサーチ系 (WebSearch / WebFetch) や MCP tools が事実上使え
ない状態だった。本リリースで sidecar に `canUseTool` callback を実装し、
Rust 経由で Frontend モーダル承認ダイアログを出す経路を追加する。併せて
destructive でないリサーチ / タスク管理 / Notebook 系 4 tool を allowedTools
デフォルトに追加して UX を底上げする（DEC-059 案A/案B）。

### Added

- ツール実行の承認ダイアログを追加。Claude が未許可ツールを要求した際、
  ユーザーがモーダルで許可/拒否できる (DEC-059 案B)
- session-preferences に `allowedTools` / `deniedTools` を追加し、
  「このセッションで常に許可/拒否」を記憶する auto-resolve 経路を追加
- デフォルト `allowedTools` に `WebSearch` / `WebFetch` / `TodoWrite` /
  `NotebookEdit` を追加 (DEC-059 案A)
- Rust command `resolve_permission_request(projectId, requestId, decision)`
  を追加。Frontend の決定を sidecar stdin に書き戻す

### Changed

- sidecar が `canUseTool` callback を登録し、未許可ツールの実行要求を Rust
  経由で Frontend に通知するようになった
- sidecar stdout parser が `permission_request` 型の NDJSON を
  `sumi://permission-request` Tauri event に転送するようになった

## [v1.12.0] - 2026-04-24

**プロジェクト削除時のセッション cascade 削除と store cleanup** — 従来、
`removeProject` は `useProjectStore` から project を外すのみで、`sessions`
テーブルに紐づく session や各 zustand store (session-preferences / workspace-layout
/ preview / session-order / monitor / terminal / editor / chat) の project /
session キー entry が残留し、孤児 session や localStorage 肥大・UI の stale 参照を
招いていた。Rust `delete_project` コマンドで同一 transaction 内に sessions を
cascade 削除し、削除された session id を Frontend に返す新フローに差替えて修正
する（DEC-058）。

### Fixed

- プロジェクト削除時に所属セッションが DB / store に残留する不具合を修正
  (DEC-058)
- project 削除により、workspace-layout / session-preferences / preview /
  session-order / monitor など各 store の関連 entry も全て cleanup されるように
  修正
- `sessions_has_project_id` の unused warning を `apply_ddl` 末尾の invariant
  check で正式活用し解消

### Added

- Rust command `delete_project(projectId)` を追加（rusqlite transaction で
  sessions を cascade 削除し、削除された session id を Frontend に返す）
- `lib/stores/purge-project.ts` を新規追加し、project 削除時の store cleanup を
  一元化

## [v1.11.0] - 2026-04-24

**Session Preferences を Project 別に独立保持** — DEC-053 で導入した
session-preferences store の global fallback (`useDialogStore.selectedModel` /
`selectedEffort`) が project 切替時に前 project の設定を連れ回す leak を起こして
いたため、継承源を当該 project の `perProject[projectId]` に変更し、project scope
で完全独立化する（DEC-057）。

### Fixed

- プロジェクト切替時にモデル / 工数 / 実行モードが前プロジェクトの値に変更される
  不具合を修正 (DEC-057)

### Changed

- `lib/stores/session-preferences.ts` を拡張し、プロジェクト単位の最後の設定
  `perProject: Record<projectId, SessionPreferences>` を追加（perSession は維持）
- 新規セッション作成時の初期値継承源を `useDialogStore` の global default から、
  所属プロジェクトの `perProject[projectId]` に変更（無ければ HARD_DEFAULT:
  `{ model: null, effort: null, permissionMode: "default" }`）
- `setPreference(sessionId, projectId, patch)` シグネチャに変更。perSession と
  perProject を同時更新する（project scoped sticky）
- `TrayModelPicker` / `TrayEffortPicker` / `TrayPermissionModePicker` の fallback
  表示を dialog store から perProject 参照に変更
- `InputArea` の送信時 resolve fallback も `perProject[activeProjectId]` → HARD_DEFAULT
  の順に変更（dialog store 非参照）
- persist schema version を 2 に上げ、旧形 (perSession のみ) → 新形 (perProject: {}
  を補完) への migrate 関数を実装。既存ユーザーの perSession 値は保持される

## [v1.10.0] - 2026-04-24

**L字 3 分割 + Project 別 Layout 独立 + Preview localhost iframe** — ワークスペース
分割モードを整理し、project 切替時の layout leak を解消。localhost URL は
slot 内で iframe 表示できるようにする（DEC-054 / DEC-055 / DEC-056）。

### Added

- **L字 3 分割レイアウト (DEC-054)** — LayoutSwitcher に `"3"` (左 1 全高 +
  右上 + 右下) を追加。左 slot を Chat、右上を Editor、右下を Terminal / Preview
  として使う等、縦 2 分割より実用的な構成を提供する。
- **Preview の localhost iframe 表示 (DEC-056)** — `isLocalUrl()` で URL host が
  `localhost` / `127.0.0.1` / `*.localhost` / `0.0.0.0` / `::1` かを判定し、
  internal URL は slot 内 `<iframe sandbox referrerPolicy="no-referrer">` で
  表示する。外部 URL は既存の `spawn_preview_window` (Tauri 2 WebviewWindowBuilder)
  による別ウィンドウ spawn を継続（DEC-052 の「iframe 撤退」を internal 限定で
  条件付き上書き）。CSP は `frame-src 'self' http://localhost:* http://127.0.0.1:*
  http://*.localhost https:` で許可済みのため追加設定不要。

### Changed

- **Workspace Layout の store を project 別に独立保持 (DEC-055)** —
  `layouts: Record<sessionId, SessionLayout>` から
  `layouts: Record<projectId, Record<sessionId, SessionLayout>>` に refactor。
  session id は project をまたいで uniqueness が保証されないため、project 切替時に
  別 project の session id と衝突して layout が leak する事故を解消。
  `useProjectStore.getState()` で遅延参照し循環依存を回避。
- **LayoutSwitcher UI の再構成 (DEC-054)** — `"2v"` (縦 2 分割) ボタンを削除し、
  新設の `"3"` (L字 3 分割、lucide-react `PanelRightDashed` icon) を追加。

### Removed

- **`"2v"` (縦 2 分割) モード (DEC-054)** — 実測利用が少なく、L字 3 分割のほうが
  実用的という判断。既存の `"2v"` state は自動で `"2h"` に変換され、
  slot2 の chip は slot1 に移送される（slot1 既存があれば破棄）。
- **CHANGELOG の絵文字** — Keep a Changelog に寄せ、`### Added` / `### Changed` /
  `### Removed` のプレーン見出しに統一。

### Migration

- `sumi:workspace-layout` localStorage (persist version 2 → 3): 旧 flat
  `{ [sid]: SessionLayout }` は `__legacy__` project key の配下に退避される。
  他 project は参照せず、新 project は空状態から開始。
- `"2v"` layout 値は migration 時に `"2h"` + slot2→slot1 移送で正規化される。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.9.0] - 2026-04-24

**Session-Scoped Model / Effort / Permission-Mode** — StatusBar の model/effort picker を TrayBar に移設し、session 単位で切替できるようにする。新規に permission-mode picker を追加（DEC-053）。

### Added

- **TrayPermissionModePicker (新規)** — TrayBar に `default` / `acceptEdits` /
  `bypassPermissions` / `plan` の 4 モードを切替できる Popover を追加。選択値は
  `send_agent_prompt` の options に per-query で同梱され、sidecar 側
  (`handlePrompt`) が SDK `query({ permissionMode })` に渡す。
- **`lib/stores/session-preferences.ts` (新規 store)** — session 別の
  `{ model, effort, permissionMode }` を保持する zustand store。localStorage
  (`sumi:session-preferences`) に永続化。新規 session 作成時は
  `useDialogStore` の `selectedModel` / `selectedEffort` を global default として
  seed（sticky 挙動）。

### Changed

- **StatusBar の ModelPickerPopover / EffortPickerPopover を TrayBar に移設**
  (DEC-053)。StatusBar はシステム指標（OAuth gauge / ClaudeActivitySummary /
  sidecar count / git branch）に専念。TrayBar には `TrayModelPicker` /
  `TrayEffortPicker` / `TrayPermissionModePicker` が LayoutSwitcher の左に並ぶ。
- **`send_agent_prompt` は per-query で model / effort / permissionMode を渡す**
  — argv 経由の sidecar 再起動を伴わず、Rust `send_agent_prompt` に `options`
  引数を追加して透過し、sidecar 側の既存 `req.options` 分岐で SDK query
  options を上書きする経路を採用。

### Removed

- **`components/chat/ModelPickerPopover.tsx` / `EffortPickerPopover.tsx`** の
  2 ファイルを削除（StatusBar 専用の未使用コンポーネントになったため）。
  `/model` / `/effort` slash 用の `ModelPickerDialog` / `EffortPickerDialog` は
  引き続き残置。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.8.3] - 2026-04-24

**Strict Session Context + Cleanup** — コンテキスト表示の session 厳密化 + 不要 UI 撤去。

### 💎 Changed

- **TrayContextBar の global fallback を廃止** (PM-985)。session 別の snapshot が
  無い場合に global 最新値を fallback 表示する挙動は混乱を招くため撤去。
  snapshot が無ければ `ctx — (empty bar)` と明示表示、tooltip で「この session
  ではまだ計測していません（Claude と会話すると表示）」と案内する。
- **StatusBar から global コンテキスト表示を撤去** (PM-985)。TrayBar の
  TrayContextBar (session 別) が代替となるため、StatusBar 中央L の
  `コンテキスト XX%` 表示は削除して重複を解消。
- **SessionList から「未分類を表示」toggle を撤去** (PM-985)。v5 Chunk B /
  DEC-032 で入れた旧 toggle は機能不要と判断し、関連 state /
  fetchUncategorizedSessions 処理 / UI section を全て削除。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.8.2] - 2026-04-24

**Tray Context Bar** — session 別のコンテキスト使用量を Tray Bar に表示。

### ✨ Added

- **Session 別コンテキスト使用量バッジ** (PM-984)。Tray Bar の LayoutSwitcher
  左側に横 1 行のコンパクトバッジ `[⚠ ctx ■■■░░ 38%]` を追加:
  - 色段階は ContextGauge と統一（<60% emerald / <85% yellow / >=85% red + ⚠）
  - 60px thin progress bar + percent 数値
  - tooltip に tokens used/max、model 名を表示
  - **session 切替で該当 session の snapshot を表示**（前回 tick 時の値を保持）
- `useMonitorStore` に `perSession: Record<sessionId, MonitorState>` を追加。
  `monitor:tick` 受信時に currentSessionId をキーに snapshot 保存
- `selectMonitorForSession(sessionId)` helper: 該当 session の snapshot、無ければ
  global 最新値を fallback

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.8.1] - 2026-04-24

**Session Order Toggle + Drag Reorder** — セッション並び順を更新時刻 / 手動で切替。

### ✨ Added

- **セッション並び順 toggle** (PM-983)。新規セッションボタンの隣に追加。
  - 🕐 モード（default）: SQLite `list_sessions` の `updated_at DESC`（従来動作）
  - 📝 モード: 手動並べ替え（ドラッグ&ドロップで順序固定）
- **手動並び替えの drag & drop** (PM-983)。`@dnd-kit/sortable` を追加し、
  セッション項目の左端 `⋮⋮` grip アイコンで掴んでドラッグすると並び順を
  入れ替え可能。並び順は project ごとに独立保存（`sumi:session-order`
  localStorage、未分類セクションも別 key で独立管理）。
- **セッション削除時の order 自動クリーンアップ** (PM-983)。削除された session
  は保存済の並び順からも除去され stale 参照を回避。
- 依存追加: `@dnd-kit/sortable@^10.0.0`

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.8.0] - 2026-04-24

**Simplified Tray: Fixed 3 Chips + Editor Multi** — Tray の構成をオーナー要望に合わせて大幅簡素化。

### 💎 Changed (Breaking UI)

- **Tray のチップ構成を再設計** (PM-982)。session あたり:
  - **Chat**: 1 固定（main pane、削除不可）
  - **Terminal**: 1 固定（session ごと lazy 生成、削除不可）
  - **Preview**: 1 固定（session ごと lazy 生成、削除不可）
  - **Editor**: 複数（従来通り、sidebar D&D で追加）
- **+ ボタン (チャット追加 / ターミナル追加 / プレビュー配置) を全廃** (PM-982)。
  ユーザーは固定チップを **そのままドラッグ** するだけで配置できる。Session に
  terminal / preview が未作成の場合、**drop 時に自動生成**する。
- **Chat 複数 pane 機能撤去**。`addPane` ロジックは store に残すが UI からは
  アクセス不可。これまでの Chat 1/2/3 の「セッション切替バグ」を根本解消。
- **固定チップには ✕ 削除ボタンなし**（削除不可の session リソースのため）。
  配置解除は slot 側の ✕ で。エディタチップは従来通り ✕ で file を purge。

### ✨ Added

- **Lazy 生成ロジック** (PM-982)。`WorkspaceView.handleDragEnd` で refId が
  null の chip を drop した場合に:
  - terminal → `createTerminal(projectId, path)` → 生成された ptyId で setSlot
  - preview → `addInstance(projectId, { sessionId })` → 新 id で setSlot
  - chat / editor はもとから refId がある前提（例外はトースト表示）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.7.4] - 2026-04-24

**Session-Scoped Workspace Layout** — session ごとに slot 配置と layout を独立管理。

### 💎 Changed

- **`useWorkspaceLayoutStore` を session-keyed に全面 refactor** (PM-981)。
  - v1 は `{ slots, layout }` をグローバルに 1 組だけ持っていたため、session を
    切替えても slot の中身が残り続け、「Session A で作った Chat 2 が Session B
    の slot にも残って表示される」状態になっていた。
  - v2 から `layouts: Record<sessionId, { slots, layout }>` に変更。
    各 session が独立した slot 配置と layout を持ち、session 切替で自動的に
    その session の layout に切り替わる。
  - session 未選択時は `"__default__"` key を使用（後方互換）。
  - 既存 v1 データは migration で `__default__` key に移され保持される。
- 新 hook `useCurrentSlots()` / `useCurrentSlotContent(i)` / `useCurrentLayout()`
  を追加。component はこれらを経由して current session の layout を購読する。
- **削除された chip は全 session layouts から自動除去** (PM-981)。`removeByRefId`
  が他 session の slot にも波及してクリーンアップする。stale 参照で「存在しない
  chat/file/pty」が描画される問題を回避。
- **Auto-provision を session 切替時にも発火** (PM-981)。新 session の slots が
  全て空ならメインチャットを slot 0 に自動配置する（依存配列に
  `currentSessionId` を追加）。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.7.3] - 2026-04-24

**One Chip = One Slot** — 同じチップは常に 1 slot 限定で表示。

### 💎 Changed

- **setSlot に 1 chip = 1 slot 制約を追加** (PM-980)。旧動作では同じ chip を
  別 slot にドラッグすると両方に同じ内容が並列表示されていたが、
  「移動」セマンティクス（元 slot を空にして新 slot に表示）に変更した。
  例: Slot A に Chat 1 を表示中 → Slot B にドラッグ → Slot A 空 + Slot B に
  Chat 1。重複表示による認知コストとリソース浪費を回避。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.7.2] - 2026-04-24

**Slim Chat Header + Session-Scoped Chat** — チャット画面を縦方向にさらに拡大、chat も session 別管理へ。

### 💎 Changed (UX)

- **ChatPanel の 1 pane fallback header を撤去** (PM-978)。旧版は
  「プロジェクト名 + 👁 tool toggle + Claude 接続中」を独立行 48px で表示して
  チャット面積を圧迫していた。プロジェクト名は上部 TitleBar と重複で冗長だった
  ため削除、**tool toggle + 接続状態は SlotHeader (28px) に inline 統合**。
  垂直スペースが 48px 開放されチャット画面を実質 1.5 行分拡大。
- `ChatStatusIndicator` / `ToolDetailsToggle` を再利用可能コンポーネントに
  切り出し（`components/chat/`）。

### ✨ Added

- **Chat pane の session 別管理** (PM-979)。v1.7.0 PM-975 では chat pane を
  `pane.currentSessionId` (mutable な "load 中" session) で filter していたため、
  session 切替で pane.currentSessionId が書き換わり「Session A で作った Chat 2 が
  Session B でも見える」共通状態になっていた。
  - 新規フィールド `ChatPaneState.creatingSessionId?: string | null` (immutable)
  - `addPane()` 時点で `useSessionStore.currentSessionId` をタグ付け
  - Tray フィルタ: `pane.creatingSessionId === currentSessionId` で判定
  - main pane は削除不可 + 全 session 共通（不変の「メインチャット」）
  - legacy (未タグ、creatingSessionId === null) は常時表示で後方互換

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.7.1] - 2026-04-24

**Tray Hotfixes** — エディタチップの完全削除 + 新規チャットチップの表示 regression 修正。

### 🔧 Fixed

- **エディタチップが ✕ を押しても消えない regression** (PM-976)。`closeFile`
  は active editor pane からのみ file を除去する設計で、他 pane でも参照されて
  いた legacy file（v1.6.x 以前の「全セッション表示」される CLAUDE.md 等）は
  `openFiles` プールに残り続け、tray のチップも消えなかった。
  - 新規 action `useEditorStore.purgeFile(id)` を追加: 全 pane の openFileIds
    から除去 + openFiles プールからも削除する完全消去版
  - Tray の ✕ ボタン（`DeleteChipButton`）から `closeFile` → `purgeFile` に
    切替
- **「チャットを追加」でチップが表示されない regression** (PM-976)。新規
  `addPane()` は `currentSessionId: null` の状態で pane を作り、セッション
  フィルタ `pane.currentSessionId === currentSessionId` で弾かれていた。
  - `currentSessionId === null` の pane（session 未 attach、新規追加直後）は
    常時表示扱いに変更（legacy 未タグと同じ扱い）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.7.0] - 2026-04-24

**Session-Scoped Tray + Auth Announce Dialog** — セッション別の Tray チップ管理と認証案内 UX 強化。

### ✨ Added

- **セッション別 Tray チップ** (PM-975)。各チャット / エディタ / ターミナル /
  プレビューを **作成時のアクティブ session id** でタグ付けし、Tray はその
  `currentSessionId` に紐づくチップのみ表示する。セッション切替で workspace
  の作業単位が視覚的に分離される:
  - `OpenFile` / `TerminalState` / `PreviewInstance` に `creatingSessionId`
    フィールド追加
  - Chat pane は `pane.currentSessionId` との一致で filter（main pane は
    常時表示、他 pane の作成起点のため）
  - Legacy（未タグ）の資産は全 session で表示する後方互換
  - セッション未選択時（`currentSessionId === null`）は全 chips 表示

- **認証案内ダイアログ** (PM-974)。旧 10 秒 toast では見落としやすかった
  Claude Code 認証案内を **永続モーダル** に格上げ。workspace 起動後に
  `check_claude_authenticated` を呼び、未認証なら以下を表示:
  - 方法 A: `claude login`（Claude Max / Pro、推奨）— クリップボード
    コピーボタン付き
  - 方法 B: Anthropic API Key — `/settings` 遷移ボタン
  - **再確認ボタン**でターミナルで `claude login` 実行後に Rust 側 check
    を再実行、成功で自動 close
  - status 詳細表示（`NotFound` / `TokenMissing`）
  - 「閉じる」でこのセッション限定で非表示（再起動時に再表示）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.6.3] - 2026-04-23

**Multi-instance Preview** — プレビューを複数同時に独立 URL で表示可能に。

### ✨ Added

- **Preview インスタンス管理** (PM-973)。新規ストア `usePreviewInstances` を
  追加し、slot に配置した各プレビューが **独立した URL** を持てるようにした。
  これまでは 1 project = 1 preview で、同一プロジェクト内に複数スロットを
  置いても全て同じ URL に同期していた。v1.6.3 以降は:
  - `🌐+` ボタンを押す毎に **新規プレビューインスタンス**を作成
  - 最初の空 slot に自動配置、空 slot が無ければ tray にチップとして残置
  - 各インスタンスは URL を独立に保持（例: Slot A = `localhost:3000`、
    Slot B = `localhost:3001`）
  - `sumi:preview-instances` localStorage に永続化、再起動で復元
- PreviewPane に `previewId?: string` prop を追加（指定時は instance 固有の
  URL を読み書き、未指定時は旧 project 単位の挙動で後方互換）

### 💎 Changed

- **Tray 左側の既定 Preview チップを廃止** (PM-973)。旧動作では project を
  選ぶだけで常時表示されていたが、`🌐+` ボタン経由で作成されたインスタンス
  のみ表示する設計に変更。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.6.2] - 2026-04-23

**Creation Buttons Re-balanced** — エディタ + ボタンを撤去、プレビュー + を追加。

### 💎 Changed

- **エディタ + ボタンを撤去** (PM-972)。ファイルを開く導線は **サイドバー →
  slot への直接 D&D** に一本化。トレイバー上の「📂 エディタでファイルを開く」
  ボタンは不要と判断し削除。
- **プレビュー + ボタンを追加** (PM-972)。Tray 右側に「🌐 プレビューを配置」
  ボタンを追加。クリックで、現在表示中 layout の **最初の空 slot にプレビュー
  を自動配置** する（ドラッグ不要の 1 クリック配置）。既に表示中または空 slot
  なしの場合はトーストで案内。
- **Creation Button の並びを統一**: 💬 チャット → 🖥 ターミナル → 🌐 プレビュー
  の 3 つ（tray 右側、Tooltip 付き）。

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.6.1] - 2026-04-23

**Tray UX Polish** — 削除ボタン + エディタ追加ボタン + チャット名簡潔化。

### ✨ Added

- **チップ削除ボタン** (PM-971)。各チップに小さな ✕ ボタンを追加。クリックで
  chat pane / editor file / terminal pty を閉じ、同時に slot に配置中なら
  slot も自動で空にする。main chat と preview は削除不可。
- **📂 エディタ追加ボタン** (PM-971)。Tray 右側の創造ボタン群に「エディタで
  ファイルを開く」を追加。クリックで Tauri ネイティブのファイルピッカー
  ダイアログが開き、defaultPath を project ルートに指定。選択した
  ファイルは `openFile` で開かれる。
- **チャットチップの簡潔命名** (PM-971)。旧 "Main" / pane-id 抜粋 →
  **「Chat 1」「Chat 2」…** の連番表示に変更。tooltip でメイン判定も案内。

### 🔧 Fixed

- `terminalItems` の label を「Terminal 1」「Terminal 2」…の連番表示に整理
  （旧は `t.title` 直出で冗長）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.6.0] - 2026-04-23

**Workspace-First UI** — タブ廃止、ワークスペースがアプリそのものに。Tray Bar を
icon-first の超コンパクト設計に全面刷新。

### 💎 Changed (Breaking UI)

- **タブ全廃** (PM-970)。旧「チャット / エディタ / ターミナル / プレビュー /
  ワークスペース」の 5 タブを撤去。起動時から常にワークスペース UI を表示。
  チャット / エディタ / ターミナル / プレビューは **slot へドラッグ** して
  初めて表示される設計へ統一。
- **Tray Bar を 1 行コンパクト化** (PM-970)。旧 2 段 (トレイ + レイアウト) を
  1 行に集約、高さ 44px。チップは icon-first で label は 12 文字 truncate +
  tooltip で full name 表示。チャットチップは Main のみ表示で不要な "Chat (main)"
  を削除。

### ✨ Added

- **Tray Bar 内の新規作成ボタン** (PM-970):
  - 💬+ チャット追加（青）
  - 🖥+ ターミナル追加（緑、project cwd で pty_spawn）
  - 🌐 プレビューは project 単位 1 つで常時チップ表示（ボタン不要）
  - 📝 エディタは sidebar ファイル D&D で開く（ボタン不要）
- **Sidebar ファイル → Slot 直接 D&D** (PM-970)。ProjectTree の HTML5 ネイティブ
  ドラッグ（`CCMUX_FILE_PATH_MIME`）を Slot 側で受け、`openFile` + `setSlot`
  を自動実行。`@dnd-kit` と HTML5 のハイブリッドドロップで共存。
- **LayoutSwitcher を Tray Bar 右端に inline 配置** (PM-970)。1 / 2 横 / 2 縦 /
  2x2 をアイコンボタン 4 つで切替。旧 WorkspaceView の独立行は撤去。
- **DragOverlay ghost chip** (PM-970)。ドラッグ中に浮遊するチップを表示、
  視覚フィードバック向上。

### 🔧 Fixed

- (Minor) TrayBar の幅が横に膨れて後続コントロールを押し出す regression

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.5.0] - 2026-04-23

**Workspace Mode** — チャット / エディタ / ターミナル / プレビューをドラッグ&ドロップで自由に組み合わせ表示できるヘテロ分割ワークスペース追加。

### ✨ Added

- **Workspace モード** (PM-969)。画面上部の新タブ「ワークスペース」から起動。
  画面上部に **Tray Bar**（開いている項目のドラッグソース）、下部に **1 / 2 横 / 2 縦 / 4 (2x2)** から選べる slot grid。各 slot にトレイのチップをドロップすると、その項目（chat / editor / terminal / preview）が表示される:
  - 💬 Chat セッション
  - 📝 開いているエディタファイル（PDF / 画像含む）
  - 🖥 ターミナル (pty)
  - 🌐 プレビュー
  - 任意の組み合わせ可能（例: A=Chat / B=Editor、A=Terminal / B=Preview、2x2 で全部入り）
- レイアウト配置は `sumi:workspace-layout` に localStorage 永続化（アプリ再起動後も復元）
- 依存追加: `@dnd-kit/core@^6.3.1` (~30KB、キーボード a11y 込み)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.2] - 2026-04-23

**Readability & Viewer Fixes** — チャット可読性 + PDF / 画像ビューワ対応。

### ✨ Added

- **Tool use 折り畳み表示** (PM-967)。Claude レスポンス中の `Read` / `Edit` /
  `Bash` / `Grep` 等の tool 呼び出しが数十件並んで本質的な回答が埋もれる問題
  に対応。連続する tool use を「N 件の tool 操作」の折り畳みカードに集約
  表示する。チャットヘッダ右上の 👁 toggle ボタンで「詳細表示 ON / OFF」を
  切替可能。**デフォルトは折り畳み ON**（本修正で即座に可読性改善）。
  状態は `sumi:settings` に localStorage 永続化。
- **PDF / 画像 / 動画 / 音声ビューワ** (PM-968)。エディタに PDF を開くと
  Monaco が text として流し込んで文字化けしていた問題を修正。`FileViewer`
  が拡張子を見て適切なビューワにディスパッチする:
  - `.pdf` → WebView2 / WebKit 内蔵 PDF ビューワ（iframe + `asset://` URL）
  - `.png` / `.jpg` / `.webp` / `.gif` / `.bmp` / `.ico` / `.avif` → `<img>`
  - `.svg` → `<img>`（ソース編集は拡張子判定外しで Monaco に切替可能）
  - `.mp4` / `.webm` / `.mov` / `.mkv` → `<video controls>`
  - `.mp3` / `.wav` / `.ogg` / `.flac` / `.m4a` → `<audio controls>`
  - その他 → `<FileEditor>`（Monaco、従来通り）
- **バイナリファイルの上限緩和**: テキストは従来の 1MB 制限のまま、バイナリ
  ビューワ対応ファイルは 50MB まで（PM-968）。`readTextFile` をスキップする
  ことで text / UTF-8 破損のリスクも消滅。

### 🔧 Fixed

- PDF をエディタで開くと文字化けする regression (PM-968)
- チャット画面でツール操作履歴が縦に長く連なり、ユーザー質問と Claude の
  回答が見つけづらい UX 問題 (PM-967)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.1] - 2026-04-23

**Context Fix** — Claude Code CLI 相当のプロジェクトコンテキスト自動読込を実装。

### 🔧 Fixed: Claude がプロジェクト構造 / CLAUDE.md / skill を認識できない regression (PM-966 / DEC-055)

v1.4.0 まで、Sumi で project を開いても Claude が以下を認識できない重大な問題があった:
- `CLAUDE.md` のプロジェクトルール・指示が完全に無視され、Claude が「どのディレクトリですか？絶対パスを教えてください」と聞き返す
- `/ceo` などの skill が SlashPalette に表示されるのに、実行すると「そのスキルは登録されていません」と応答
- Claude が自身の `cwd` を Sumi インストールディレクトリ（`C:\Program Files\Sumi\...`）だと認識し、プロジェクトファイルが見えない

#### 根因（3 層の複合）
1. **sidecar cwd がプロジェクトパスでない** — `send_agent_prompt` が options JSON に `cwd` を含めず、sidecar が `process.cwd() = Sumi インストール dir` にフォールバックしていた
2. **`settingSources` が未指定** — Claude Agent SDK は `settingSources` 未設定のとき CLAUDE.md / .claude/settings.json / commands / skills / MCP を **一切自動読込しない**（Claude Code CLI との差異）
3. **skills 個別登録は実は不要** — SDK は `settingSources` 有効化で `~/.claude/skills/` + `<cwd>/.claude/skills/` を auto-discover する。個別 API 呼出は不要

#### 修正内容
- **`src-tauri/src/commands/agent.rs`**: `send_agent_prompt` の options JSON に以下 2 項目を毎回注入
  - `cwd: handle.cwd` — `SidecarHandle` に起動時保存したプロジェクトパス
  - `settingSources: ["user", "project", "local"]` — Claude Code CLI と同等の file-based 設定読込
- **`sidecar/src/index.ts`**: defense-in-depth として `settingSources` の default を `["user", "project", "local"]` に設定。debug stderr ログに `settingSources` を追加
- **`components/palette/SlashPalette.tsx`**: skill click の toast 文言を「セッションで自動で利用されます」（嘘だった）→「次のプロンプト送信時に Claude が自動で読み込みます」（DEC-055 で実際にそうなった）

#### 挙動変化
- **CLAUDE.md のルールに Claude が従い始める**（user + project 階層）
- **`/ceo` `/dev` 等の slash コマンドが実動作**
- **skills が auto-discover され呼出可能**
- **MCP servers が `.mcp.json` から自動 load**
- sidecar cwd がプロジェクト実パスに設定され、ファイル操作が project root 基準で動作

#### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.0] - 2026-04-23

**The "Sumi" Rename Release** — `ccmux-ide` 改称 + ブランドアイデンティティ + 公式サイト公開。

### 🎨 Rebrand: ccmux-ide → Sumi (墨)

- **製品名を `ccmux-ide` から `Sumi (墨)` に改称** (PM-962 / DEC-053)。「墨の哲学 × モダンテック」をコンセプトに、侘寂 × 静謐 × 職人的 × 濃密の 4 軸で視覚言語を統一
- ロゴ / アプリアイコン / OG image / favicon を新ブランドで刷新。一筆ブラシストローク + 橙の墨滴を採用
- `productName`: `ccmux-ide` → `Sumi`、bundle identifier: `jp.improver.ccmux-ide` → `jp.improver.sumi`、crate name: `ccmux-ide` → `sumi`
- Tauri アイコン 40+ ファイル（desktop / iOS / Android）を 1024px master から再生成 (PM-963)

### 🌐 公式サイト公開

- **https://hironori-oi.github.io/ccmux-ide/** で landing + docs 5 ページ構成の公式サイトを公開 (PM-961)
- Next.js 15 + Tailwind + framer-motion で構築、GitHub Actions で自動デプロイ
- 日本語ファースト、ダークモード default、Hero `Claude Code を、墨でしたためる。`

### 🧹 汎用 Claude Code クライアント化

- claude-code-company 固有要素を完全撤去 (PM-959 / DEC-050)。「日本語ファースト + おしゃれな汎用 Claude Code クライアント」として再定義
- `cwd` scope を slash / skills / memory_tree から完全廃止し、Global / Project の 2 スコープに簡素化 (PM-960 / DEC-051)。デスクトップ IDE では process cwd はユーザー意図と無関係かつ、`~/` に walk して global コマンドが cwd ラベルに誤分類される regression を引き起こしていた

### 🔄 Transparent Migration（v1.3.x からアップグレード時に自動引継ぎ）

- **API Key**: OS keyring の service 名 `ccmux-ide` → `sumi`。旧 service に保存されていた鍵は起動時に自動で新 service へコピー + 旧削除 (PM-963 / DEC-054)
- **Project 一覧**: localStorage `ccmux-project-registry` → `sumi-project-registry`。zustand persist の初回 rehydrate でも空 state にならないよう、safeStorage.getItem を override して transparent 移行
- **UI 設定**（テーマ / アクセント / 壁紙 / フォントサイズ）: localStorage `ccmux-ide-gui:settings` → `sumi:settings`

### ✨ UX 改善

- 起動時に **ウィンドウを最大化** (PM-958)
- エディタ overlay 強度を terminal と同じ `rgba(0, 0, 0, 0.55)` に揃え、壁紙の視認性向上。`backdrop-filter: blur` は除去して壁紙の質感を保つ (PM-956 hotfix5)
- **1 pane エディタの高さが 0px に潰れる regression を修正** (PM-957)。Shell.tsx の viewMode container を `block` → `flex flex-col` に統一、SplitView 1 pane 分岐も `flex-1` → `h-full` で親 context 非依存化
- ブランド表示の重複を解消 (PM-964): Sidebar の `Sumi` ラベルと TitleBar の Sparkles アイコン、ProjectRail の Sparkles 装飾を削除。`Sumi` 表記は OS ウィンドウタイトル + アプリ TitleBar の 2 箇所に正規化
- **エディタタブ左クリックで切替できない regression を修正** (PM-964)。旧版は `DropdownMenuTrigger asChild` で tab div を包んでいたため全クリックが menu 起動を奪っていた。DropdownMenu を削除して純粋な `<div role="tab">` に戻す。閉じる導線は X ボタン + 中クリック（onAuxClick）で維持
- 1 pane チャットヘッダを固定 `Sumi` → `activeProject.title` 動的表示に (PM-965)

### ⚠️ Breaking changes

- **Auto-update 切断**: bundle identifier 変更のため v1.3.x からの auto-update は機能しない。v1.3.x ユーザーは Releases から Sumi バイナリを **手動ダウンロード** してインストールする必要あり
- **Windows install path 変更**: `%LOCALAPPDATA%\ccmux-ide\` → `\Sumi\`（旧版共存可能、手動アンインストールを推奨）
- **`~/.ccmux-ide-gui/` config dir は引き継がれない** — 初回起動は clean state。ただし localStorage + keyring は transparent migration で引継ぎ

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust modules (`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`) are derived from ccmux.

## [v1.3.1] - 2026-04-23

### Added
- **Claude Code MCP (Model Context Protocol) 対応** (PM-955)。5 scope (global / user / user-project / plugin / project-local) の `.mcp.json` / `settings.json` の `mcpServers` を統合走査、SlashPalette に MCP section (emerald accent + Plug icon) で表示。disable 機構 3 系統 (`disabledMcpServers` / `disabledMcpjsonServers` / `enabledPlugins`) も反映、secret (env) 漏洩防止。オーナー環境の stitch / aidesigner / vercel (plugin bundled) / supabase / github / playwright 等を実機認識

### Fixed
- Monaco Editor の背景が透過しすぎて text が壁紙に埋もれる bug を修正 (PM-956)。PM-870 の body `bg-transparent` 化の副作用で editor 背景が継承透過、可読性を失っていた。`bg-background/95` の div で wrap、壁紙は薄く透ける程度に抑制

### Claude Code ecosystem 3 層完成
v1.3.x で Cursor 上の Claude Code と同等の **Slash Command / Skill / Plugin / MCP** 4 層エコシステムに完全対応。

## [v1.3.0] - 2026-04-23

### Added
- **Claude Code skill 機能の可視化** (PM-953)。`~/.claude/skills/<name>/SKILL.md` を走査、SlashPalette に skill section (amber accent + Sparkles icon) で表示。global + project + cwd chain の走査、cwd > project > global override。Claude Agent SDK が session 起動時に first-class 機能として auto-discover するため、表示/preview のみで実機動作する
- **Claude Code plugin 機能の可視化** (PM-954)。`~/.claude/plugins/installed_plugins.json` index から各 plugin の `.claude-plugin/plugin.json` manifest を読込、SlashPalette に plugin section (sky accent + Package icon) で表示。`~/.claude/settings.json` の `enabledPlugins` に従って disabled plugin は dimm 表示。Agent SDK の `SdkPluginConfig` + `reloadPlugins()` first-class support により実行は SDK 側で担保。Cursor 上の Claude Code と同等の plugin ecosystem を ccmux-ide-gui で利用可能に

### Fixed
- E2E CI workflow が `apt-get update` で 20 分 timeout する問題を修正 (PM-952)。`npx playwright install --with-deps chromium` の `--with-deps` 削除 + cache hit 経路の `install-deps` step 撤去。ubuntu-24.04 runner の pre-installed deps で chromium 動作

### Known Issues
- Plugin の install/uninstall/enable toggle UI は v1.4+ で対応 (現状は CLI `claude plugin install` を使用)
- Skill / plugin の drill-down (内部 slash 一覧展開) は v1.4+ で検討
- Phase 2 として per-plugin enable/disable UI + MCP server 起動管理を v1.5+ で計画

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed
- Claude Code skill / plugin ecosystem integration は [Claude Code](https://docs.claude.com/en/docs/claude-code) 公式仕様に準拠

## [v1.2.0] - 2026-04-23

### Added
- **Ctrl+P で File Palette** (VSCode/Cursor Quick Open 相当)。project 内の file を fuzzy 検索して Editor で開く。既存 Rust `list_project_files` + LRU/TTL cache 流用、warm で ~1ms 応答 (PM-948)
- **Terminal keyboard shortcut 7 種** 追加。`Ctrl+Shift+F` 検索 / `C` コピー / `V` paste / `K` clear / `N` 新規 / `W` 閉じる / `Ctrl+Tab` sub-tab 切替。`@xterm/addon-search` で scrollback 検索 (PM-947)
- **SearchPalette tool_use 構造化表示**。tool Badge + field preview + raw snippet の 2 段、`parseToolMessageContent` → regex → raw の 3 段 fallback (PM-900)
- **Preview window 位置・サイズ記憶**。project ごとに persist、次回 open で前回 geometry を復元。onMoved/onResized/onCloseRequested 経由で polling なし (PM-945)
- **session 継続性 system hint**。sidecar resume 時のみ「これは継続中の会話」hint を systemPrompt に additive append、Claude の応答変動を抑制 (PM-850)
- **起動時の project auto-restore**。前回 active だった project を自動選択、stale/null なら先頭 project、空なら未選択 (PM-950)
- **Monaco Editor theme sync**。app の dark/light と preset (Tokyo Night / Catppuccin / Dracula / Nord) に theme 追従、Ctrl+S keybinding (PM-949)
- **File icon 拡張**。docker-compose / bun.lockb / .eslintrc / .nvmrc / Makefile / CMakeLists 等を追加 (PM-949)

### Fixed
- **設定画面のフォントサイズ変更が反映されない bug を修正**。store は persist していたが DOM/Monaco/xterm に apply する処理が未実装だった。Chat / Editor / Terminal 3 pane に live 反映、persist で reload 後も維持 (PM-951)
- `FileEditor.tsx` / `FilePreviewDialog.tsx` で Monaco 存在しない theme 名 `"vs-light"` を渡していた bug を `"vs"` に修正 (silent fallback で気づかれていなかった) (PM-949)

### Known Issues
- In-window Preview (Cursor 同等 UX、案 D2) は Tauri 2 multi-webview `unstable` feature 必要のため **v1.2 でも見送り** (v1.3+ で Tauri stable 化を待って再検討)
- Preview window 新規 spawn 時に一瞬 default サイズが見える可能性 (geometry 適用前) → v1.3 で event pre-apply を検討

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed

## [v1.1.0] - 2026-04-22

### Added
- **Preview タブにアプリ内プレビュー**。Tauri 2 `WebviewWindow` を Rust 側 `WebviewWindowBuilder` で spawn、任意 HTTPS URL (yahoo.co.jp / github.com 等) を別 window で表示可能。user data dir を project/label 別に分離し、Windows WebView2 の multi-webview lock 競合を回避 (PM-943 / PM-944)
- **Terminal scrollback 保持**。tab 切替で xterm が unmount されても 256KB/pty の ring buffer に PTY output を蓄積、再 mount 時に即復元 (PM-941)

### Changed
- **Welcome Wizard 撤去 + Claude 認証自動検出**。起動時に `~/.claude/.credentials.json` の OAuth token を検出、認証済なら即 Workspace、未認証なら toast 案内 + 「ターミナルを開く」誘導 (PM-938)
- **snapshot orchestrate を Shell 側 effect に移管**。project 切替時の streaming 中 message / activity が deep copy で保持され、戻した時に途中のまま復活 (PM-890、PM-810 regression hotfix の縮退を解消)

### Fixed
- **セッション作成時にプロジェクト必須化 (3 層 validate)**。UI disable + tooltip + Store guard + Rust backend rejection (PM-939)
- PreviewPane の Tooltip が `<p>` 内にネストされて起きる React hydration error を `<div>` ラッピングに修正

### Security
- **GitHub Actions を Node 24 対応にバンプ** (PM-940)。`actions/checkout@v6` / `setup-node@v6` / `cache@v5` / `upload-artifact@v7` / `download-artifact@v8` / `action-gh-release@v3` で Node.js 20 deprecation 警告解消 (2026-06 強制切替前に対応済)
- Preview window 用の WebView2 user data dir を `$APPLOCALDATA/preview-webview/{label}/` 配下に分離、メイン webview と credential / cache 共有を回避

### Infra
- `darwin-x86_64` の runner を `macos-13` (deprecated) → `macos-14` (Apple Silicon) に変更、`x86_64-apple-darwin` は cross-compile で生成
- `v1.0.1` → `v1.1.0` tag で workflow 再 trigger、全 4 matrix (win/linux/darwin-x64/darwin-arm64) が macOS 14 以降の runner で安定動作

### Known Issues
- In-window Preview (Cursor 同等 UX、案 D2) は Tauri 2 の multi-webview `unstable` feature が必要なため **v1.1 見送り**。Tauri multi-webview stable 化を待って v1.2+ で再検討
- Preview 別 window の position / size は非記憶 (次回 open で default 位置、v1.2 候補)
- Terminal 4 pane 同時使用時の memory 消費は PTY × 4 + scrollback buffer × 4 (256KB each)
- Node.js 20 deprecation 対応は完了だが、各 action の major bump に伴う細かい挙動差分は dogfood で観察

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed

### Acceptance
- v1.1 実機検証: Preview / Terminal / Welcome 撤去 / セッション必須化 すべて合格
- v1.1-dev branch で 6 PM (938/939/940/890/941/944) + 8 hotfix を累積、実機検証合格で main merge

## [v1.0.0] - 2026-04-21

### Added
- **組込ターミナル本格版** (xterm.js + portable-pty)。cmd / PowerShell / bash / zsh / vim / python REPL 等 interactive command 対応、複数 pty の sub-tab 切替、Windows JobObject による orphan-process 防止 (PM-920 / DEC-045)
- **Preview タブ**。外部ブラウザ連携 (`@tauri-apps/plugin-shell`) による URL プレビュー、プロジェクトごとに last URL を zustand persist (PM-925 / PM-936 / DEC-046 / DEC-048)
- **Chat / Editor / Terminal の 1 / 2 / 4 pane 分割**。shadcn DropdownMenu で mode 切替、4 pane は 2×2 grid (垂直 PanelGroup 内に水平 PanelGroup 2 つ) (PM-924 / PM-937 / DEC-049 / DEC-050)
- **`/effort` slash command**。model-level thinking effort の UI 連携 (PM-840)
- **tool content の JSON 整形表示**。assistant の tool_use / tool_result を humanize、専用 view (Edit / Bash) + 汎用 pretty JSON fallback (PM-831 / PM-880)
- **公式 OAuth Usage API 連携** (Round D')。`GET https://api.anthropic.com/api/oauth/usage` で Pro/Max プランの 5 時間 / 7 日 / 追加クレジット使用率を取得。StatusBar 中央のミニゲージ + サイドバー UsageStatsCard の実値化 (5 分 cache、`claude login` 誘導)

### Changed
- **`/clear` で sidecar 再起動による完全 context リフレッシュ**。従来は conversation reset のみだったが、Claude session jsonl も cleanup (PM-910)
- **Sidebar タブ順序**: ファイル / セッション / ルール / 実行状態 → **セッション / ファイル / ルール / 実行状態**。default active tab も sessions に変更
- **Terminal Shell は conditional mount に移行**。`display:hidden` 常時 mount の 0x0 canvas race を構造的に解消 (PM-935 / DEC-047)
- Round A の `claude /usage` CLI TUI parse 経路を廃止、OAuth API ベースに全面置換 (`lib/stores/oauth-usage.ts` / `hooks/useClaudeOAuthUsage.ts`)

### Fixed
- **Split Sessions で message が誤 pane に届く regression**。pm810-claim/resolve/release の 3-phase routing で sidecar event を正しい pane に配送 (PM-810)
- **Session cache stale で resume 失敗する regression** (v3.5.19)。session 選択時の cache invalidation タイミング制御
- **背景画像が起動時に反映されない bug**。AppearanceSettings 初期化と apply-accent の race (PM-870)
- **Next.js CVE-2025-66478** (HTTP smuggling / SSRF / RCE / DoS 系 15 advisory) を 15.0.3 → 15.5.15 で解消。`npm audit critical 1 → 0` (T1-B)
- **React 19 + zustand infinite loop 3 件**。MessageList / InputArea / ActivityIndicator の selector memoize 修正
- `tailwind.config.ts` の ESM `require()` エラーを ESM import に移行
- Terminal で `term.open()` が 0x0 container で呼ばれ canvas が永続破損する bug (PM-930 → PM-935 で根治)
- Terminal の `pty_kill` deadlock (child mutex 共有で blocking wait が killer を block) を `ChildKiller` 分離で解消 (PM-921)

### Security
- **Tauri asset protocol scope 絞込**: `$HOME/**` → 8 具体 path (`$APPLOCALDATA/**` / `$APPDATA/ccmux-images/**` / `$HOME/.claude/**` / `$HOME/.ccmux-ide-gui/**` / `$HOME/Pictures/**` / `$HOME/Desktop/**` / `$HOME/Downloads/**` / `$HOME/Documents/**`) (T2-D)
- **Frontend console.log を logger wrapper で `NODE_ENV` gate 化**。実コード 12 件を `logger.debug` に置換、warn / error は production でも残置 (T1-C)
- Capability の `fs:scope $HOME/**` と `shell:allow-spawn args:true` は維持 (project cwd / sidecar args 可変要件、v1.1 で Rust 側 dynamic scope + whitelist 化予定) (T2-E)

### Removed
- **Frontend dead code 14 ファイル** (PM-770): `GitPanel` / `WorktreeTabs` / `Inspector` / `ProjectSwitcher` 等、過去の実験 UI で現在参照なし
- **Rust 孤立 command 13 個** (PM-771): `git_*` / `worktree_*` / `status_*` 系、frontend から invoke なしの v3.4 以前残骸

### Known Issues
- Terminal 4 pane は PTY process が project 当たり最大 4 個生成、メモリ消費増 (ユーザ明示選択時のみ)
- Terminal conditional mount の tradeoff として tab 切替で xterm scrollback が reset (PTY 自体は維持、v1.1 で data stream buffering 検討)
- Preview は iframe 撤退のため完全な IDE 内 preview ではなく外部ブラウザ起動式 (v1.1 で Tauri 2 secondary webview window / Phase 4 案 D を再検証)
- OAuth Usage API は Anthropic Beta のため仕様変更の可能性あり (partial `null` 判定で耐性確保)
- WSL2 の日本語 IME は制約あり (Windows native ビルドを推奨)
- 自己署名なし配布のため Windows SmartScreen / macOS Gatekeeper の警告あり (README の回避手順参照)
- Updater は pubkey 未設定のため署名検証 skip (v1.1 で Ed25519 化予定)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed

### Acceptance
- v1.0 readiness audit: `pm-release-readiness-audit.md` (Tier 1 全完了、Tier 2-D/E 完了、Tier 2-G は v1.1 候補)
- リリース手順: [docs/release-checklist.md](./docs/release-checklist.md)

## [v0.1.0] - 2026-04-19
### Added
- 日本語ファーストな Claude Code GUI クライアント（Tauri 2 + Next.js 15）
- Welcome Wizard（API Key 入力 / パーミッション説明 / サンプルプロジェクト）
- 会話履歴 SQLite 永続化（FTS5 横断検索 + セッション管理）
- Monaco DiffEditor による Edit tool 可視化
- Slash Commands 連携（`/ceo` `/dev` `/pm` `/research` `/review` `/secretary` `/marketing` `/web-ops` + プロジェクト内 `.claude/commands/`）
- PRJ-XXX プロジェクトツリー + CLAUDE.md 3 スコープビュー
- ContextGauge / SubAgents / Todos サイドバー常設
- Command Palette（Ctrl+K）+ Slash Palette + Search Palette（Ctrl+Shift+F）
- ダーク / ライトテーマ + 5 種のテーマプリセット（Tokyo Night / Catppuccin Mocha / Dracula / Nord / Claude Orange）+ アクセントカラー
- git worktree 管理 UI（作成 / 切替 / 削除）
- 画像 D&D + Ctrl+V 貼付（Agent SDK streaming input image）
- 自動更新（GitHub Release ポーリング、`tauri-plugin-updater`）
- 配布: Windows NSIS/MSI、macOS DMG (Intel + Apple Silicon)、Linux AppImage/deb

### Known Issues
- WSL2 の日本語 IME は制約あり（Windows native ビルドを推奨）
- 自己署名なし配布のため、Windows SmartScreen / macOS Gatekeeper の警告あり（README の回避手順参照）
- Updater は pubkey 未設定のため署名検証 skip（MVP 許容、M3 PM-304 で Ed25519 化予定）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust モジュール（`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`）は ccmux から派生（DEC-008 / DEC-022）

### Acceptance
- M3 AC チェックリストは [docs/m3-acceptance-criteria.md](./docs/m3-acceptance-criteria.md) を参照（起動時間 / バイナリサイズ / RAM / 7 日 dogfood / 画像 D&D 20 連続 / E2E 10 シナリオ / 友人配布テスト）
- リリース手順は [docs/release-checklist.md](./docs/release-checklist.md) を参照
