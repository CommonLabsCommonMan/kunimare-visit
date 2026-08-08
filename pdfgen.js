/* pdfgen.js — official Japanese 来訪報告書 PDF.
 * Strategy: render pages on <canvas> with the bundled Noto Sans JP subset
 * (identical output on every device, no CDN needed), then assemble the
 * pages into a real A4 PDF with the bundled pdf-lib.
 */
import { CONFIG } from "./config.js";
import { loadSettings } from "./notion.js";

const PW = CONFIG.pdf.pageW, PH = CONFIG.pdf.pageH, M = CONFIG.pdf.margin, S = CONFIG.pdf.scale;
const IND = "#1F3A5F", GOLD = "#B08D40", INK = "#22293A", GRAY = "#5A6070", LGRAY = "#8B8F9C",
      LINE = "#B9B29C", WASHI = "#F2EEE2", SHU = "#C24E45";

let fontsReady = null;
function ensureFonts() {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    const r = new FontFace("KunimarePDF", `url(${CONFIG.pdf.fontRegular})`, { weight: "400" });
    const b = new FontFace("KunimarePDF", `url(${CONFIG.pdf.fontBold})`, { weight: "700" });
    await Promise.all([r.load(), b.load()]);
    document.fonts.add(r); document.fonts.add(b);
  })();
  return fontsReady;
}

function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

/* ---------- text helpers ---------- */
const NO_START = "、。，．）」』】〉》・：；！？!?ー〜…％%,.)]}";
const NO_END = "（「『【〈《([{";
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || "").split(/\r?\n/)) {
    if (!para) { out.push(""); continue; }
    let line = "";
    for (const ch of para) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line) {
        // kinsoku: pull forbidden leading char back, push forbidden trailing char forward
        if (NO_START.includes(ch)) { out.push(line + ch); line = ""; continue; }
        if (NO_END.includes(line[line.length - 1])) {
          out.push(line.slice(0, -1)); line = line[line.length - 1] + ch; continue;
        }
        out.push(line); line = ch;
      } else line = t;
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/* Times are rendered as the literal wall-clock written in the ISO string
 * (visits are stored with the brewery's +09:00 offset), so the PDF is
 * identical no matter what timezone the generating device is in. */
const jpDate = (iso) => {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const [_, y, mo, d] = m;
  const w = "日月火水木金土"[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${+y}年${+mo}月${+d}日（${w}）`;
};
const jpTime = (iso) => {
  if (!iso) return "";
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${+m[1]}:${m[2]}` : "";
};

/* ---------- page painter ---------- */
class Page {
  constructor(images, pageNo) {
    this.c = document.createElement("canvas");
    this.c.width = PW * S; this.c.height = PH * S;
    this.x = this.c.getContext("2d");
    this.x.scale(S, S);
    this.x.fillStyle = "#FFFFFF";
    this.x.fillRect(0, 0, PW, PH);
    this.x.textBaseline = "alphabetic";
    this.images = images;
    this.pageNo = pageNo;
    this.y = M;
  }
  font(size, weight = 400) { this.x.font = `${weight} ${size}px KunimarePDF`; }
  text(t, x, y, { size = 10, weight = 400, color = INK, align = "left", ls = 0 } = {}) {
    this.font(size, weight); this.x.fillStyle = color;
    if (ls > 0) {
      let cx = x;
      const w = [...t].reduce((a, ch) => a + this.x.measureText(ch).width + ls, -ls);
      if (align === "center") cx = x - w / 2;
      if (align === "right") cx = x - w;
      for (const ch of t) { this.x.fillText(ch, cx, y); cx += this.x.measureText(ch).width + ls; }
    } else {
      this.x.textAlign = align; this.x.fillText(t, x, y); this.x.textAlign = "left";
    }
  }
  line(x1, y1, x2, y2, color = LINE, w = 0.7) {
    this.x.strokeStyle = color; this.x.lineWidth = w;
    this.x.beginPath(); this.x.moveTo(x1, y1); this.x.lineTo(x2, y2); this.x.stroke();
  }
  rect(x, y, w, h, { fill, stroke, lw = 0.8 } = {}) {
    if (fill) { this.x.fillStyle = fill; this.x.fillRect(x, y, w, h); }
    if (stroke) { this.x.strokeStyle = stroke; this.x.lineWidth = lw; this.x.strokeRect(x, y, w, h); }
  }
  footer(total) {
    const { footerImg } = this.images;
    const bandTop = PH - 56;
    this.line(M, bandTop, PW - M, bandTop, LINE, 0.6);
    if (footerImg) {
      // aspect-preserving, centered letterhead band
      const ar = footerImg.width / footerImg.height;
      let fh = 38, fw = fh * ar;
      const maxW = (PW - M * 2) * 0.72;
      if (fw > maxW) { fw = maxW; fh = fw / ar; }
      this.x.drawImage(footerImg, (PW - fw) / 2, bandTop + 6, fw, fh);
    }
    this.text(`${this.pageNo} / ${total}`, PW / 2, PH - 8, { size: 7.5, color: LGRAY, align: "center" });
  }
}

/* ---------- main ---------- */
export async function generateReportPdf(d) {
  await ensureFonts();
  const s = loadSettings();
  const [logoImg, footerImg] = await Promise.all([
    loadImg(s.logoData || CONFIG.pdf.logo),
    loadImg(s.footerData || CONFIG.pdf.footer),
  ]);
  const images = { logoImg, footerImg };
  const pages = [];
  let pg = new Page(images, 1);
  pages.push(pg);

  const CW = PW - M * 2; // content width

  /* ===== header (page 1) ===== */
  let logoH = 0;
  if (logoImg) {
    const ar = logoImg.width / logoImg.height;
    logoH = ar < 1.4 ? 48 : 30; // square emblem gets more presence than a wide wordmark
    let lw = logoH * ar;
    if (lw > 190) { lw = 190; logoH = lw / ar; }
    pg.x.drawImage(logoImg, M, pg.y - 8, lw, logoH);
  } else {
    pg.text(CONFIG.brandJa, M, pg.y + 14, { size: 13, weight: 700, color: IND });
  }
  // doc meta (right)
  pg.text(`文書番号：${d.docNo}`, PW - M, pg.y + 2, { size: 8.5, color: GRAY, align: "right" });
  pg.text(`作成日：${jpDate(d.createdDate || new Date().toISOString())}`, PW - M, pg.y + 14, { size: 8.5, color: GRAY, align: "right" });
  pg.y += Math.max(40, logoH + 4);

  // title
  pg.text("来 訪 報 告 書", PW / 2, pg.y + 12, { size: 21, weight: 700, color: IND, align: "center", ls: 6 });
  pg.text("国稀ブルワリー　来訪記録", PW / 2, pg.y + 28, { size: 8.5, color: LGRAY, align: "center", ls: 2 });
  pg.y += 36;
  pg.line(M, pg.y, PW - M, pg.y, IND, 2.2);
  pg.line(M, pg.y + 3, PW - M, pg.y + 3, GOLD, 0.8);
  pg.y += 14;

  // stamp boxes (担当 / 承認)
  const sbW = 40, sbH = 42, sbX = PW - M - sbW * 2 - 6;
  ["担当", "承認"].forEach((lb, i) => {
    const bx = sbX + i * (sbW + 6);
    pg.rect(bx, pg.y, sbW, sbH, { stroke: LINE, lw: 0.8 });
    pg.rect(bx, pg.y, sbW, 13, { fill: WASHI, stroke: LINE, lw: 0.8 });
    pg.text(lb, bx + sbW / 2, pg.y + 9.5, { size: 7.5, color: GRAY, align: "center", ls: 2 });
  });

  /* ===== info table ===== */
  const rows = [];
  const dateLine = d.dateStart
    ? jpDate(d.dateStart) + (d.dateStart.includes("T") ? `　${jpTime(d.dateStart)}${d.dateEnd ? "〜" + jpTime(d.dateEnd) : ""}` : "")
    : "―";
  rows.push(["訪問日時", dateLine]);
  if (d.inTime || d.outTime)
    rows.push(["入退場時間", `入場 ${d.inTime ? jpTime(d.inTime) : "―"}　／　退場 ${d.outTime ? jpTime(d.outTime) : "―"}`]);
  rows.push(["訪問者名", d.visitorName || "―"]);
  rows.push(["会社・所属", d.company || "―"]);
  rows.push(["人数", d.count ? `${d.count} 名` : "―"]);
  rows.push(["紹介・経由", d.via || "―"]);
  rows.push(["訪問目的", d.purpose || "―"]);
  rows.push(["立入りエリア", (d.areas || []).join("、") || "―"]);
  rows.push(["案内者", d.escort || "―"]);

  const labW = 96, valW = CW - labW, tblW = CW - (sbW * 2 + 18); // avoid stamp boxes for first rows
  const rowH = 21, padX = 8;
  let ty = pg.y;
  rows.forEach(([lb, val], i) => {
    const w = ty < pg.y + sbH + 4 && i < 2 ? tblW : CW; // first two rows narrower (stamp area)
    const vw = w - labW;
    pg.rect(M, ty, labW, rowH, { fill: WASHI, stroke: LINE });
    pg.rect(M + labW, ty, vw, rowH, { stroke: LINE });
    pg.text(lb, M + padX, ty + 14, { size: 9, weight: 700, color: GRAY });
    // shrink long values
    pg.font(10);
    let size = 10, tv = String(val);
    while (pg.x.measureText(tv).width > vw - padX * 2 && size > 7) { size -= 0.5; pg.font(size); }
    pg.text(tv, M + labW + padX, ty + 14.2, { size, color: INK });
    ty += rowH;
  });

  // hygiene row (taller, checkboxes)
  const hyH = 24;
  pg.rect(M, ty, labW, hyH, { fill: WASHI, stroke: LINE });
  pg.rect(M + labW, ty, CW - labW, hyH, { stroke: LINE });
  pg.text("衛生チェック", M + padX, ty + 15, { size: 9, weight: 700, color: GRAY });
  let hx = M + labW + padX;
  CONFIG.hygieneItems.forEach((item) => {
    const on = (d.hygiene || []).includes(item);
    pg.rect(hx, ty + 8, 8.5, 8.5, { stroke: on ? IND : LINE, lw: on ? 1.2 : 0.8, fill: on ? IND : "#fff" });
    if (on) { pg.text("✓", hx + 4.3, ty + 15.4, { size: 8, weight: 700, color: "#fff", align: "center" }); }
    pg.text(item, hx + 12, ty + 15.5, { size: 8.2, color: on ? INK : LGRAY });
    pg.font(8.2); hx += 12 + pg.x.measureText(item).width + 11;
  });
  ty += hyH;
  pg.y = ty + 18;

  /* ===== notes section (flows over pages) ===== */
  const sectionHead = (page, label) => {
    page.rect(M, page.y - 9, 3.5, 12, { fill: SHU });
    page.text(label, M + 10, page.y + 1, { size: 11.5, weight: 700, color: IND, ls: 1.5 });
    page.line(M, page.y + 7, PW - M, page.y + 7, IND, 1);
    page.y += 20;
  };
  const bottomLimit = PH - M - 34;

  const flowText = (label, body, size = 10, color = INK, lh = 16.5) => {
    sectionHead(pg, label);
    pg.font(size);
    const lines = wrap(pg.x, body, CW - 8);
    for (const ln of lines) {
      if (pg.y > bottomLimit) {
        pg = new Page(images, pages.length + 1); pages.push(pg);
        pg.y = M + 6;
        sectionHead(pg, label + "（続き）");
        pg.font(size);
      }
      pg.text(ln, M + 4, pg.y, { size, color });
      pg.y += lh;
    }
    pg.y += 14;
  };

  flowText("訪問内容・所感", d.notes || "―");

  if ((d.attachments || []).length || (d.ocrText || "").trim()) {
    if (pg.y > bottomLimit - 60) { pg = new Page(images, pages.length + 1); pages.push(pg); pg.y = M + 6; }
    let block = "";
    if ((d.attachments || []).length) block += "添付資料：" + d.attachments.join("、") + "\n";
    if ((d.ocrText || "").trim()) block += (block ? "\n" : "") + "【抽出テキスト（OCR）】\n" + d.ocrText.trim();
    flowText("添付資料・抽出テキスト", block, 8.8, GRAY, 14);
  }

  /* ===== author block ===== */
  if (pg.y > bottomLimit - 40) { pg = new Page(images, pages.length + 1); pages.push(pg); pg.y = M + 6; }
  const abW = 210, abX = PW - M - abW;
  pg.rect(abX, pg.y, abW, 40, { stroke: LINE });
  pg.rect(abX, pg.y, 72, 40, { fill: WASHI, stroke: LINE });
  pg.text("報告書作成者", abX + 8, pg.y + 24, { size: 8.5, weight: 700, color: GRAY });
  pg.text(d.author || "", abX + 82, pg.y + 25, { size: 11 });

  /* ===== footers & assemble ===== */
  pages.forEach((p) => p.footer(pages.length));

  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`来訪報告書 ${d.docNo}`);
  doc.setAuthor("Kunimare Brewery");
  doc.setSubject(d.title || "来訪報告書");
  doc.setCreator("Kunimare 来訪管理アプリ");
  for (const p of pages) {
    let bytes, isPng = true;
    const pngUrl = p.c.toDataURL("image/png");
    bytes = dataUrlToBytes(pngUrl);
    if (bytes.length > 1_300_000) { // fall back to JPEG for heavy pages
      const jpgUrl = p.c.toDataURL("image/jpeg", 0.93);
      const jb = dataUrlToBytes(jpgUrl);
      if (jb.length < bytes.length) { bytes = jb; isPng = false; }
    }
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([PW, PH]);
    page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
  }
  const out = await doc.save();
  return out;
}

function dataUrlToBytes(url) {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function makeDocNo(dateIso, prefix) {
  const px = prefix || CONFIG.docPrefix;
  const d = dateIso ? new Date(dateIso) : new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const seqKey = "kv_docseq_" + px + "_" + ymd;
  const n = (parseInt(localStorage.getItem(seqKey) || "0", 10) + 1);
  localStorage.setItem(seqKey, String(n));
  return `${px}-${ymd}-${String(n).padStart(2, "0")}`;
}

/* ============================================================
 * ご予約確認書 (Beer hall booking confirmation) — same visual
 * language as 来訪報告書, single page.
 * d: { docNo, createdDate, dateStart(dateTtime), endTime?, adults, children,
 *      repName, phone, email, company, plan, nomihodai, allergies, notes,
 *      tentative:true, source }
 * ============================================================ */
export async function generateBookingPdf(d) {
  await ensureFonts();
  const s = loadSettings();
  const [logoImg, footerImg] = await Promise.all([
    loadImg(s.logoData || CONFIG.pdf.logo),
    loadImg(s.footerData || CONFIG.pdf.footer),
  ]);
  const images = { logoImg, footerImg };
  const pg = new Page(images, 1);
  const CW = PW - M * 2;

  /* header */
  let logoH = 0;
  if (logoImg) {
    const ar = logoImg.width / logoImg.height;
    logoH = ar < 1.4 ? 48 : 30;
    let lw = logoH * ar;
    if (lw > 190) { lw = 190; logoH = lw / ar; }
    pg.x.drawImage(logoImg, M, pg.y - 8, lw, logoH);
  }
  pg.text(`予約番号：${d.docNo}`, PW - M, pg.y + 2, { size: 8.5, color: GRAY, align: "right" });
  pg.text(`受付日：${jpDate(d.createdDate || new Date().toISOString())}`, PW - M, pg.y + 14, { size: 8.5, color: GRAY, align: "right" });
  pg.y += Math.max(40, logoH + 4);

  pg.text("ご 予 約 確 認 書", PW / 2, pg.y + 12, { size: 21, weight: 700, color: IND, align: "center", ls: 6 });
  pg.text("国稀ブルワリー　ビヤホール", PW / 2, pg.y + 28, { size: 8.5, color: LGRAY, align: "center", ls: 2 });
  pg.y += 36;
  pg.line(M, pg.y, PW - M, pg.y, IND, 2.2);
  pg.line(M, pg.y + 3, PW - M, pg.y + 3, GOLD, 0.8);
  pg.y += 14;

  /* tentative notice */
  if (d.tentative !== false) {
    pg.rect(M, pg.y, CW, 24, { fill: "#FBF6E7", stroke: "#D8C58C", lw: 0.9 });
    pg.text("※ 本予約は仮予約です。担当者より確定のご連絡を差し上げます。", M + 10, pg.y + 15, { size: 9.5, weight: 700, color: "#7A5E19" });
    pg.y += 32;
  }

  /* info table */
  const total = (Number(d.adults) || 0) + (Number(d.children) || 0);
  const timeLine = d.dateStart
    ? jpDate(d.dateStart) + (d.dateStart.includes("T") ? `　${jpTime(d.dateStart)}${d.endTime ? "〜" + d.endTime : "〜"}` : "")
    : "―";
  const rows = [
    ["ご予約日時", timeLine],
    ["ご人数", total ? `${total} 名（大人 ${d.adults || 0}名／お子様 ${d.children || 0}名）` : "―"],
    ["代表者名", d.repName ? `${d.repName} 様` : "―"],
    ["お電話番号", d.phone || "―"],
    ["メール", d.email || "―"],
    ["会社・団体名", d.company || "―"],
    ["プラン", (d.plan || "未定") + (d.nomihodai ? "　＋ 飲み放題" : "")],
    ["アレルギー・食事制限", d.allergies || "―"],
    ["受付方法", d.source || "オンライン予約フォーム"],
  ];
  const labW = 110, rowH = 22, padX = 8;
  let ty = pg.y;
  rows.forEach(([lb, val]) => {
    pg.rect(M, ty, labW, rowH, { fill: WASHI, stroke: LINE });
    pg.rect(M + labW, ty, CW - labW, rowH, { stroke: LINE });
    pg.text(lb, M + padX, ty + 14.5, { size: 9, weight: 700, color: GRAY });
    let size = 10; pg.font(size);
    let tv = String(val);
    while (pg.x.measureText(tv).width > CW - labW - padX * 2 && size > 7) { size -= 0.5; pg.font(size); }
    pg.text(tv, M + labW + padX, ty + 14.7, { size, color: INK });
    ty += rowH;
  });
  pg.y = ty + 18;

  /* notes */
  pg.rect(M, pg.y - 9, 3.5, 12, { fill: SHU });
  pg.text("ご要望・備考", M + 10, pg.y + 1, { size: 11.5, weight: 700, color: IND, ls: 1.5 });
  pg.line(M, pg.y + 7, PW - M, pg.y + 7, IND, 1);
  pg.y += 20;
  pg.font(10);
  const lines = wrap(pg.x, d.notes || "―", CW - 8);
  for (const ln of lines.slice(0, 14)) { pg.text(ln, M + 4, pg.y, { size: 10 }); pg.y += 16.5; }
  pg.y += 10;

  /* contact block */
  pg.rect(M, pg.y, CW, 34, { fill: "#F3F6FA", stroke: "#C7D2E0", lw: 0.8 });
  pg.text("ご変更・キャンセルはお電話にてご連絡ください。", M + 10, pg.y + 14, { size: 9, color: IND, weight: 700 });
  pg.text("国稀ブルワリー ビヤホール（国稀酒造株式会社）", M + 10, pg.y + 26, { size: 8.5, color: GRAY });
  pg.y += 42;

  pg.footer(1);

  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`ご予約確認書 ${d.docNo}`);
  doc.setAuthor("Kunimare Brewery");
  doc.setCreator("Kunimare 来訪管理アプリ");
  const pngUrl = pg.c.toDataURL("image/png");
  let bytes = dataUrlToBytes(pngUrl), isPng = true;
  if (bytes.length > 1_300_000) {
    const jb = dataUrlToBytes(pg.c.toDataURL("image/jpeg", 0.93));
    if (jb.length < bytes.length) { bytes = jb; isPng = false; }
  }
  const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([PW, PH]);
  page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
  return doc.save();
}
