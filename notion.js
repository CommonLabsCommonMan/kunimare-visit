/* notion.js — Notion API client (browser → relay → api.notion.com) + local demo store */
import { CONFIG } from "./config.js";

const LS = {
  settings: "kv_settings",
  demo: "kv_demo_pages",
};

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS.settings)) || {}; } catch { return {}; }
}
export function saveSettings(s) { localStorage.setItem(LS.settings, JSON.stringify(s)); }

export function isConnected() {
  const s = loadSettings();
  return !!(s.token && !s.demo);
}

/* ---------------- relay ---------------- */
function relayUrl(url) {
  const s = loadSettings();
  const id = s.relay || "corsproxy";
  const r = CONFIG.relays.find((x) => x.id === id) || CONFIG.relays[1];
  return r.build(url, s.relayCustom || "");
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const s = loadSettings();
  const url = "https://api.notion.com" + path;
  const headers = {
    Authorization: "Bearer " + (s.token || ""),
    "Notion-Version": CONFIG.notionVersion,
  };
  if (!isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(relayUrl(url), {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) {
    let msg = res.status + " " + res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new Error("Notion API: " + msg);
  }
  return res.json();
}

/* ---------------- helpers: property builders ---------------- */
const P = CONFIG.props;
const rt = (v) => ({ rich_text: [{ type: "text", text: { content: String(v).slice(0, 1900) } }] });
const sel = (v) => ({ select: { name: v } });
const msel = (arr) => ({ multi_select: (arr || []).map((n) => ({ name: n })) });
const num = (v) => ({ number: v == null || v === "" ? null : Number(v) });
const chk = (v) => ({ checkbox: !!v });
const dateProp = (start, end) => ({ date: start ? { start, ...(end ? { end } : {}) } : null });

function buildProps(v, { forCreate = false } = {}) {
  const props = {};
  if (v.title != null) props[P.title] = { title: [{ type: "text", text: { content: v.title } }] };
  if (v.dateStart) props[P.date] = dateProp(v.dateStart, v.dateEnd);
  if (v.category) props[P.category] = sel(v.category);
  if (v.visitorName != null) props[P.visitorName] = rt(v.visitorName);
  if (v.company != null) props[P.company] = rt(v.company);
  if (v.count != null && v.count !== "") props[P.visitorCount] = num(v.count);
  if (v.areas) props[P.areas] = msel(v.areas);
  if (v.via != null) props[P.via] = rt(v.via);
  if (v.purpose) props[P.purpose] = sel(v.purpose);
  if (v.inTime || v.outTime) props[P.inOut] = dateProp(v.inTime || v.outTime, v.inTime && v.outTime ? v.outTime : undefined);
  if (v.hygiene) props[P.hygiene] = msel(v.hygiene);
  if (v.status) props[P.visitStatus] = sel(v.status);
  if (v.minutes != null) props[P.minutes] = chk(v.minutes);
  if (v.done != null) props[P.done] = chk(v.done);
  if (v.phone != null) props[P.phone] = { phone_number: v.phone || null };
  if (v.email != null) props[P.email] = { email: v.email || null };
  if (v.plan) props[P.plan] = sel(v.plan);
  if (v.nomihodai != null) props[P.nomihodai] = chk(v.nomihodai);
  if (v.deptCategory) props[P.deptCategory] = sel(v.deptCategory);
  // day-before reminder (existing Notion automation reads リマインド（自動）)
  if (v.reminderFromDate) {
    const d = new Date(v.reminderFromDate.slice(0, 10) + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    props[P.reminder] = { date: { start: iso } };
  }
  return props;
}

/* ---------------- parse Notion page → visit object ---------------- */
function parsePage(pg) {
  const p = pg.properties || {};
  const g = (name) => p[name];
  const text = (name) => ((g(name)?.rich_text || []).map((t) => t.plain_text).join("") || "");
  const selv = (name) => g(name)?.select?.name || "";
  const mselv = (name) => (g(name)?.multi_select || []).map((o) => o.name);
  const d = g(P.date)?.date || null;
  const io = g(P.inOut)?.date || null;
  return {
    id: pg.id,
    url: pg.url,
    title: (g(P.title)?.title || []).map((t) => t.plain_text).join(""),
    dateStart: d?.start || null,
    dateEnd: d?.end || null,
    category: selv(P.category),
    visitorName: text(P.visitorName),
    company: text(P.company),
    count: g(P.visitorCount)?.number ?? null,
    areas: mselv(P.areas),
    via: text(P.via),
    purpose: selv(P.purpose),
    inTime: io?.start || null,
    outTime: io?.end || null,
    hygiene: mselv(P.hygiene),
    status: selv(P.visitStatus),
    phone: g(P.phone)?.phone_number || "",
    email: g(P.email)?.email || "",
    plan: selv(P.plan),
    nomihodai: !!g(P.nomihodai)?.checkbox,
    deptCategory: selv(P.deptCategory),
    minutes: !!g(P.minutes)?.checkbox,
    done: !!g(P.done)?.checkbox,
    files: (g(P.files)?.files || []).map((f) => f.name),
  };
}

/* ---------------- demo store (localStorage) ---------------- */
function demoAll() {
  try { return JSON.parse(localStorage.getItem(LS.demo)) || []; } catch { return []; }
}
function demoSave(list) { localStorage.setItem(LS.demo, JSON.stringify(list)); }
function demoUpsert(v) {
  const list = demoAll();
  const i = list.findIndex((x) => x.id === v.id);
  if (i >= 0) list[i] = { ...list[i], ...v };
  else list.unshift({ ...v, id: "demo-" + Date.now(), url: null });
  demoSave(list);
  return v.id ? list[i >= 0 ? i : 0] : list[0];
}

/* ---------------- public API ---------------- */
export async function testConnection() {
  const s = loadSettings();
  const ds = s.dataSourceId || CONFIG.dataSourceId;
  const j = await api(`/v1/data_sources/${ds}`, { method: "GET" });
  return j?.title?.[0]?.plain_text || j?.name || "OK";
}

export async function listVisits({ fromDays = -45, toDays = 120 } = {}) {
  if (!isConnected()) {
    return demoAll().map((v) => ({ ...v })).sort((a, b) => (a.dateStart || "").localeCompare(b.dateStart || ""));
  }
  const s = loadSettings();
  const ds = s.dataSourceId || CONFIG.dataSourceId;
  const from = new Date(Date.now() + fromDays * 864e5).toISOString().slice(0, 10);
  const to = new Date(Date.now() + toDays * 864e5).toISOString().slice(0, 10);
  const body = {
    filter: {
      and: [
        { property: P.date, date: { on_or_after: from } },
        { property: P.date, date: { on_or_before: to } },
        {
          or: [
            { property: P.visitStatus, select: { is_not_empty: true } },
            ...CONFIG.visitCategories.map((c) => ({ property: P.category, select: { equals: c } })),
          ],
        },
      ],
    },
    sorts: [{ property: P.date, direction: "ascending" }],
    page_size: 100,
  };
  const out = [];
  let cursor;
  do {
    const j = await api(`/v1/data_sources/${ds}/query`, { method: "POST", body: cursor ? { ...body, start_cursor: cursor } : body });
    out.push(...(j.results || []).map(parsePage));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && out.length < 300);
  return out;
}

export async function createVisit(v) {
  if (!isConnected()) return demoUpsert({ ...v, id: null });
  const s = loadSettings();
  const ds = s.dataSourceId || CONFIG.dataSourceId;
  const children = [];
  const para = (txt) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: txt.slice(0, 1900) } }] } });
  if (v.escort) children.push(para("案内者：" + v.escort));
  if (v.memo) v.memo.split(/\n/).filter(Boolean).forEach((l) => children.push(para(l)));
  const j = await api("/v1/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: ds },
      properties: buildProps(v, { forCreate: true }),
      ...(children.length ? { children: children.slice(0, 40) } : {}),
    },
  });
  return parsePage(j);
}

export async function updateVisit(id, v) {
  if (!isConnected()) return demoUpsert({ ...v, id });
  const j = await api(`/v1/pages/${id}`, { method: "PATCH", body: { properties: buildProps(v) } });
  return parsePage(j);
}

export async function appendReportBody(id, markdownishLines) {
  if (!isConnected()) return;
  const blocks = [];
  blocks.push({ object: "block", type: "divider", divider: {} });
  blocks.push({
    object: "block", type: "heading_3",
    heading_3: { rich_text: [{ type: "text", text: { content: "来訪報告書（アプリ生成）" } }] },
  });
  for (const line of markdownishLines) {
    if (!line.trim()) continue;
    blocks.push({
      object: "block", type: line.startsWith("■") ? "heading_3" : "paragraph",
      [line.startsWith("■") ? "heading_3" : "paragraph"]: {
        rich_text: [{ type: "text", text: { content: line.slice(0, 1900) } }],
      },
    });
  }
  await api(`/v1/blocks/${id}/children`, { method: "PATCH", body: { children: blocks.slice(0, 90) } });
}

export async function attachPdf(id, filename, pdfBytes, existingFiles) {
  if (!isConnected()) return null;
  // 1) create file upload
  const up = await api("/v1/file_uploads", {
    method: "POST",
    body: { filename, content_type: "application/pdf" },
  });
  // 2) send bytes (multipart)
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  await api(`/v1/file_uploads/${up.id}/send`, { method: "POST", body: fd, isForm: true });
  // 3) attach to files property, preserving existing
  const page = await api(`/v1/pages/${id}`, { method: "GET" });
  const cur = page?.properties?.[P.files]?.files || [];
  const keep = cur.map((f) => {
    if (f.type === "external") return { type: "external", name: f.name, external: f.external };
    if (f.type === "file" && f.file?.url) return { type: "file", name: f.name, file: { url: f.file.url } };
    return null; // file_upload refs cannot be re-passed
  }).filter(Boolean);
  const files = [...keep, { type: "file_upload", file_upload: { id: up.id }, name: filename }];
  try {
    await api(`/v1/pages/${id}`, { method: "PATCH", body: { properties: { [P.files]: { files } } } });
  } catch (e) {
    // fallback: set only the new upload
    await api(`/v1/pages/${id}`, { method: "PATCH", body: { properties: { [P.files]: { files: [{ type: "file_upload", file_upload: { id: up.id }, name: filename }] } } } });
  }
  return up.id;
}
