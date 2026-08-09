/* ============================================================
 * Kunimare Brewery — 来訪管理 / Visitor Management
 * config.js — edit here to adapt to your Notion workspace.
 * ============================================================ */

export const CONFIG = {
  appName: "Kunimare 来訪管理",
  brandJa: "国稀ブルワリー",
  brandEn: "KUNIMARE BREWERY",

  // ---- Notion ----
  notionVersion: "2025-09-03",
  // 全体スケジュール data source (collection) id:
  dataSourceId: "26ff5289-a51c-806a-bec4-000b77aae1bf",
  // Database page (for opening links in Notion):
  databaseUrl: "https://www.notion.so/26ff5289a51c80618debc86af268be2f",

  // Exact property names in 全体スケジュール — must match Notion.
  props: {
    title: "名前",
    date: "日付",
    category: "カテゴリー",
    deptCategory: "部門カテゴリー",
    person: "担当者",
    files: "ファイル&メディア",
    done: "完了",
    minutes: "議事録",
    minutesAuthor: "議事録作成者",
    visitorName: "訪問者名",
    company: "会社・所属",
    visitorCount: "訪問人数",
    areas: "訪問エリア",
    via: "紹介・経由",
    purpose: "訪問目的",
    inOut: "入退場時間",
    hygiene: "衛生チェック",
    visitStatus: "訪問ステータス",
    phone: "電話番号",
    email: "メール",
    plan: "プラン",
    nomihodai: "飲み放題",
    reminder: "リマインド（自動）",
    deptCategory: "部門カテゴリー",
  },

  // Select options (must exist in Notion — created 2026-08-03)
  visitCategories: ["来客", "業者", "取材", "団体／バス", "外部監査・検査", "顧客予約", "製造"],
  defaultCategory: "来客",
  purposes: ["工場視察", "商談・打ち合わせ", "監査・検査", "取材", "観光・ツアー", "納品・メンテナンス", "その他"],
  areas: ["醸造室（仕込）", "発酵・貯酒タンク", "充填・パッケージング", "原料倉庫", "冷蔵庫・出荷場", "タップルーム・店舗", "会議室", "その他"],
  hygieneItems: ["体調確認OK", "帽子・ヘアネット", "作業着・白衣", "手洗い・消毒", "アクセサリー除去"],
  statuses: { reserved: "予約済", visited: "来訪済", reported: "報告書済", cancelled: "キャンセル" },

  // ---- CORS relays (Notion API refuses direct browser calls) ----
  relays: [
    { id: "worker", labelJa: "自前リレー（Cloudflare Worker 推奨）", labelEn: "Own relay (Cloudflare Worker, recommended)", build: (url, custom) => (custom || "").replace(/\/$/, "") + "/" + url.replace(/^https:\/\/api\.notion\.com\//, "") },
    { id: "corsproxy", labelJa: "corsproxy.io（公共・設定不要）", labelEn: "corsproxy.io (public, zero-setup)", build: (url) => "https://corsproxy.io/?url=" + encodeURIComponent(url) },
    { id: "corssh", labelJa: "proxy.cors.sh（公共・予備）", labelEn: "proxy.cors.sh (public, backup)", build: (url) => "https://proxy.cors.sh/" + url },
  ],

  timezoneOffset: "+09:00",
  docPrefix: "KV", // 来訪報告書 prefix e.g. KV-20260803-01

  // ---- Cloudflare Worker (relay + public booking API) ----
  // Baked in so every device works with ZERO setup. The Notion token lives
  // in the Worker as a secret (NOTION_TOKEN) — never in this public repo.
  workerUrl: "https://kunimare-book.pratik-biswas.workers.dev",

  // ---- Beer hall booking (ビヤホール予約) ----
  booking: {
    docPrefix: "BH",             // ご予約確認書 prefix
    category: "顧客予約",         // カテゴリー for bookings
    deptCategory: "ビヤホール",    // 部門カテゴリー for bookings
    plans: ["コース", "アラカルト", "未定"], // edit to real course names anytime (must exist in Notion プラン options)
    defaultDurationMin: 120,
  },

  pdf: {
    pageW: 595.28, pageH: 841.89, // A4 pt
    margin: 46,
    scale: 3, // raster scale (≈216dpi)
    logo: "assets/logo.png",
    footer: "assets/footer.png",
    fontRegular: "assets/NotoSansJP-Regular.otf",
    fontBold: "assets/NotoSansJP-Bold.otf",
  },

  ocr: {
    // tesseract.js is loaded lazily from CDN (first that responds)
    cdns: [
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
      "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js",
    ],
    langs: "jpn+eng",
    maxPdfPages: 10,
  },
};
