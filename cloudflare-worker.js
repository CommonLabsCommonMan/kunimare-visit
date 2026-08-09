/* ============================================================
 * Kunimare 来訪管理 — Notion relay + 公開ビヤホール予約API
 * (Cloudflare Worker)
 * ------------------------------------------------------------
 * このWorkerは2つの役割を持ちます：
 *
 *  A) スタッフ用アプリの中継（リレー）
 *     ブラウザ → Worker → api.notion.com。トークンはアプリ側から
 *     Authorization ヘッダーで届いたものだけを転送します。
 *     ※ Workerに保存した NOTION_TOKEN は絶対にここでは使いません
 *       （公開URLなので、使うと誰でもDBを読めてしまうため）。
 *
 *  B) 公開予約API（POST /book のみ）
 *     お客様向け book.html からの送信を受け、NOTION_TOKEN
 *     （Workerのシークレット）でNotionに予約ページを作成します。
 *     ・カテゴリー=顧客予約／部門カテゴリー=ビヤホール
 *     ・訪問ステータス=予約済（仮予約）
 *     ・リマインド（自動）= 前日
 *     ・ご予約確認書PDFを「ファイル&メディア」に添付
 *
 * ◆ 設置手順（約5分）
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. このファイルを貼り付けて Deploy
 *   3. Settings → Variables and Secrets：
 *        NOTION_TOKEN   = ntn_…（シークレットとして保存。公開予約に必須）
 *        ALLOWED_ORIGIN = https://<ユーザー名>.github.io（推奨）
 *   4. スタッフアプリ：設定 → 接続方法「自前リレー」＋ Worker URL
 *   5. 公開予約：config.js の booking.workerUrl に Worker URL を設定
 * ============================================================ */

const NOTION = "https://api.notion.com";
const NOTION_VERSION = "2025-09-03";

// ▼ Notionの物件名（全体スケジュール）— 変更した場合はここも合わせる
const DATA_SOURCE_ID = "26ff5289-a51c-806a-bec4-000b77aae1bf";
const P = {
  title: "名前", date: "日付", category: "カテゴリー", dept: "部門カテゴリー",
  status: "訪問ステータス", visitor: "訪問者名", company: "会社・所属",
  count: "訪問人数", phone: "電話番号", email: "メール",
  plan: "プラン", nomihodai: "飲み放題", reminder: "リマインド（自動）", files: "ファイル&メディア",
};
const BOOK = { category: "顧客予約", dept: "ビヤホール", status: "予約済" };

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? origin : allowed),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Notion-Version, X-Staff-Key",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);

    /* ---------- B) 公開予約API ---------- */
    if (url.pathname === "/book" && request.method === "POST") {
      try {
        const out = await handleBook(request, env);
        return json(out, 200, cors);
      } catch (e) {
        return json({ ok: false, error: String(e.message || e).slice(0, 300) }, 400, cors);
      }
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

/* ================= booking handler ================= */
async function handleBook(request, env) {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not configured");
  const b = await request.json();

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
  const plan = ["コース", "アラカルト", "未定"].includes(b.plan) ? b.plan : "未定";
  const nomihodai = !!b.nomihodai;
  const allergies = s(b.allergies, 500), notes = s(b.notes, 1000);
  const docNo = /^[A-Z0-9-]{4,24}$/.test(s(b.docNo, 24)) ? b.docNo : "BH-" + date.replace(/-/g, "");

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
  const page = await api("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID },
      properties: {
        [P.title]: { title: [{ type: "text", text: { content: `【BH予約】${name}様 ${total}名` } }] },
        [P.date]: { date: { start: `${date}T${time}:00+09:00`, ...(end ? { end: `${date}T${end}:00+09:00` } : {}) } },
        [P.category]: { select: { name: BOOK.category } },
        [P.dept]: { select: { name: BOOK.dept } },
        [P.status]: { select: { name: BOOK.status } },
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
    }),
  });

  // --- attach the confirmation PDF (best effort) ---
  let attached = false;
  try {
    if (b.pdfBase64 && b.pdfBase64.length < 4_000_000) {
      const bin = atob(b.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const filename = /\.pdf$/.test(s(b.filename, 120)) ? b.filename : `ご予約確認書_${docNo}.pdf`;
      const up = await api("/v1/file_uploads", { method: "POST", body: JSON.stringify({ filename, content_type: "application/pdf" }) });
      const fd = new FormData();
      fd.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
      await api(`/v1/file_uploads/${up.id}/send`, { method: "POST", body: fd, form: true });
      await api(`/v1/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { [P.files]: { files: [{ type: "file_upload", file_upload: { id: up.id }, name: filename }] } } }),
      });
      attached = true;
    }
  } catch (e) { /* page is created; PDF attach failure is non-fatal */ }

  return { ok: true, docNo, attached };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
