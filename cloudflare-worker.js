/* ============================================================
 * Kunimare 来訪管理 — Notion relay + 公開ビヤホール予約API
 * (Cloudflare Worker)
 * ------------------------------------------------------------
 * このWorkerは2つの役割を持ちます：
 *
 *  A) スタッフ用アプリの中継（リレー）
 *     ブラウザ → Worker → api.notion.com。トークンはアプリ側から
 *     Authorization ヘッダーで届いたものを転送します。届かない場合のみ
 *     Workerに保存した NOTION_TOKEN を注入します（STAFF_KEY で保護可）。
 *
 *  B) 公開予約API（/book）
 *     POST /book … お客様向け book.html からの送信を受け、NOTION_TOKEN
 *       （Workerのシークレット）でNotionに予約ページを作成します。
 *       ・カテゴリー=顧客予約／部門カテゴリー=ビアホール（複数選択）
 *       ・訪問ステータス=予約済（仮予約）
 *       ・担当者=Pratik／議事録作成者=Pratik＋Kunimare Visit App
 *       ・リマインド（自動）= 前日
 *       ・ご予約確認書PDFを「ファイル&メディア」に添付
 *     GET /book  … 動作確認用。デプロイ済みの WORKER_VERSION を返します。
 *
 * ◆ 設置手順（約5分）
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. このファイルを丸ごと貼り付けて Deploy
 *   3. Settings → Variables and Secrets：
 *        NOTION_TOKEN   = ntn_…（シークレットとして保存。公開予約に必須）
 *        ALLOWED_ORIGIN = https://<ユーザー名>.github.io（推奨。複数はカンマ区切り）
 *        STAFF_KEY      = 任意の合言葉（スタッフ中継を保護したい場合）
 *   4. スタッフアプリ：設定 → 接続方法「自前リレー」＋ Worker URL
 *   5. 公開予約：config.js の workerUrl に Worker URL を設定
 *   6. 確認：ブラウザで https://<worker>.workers.dev/book を開き、
 *      "version" が下の WORKER_VERSION と同じならデプロイ完了です。
 * ============================================================ */

const WORKER_VERSION = "2026-10-01b";
const NOTION = "https://api.notion.com";
const NOTION_VERSION = "2025-09-03";

// ▼ Notionの物件名（全体スケジュール）— 変更した場合はここも合わせる
const DATA_SOURCE_ID = "26ff5289-a51c-806a-bec4-000b77aae1bf";
const P = {
  title: "名前", date: "日付", category: "カテゴリー", dept: "部門カテゴリー",
  status: "訪問ステータス", visitor: "訪問者名", company: "会社・所属",
  count: "訪問人数", phone: "電話番号", email: "メール",
  plan: "プラン", nomihodai: "飲み放題", reminder: "リマインド（自動）", files: "ファイル&メディア",
  person: "担当者", minutesAuthor: "議事録作成者",
};
// 部門カテゴリー は Notion 側で「複数選択（multi_select）」。既存の選択肢は
// 「ビアホール」（ア）なので、config.js の booking.deptCategory と同じ綴りにすること。
const BOOK = { category: "顧客予約", dept: "ビアホール", status: "予約済" };
// ▼ 予約ページ作成時に自動で入れる担当者（Notion ユーザーID）。行ごとの変更は Notion 上で。
//   担当者        = Pratik
//   議事録作成者  = Pratik ＋ Kunimare Visit App（インテグレーション）
const OWNER_ID = "2dfd872b-594c-81a2-a6ee-00026d1a9f98";
const BOT_ID   = "3b6f5289-a51c-8120-83ac-0027e5501d33";
const OWNERS = {
  person: [OWNER_ID],
  minutesAuthor: [OWNER_ID, BOT_ID],
};
const people = (ids) => ({ people: ids.map((id) => ({ object: "user", id })) });
const PLANS = ["コース", "アラカルト", "未定"]; // config.js booking.plans と同じ
const MAX_PDF_BYTES = 3_000_000;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    /* ---------- B) 公開予約API ---------- */
    if (url.pathname === "/book") {
      if (request.method === "GET") {
        return json({ ok: true, service: "kunimare-book", version: WORKER_VERSION, booking: !!env.NOTION_TOKEN }, 200, cors);
      }
      if (request.method === "POST") {
        try {
          const out = await handleBook(request, env);
          return json(out, 200, cors);
        } catch (e) {
          return json({ ok: false, error: String(e.message || e).slice(0, 300) }, 400, cors);
        }
      }
      return json({ ok: false, error: "method not allowed" }, 405, cors);
    }

    /* ---------- A) スタッフ用リレー ---------- */
    // 認証の考え方：
    //  1) アプリからAuthorizationが届けばそれを転送（従来どおり）
    //  2) 届かない場合、Workerに保存したNOTION_TOKENを注入する（ゼロ設定運用）
    //     - STAFF_KEY シークレットを設定している場合は X-Staff-Key の一致が必要
    //     - STAFF_KEY 未設定なら誰でも中継可（URLを知る人はDBを操作できる点に注意）
    let auth = request.headers.get("Authorization");
    if (!auth && env.NOTION_TOKEN) {
      const keyOk = !env.STAFF_KEY || request.headers.get("X-Staff-Key") === env.STAFF_KEY;
      if (keyOk) auth = "Bearer " + env.NOTION_TOKEN;
    }
    if (!auth) return json({ error: "Authorization required (or set NOTION_TOKEN / check STAFF_KEY)" }, 401, cors);
    const headers = new Headers();
    headers.set("Authorization", auth);
    headers.set("Notion-Version", request.headers.get("Notion-Version") || NOTION_VERSION);
    const ct = request.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    const resp = await fetch(NOTION + url.pathname + url.search, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    });
    const out = new Response(resp.body, resp);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};

/* ================= CORS =================
 * ALLOWED_ORIGIN: 未設定なら "*"。1つ、またはカンマ区切りで複数指定可。
 * 大文字小文字・末尾の "/"・パス部分は無視して比較する（設定ミスで予約が
 * 止まらないように）。 */
function corsHeaders(request, env) {
  const norm = (o) => {
    const s = String(o || "").trim();
    try { return new URL(s).origin.toLowerCase(); } catch { return s.replace(/\/+$/, "").toLowerCase(); }
  };
  const list = String(env.ALLOWED_ORIGIN || "").split(/[,\s]+/).map(norm).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  let allow = "*";
  if (list.length && !list.includes("*")) allow = list.includes(norm(origin)) ? origin : list[0];
  const h = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Notion-Version, X-Staff-Key",
    "Access-Control-Max-Age": "86400",
  };
  if (allow !== "*") h["Vary"] = "Origin";
  return h;
}

/* ================= booking handler ================= */
async function handleBook(request, env) {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not configured");
  const { b, pdf } = await readBooking(request);

  // honeypot: bots fill it → pretend success, write nothing
  if (b.hp) return { ok: true };

  // --- validation (public input!) ---
  const s = (v, max) => String(v ?? "").trim().slice(0, max);
  const name = s(b.name, 80), phone = s(b.phone, 40);
  const date = s(b.date, 10), time = s(b.time, 5), end = s(b.end, 5);
  if (!name || !phone) throw new Error("name/phone required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("bad date");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("bad time");
  if (end && !/^\d{2}:\d{2}$/.test(end)) throw new Error("bad end");
  const adults = Math.min(Math.max(parseInt(b.adults) || 0, 0), 500);
  const children = Math.min(Math.max(parseInt(b.children) || 0, 0), 500);
  const total = adults + children;
  const email = s(b.email, 120), group = s(b.group, 120);
  const plan = PLANS.includes(b.plan) ? b.plan : "未定";
  const nomihodai = !!b.nomihodai;
  const allergies = s(b.allergies, 500), notes = s(b.notes, 1000);
  const docNo = /^[A-Z0-9-]{4,24}$/.test(s(b.docNo, 24)) ? s(b.docNo, 24) : "BH-" + date.replace(/-/g, "");

  // day-before reminder
  const dt = new Date(date + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  const remind = dt.toISOString().slice(0, 10);

  const api = (path, init) => fetch(NOTION + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      ...(init.form ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error("notion " + r.status + " " + (await r.text()).slice(0, 200));
    return r.json();
  });

  const rt = (v) => ({ rich_text: [{ type: "text", text: { content: v } }] });
  const para = (txt) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: txt.slice(0, 1900) } }] } });

  // --- create the reservation page ---
  // Property types must match the Notion schema exactly (select vs multi_select
  // is a hard validation error): カテゴリー/訪問ステータス/プラン = select,
  // 部門カテゴリー = multi_select, 電話番号 = phone_number, メール = email,
  // 訪問人数 = number, 飲み放題 = checkbox, 日付/リマインド = date.
  const pageBody = {
      parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID },
      properties: {
        [P.title]: { title: [{ type: "text", text: { content: `【BH予約】${name}様 ${total}名` } }] },
        [P.date]: { date: { start: `${date}T${time}:00+09:00`, ...(end ? { end: `${date}T${end}:00+09:00` } : {}) } },
        [P.category]: { select: { name: BOOK.category } },
        [P.dept]: { multi_select: [{ name: BOOK.dept }] },
        [P.status]: { select: { name: BOOK.status } },
        [P.person]: people(OWNERS.person),
        [P.minutesAuthor]: people(OWNERS.minutesAuthor),
        [P.visitor]: rt(name + "様"),
        ...(group ? { [P.company]: rt(group) } : {}),
        [P.count]: { number: total || null },
        [P.phone]: { phone_number: phone },
        ...(email ? { [P.email]: { email } } : {}),
        [P.plan]: { select: { name: plan } },
        [P.nomihodai]: { checkbox: nomihodai },
        [P.reminder]: { date: { start: remind } },
      },
      children: [
        para(`【ビヤホール予約 ${docNo}】大人${adults}名・お子様${children}名`),
        para(`アレルギー・食事制限：${allergies || "なし"}`),
        para(`ご要望・備考：${notes || "—"}`),
        para(`受付：オンライン予約フォーム（仮予約）`),
      ],
  };
  let page;
  try {
    page = await api("/v1/pages", { method: "POST", body: JSON.stringify(pageBody) });
  } catch (e) {
    // Fallback: if Notion rejects the integration bot inside 議事録作成者,
    // retry with Pratik only (the booking must never fail because of this).
    if (!(String(e.message).includes("400") && String(e.message).includes(P.minutesAuthor))) throw e;
    pageBody.properties[P.minutesAuthor] = people(OWNERS.person);
    page = await api("/v1/pages", { method: "POST", body: JSON.stringify(pageBody) });
  }

  // --- attach the confirmation PDF (best effort) ---
  let attached = false;
  try {
    if (pdf) {
      const fn = s(b.filename, 120);
      const filename = /\.pdf$/i.test(fn) ? fn : `ご予約確認書_${docNo}.pdf`;
      const up = await api("/v1/file_uploads", { method: "POST", body: JSON.stringify({ filename, content_type: "application/pdf" }) });
      const fd = new FormData();
      fd.append("file", pdf, filename);
      await api(`/v1/file_uploads/${up.id}/send`, { method: "POST", body: fd, form: true });
      await api(`/v1/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { [P.files]: { files: [{ type: "file_upload", file_upload: { id: up.id }, name: filename }] } } }),
      });
      attached = true;
    }
  } catch (e) { /* page is created; PDF attach failure is non-fatal */ }

  return { ok: true, docNo, attached, version: WORKER_VERSION };
}

/* 本文の読み取り。
 *  - multipart/form-data: payload = JSON文字列、pdf = ファイル（現在の book.js）
 *    → Base64 変換が不要で、Worker の CPU 時間をほとんど使わない
 *  - application/json: pdfBase64 を含む旧形式（古いキャッシュのページ用） */
async function readBooking(request) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    let b;
    try { b = JSON.parse(String(form.get("payload") || "{}")); } catch { throw new Error("bad payload"); }
    const f = form.get("pdf");
    const pdf = f && typeof f === "object" && typeof f.size === "number" && f.size > 0 && f.size <= MAX_PDF_BYTES ? f : null;
    return { b: b && typeof b === "object" ? b : {}, pdf };
  }
  const b = await request.json();
  let pdf = null;
  if (typeof b.pdfBase64 === "string" && b.pdfBase64.length <= MAX_PDF_BYTES * 1.37) {
    try {
      const bin = atob(b.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      pdf = new Blob([bytes], { type: "application/pdf" });
    } catch { pdf = null; }
  }
  return { b: b && typeof b === "object" ? b : {}, pdf };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
