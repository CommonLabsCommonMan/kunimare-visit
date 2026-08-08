/* ============================================================
 * Kunimare 来訪管理 — Notion relay (Cloudflare Worker)
 * ------------------------------------------------------------
 * なぜ必要？ Notion API はブラウザからの直接呼び出し（CORS）を
 * 許可していないため、小さな中継サーバーを経由します。
 * 公共プロキシ（corsproxy.io 等）でも動きますが、自前のWorkerの方が
 * 安定・安全です（無料枠で十分動きます）。
 *
 * ◆ 設置手順（約5分）
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. このファイルの中身を貼り付けて Deploy
 *   3. （推奨）Settings → Variables and Secrets:
 *        - ALLOWED_ORIGIN = https://<あなたのユーザー名>.github.io
 *   4. アプリの設定画面で「接続方法 → 自前リレー」を選び、
 *      Worker の URL（https://xxx.workers.dev）を入力
 *
 * トークンはアプリ側（ブラウザ保存）から Authorization ヘッダーで
 * そのまま転送されます。Worker にトークンを保存したい場合は
 * NOTION_TOKEN シークレットを設定してください（下のコードが自動使用）。
 * ============================================================ */

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = allowed === "*" ? "*" : (origin === allowed ? origin : allowed);

    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Notion-Version",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // path after the worker host maps to api.notion.com
    const url = new URL(request.url);
    const target = "https://api.notion.com" + url.pathname + url.search;

    const headers = new Headers();
    headers.set("Notion-Version", request.headers.get("Notion-Version") || "2025-09-03");
    const ct = request.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    // Prefer a server-side secret token if configured; else forward the client's
    const auth = env.NOTION_TOKEN ? "Bearer " + env.NOTION_TOKEN : request.headers.get("Authorization");
    if (auth) headers.set("Authorization", auth);

    const resp = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    });

    const out = new Response(resp.body, resp);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
