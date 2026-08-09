# Kunimare 来訪管理 / Visitor Management App

国稀ブルワリーの **来訪予約・来訪報告書** アプリ。GitHub Pages でそのまま動く静的アプリです。
Bilingual (日本語/English) visitor reservation & official report app for Kunimare Brewery, built for GitHub Pages.

- 来訪の **予約・変更・キャンセル**（Notion 全体スケジュールと同期）
- **来訪報告書** の作成 → 公式書式の **日本語PDF**（ロゴ・フッター入り）を自動生成
- 添付（画像・PDF）の **自動テキスト抽出（OCR：日本語+英語）**
- 生成PDFを Notion の該当スケジュール（ファイル&メディア）へ **自動添付**
- 進行状況が見える **プログレスバー**（OCR → PDF → Notion同期 → 添付）
- HACCP対応の **衛生チェック**、入退場時間、紹介・経由、立入りエリアを記録

---

## 1. デプロイ（GitHub Pages）

1. このフォルダーの中身をそのまま GitHub リポジトリに push
2. リポジトリの **Settings → Pages → Source: Deploy from a branch**、Branch: `main` / `(root)` を選択
3. 数分後 `https://<ユーザー名>.github.io/<リポジトリ名>/` で開けます

> ⚠️ **公開リポジトリにトークンを絶対に書き込まないでください。** トークンはアプリの設定画面から入力し、その端末のブラウザ（localStorage）にのみ保存されます。

## 2. Notion 連携（ゼロ設定運用・約3分／初回のみ）

**v1.2以降、各端末での入力は一切不要です。** トークンは Cloudflare Worker にシークレットとして1回だけ保存し、スタッフアプリ・公開予約ページの両方がそれを使います。

1. https://www.notion.so/my-integrations → **New integration**（Workspace: 会社 ／ Read・Update・Insert）→ `ntn_…` をコピー
2. Notion で **スケジュール** ページ → 右上「⋯」→ **接続** → インテグレーションを追加
3. Cloudflare Worker → **Settings → Variables and Secrets** → `NOTION_TOKEN`（Secret）にトークンを保存
4. （推奨）`STAFF_KEY` シークレットも設定 → スタッフは各端末で**1回だけ**設定画面にキーを入力。未設定なら入力ゼロだが、スタッフURLを知る人は誰でもDBを操作できる点に注意

Worker URL・データソースID・リレー方式・ロゴはすべて `config.js` に組込み済み（プリロード）。設定画面のトークン欄は「個別トークンで動かしたい場合」のみ使う任意項目です。

## 3. 接続方法（リレー）について

Notion API はブラウザからの直接呼び出しを許可していないため、リレー経由で通信します。

| 方式 | 設定 | 特徴 |
|---|---|---|
| **corsproxy.io**（初期値） | 不要 | すぐ使える。公共サービスのため稀に不安定 |
| proxy.cors.sh | 不要 | 予備の公共リレー |
| **Cloudflare Worker（推奨）** | 約5分 | 自前・無料・安定。`cloudflare-worker.js` をコピペでデプロイし、設定画面でURLを入力 |

Worker の設置手順は `cloudflare-worker.js` の冒頭コメントに記載しています。

## 4. ロゴ・フッター画像の差し替え

- `assets/logo.png` … PDFヘッダー左上のロゴ（現在はプレースホルダー）
- `assets/footer.png` … PDF最下部の帯画像（現在はプレースホルダー）

同名で上書きするだけで、アプリとPDFの両方に反映されます。
（設定画面から端末ごとに一時的な差し替えも可能）

## 5. Notion プロパティ対応表

アプリが読み書きする 全体スケジュール のプロパティ：

| プロパティ | 型 | 用途 |
|---|---|---|
| 名前 | title | 件名 |
| 日付 | date | 訪問日時（開始〜終了） |
| カテゴリー | select | 来客・業者・取材など |
| 訪問者名 / 会社・所属 / 紹介・経由 | text | Who / How |
| 訪問人数 | number | 人数 |
| 訪問エリア | multi-select | Where（立入りエリア） |
| 訪問目的 | select | 目的 |
| 入退場時間 | date (range) | 入場〜退場 |
| 衛生チェック | multi-select | HACCP チェック項目 |
| 訪問ステータス | select | 予約済→来訪済→報告書済 |
| ファイル&メディア | files | 生成PDFの添付先 |
| 議事録・完了 | checkbox | 報告書作成時に自動✓ |

プロパティ名を変更した場合は `config.js` の `props` を合わせてください。

## 6. ビヤホール予約（公開予約フォーム）🍺

`book.html` が **お客様向けの公開予約ページ** です（例：`https://<ユーザー名>.github.io/<リポジトリ名>/book.html`）。QRコードやSNSリンクで共有できます。

- **仮予約制**：送信するとNotionの全体スケジュールに「カテゴリー＝顧客予約／部門カテゴリー＝ビヤホール／訪問ステータス＝予約済」で登録され、スタッフが電話・メールで確定します
- **リマインド**：`リマインド（自動）` に **前日** の日付が自動で入ります（Notion側のリマインド運用がそのまま使えます）
- **ご予約確認書PDF** が自動生成され、その予約ページの「ファイル&メディア」に添付＋お客様側でもダウンロードできます
- 電話で受けた予約は、スタッフアプリの **予約 → ビヤホール予約** から同じ流れで登録できます
- プラン名は `config.js` の `booking.plans` で変更可（Notionの「プラン」選択肢にも同名を追加してください）

### 公開予約の有効化（Worker必須・約5分）

公開ページはトークンを持てないため、Cloudflare Worker 経由でNotionに書き込みます。

1. `cloudflare-worker.js` を Cloudflare にデプロイ（ファイル冒頭の手順どおり）
2. Worker の **Variables and Secrets** に登録：
   - `NOTION_TOKEN` … インテグレーションのトークン（Secret）
   - `ALLOWED_ORIGIN` … `https://<ユーザー名>.github.io`（推奨）
3. `config.js` の `booking.workerUrl` に Worker のURL（`https://xxx.workers.dev`）を記入して push

> 🔒 セキュリティ：Workerが**トークンを使うのは `/book`（予約作成）だけ**です。それ以外の中継はアプリ側から届くトークンを転送するのみで、URLを知っている第三者がDBを読み書きすることはできません。`/book` は入力検証＋ハニーポットでボット対策済み。

## 7. 補足

- **OCR** は初回実行時に OCRエンジン（tesseract.js）をCDNから読み込みます（要インターネット）。PDFの文字抽出はオフラインでも動作します。
- **PDFは画像ベース**（全端末で同一の見た目・日本語フォント埋め込み相当）。報告書の全文は Notion ページ本文にもテキストとして書き込まれるため、検索性は保たれます。
- デモモード（トークン未設定時）はブラウザ内保存で全機能を試せます。
- `reports/` に生成済みの報告書PDF（エコラボ・BIFUKA BEER VILLAGE）を同梱しています。

---

# English

**Visitor reservation & official report app** for Kunimare Brewery. Static app — runs on GitHub Pages as-is.

Reserve / reschedule / cancel visits (synced to the Notion 全体スケジュール database), create official Japanese-format visit report PDFs (logo header + footer), OCR attachments (JA+EN), auto-attach the PDF to that day's schedule entry, with a step-by-step progress bar. Records HACCP hygiene checks, entry/exit times, introduced-by, and areas visited.

**Deploy**: push this folder to a GitHub repo → Settings → Pages → deploy from branch → open `https://<user>.github.io/<repo>/`.

**Notion**: create an integration at notion.so/my-integrations, connect it to the スケジュール page (⋯ → Connections), paste the token in the app's Settings → Test → Save. The token is stored only in that browser — never commit it to the repo.

**Relay**: Notion's API blocks direct browser calls, so requests go through a relay. Default is corsproxy.io (zero setup). For production stability, deploy `cloudflare-worker.js` (free, ~5 min, instructions inside the file) and select "Own relay" in Settings.

**Branding**: replace `assets/logo.png` and `assets/footer.png` (placeholders) with the real images — both the app header and the PDF pick them up.

**Beer hall booking**: `book.html` is the public reservation page (share the URL / QR). Bookings are tentative — they land in 全体スケジュール as 顧客予約/ビヤホール with status 予約済, a day-before date in リマインド（自動）, and an auto-generated confirmation PDF attached; staff confirm by phone. Phone bookings can be entered from the staff app via 予約 → ビヤホール予約. To enable the public page: deploy `cloudflare-worker.js`, set the `NOTION_TOKEN` secret and `ALLOWED_ORIGIN`, then put the worker URL into `config.js` → `booking.workerUrl`. The worker uses the stored token **only** for the validated `/book` endpoint; the staff relay still requires each client's own token.

**Notes**: OCR loads tesseract.js from a CDN on first use (internet required); PDF text extraction works offline. PDFs are image-based for identical rendering everywhere; the full report text is also written into the Notion page body, so everything stays searchable. Demo mode (no token) stores everything locally so you can try the full flow safely.
