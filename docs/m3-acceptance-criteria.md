# M3 Full MVP 受入判定チェックリスト

本ドキュメントは PRJ-012 Sumi の **M3 Full MVP（Week8 末）** 到達判定の受入基準（Acceptance Criteria）を定義する。各項目は計測方法と判定基準（PASS / FAIL / 保留）を持ち、週末の自己検収で実測値を埋める。

- 関連: `projects/PRJ-012/brief.md` § 新 M3 Full MVP / `tasks.md` PM-291 / `decisions.md` DEC-013 DEC-025
- 判定者: オーナー本人（兼 CEO 兼 /dev）
- 判定日: Week8 末（予定）

---

## 判定サマリテーブル

| # | 項目 | 基準 | 実測 | 判定 |
|---|---|---|---|---|
| AC-01 | 起動時間 | < 1.5 秒 | — | — |
| AC-02 | バイナリサイズ | 20〜50 MB（NSIS 本体） | — | — |
| AC-03 | RAM 使用量 | 30〜80 MB（idle） | — | — |
| AC-04 | Cursor / 公式 Desktop 起動ゼロ | 7 日連続 | — | — |
| AC-05 | 画像 D&D 連続成功 | 20 回連続成功 | — | — |
| AC-06 | API Key → Claude 応答 | 3 ステップ以内 | — | — |
| AC-07 | E2E 10 シナリオ緑 | 全 10 シナリオ PASS | — | — |
| AC-08 | 友人配布テスト | 1 人 Full Win 判定 | — | — |

**総合判定**: — （M3 到達 / 一部未達許容 / 未達）

---

## AC-01: 起動時間 < 1.5 秒

**計測方法**:
- Tauri バイナリダブルクリック → window visible（Welcome 画面描画完了）までを stopwatch アプリで手動計測
- または Rust 側 `std::time::Instant::now()` を `main()` 冒頭に仕込み、Next.js 側で `window.addEventListener('load')` 時に invoke で報告して差分ログ
- 各 OS で 5 回計測、中央値を採用
- 対象: 初回起動（ウォームアップなし）と 2 回目以降（キャッシュあり）を分けて記録

**基準**:
- **PASS**: 初回 < 2.0 秒、2 回目以降 < 1.5 秒
- **保留**: 初回 2.0〜3.0 秒、2 回目以降 1.5〜2.0 秒（Windows WebView2 の初期化待ち許容）
- **FAIL**: 2 回目以降が 2.0 秒超

**実測（Windows 11 native）**: ______ 秒（初回 / 2 回目以降）
**実測（WSL2 WebKitGTK）**: ______ 秒
**実測（macOS）**: ______ 秒（もし入手可能なら）

---

## AC-02: バイナリサイズ 20〜50 MB（NSIS 本体）

**計測方法**:
- GitHub Actions の `build-windows.yml` artifact から `Sumi_0.1.0_x64-setup.exe`（NSIS）のサイズを取得
- `.msi` / `.dmg` / `.AppImage` / `.deb` も参考値として記録

**基準**:
- **PASS**: NSIS が 20〜50 MB
- **保留**: 50〜80 MB（画像アセット過多など原因特定要）
- **FAIL**: 80 MB 超 or 10 MB 未満（sidecar bundle 漏れ疑い）

**実測**:
- NSIS `.exe`: ______ MB
- MSI `.msi`: ______ MB
- DMG `.dmg`: ______ MB（macOS CI）
- AppImage: ______ MB
- deb: ______ MB

---

## AC-03: RAM 使用量 30〜80 MB（idle）

**計測方法**:
- Sumi 起動 → Welcome 通過 → Workspace idle 状態で 30 秒待機
- Windows: タスクマネージャー「詳細」タブの `Sumi.exe` と `WebView2` 関連プロセスの合計を記録
- Linux: `ps -o rss -p $(pgrep Sumi)` で RSS を kB 単位取得
- macOS: アクティビティモニタの `Sumi` 実メモリ

**基準**:
- **PASS**: 30〜80 MB
- **保留**: 80〜150 MB（DevTools 有効時許容）
- **FAIL**: 150 MB 超

**実測（Windows）**: ______ MB（Sumi.exe + WebView2 合計）
**実測（Linux）**: ______ MB

---

## AC-04: Cursor / 公式 Claude Code Desktop 起動ゼロ 7 日連続

**計測方法**:
- PM-220 の dogfood 期間（Week 6 末〜Week 7 中）で実施済 / 継続
- 日毎に `projects/PRJ-012/progress.md` の M2 dogfood セクションへ「Cursor 起動回数 / 公式 Desktop 起動回数 / Sumi 起動時間」を記録
- 1 回でも Cursor / 公式 Desktop を起動したらカウンタリセット、7 日連続ゼロを目指す

**基準**:
- **PASS**: 7 日連続ゼロ達成（AC2-1 / M2 Gate-E2v3 と兼用）
- **保留**: 5〜6 日連続（部分 Win、M3 判定は許容）
- **FAIL**: 4 日以下で中断

**実測**: Day 1 ___ / Day 2 ___ / Day 3 ___ / Day 4 ___ / Day 5 ___ / Day 6 ___ / Day 7 ___
**最長連続日数**: ______ 日
**備考**: （Cursor / 公式を起動した場合の理由を記載）

---

## AC-05: 画像 D&D 20 回連続成功

**計測方法**:
- Sumi Workspace のチャット入力欄へ PNG 画像を 20 回連続 D&D（または Ctrl+V）
- 各回で以下を確認:
  1. ImageThumb に画像サムネ表示
  2. sonner トースト「画像を貼り付けました」表示
  3. 送信後に Claude が画像内容を認識して返答
- 画像サイズ・フォーマット混合（PNG / JPEG / BMP / GIF / WebP、1 KB〜5 MB）

**基準**:
- **PASS**: 20/20 成功、失敗時は error toast が明示的に出る
- **保留**: 18〜19/20（稀な clipboard race）
- **FAIL**: 17/20 以下 or silent failure あり

**実測**: ______ / 20 成功
**失敗時のエラー内容**: （あれば記載）

---

## AC-06: API Key 入力 → Claude 応答まで 3 ステップ

**計測方法**:
- 初回起動（clean install、keyring / localStorage / ~/.claude/.credentials.json 全削除）で計測
- ステップカウント:
  1. Welcome Wizard Step 1 → 「始める」
  2. Step 2 で API Key 貼付 → 「次へ」（または Max プランなら Skip）
  3. Step 3 「理解した、続ける」 → Step 4 Skip → Workspace 到達
- Workspace のチャット入力欄に「こんにちは」と打ち Enter、Claude 応答到達まで計測

**基準**:
- **PASS**: Welcome → 入力 → 応答 が 3 ステップ以内、応答到達まで 60 秒以内
- **保留**: 4 ステップ or 60〜120 秒
- **FAIL**: 5 ステップ超 or エラーで到達不可

**実測**: ______ ステップ / ______ 秒
**備考**: （step の内訳）

---

## AC-07: E2E テスト 10 シナリオ緑

**計測方法**:
- PM-290（Chunk 2 担当）が Playwright for Tauri で構築した 10 シナリオを CI 上で実行
- 対象シナリオ:
  1. Welcome Wizard 4 ステップ完走
  2. API Key 入力 → keyring 保存 → 再起動で復元
  3. チャット送信 → streaming 応答
  4. 画像 Ctrl+V → 送信 → Vision 応答
  5. Monaco DiffEditor で Edit tool の diff 展開
  6. Ctrl+K CommandPalette → Open Settings → 戻る
  7. `/` SlashPalette → `/ceo` 選択
  8. Ctrl+Shift+F 全文検索 → ヒット → 該当 session ロード
  9. Settings で theme 切替（Tokyo Night ↔ Claude Orange）
  10. Updater ポーリング（mock）

**基準**:
- **PASS**: 10/10 緑
- **保留**: 9/10（1 件 flaky で再実行緑）
- **FAIL**: 8/10 以下

**実測**: ______ / 10
**失敗シナリオ**: （あれば記載）

---

## AC-08: 友人 1 人に配布テスト（Full Win 判定）

**計測方法**:
- PM-292 でオーナー実施
- 非エンジニアの友人 or 家族 1 人に Windows NSIS installer を配布
- 以下のチェックシートに基づき verification:

### 配布先 verification チェックシート

配布先が実施する項目（Sumi 初見ユーザー視点）:

- [ ] インストール成功（SmartScreen 警告回避込み、README 手順に従える）
- [ ] 初回起動で Welcome Wizard が日本語で表示される
- [ ] Step 2 で Anthropic API Key（別途発行して共有）を貼り付け → 接続テスト成功
- [ ] Step 4 完走 or Skip で Workspace 到達
- [ ] チャットで「こんにちは」と送信 → Claude が日本語で応答
- [ ] 画像（任意の PNG）をチャット入力欄に D&D → 送信 → Claude が画像内容を説明
- [ ] Ctrl+K で CommandPalette が開く（操作してみる）
- [ ] 意図せずクラッシュしない（15 分使って不具合遭遇なし）

**基準**:
- **PASS（Full Win）**: 全項目クリア、配布先が「普通に使える」と評価
- **保留（Partial Win）**: 6〜7 項目クリア、手順で詰まったが最終的に解決
- **FAIL**: 4 項目以下、インストール or API Key 入力で挫折

**実測**: ______ / 8 項目
**配布先コメント**: （ヒアリング内容）

---

## 判定フロー

1. 各 AC に実測値を記入 → PASS / 保留 / FAIL を判定
2. PASS ≥ 6 / 8 かつ FAIL = 0 → **M3 Full MVP 到達**、v0.1.0 正式リリース判定（DEC-029 公開判断と併せて）
3. PASS 4〜5 / 8 → **M3 一部未達**、バッファ消化してリトライ or v0.1.0-rc として限定公開
4. PASS ≤ 3 / 8 → **M3 未達**、Gate-E2v3 リカバリ A/B/C/D 発動判断（`brief.md` § 撤退基準）

---

## 参考

- 関連タスク: PM-280〜292（配布 + 自己検収）、PM-300〜303（README + デモ動画 + v0.1.0 tag）
- 関連 DEC: DEC-013（配布パイプ、未署名許容）、DEC-025（Gate 基準）、DEC-029 候補（public 化判断）
- 過去の M1 / M2 判定実績: `progress.md` の「深夜拡張」セクション群参照
