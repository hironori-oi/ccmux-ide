# スクリーンショット撮影要領（PM-301 / PM-302 併設）

本ドキュメントは README.md に掲載する 5 枚 + 1 枚（Defender 回避）の撮影要領を定義する。オーナー本人が Windows ネイティブビルド完成後に撮影する前提。

- 関連タスク: PM-301（5 枚配置）/ PM-302（30 秒デモ動画）
- 保存先: `docs/screenshots/`
- フォーマット: PNG、解像度 1920x1080（1 枚 500 KB〜2 MB 目安）
- 撮影環境: Windows 11 ネイティブビルドの Sumi、ダークテーマ（Tokyo Night Storm base）、システムフォント Geist

---

## 共通ルール

- OS: Windows 11 22H2 以降、Display Scaling 100%（DPI 上げず）
- ウィンドウサイズ: 1400x900（Windows Snap 右上領域）
- テーマ: ダーク（Tokyo Night Storm）、アクセント Claude Orange
- 背景: `rgb(24, 25, 34)`（Tokyo Night base）
- マウスカーソルは映さない（Snipping Tool で矩形選択 or `Win+Shift+S`）
- 個人情報（API Key 末尾 4 桁 / メールアドレス / 自宅 PC 名 / private project 名）はモザイク or ダミーに差し替え
- Claude の返答内容は「Hello! How can I help you today?」等の無害なやり取りに統一

---

## 1. `hero.png` — Welcome 画面 Step 1

**撮影内容**:
- Sumi を起動 → Welcome Wizard Step 1（ブランド紹介）
- 3 カード（「Claude と対話」「マルチエージェント並列」「画像貼付 + diff」）が表示されている状態
- 下部の「始める」ボタンが有効
- framer-motion fade-in が完了した後の静止画

**ファイル名**: `hero.png`
**優先度**: 最高（README 冒頭に表示される）
**サイズ目安**: 1920x1080、1.5 MB 以下

---

## 2. `chat.png` — Workspace チャット画面

**撮影内容**:
- Workspace で Claude と 2〜3 往復したチャット画面
- 左サイドバー: Session 一覧（2〜3 個のダミーセッション名、例: 「ログイン機能の実装」「README 執筆」「画像認識テスト」）
- 中央: ユーザーメッセージ + Claude 応答（Markdown render + code block + 日本語）
- 右サイドバー: ContextGauge（緑ゾーン、50% 程度）+ SubAgents（空でも可）
- StatusBar 下部: Claude Sonnet / context 50% / main branch

**ファイル名**: `chat.png`
**優先度**: 高
**サイズ目安**: 1920x1080、2 MB 以下

---

## 3. `diff.png` — Monaco DiffEditor 展開状態

**撮影内容**:
- ToolUseCard の `Edit` tool を展開した状態
- DiffViewer が before（赤）/ after（緑）の 2 カラムで差分表示
- 対象ファイルは TypeScript（例: `app/page.tsx` への変更）、10 行程度の差分
- シンタックスハイライト有効
- チャット上部に「Claude が app/page.tsx を編集しました」等のメッセージ

**ファイル名**: `diff.png`
**優先度**: 高（差別化軸 B 訴求）
**サイズ目安**: 1920x1080、1.5 MB 以下

---

## 4. `sidebar.png` — Sidebar（Project + Session + ContextGauge）

**撮影内容**:
- 左サイドバーにフォーカスしたスクリーンショット
- ProjectSwitcher dropdown が開いている状態（登録済みプロジェクトの一覧）
- 選択中プロジェクトの ProjectTree（README / package.json / src/ など一般的なファイルツリー）
- Session 一覧（3〜5 個）
- 右側に ContextGauge + SubAgents + Todos（TodosList に 2〜3 項目）
- 中央チャットは薄く blur（サイドバーを主役化）

**ファイル名**: `sidebar.png`
**優先度**: 中〜高（差別化軸 C 訴求）
**サイズ目安**: 1920x1080、2 MB 以下

---

## 5. `palette.png` — Ctrl+K CommandPalette

**撮影内容**:
- `Ctrl+K` で CommandPalette ダイアログが開いた状態
- 入力欄に部分一致で「set」等を入力、「Open Settings」候補がハイライト
- 5 グループ表示（セッション / チャット / 表示 / 検索 / Git）
- 背景の Workspace は半透明オーバーレイで暗く

**ファイル名**: `palette.png`
**優先度**: 中
**サイズ目安**: 1920x1080、1 MB 以下

---

## 6. `defender-bypass.png` — SmartScreen 回避手順（PM-284）

**撮影内容**:
- Windows Defender SmartScreen の「PC を保護しました」警告ダイアログ
- 「詳細情報」リンクを展開した状態（「実行」ボタンが表示されている）
- README.md のインストール手順で参照される

**ファイル名**: `defender-bypass.png`
**優先度**: 中（Windows ユーザー向け UX 補助）
**サイズ目安**: 800x600〜1200x800、500 KB 以下

**撮影方法**:
- VM or クリーン環境で未署名 `.exe` をダウンロード → ダブルクリック → SmartScreen 警告発生時にキャプチャ
- 既存ユーザーのマシンでは SmartScreen が抑制されているため再現困難、VM 推奨

---

## デモ動画（PM-302、参考）

本ドキュメントは静止画中心だが、PM-302 で 30 秒デモ動画も撮影予定。要領:

- ツール: OBS Studio または ShareX
- 解像度: 1920x1080、30 fps
- 長さ: 25〜35 秒
- 流れ:
  1. 0〜3 秒: Sumi 起動 → Welcome 画面
  2. 3〜8 秒: Welcome Wizard 通過（API Key は既入力でスキップ or ダミー）
  3. 8〜15 秒: Workspace でチャット送信 → Claude 応答 streaming
  4. 15〜22 秒: 画像を D&D → Vision で説明させる
  5. 22〜28 秒: `/ceo` を入力 → SlashPalette から選択、または Ctrl+K CommandPalette 起動
  6. 28〜30 秒: Monaco DiffEditor が展開される瞬間で fade out
- 保存先: `docs/screenshots/demo.mp4`（または YouTube unlisted + 埋込）
- README.md 冒頭のヒーロー画像の下に埋込 or リンク

---

## 撮影後チェックリスト

- [ ] 全 5 枚（hero / chat / diff / sidebar / palette）が `docs/screenshots/` に配置
- [ ] `defender-bypass.png` 配置
- [ ] README.md のスクリーンショットセクションから相対パスで参照可能
- [ ] 個人情報のモザイク / ダミー置換が完了
- [ ] PNG ファイルサイズが合計 10 MB 以下（GitHub repo への push を考慮）
- [ ] デモ動画（PM-302、任意）配置 or リンク

---

## 現状ステータス

- 本ドキュメント作成時点（Week 8 Chunk 3 完了時）では **placeholder のみ存在**
- Windows ネイティブビルド完成後に撮影（PM-281 build-windows.yml 経由の artifact で起動確認）
- 撮影者: オーナー本人
