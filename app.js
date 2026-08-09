/* app.js — Kunimare Brewery 来訪管理 SPA */
import { CONFIG } from "./config.js";
import { makeT } from "./i18n.js";
import * as N from "./notion.js";
import { generateReportPdf, generateBookingPdf, makeDocNo } from "./pdfgen.js";
import { extractAttachments } from "./ocr.js";

/* ---------------- state ---------------- */
let S = N.loadSettings();
let lang = S.lang || "ja";
let t = makeT(lang);
let visits = [];
let visitsLoaded = false;
let lastError = null;
let reportFiles = []; // File[]
let currentRoute = "";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TZ = CONFIG.timezoneOffset;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/* literal wall-clock from the stored ISO string (visits carry +09:00) —
 * independent of the viewing device's timezone */
const fmtTime = (iso) => {
  const m = String(iso || "").match(/T(\d{2}):(\d{2})/);
  return m ? m[1] + ":" + m[2] : "";
};
const fmtDateShort = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const DOW = { ja: ["日", "月", "火", "水", "木", "金", "土"], en: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] };
const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function statusChip(st) {
  const { reserved, visited, reported, cancelled } = CONFIG.statuses;
  const map = { [reserved]: "res", [visited]: "vis", [reported]: "rep", [cancelled]: "can" };
  const lbl = { [reserved]: t("filter_reserved"), [visited]: t("filter_visited"), [reported]: t("filter_reported"), [cancelled]: t("filter_cancelled") };
  if (!st) return "";
  return `<span class="chip ${map[st] || "cat"}">${esc(lbl[st] || st)}</span>`;
}

function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("on"), 2600);
}

/* ---------------- shell ---------------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="1.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.37.96a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.37 2.55a7 7 0 0 0-2.42 1.4l-2.37-.96-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.37-.96a7 7 0 0 0 2.42 1.4l.37 2.55h3.4l.37-2.55a7 7 0 0 0 2.42-1.4l2.37.96 2-3.46-2-1.55c.09-.46.14-.92.14-1.4Z"/></svg>',
};

function renderShell() {
  document.title = `${CONFIG.brandEn} | ${t("appTitle")}`;
  $("#app").innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <div class="mark">
          <img class="slogo" src="assets/logo-white.png" alt="KUNIMARE" onerror="this.outerHTML='&lt;div class=&quot;roundel&quot;&gt;稀&lt;/div&gt;'">
          <div><h1>${esc(CONFIG.brandJa)}</h1><small>${esc(CONFIG.brandEn)}</small></div>
        </div>
      </div>
      <nav class="nav">
        <a href="#home" data-r="home">${ICONS.home}<span>${t("nav_home")}</span></a>
        <a href="#schedule" data-r="schedule">${ICONS.cal}<span>${t("nav_schedule")}</span></a>
        <a href="#reserve" data-r="reserve">${ICONS.plus}<span>${t("nav_reserve")}</span></a>
        <a href="#report" data-r="report">${ICONS.doc}<span>${t("nav_report")}</span></a>
        <a href="#settings" data-r="settings">${ICONS.gear}<span>${t("nav_settings")}</span></a>
      </nav>
      <div class="lang-sw">
        <button data-lang="ja" class="${lang === "ja" ? "on" : ""}">日本語</button>
        <button data-lang="en" class="${lang === "en" ? "on" : ""}">EN</button>
      </div>
      <div class="foot">© Kunimare Brewery<br>来訪管理 v1.2</div>
    </aside>
    <main class="main" id="main"></main>
  </div>
  <div class="scrim" id="scrim"></div>
  <div class="drawer" id="drawer"></div>
  <div class="pov" id="pov"></div>`;
  $$(".lang-sw button").forEach((b) => b.onclick = () => {
    lang = b.dataset.lang; t = makeT(lang);
    S.lang = lang; N.saveSettings(S);
    renderShell(); route();
  });
}

function setNav(r) {
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
}

function banners() {
  if (!N.isConnected()) return `<div class="banner demo">※ ${t("demoBanner")}</div>`;
  if (lastError) return `<div class="banner err">！ ${t("offlineBanner")} — <span style="opacity:.8">${esc(lastError)}</span></div>`;
  return "";
}

/* ---------------- data ---------------- */
async function refreshVisits(force = false) {
  if (visitsLoaded && !force) return visits;
  try {
    lastError = null;
    visits = await N.listVisits();
    visitsLoaded = true;
  } catch (e) {
    lastError = e.message;
    visits = visits || [];
  }
  return visits;
}

/* ---------------- views ---------------- */
function pageHead(titleKey, subEn, actions = "") {
  return `<div class="phead">
    <div><h2>${t(titleKey)}</h2><div class="sub">${esc(subEn)}</div></div>
    <div class="actions">${actions}</div>
  </div>`;
}

function visitRow(v) {
  const d = v.dateStart ? new Date(v.dateStart.slice(0, 10) + "T00:00:00") : null;
  const dow = d ? DOW[lang][d.getDay()] : "";
  const sun = d && (d.getDay() === 0);
  const time = fmtTime(v.dateStart) ? `${fmtTime(v.dateStart)}${v.dateEnd ? "–" + fmtTime(v.dateEnd) : ""}` : "";
  return `<div class="vrow" data-id="${esc(v.id)}">
    <div class="dbox ${sun ? "sun" : ""}">
      <div class="dow">${dow}</div>
      <div class="dd">${d ? d.getDate() : "–"}</div>
      <div class="mm">${d ? (lang === "ja" ? (d.getMonth() + 1) + "月" : MON[d.getMonth()]) : ""}</div>
    </div>
    <div class="body">
      <div class="t">${esc(v.title || "(untitled)")}</div>
      <div class="meta">
        ${time ? `<span>${time}</span>` : ""}
        ${v.company ? `<span>${esc(v.company)}</span>` : ""}
        ${v.count ? `<span>${v.count}${t("visitors_unit")}</span>` : ""}
        ${v.purpose ? `<span>${esc(v.purpose)}</span>` : ""}
      </div>
    </div>
    <div class="right">
      ${statusChip(v.status)}
      ${v.deptCategory === CONFIG.booking.deptCategory
        ? `<span class="chip cat" style="color:var(--gold);border-color:var(--gold)">${esc(v.deptCategory)}</span>`
        : (v.category ? `<span class="chip cat">${esc(v.category)}</span>` : "")}
    </div>
  </div>`;
}

async function viewHome() {
  const main = $("#main");
  main.innerHTML = pageHead("nav_home", "Kunimare Brewery — Visitor Management",
    `<a class="btn primary" href="#reserve">${t("quickReserve")}</a><a class="btn ghost" href="#report">${t("quickReport")}</a>`)
    + banners() + `<div class="empty">${t("loading")}</div>`;
  await refreshVisits();
  const today = todayStr();
  const act = visits.filter((v) => v.status !== CONFIG.statuses.cancelled);
  const todays = act.filter((v) => (v.dateStart || "").slice(0, 10) === today);
  const upcoming = act.filter((v) => (v.dateStart || "").slice(0, 10) > today).slice(0, 8);
  const unrep = act.filter((v) =>
    (v.dateStart || "").slice(0, 10) <= today && v.status !== CONFIG.statuses.reported).slice(-8).reverse();

  main.innerHTML = pageHead("nav_home", "Kunimare Brewery — Visitor Management",
    `<a class="btn primary" href="#reserve">${t("quickReserve")}</a><a class="btn ghost" href="#report">${t("quickReport")}</a>`)
    + banners()
    + `<div class="card"><div class="chead"><h3>${t("today")} <span class="en">Today ${fmtDateShort(today)}</span></h3></div>
       <div class="cbody flush">${todays.length ? todays.map(visitRow).join("") : `<div class="empty">${t("noUpcoming")}</div>`}</div></div>`
    + `<div class="card"><div class="chead"><h3>${t("unreported")} <span class="en">Reports pending</span></h3></div>
       <div class="cbody flush">${unrep.length ? unrep.map(visitRow).join("") : `<div class="empty">${t("noUnreported")}</div>`}</div></div>`
    + `<div class="card"><div class="chead"><h3>${t("upcoming")} <span class="en">Upcoming</span></h3></div>
       <div class="cbody flush">${upcoming.length ? upcoming.map(visitRow).join("") : `<div class="empty">${t("noUpcoming")}</div>`}</div></div>`;
  bindRows();
}

let schedFilter = "all", schedMonth = null;
async function viewSchedule() {
  const main = $("#main");
  main.innerHTML = pageHead("schedTitle", "Visit schedule", `<a class="btn primary" href="#reserve">${t("quickReserve")}</a>`)
    + banners() + `<div class="empty">${t("loading")}</div>`;
  await refreshVisits();
  if (!schedMonth) schedMonth = todayStr().slice(0, 7);
  const [yy, mm] = schedMonth.split("-").map(Number);

  const flt = { all: () => true,
    res: (v) => v.status === CONFIG.statuses.reserved,
    vis: (v) => v.status === CONFIG.statuses.visited,
    rep: (v) => v.status === CONFIG.statuses.reported,
    can: (v) => v.status === CONFIG.statuses.cancelled };
  const inMonth = visits.filter((v) => (v.dateStart || "").slice(0, 7) === schedMonth).filter(flt[schedFilter] || flt.all);

  main.innerHTML = pageHead("schedTitle", "Visit schedule", `<a class="btn primary" href="#reserve">${t("quickReserve")}</a>`)
    + banners()
    + `<div class="phead" style="margin-bottom:8px">
        <div class="mnav">
          <button id="mPrev">←</button><b>${yy}${lang === "ja" ? "年" : ""} ${lang === "ja" ? mm + "月" : MON[mm - 1]}</b><button id="mNext">→</button>
        </div>
        <div class="fbar">
          ${[["all", t("filter_all")], ["res", t("filter_reserved")], ["vis", t("filter_visited")], ["rep", t("filter_reported")], ["can", t("filter_cancelled")]]
            .map(([k, l]) => `<button data-f="${k}" class="${schedFilter === k ? "on" : ""}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="card"><div class="cbody flush">
        ${inMonth.length ? inMonth.map(visitRow).join("") : `<div class="empty">${t("noUpcoming")}</div>`}
      </div></div>`;
  $("#mPrev").onclick = () => { schedMonth = shiftMonth(schedMonth, -1); viewSchedule(); };
  $("#mNext").onclick = () => { schedMonth = shiftMonth(schedMonth, 1); viewSchedule(); };
  $$(".fbar button").forEach((b) => b.onclick = () => { schedFilter = b.dataset.f; viewSchedule(); });
  bindRows();
}
function shiftMonth(ym, d) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function bindRows() {
  $$(".vrow").forEach((r) => r.onclick = () => openDrawer(r.dataset.id));
}

/* ---------------- drawer ---------------- */
function openDrawer(id) {
  const v = visits.find((x) => x.id === id);
  if (!v) return;
  const dr = $("#drawer"), sc = $("#scrim");
  const kv = (l, val) => val ? `<div>${esc(l)}</div><div>${esc(val)}</div>` : "";
  dr.innerHTML = `
    <div class="dhead"><button class="x">✕</button>
      <h3>${esc(v.title)}</h3>
      ${statusChip(v.status)} ${v.category ? `<span class="chip cat">${esc(v.category)}</span>` : ""}
      ${v.deptCategory === CONFIG.booking.deptCategory ? `<span class="chip cat" style="color:var(--gold);border-color:var(--gold)">${esc(v.deptCategory)}</span>` : ""}
    </div>
    <div class="dbody">
      <div class="kv">
        ${kv(t("f_date"), v.dateStart ? `${v.dateStart.slice(0, 10)} ${fmtTime(v.dateStart)}${v.dateEnd ? "–" + fmtTime(v.dateEnd) : ""}` : "")}
        ${kv(t("f_company"), v.company)}
        ${kv(t("f_visitor"), v.visitorName)}
        ${kv(t("f_count"), v.count ? v.count + t("visitors_unit") : "")}
        ${kv(t("f_via"), v.via)}
        ${kv(t("f_purpose"), v.purpose)}
        ${kv(t("f_areas"), (v.areas || []).join("、"))}
        ${kv(t("f_inTime") + "/" + t("f_outTime"), v.inTime ? `${fmtTime(v.inTime)} / ${v.outTime ? fmtTime(v.outTime) : "—"}` : "")}
        ${kv(t("f_hygiene"), (v.hygiene || []).join("、"))}
        ${kv(t("f_phone"), v.phone)}
        ${kv(t("f_email"), v.email)}
        ${kv(t("f_plan"), v.plan ? v.plan + (v.nomihodai ? "＋飲み放題" : "") : "")}
        ${kv("PDF", (v.files || []).join(", "))}
      </div>
    </div>
    <div class="dfoot">
      ${v.status !== CONFIG.statuses.reported ? `<a class="btn primary sm" href="#report/${esc(v.id)}">${t("makeReport")}</a>` : ""}
      <a class="btn ghost sm" href="#reserve/${esc(v.id)}">${t("editReserve")}</a>
      ${v.status === CONFIG.statuses.cancelled
        ? `<button class="btn ghost sm" id="dRestore">${t("restoreVisit")}</button>`
        : `<button class="btn danger sm" id="dCancel">${t("cancelVisit")}</button>`}
      ${v.url ? `<a class="btn ghost sm" href="${esc(v.url)}" target="_blank" rel="noopener">${t("openInNotion")}</a>` : ""}
    </div>`;
  dr.classList.add("on"); sc.classList.add("on");
  const close = () => { dr.classList.remove("on"); sc.classList.remove("on"); };
  $(".x", dr).onclick = close; sc.onclick = close;
  $$("a", dr).forEach((a) => { if (a.getAttribute("href")?.startsWith("#")) a.addEventListener("click", close); });
  const cBtn = $("#dCancel", dr);
  if (cBtn) cBtn.onclick = async () => {
    if (!confirm(t("confirmCancel"))) return;
    cBtn.disabled = true;
    try {
      await N.updateVisit(v.id, { status: CONFIG.statuses.cancelled });
      await refreshVisits(true); close(); route(); toast(t("saved"));
    } catch (e) { toast("✕ " + e.message); cBtn.disabled = false; }
  };
  const rBtn = $("#dRestore", dr);
  if (rBtn) rBtn.onclick = async () => {
    rBtn.disabled = true;
    try {
      await N.updateVisit(v.id, { status: CONFIG.statuses.reserved });
      await refreshVisits(true); close(); route(); toast(t("saved"));
    } catch (e) { toast("✕ " + e.message); rBtn.disabled = false; }
  };
}

/* ---------------- reservation form ---------------- */
let reserveType = "visit"; // "visit" | "bh"

async function viewReserve(id) {
  await refreshVisits();
  const v = id ? visits.find((x) => x.id === id) : null;
  const isBH = v ? v.deptCategory === CONFIG.booking.deptCategory : reserveType === "bh";
  const main = $("#main");
  const toggle = v ? "" : `
    <div class="field" style="margin-bottom:14px"><label>${t("resType")}</label>
      <div class="pills">
        <label class="pill"><input type="radio" name="rType" value="visit" ${!isBH ? "checked" : ""}><span>${t("type_visit")}</span></label>
        <label class="pill"><input type="radio" name="rType" value="bh" ${isBH ? "checked" : ""}><span>${t("type_bh")}</span></label>
      </div></div>`;
  main.innerHTML = pageHead(isBH ? (v ? "bhEditTitle" : "bhTitle") : (v ? "resEditTitle" : "resTitle"),
    isBH ? "Beer hall booking" : "Visit reservation") + banners()
    + `<div class="card"><div class="cbody">${toggle}<div id="resWrap"></div></div></div>`;
  $$("input[name=rType]").forEach((r) => r.onchange = () => { reserveType = r.value; viewReserve(); });
  if (isBH) renderBHForm(v); else renderVisitForm(v);
}

/* ---- factory visit reservation ---- */
function renderVisitForm(v) {
  const dv = v?.dateStart ? v.dateStart.slice(0, 10) : todayStr();
  const st = v?.dateStart && v.dateStart.includes("T") ? fmtTime(v.dateStart) : "10:00";
  const en = v?.dateEnd ? fmtTime(v.dateEnd) : "11:00";
  $("#resWrap").innerHTML = `
    <div class="fsec"><b>基本情報</b><span>Basic</span></div>
    <div class="fgrid">
      <div class="field full"><label>${t("f_title")}<span class="req">${t("required")}</span></label>
        <input type="text" id="rTitle" value="${esc(v?.title || "")}" placeholder="${esc(t("f_title_ph"))}">
        <div class="hint">${t("f_autoTitle")}</div></div>
      <div class="field"><label>${t("f_date")}<span class="req">${t("required")}</span></label><input type="date" id="rDate" value="${dv}"></div>
      <div class="field"><div class="hstack">
        <div><label>${t("f_start")}</label><input type="time" id="rStart" value="${st}"></div>
        <div><label>${t("f_end")}</label><input type="time" id="rEnd" value="${en}"></div>
      </div></div>
      <div class="field"><label>${t("f_company")}</label><input type="text" id="rCompany" value="${esc(v?.company || "")}" placeholder="${esc(t("f_company_ph"))}"></div>
      <div class="field"><label>${t("f_visitor")}</label><input type="text" id="rVisitor" value="${esc(v?.visitorName || "")}" placeholder="${esc(t("f_visitor_ph"))}"></div>
      <div class="field"><label>${t("f_count")}</label><input type="number" id="rCount" min="1" value="${v?.count || 1}"></div>
      <div class="field"><label>${t("f_via")}</label><input type="text" id="rVia" value="${esc(v?.via || "")}" placeholder="${esc(t("f_via_ph"))}"></div>
      <div class="field"><label>${t("f_purpose")}</label><select id="rPurpose">
        ${CONFIG.purposes.map((p) => `<option ${v?.purpose === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label>${t("f_category")}</label><select id="rCat">
        ${CONFIG.visitCategories.map((c) => `<option ${((v?.category || CONFIG.defaultCategory) === c) ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    </div>
    <div class="fsec"><b>訪問エリア・メモ</b><span>Areas & memo</span></div>
    <div class="fgrid">
      <div class="field full"><label>${t("f_areas")}</label>
        <div class="pills">${CONFIG.areas.map((a) => `<label class="pill"><input type="checkbox" name="rArea" value="${esc(a)}" ${v?.areas?.includes(a) ? "checked" : ""}><span>${esc(a)}</span></label>`).join("")}</div></div>
      <div class="field"><label>${t("f_escort")}</label><input type="text" id="rEscort" value="" placeholder="${esc(t("f_escort_ph"))}"></div>
      <div class="field full"><label>${t("f_memo")}</label><textarea id="rMemo" placeholder="${esc(t("f_memo_ph"))}"></textarea></div>
    </div>
    <div class="subbar">
      <span class="note">${N.isConnected() ? "→ Notion 全体スケジュール" : t("demoBanner")}</span>
      <a class="btn ghost" href="#schedule">${t("cancel")}</a>
      <button class="btn primary lg" id="rSave">${v ? t("save") : t("saveReserve")}</button>
    </div>`;

  const auto = () => {
    const ti = $("#rTitle");
    if (ti.value.trim()) return;
    const c = $("#rCompany").value.trim(), n = $("#rVisitor").value.trim();
    if (c || n) ti.value = `${c}${c && n ? " " : ""}${n} 来社`.trim();
  };
  $("#rCompany").addEventListener("blur", auto);
  $("#rVisitor").addEventListener("blur", auto);

  $("#rSave").onclick = async () => {
    const title = $("#rTitle").value.trim();
    const date = $("#rDate").value;
    if (!title) return toast(t("errTitle"));
    if (!date) return toast(t("errDate"));
    const st = $("#rStart").value, en = $("#rEnd").value;
    const payload = {
      title,
      dateStart: st ? `${date}T${st}:00${TZ}` : date,
      dateEnd: st && en ? `${date}T${en}:00${TZ}` : undefined,
      category: $("#rCat").value,
      company: $("#rCompany").value.trim(),
      visitorName: $("#rVisitor").value.trim(),
      count: $("#rCount").value || null,
      via: $("#rVia").value.trim(),
      purpose: $("#rPurpose").value,
      areas: $$("input[name=rArea]:checked").map((i) => i.value),
      status: v?.status && v.status !== CONFIG.statuses.cancelled ? v.status : CONFIG.statuses.reserved,
      escort: $("#rEscort").value.trim(),
      memo: $("#rMemo").value.trim(),
      reminderFromDate: date,
    };
    const btn = $("#rSave"); btn.disabled = true; btn.textContent = t("saving");
    try {
      if (v) await N.updateVisit(v.id, payload);
      else await N.createVisit(payload);
      await refreshVisits(true);
      toast("✓ " + t("saved"));
      location.hash = "#schedule";
    } catch (e) {
      toast("✕ " + e.message);
      btn.disabled = false; btn.textContent = v ? t("save") : t("saveReserve");
    }
  };
}

/* ---- beer hall booking (staff entry) ---- */
function renderBHForm(v) {
  const dv = v?.dateStart ? v.dateStart.slice(0, 10) : todayStr();
  const st = v?.dateStart && v.dateStart.includes("T") ? fmtTime(v.dateStart) : "18:00";
  const en = v?.dateEnd ? fmtTime(v.dateEnd) : "";
  $("#resWrap").innerHTML = `
    <div class="fsec"><b>ご予約内容</b><span>Booking</span></div>
    <div class="fgrid">
      <div class="field"><label>${t("f_date")}<span class="req">${t("required")}</span></label><input type="date" id="bDate" value="${dv}"></div>
      <div class="field"><div class="hstack">
        <div><label>${t("f_start")}<span class="req">${t("required")}</span></label><input type="time" id="bStart" value="${st}"></div>
        <div><label>${t("f_endTime")}</label><input type="time" id="bEnd" value="${en}"></div>
      </div></div>
      <div class="field"><div class="hstack">
        <div><label>${t("f_adults")}</label><input type="number" id="bAdults" min="0" value="${v?.count || 2}"></div>
        <div><label>${t("f_children")}</label><input type="number" id="bChildren" min="0" value="0"></div>
      </div></div>
      <div class="field"><label>${t("f_plan")}</label><select id="bPlan">
        ${CONFIG.booking.plans.map((p) => `<option ${v?.plan === p ? "selected" : ""}>${p}</option>`).join("")}</select>
        <div class="hint"><label class="pill green"><input type="checkbox" id="bNomi" ${v?.nomihodai ? "checked" : ""}><span>☑ ${t("f_nomihodai")}</span></label></div></div>
    </div>
    <div class="fsec"><b>お客様情報</b><span>Guest</span></div>
    <div class="fgrid">
      <div class="field"><label>${t("f_repName")}<span class="req">${t("required")}</span></label><input type="text" id="bName" value="${esc((v?.visitorName || "").replace(/様$/, ""))}" placeholder="${esc(t("f_repName_ph"))}"></div>
      <div class="field"><label>${t("f_phone")}<span class="req">${t("required")}</span></label><input type="text" id="bPhone" inputmode="tel" value="${esc(v?.phone || "")}" placeholder="0164-53-1050"></div>
      <div class="field"><label>${t("f_email")}</label><input type="text" id="bEmail" inputmode="email" value="${esc(v?.email || "")}"></div>
      <div class="field"><label>${t("f_groupName")}</label><input type="text" id="bGroup" value="${esc(v?.company || "")}"></div>
      <div class="field full"><label>${t("f_allergy")}</label><textarea id="bAllergy" style="min-height:64px" placeholder="${esc(t("f_allergy_ph"))}"></textarea></div>
      <div class="field full"><label>${t("f_memo")}</label><textarea id="bMemo" style="min-height:64px"></textarea></div>
    </div>
    <div class="subbar">
      <span class="note">${N.isConnected() ? "→ Notion 全体スケジュール（リマインド前日）" : t("demoBanner")}</span>
      <a class="btn ghost" href="#schedule">${t("cancel")}</a>
      <button class="btn primary lg" id="bSave">${v ? t("save") : t("saveBooking")}</button>
    </div>`;

  $("#bSave").onclick = () => {
    const date = $("#bDate").value, start = $("#bStart").value;
    const repName = $("#bName").value.trim(), phone = $("#bPhone").value.trim();
    if (!date || !start) return toast(t("errDate"));
    if (!repName) return toast(t("errRep"));
    if (!phone) return toast(t("errPhone"));
    runBookingPipeline({
      date, start, end: $("#bEnd").value,
      repName, phone,
      email: $("#bEmail").value.trim(),
      groupName: $("#bGroup").value.trim(),
      adults: +$("#bAdults").value || 0,
      children: +$("#bChildren").value || 0,
      plan: $("#bPlan").value,
      nomihodai: $("#bNomi").checked,
      allergies: $("#bAllergy").value.trim(),
      memo: $("#bMemo").value.trim(),
    }, v?.id || null);
  };
}

/* ---- booking pipeline: PDF → Notion → attach ---- */
async function runBookingPipeline(b, existingId) {
  const connected = N.isConnected();
  const steps = [
    { label: t("p_validate") },
    { label: t("p_bhpdf") },
    { label: t("p_notion") },
    { label: t("p_upload") },
  ];
  const pov = $("#pov");
  pov.innerHTML = `<div class="pwin">
    <div class="ph"><h3>ビヤホール予約　登録中…</h3></div>
    <div class="pbar"><i id="pbari"></i></div>
    <div class="psteps">${steps.map((s, i) => `
      <div class="pstep" id="ps${i}"><div class="ic">${i + 1}</div><div>${esc(s.label)}<span class="sub" id="pss${i}"></span></div></div>`).join("")}
    </div>
    <div class="pdone" id="pdone" style="display:none"></div>
    <div class="pfoot" id="pfoot"></div>
  </div>`;
  pov.classList.add("on");
  const bar = $("#pbari");
  const setStep = (i, st, sub) => {
    const el = $("#ps" + i);
    el.className = "pstep " + st;
    if (st === "ok" || st === "skip") { el.querySelector(".ic").textContent = st === "ok" ? "✓" : "—"; bar.style.width = ((i + 1) / steps.length) * 100 + "%"; }
    if (st === "run") el.querySelector(".ic").textContent = "";
    if (st === "err") el.querySelector(".ic").textContent = "!";
    if (sub != null) $("#pss" + i).textContent = sub;
  };

  const docNo = makeDocNo(null, CONFIG.booking.docPrefix);
  const total = b.adults + b.children;
  const dateStart = `${b.date}T${b.start}:00${TZ}`;
  const dateEnd = b.end ? `${b.date}T${b.end}:00${TZ}` : undefined;
  const filename = `ご予約確認書_${docNo}_${b.repName.replace(/[\\/:*?"<>|]/g, "")}様.pdf`;
  let pdfBytes = null;

  try {
    setStep(0, "run"); await sleep(200); setStep(0, "ok");

    setStep(1, "run");
    pdfBytes = await generateBookingPdf({
      docNo, createdDate: new Date().toISOString(),
      dateStart, endTime: b.end || "",
      adults: b.adults, children: b.children,
      repName: b.repName, phone: b.phone, email: b.email,
      company: b.groupName, plan: b.plan, nomihodai: b.nomihodai,
      allergies: b.allergies, notes: b.memo, tentative: true,
      source: "スタッフ受付（アプリ）",
    });
    setStep(1, "ok", (pdfBytes.length / 1024).toFixed(0) + " KB");

    const payload = {
      title: `【BH予約】${b.repName}様 ${total}名`,
      dateStart, dateEnd,
      category: CONFIG.booking.category,
      deptCategory: CONFIG.booking.deptCategory,
      visitorName: b.repName + "様",
      company: b.groupName,
      count: total,
      phone: b.phone, email: b.email,
      plan: b.plan, nomihodai: b.nomihodai,
      status: CONFIG.statuses.reserved,
      reminderFromDate: b.date,
      memo: `【ビヤホール予約 ${docNo}】大人${b.adults}名・お子様${b.children}名\nアレルギー・食事制限：${b.allergies || "なし"}\n備考：${b.memo || "—"}`,
    };
    if (connected) {
      setStep(2, "run");
      let pageId = existingId;
      if (pageId) await N.updateVisit(pageId, payload);
      else { const created = await N.createVisit(payload); pageId = created.id; }
      setStep(2, "ok");
      setStep(3, "run");
      await N.attachPdf(pageId, filename, pdfBytes);
      setStep(3, "ok");
    } else {
      if (existingId) await N.updateVisit(existingId, payload);
      else await N.createVisit(payload);
      setStep(2, "skip", t("p_skipped")); setStep(3, "skip", t("p_skipped"));
    }

    await refreshVisits(true);
    bar.style.width = "100%";
    $("#pdone").style.display = "block";
    $("#pdone").innerHTML = `<div class="okmark">✓</div><b>${connected ? t("bookingDone") : t("bookingDoneLocal")}</b>`;
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    $("#pfoot").innerHTML = `
      <a class="btn ind" href="${url}" download="${esc(filename)}">▼ ${t("downloadPdf")}</a>
      <button class="btn ghost" id="povClose">${t("close")}</button>`;
    $("#povClose").onclick = () => { pov.classList.remove("on"); location.hash = "#schedule"; route(); };
  } catch (e) {
    const runIdx = steps.findIndex((_, i) => $("#ps" + i).classList.contains("run"));
    if (runIdx >= 0) setStep(runIdx, "err", e.message);
    $("#pfoot").innerHTML = `
      ${pdfBytes ? `<a class="btn ind" href="${URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }))}" download="${esc(filename)}">▼ ${t("downloadPdf")}</a>` : ""}
      <button class="btn ghost" id="povClose">${t("close")}</button>`;
    $("#povClose").onclick = () => pov.classList.remove("on");
  }
}

/* ---------------- report form ---------------- */
async function viewReport(id) {
  await refreshVisits();
  const main = $("#main");
  const cands = visits.filter((v) => v.status !== CONFIG.statuses.reported && v.status !== CONFIG.statuses.cancelled);
  const v = id ? visits.find((x) => x.id === id) : null;
  reportFiles = [];

  const opts = [`<option value="">${esc(t("repPick_ph"))}</option>`]
    .concat(cands.map((c) => `<option value="${esc(c.id)}" ${v?.id === c.id ? "selected" : ""}>${esc((c.dateStart || "").slice(0, 10))}　${esc(c.title)}</option>`))
    .concat([`<option value="__standalone__">${esc(t("repStandalone"))}</option>`]);

  main.innerHTML = pageHead("repTitle", "Official visit report") + banners() + `
  <div class="card"><div class="cbody">
    <div class="field"><label>${t("repPick")}<span class="req">${t("required")}</span></label>
      <select id="pPick">${opts.join("")}</select></div>
  </div></div>
  <form class="card" id="repCard" style="display:${v ? "block" : "none"}" onsubmit="return false">
    <div class="cbody">
    <div class="fsec"><b>基本情報（Who・When・How）</b><span>Who / When / How</span></div>
    <div class="fgrid">
      <div class="field full"><label>${t("f_title")}<span class="req">${t("required")}</span></label><input type="text" id="pTitle"></div>
      <div class="field"><label>${t("f_visitDate")}<span class="req">${t("required")}</span></label><input type="date" id="pDate"></div>
      <div class="field"><div class="hstack">
        <div><label>${t("f_start")}</label><input type="time" id="pStart"></div>
        <div><label>${t("f_end")}</label><input type="time" id="pEnd"></div>
      </div></div>
      <div class="field"><label>${t("f_company")}</label><input type="text" id="pCompany"></div>
      <div class="field"><label>${t("f_visitor")}</label><input type="text" id="pVisitor"></div>
      <div class="field"><label>${t("f_count")}</label><input type="number" id="pCount" min="1"></div>
      <div class="field"><label>${t("f_via")}</label><input type="text" id="pVia" placeholder="${esc(t("f_via_ph"))}"></div>
      <div class="field"><label>${t("f_purpose")}</label><select id="pPurpose">${CONFIG.purposes.map((p) => `<option>${p}</option>`).join("")}</select></div>
      <div class="field"><div class="hstack">
        <div><label>${t("f_inTime")}</label><input type="time" id="pIn"></div>
        <div><label>${t("f_outTime")}</label><input type="time" id="pOut"></div>
      </div></div>
      <div class="field"><label>${t("f_escort")}</label><input type="text" id="pEscort" placeholder="${esc(t("f_escort_ph"))}"></div>
    </div>
    <div class="fsec"><b>エリア・衛生（Where）</b><span>Where / Hygiene</span></div>
    <div class="fgrid">
      <div class="field full"><label>${t("f_areasVisited")}</label>
        <div class="pills">${CONFIG.areas.map((a) => `<label class="pill"><input type="checkbox" name="pArea" value="${esc(a)}"><span>${esc(a)}</span></label>`).join("")}</div></div>
      <div class="field full"><label>${t("f_hygiene")}</label>
        <div class="pills">${CONFIG.hygieneItems.map((h) => `<label class="pill green"><input type="checkbox" name="pHyg" value="${esc(h)}"><span>☑ ${esc(h)}</span></label>`).join("")}</div></div>
    </div>
    <div class="fsec"><b>内容・所感（What）</b><span>Notes</span></div>
    <div class="fgrid">
      <div class="field full"><label>${t("f_notes")}<span class="req">${t("required")}</span></label>
        <textarea id="pNotes" style="min-height:150px" placeholder="${esc(t("f_notes_ph"))}"></textarea></div>
    </div>
    <div class="fsec"><b>添付・OCR</b><span>Attachments / OCR</span></div>
    <div class="fgrid">
      <div class="field full">
        <label>${t("f_attach")}</label>
        <div class="drop" id="pDrop">＋ ${t("f_attach_hint")}</div>
        <input type="file" id="pFile" multiple accept="image/*,.pdf" style="display:none">
        <div class="att-list" id="pAtts"></div>
      </div>
      <div class="field full" id="ocrWrap" style="display:none">
        <label>${t("f_ocrText")}</label>
        <textarea id="pOcr" style="min-height:110px" placeholder="${esc(t("f_ocrText_ph"))}"></textarea>
        <div class="hint"><button class="btn ghost sm" id="pRunOcr" type="button">${t("runOcr")}</button></div>
      </div>
      <div class="field"><label>${t("f_author")}<span class="req">${t("required")}</span></label>
        <input type="text" id="pAuthor" value="${esc(S.author || "")}" placeholder="${esc(t("f_author_ph"))}"></div>
    </div>
    <div class="subbar">
      <span class="note">${t("pdfOnly_note")}</span>
      <button class="btn primary lg" id="pSubmit" type="button">▸ ${t("submitReport")}</button>
    </div>
    </div>
  </form>`;

  const fillFrom = (src) => {
    $("#pTitle").value = src?.title || "";
    $("#pDate").value = (src?.dateStart || todayStr()).slice(0, 10);
    $("#pStart").value = src?.dateStart?.includes("T") ? fmtTime(src.dateStart) : "";
    $("#pEnd").value = src?.dateEnd ? fmtTime(src.dateEnd) : "";
    $("#pCompany").value = src?.company || "";
    $("#pVisitor").value = src?.visitorName || "";
    $("#pCount").value = src?.count || 1;
    $("#pVia").value = src?.via || "";
    $("#pPurpose").value = src?.purpose || CONFIG.purposes[0];
    $("#pIn").value = src?.inTime ? fmtTime(src.inTime) : ($("#pStart").value || "");
    $("#pOut").value = src?.outTime ? fmtTime(src.outTime) : "";
    $$("input[name=pArea]").forEach((i) => i.checked = !!src?.areas?.includes(i.value));
    $$("input[name=pHyg]").forEach((i) => i.checked = !!src?.hygiene?.includes(i.value));
  };
  if (v) fillFrom(v);

  $("#pPick").onchange = (e) => {
    const val = e.target.value;
    $("#repCard").style.display = val ? "block" : "none";
    if (val && val !== "__standalone__") {
      const src = visits.find((x) => x.id === val);
      fillFrom(src);
    } else if (val === "__standalone__") fillFrom(null);
  };

  /* attachments */
  const drop = $("#pDrop"), fileIn = $("#pFile"), attList = $("#pAtts");
  const renderAtts = () => {
    attList.innerHTML = reportFiles.map((f, i) => `
      <div class="att"><span style="color:var(--ink-3)">■</span><span class="nm">${esc(f.name)}</span>
      <span class="st" id="attSt${i}">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="rm" data-i="${i}" type="button">✕</button></div>`).join("");
    $("#ocrWrap").style.display = reportFiles.length ? "block" : ($("#pOcr")?.value ? "block" : "none");
    $$(".att .rm", attList).forEach((b) => b.onclick = () => { reportFiles.splice(+b.dataset.i, 1); renderAtts(); });
  };
  drop.onclick = () => fileIn.click();
  fileIn.onchange = () => { reportFiles.push(...fileIn.files); fileIn.value = ""; renderAtts(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); reportFiles.push(...e.dataTransfer.files); renderAtts(); };

  const runOcrNow = async () => {
    if (!reportFiles.length) return "";
    const btn = $("#pRunOcr"); if (btn) { btn.disabled = true; btn.textContent = t("ocrRunning"); }
    try {
      const { text, warnings } = await extractAttachments(reportFiles, (name, st, sub) => {
        const i = reportFiles.findIndex((f) => f.name === name);
        const el = $("#attSt" + i);
        if (el) { el.textContent = st === "run" ? (sub || "…") : st === "ok" ? "✓" : "✕"; el.className = "st " + (st === "ok" ? "ok" : ""); }
      });
      if (warnings.includes("ocr")) toast(t("ocrNeedsNet"));
      if (text) $("#pOcr").value = ($("#pOcr").value ? $("#pOcr").value + "\n\n" : "") + text;
      return text;
    } finally { if (btn) { btn.disabled = false; btn.textContent = t("runOcr"); } }
  };
  $("#pRunOcr").onclick = runOcrNow;

  /* submit pipeline */
  $("#pSubmit").onclick = async () => {
    const pick = $("#pPick").value;
    if (!pick) return toast(t("errPick"));
    const title = $("#pTitle").value.trim();
    const date = $("#pDate").value;
    const notes = $("#pNotes").value.trim();
    const author = $("#pAuthor").value.trim();
    if (!title) return toast(t("errTitle"));
    if (!date) return toast(t("errDate"));
    if (!notes) return toast(t("errNotes"));
    if (author) { S.author = author; N.saveSettings(S); }

    const stT = $("#pStart").value, enT = $("#pEnd").value, inT = $("#pIn").value, outT = $("#pOut").value;
    const data = {
      id: pick === "__standalone__" ? null : pick,
      title, docNo: makeDocNo(),
      createdDate: new Date().toISOString(),
      dateStart: stT ? `${date}T${stT}:00${TZ}` : date,
      dateEnd: stT && enT ? `${date}T${enT}:00${TZ}` : undefined,
      inTime: inT ? `${date}T${inT}:00${TZ}` : null,
      outTime: outT ? `${date}T${outT}:00${TZ}` : null,
      company: $("#pCompany").value.trim(),
      visitorName: $("#pVisitor").value.trim(),
      count: $("#pCount").value || null,
      via: $("#pVia").value.trim(),
      purpose: $("#pPurpose").value,
      areas: $$("input[name=pArea]:checked").map((i) => i.value),
      hygiene: $$("input[name=pHyg]:checked").map((i) => i.value),
      escort: $("#pEscort").value.trim(),
      notes,
      attachments: reportFiles.map((f) => f.name),
      ocrText: $("#pOcr").value.trim(),
      author,
    };
    runPipeline(data, { hasFiles: reportFiles.length > 0 && !$("#pOcr").value.trim(), runOcrNow });
  };
}

/* ---------------- pipeline (progress overlay) ---------------- */
async function runPipeline(data, { hasFiles, runOcrNow }) {
  const connected = N.isConnected();
  const steps = [
    { k: "validate", label: t("p_validate") },
    { k: "ocr", label: t("p_ocr") },
    { k: "pdf", label: t("p_pdf") },
    { k: "notion", label: t("p_notion") },
    { k: "upload", label: t("p_upload") },
  ];
  const pov = $("#pov");
  pov.innerHTML = `<div class="pwin">
    <div class="ph"><h3>来訪報告書　作成中…</h3></div>
    <div class="pbar"><i id="pbari"></i></div>
    <div class="psteps">${steps.map((s, i) => `
      <div class="pstep" id="ps${i}"><div class="ic">${i + 1}</div><div>${esc(s.label)}<span class="sub" id="pss${i}"></span></div></div>`).join("")}
    </div>
    <div class="pdone" id="pdone" style="display:none"></div>
    <div class="pfoot" id="pfoot"></div>
  </div>`;
  pov.classList.add("on");
  const bar = $("#pbari");
  let done = 0;
  const setStep = (i, st, sub) => {
    const el = $("#ps" + i);
    el.className = "pstep " + st;
    if (st === "ok" || st === "skip") { el.querySelector(".ic").textContent = st === "ok" ? "✓" : "—"; done = i + 1; bar.style.width = (done / steps.length) * 100 + "%"; }
    if (st === "run") el.querySelector(".ic").textContent = "";
    if (st === "err") el.querySelector(".ic").textContent = "!";
    if (sub != null) $("#pss" + i).textContent = sub;
  };

  let pdfBytes = null;
  const filename = `来訪報告書_${data.docNo}${data.company ? "_" + data.company.replace(/[\\/:*?"<>|]/g, "") : ""}.pdf`;

  try {
    // 1 validate
    setStep(0, "run"); await sleep(250); setStep(0, "ok");
    // 2 ocr
    if (hasFiles) {
      setStep(1, "run");
      const text = await runOcrNow();
      data.ocrText = ($("#pOcr")?.value || data.ocrText || "").trim();
      setStep(1, "ok", text ? text.slice(0, 60).replace(/\n/g, " ") + "…" : "");
    } else setStep(1, "skip", t("p_skipped"));
    // 3 pdf
    setStep(2, "run");
    pdfBytes = await generateReportPdf(data);
    setStep(2, "ok", (pdfBytes.length / 1024).toFixed(0) + " KB");
    // 4 notion
    if (connected) {
      setStep(3, "run");
      const payload = {
        title: data.title, dateStart: data.dateStart, dateEnd: data.dateEnd,
        company: data.company, visitorName: data.visitorName, count: data.count,
        via: data.via, purpose: data.purpose, areas: data.areas,
        hygiene: data.hygiene, inTime: data.inTime, outTime: data.outTime,
        status: CONFIG.statuses.reported, minutes: true, done: true,
        category: undefined,
      };
      let pageId = data.id;
      if (pageId) await N.updateVisit(pageId, payload);
      else {
        const created = await N.createVisit({ ...payload, category: CONFIG.defaultCategory });
        pageId = created.id;
      }
      const bodyLines = [
        `文書番号：${data.docNo}｜作成者：${data.author}｜作成日：${new Date().toLocaleDateString("ja-JP")}`,
        `■ 訪問内容・所感`,
        ...data.notes.split(/\n/),
        ...(data.escort ? [`案内者：${data.escort}`] : []),
        ...(data.ocrText ? ["■ 添付資料・抽出テキスト（OCR）", ...data.ocrText.split(/\n/).slice(0, 40)] : []),
      ];
      await N.appendReportBody(pageId, bodyLines);
      setStep(3, "ok");
      // 5 upload
      setStep(4, "run");
      await N.attachPdf(pageId, filename, pdfBytes);
      setStep(4, "ok");
    } else { setStep(3, "skip", t("p_skipped")); setStep(4, "skip", t("p_skipped")); }

    // done
    if (!connected && data.id) {
      await N.updateVisit(data.id, { status: CONFIG.statuses.reported });
    }
    await refreshVisits(true);
    bar.style.width = "100%";
    $("#pdone").style.display = "block";
    $("#pdone").innerHTML = `<div class="okmark">✓</div><b>${connected ? t("reportDone") : t("reportDoneLocal")}</b>`;
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    $("#pfoot").innerHTML = `
      <a class="btn ind" href="${url}" download="${esc(filename)}">▼ ${t("downloadPdf")}</a>
      <button class="btn ghost" id="povClose">${t("close")}</button>`;
    $("#povClose").onclick = () => { pov.classList.remove("on"); location.hash = "#schedule"; };
  } catch (e) {
    const runIdx = steps.findIndex((_, i) => $("#ps" + i).classList.contains("run"));
    if (runIdx >= 0) setStep(runIdx, "err", e.message);
    $("#pfoot").innerHTML = `
      ${pdfBytes ? `<a class="btn ind" href="${URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }))}" download="${esc(filename)}">▼ ${t("downloadPdf")}</a>` : ""}
      <button class="btn ghost" id="povClose">${t("close")}</button>`;
    $("#povClose").onclick = () => pov.classList.remove("on");
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- settings ---------------- */
function viewSettings() {
  const main = $("#main");
  S = N.loadSettings();
  main.innerHTML = pageHead("setTitle", "Settings") + `
  <div class="card"><div class="chead"><h3>${t("setConn")} <span class="en">Notion</span></h3></div>
  <div class="cbody">
    <div class="fgrid">
      <div class="field full"><label>${t("setToken")}</label>
        <input type="password" id="sToken" value="${esc(S.token || "")}" placeholder="${esc(t("setToken_ph"))}" autocomplete="off">
        <div class="hint">${t("setTokenHint")}</div></div>
      <div class="field full"><label>${t("setStaffKey")}</label>
        <input type="password" id="sStaffKey" value="${esc(S.staffKey || "")}" autocomplete="off">
        <div class="hint">${t("setStaffKeyHint")}</div></div>
      <div class="field full"><label>${t("setDs")}</label>
        <input type="text" id="sDs" value="${esc(S.dataSourceId || CONFIG.dataSourceId)}"></div>
      <div class="field"><label>${t("setRelay")}</label><select id="sRelay">
        ${CONFIG.relays.map((r) => `<option value="${r.id}" ${(S.relay || (CONFIG.workerUrl ? "worker" : "corsproxy")) === r.id ? "selected" : ""}>${lang === "ja" ? r.labelJa : r.labelEn}</option>`).join("")}
      </select></div>
      <div class="field"><label>${t("setRelayUrl")}</label>
        <input type="text" id="sRelayUrl" value="${esc(S.relayCustom || CONFIG.workerUrl || "")}" placeholder="${esc(t("setRelayUrl_ph"))}"></div>
      <div class="field full hstack" style="align-items:center">
        <label class="pill"><input type="checkbox" id="sDemo" ${S.demo ? "checked" : ""}><span>${t("setDemo")}</span></label>
        <button class="btn ghost" id="sTest" type="button">${t("testConn")}</button>
        <span id="sTestRes"></span>
      </div>
    </div>
  </div></div>
  <div class="card"><div class="chead"><h3>${t("setBrand")} <span class="en">Brand</span></h3></div>
  <div class="cbody"><div class="fgrid">
    <div class="field"><label>${t("setLogo")}</label><input type="file" id="sLogo" accept="image/*">
      ${S.logoData ? `<div class="hint">✓ custom (<a href="#" id="sLogoClr">clear</a>)</div>` : ""}</div>
    <div class="field"><label>${t("setFooter")}</label><input type="file" id="sFooter" accept="image/*">
      ${S.footerData ? `<div class="hint">✓ custom (<a href="#" id="sFooterClr">clear</a>)</div>` : ""}</div>
    <div class="field full"><div class="hint">${t("setBrandHint")}</div></div>
  </div></div></div>
  <div class="subbar">
    <button class="btn primary lg" id="sSave">${t("setSave")}</button>
  </div>`;

  const readAsData = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  $("#sLogo").onchange = async (e) => { if (e.target.files[0]) { S.logoData = await readAsData(e.target.files[0]); toast("✓ logo"); } };
  $("#sFooter").onchange = async (e) => { if (e.target.files[0]) { S.footerData = await readAsData(e.target.files[0]); toast("✓ footer"); } };
  const lc = $("#sLogoClr"); if (lc) lc.onclick = (e) => { e.preventDefault(); delete S.logoData; N.saveSettings(S); viewSettings(); };
  const fc = $("#sFooterClr"); if (fc) fc.onclick = (e) => { e.preventDefault(); delete S.footerData; N.saveSettings(S); viewSettings(); };

  $("#sTest").onclick = async () => {
    const res = $("#sTestRes");
    res.className = ""; res.textContent = t("testing");
    // temporarily save current inputs
    collect(); N.saveSettings(S);
    try {
      const name = await N.testConnection();
      res.className = "conn-ok"; res.textContent = "✓ " + t("connOk") + (name ? `（${name}）` : "");
    } catch (e) {
      res.className = "conn-ng"; res.textContent = "✕ " + t("connNg") + " — " + e.message;
    }
  };
  const collect = () => {
    S.token = $("#sToken").value.trim();
    S.staffKey = $("#sStaffKey").value.trim();
    S.dataSourceId = $("#sDs").value.trim();
    S.relay = $("#sRelay").value;
    S.relayCustom = $("#sRelayUrl").value.trim();
    S.demo = $("#sDemo").checked;
    S.lang = lang;
  };
  $("#sSave").onclick = () => {
    collect(); N.saveSettings(S);
    visitsLoaded = false;
    toast("✓ " + t("saved"));
    location.hash = "#home";
  };
}

/* ---------------- router ---------------- */
function route() {
  const h = location.hash.replace(/^#/, "") || "home";
  const [r, id] = h.split("/");
  currentRoute = r;
  setNav(r);
  if (r === "home") viewHome();
  else if (r === "schedule") viewSchedule();
  else if (r === "reserve") viewReserve(id);
  else if (r === "report") viewReport(id);
  else if (r === "settings") viewSettings();
  else viewHome();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------------- demo seed ---------------- */
function seedDemo() {
  if (localStorage.getItem("kv_seeded")) return;
  localStorage.setItem("kv_seeded", "1");
  const tomorrow = new Date(Date.now() + 864e5);
  const d = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  localStorage.setItem("kv_demo_pages", JSON.stringify([{
    id: "demo-sample-1", url: null,
    title: "（サンプル）田中商事 田中様 来社",
    dateStart: `${d}T14:00:00${TZ}`, dateEnd: `${d}T15:00:00${TZ}`,
    category: "来客", company: "田中商事", visitorName: "田中様", count: 2,
    via: "町役場のご紹介", purpose: "工場視察", areas: ["醸造室（仕込）", "タップルーム・店舗"],
    hygiene: [], status: "予約済", minutes: false, done: false, files: [],
  }]));
}

/* ---------------- boot ---------------- */
seedDemo();
renderShell();
route();
