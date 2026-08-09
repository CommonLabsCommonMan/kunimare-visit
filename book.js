/* book.js — public beer hall booking page (no Notion token in the browser).
 * Flow: validate → generate ご予約確認書 PDF client-side → POST to the
 * Cloudflare Worker /book endpoint (token lives there as a secret) →
 * Worker creates the Notion page (+ day-before reminder) and attaches the PDF.
 */
import { CONFIG } from "./config.js";
import { generateBookingPdf } from "./pdfgen.js";

const BK = {
  ja: {
    title: "ビヤホール ご予約",
    tent: "※ 仮予約制です。送信後、担当者よりお電話またはメールで確定のご連絡を差し上げます。",
    date: "ご希望日", time: "開始時間", end: "終了（目安・任意）",
    adults: "大人", children: "お子様",
    plan: "プラン", nomi: "☑ 飲み放題を希望",
    name: "代表者名（必須）", phone: "お電話番号（必須）", email: "メール（任意）",
    group: "会社・団体名（任意）", allergy: "アレルギー・食事制限", notes: "ご要望・備考",
    consent: "ご入力いただいた情報は、本予約の受付・ご連絡の目的にのみ使用します。",
    submit: "この内容で予約する",
    prog_pdf: "ご予約確認書を作成しています…", prog_send: "送信しています…",
    done: "ご予約を受け付けました（仮予約）",
    doneHint: "確定のご連絡をお待ちください。内容の変更・キャンセルはお電話にてお願いいたします。",
    pdf: "ご予約確認書（PDF）",
    errReq: "必須項目（日時・代表者名・お電話番号）をご入力ください。",
    errConsent: "個人情報の取り扱いに同意のうえ送信してください。",
    errPast: "本日以降の日付をご指定ください。",
    errSend: "送信できませんでした。時間をおいて再度お試しいただくか、お電話にてご予約ください。",
    closed: "オンライン予約は現在準備中です。お電話にてご予約ください。",
  },
  en: {
    title: "Beer Hall Reservation",
    tent: "※ Reservations are tentative. Our staff will contact you by phone or email to confirm.",
    date: "Preferred date", time: "Start time", end: "End (approx., optional)",
    adults: "Adults", children: "Children",
    plan: "Plan", nomi: "☑ All-you-can-drink",
    name: "Name (required)", phone: "Phone (required)", email: "Email (optional)",
    group: "Company / group (optional)", allergy: "Allergies / dietary needs", notes: "Requests / notes",
    consent: "Your information is used only to process and confirm this reservation.",
    submit: "Submit reservation",
    prog_pdf: "Creating your confirmation…", prog_send: "Sending…",
    done: "Reservation received (tentative)",
    doneHint: "We will contact you to confirm. For changes or cancellation, please call us.",
    pdf: "Confirmation (PDF)",
    errReq: "Please fill the required fields (date, time, name, phone).",
    errConsent: "Please agree to the privacy note before submitting.",
    errPast: "Please choose today or a future date.",
    errSend: "Could not send. Please try again later or call us to reserve.",
    closed: "Online booking is not open yet. Please call us to reserve.",
  },
};

let lang = "ja";
const $ = (s) => document.querySelector(s);
const t = (k) => BK[lang][k];

function applyLang() {
  document.documentElement.lang = lang;
  $("#hTitle").textContent = t("title");
  $("#tentNote").textContent = t("tent");
  $("#lDate").textContent = t("date");
  $("#lTime").textContent = t("time");
  $("#lEnd").textContent = t("end");
  $("#lAdults").textContent = t("adults");
  $("#lChildren").textContent = t("children");
  $("#lPlan").textContent = t("plan");
  $("#lNomi").textContent = t("nomi");
  $("#lName").textContent = t("name");
  $("#lPhone").textContent = t("phone");
  $("#lEmail").textContent = t("email");
  $("#lGroup").textContent = t("group");
  $("#lAllergy").textContent = t("allergy");
  $("#lNotes").textContent = t("notes");
  $("#lConsent").textContent = t("consent");
  $("#fSubmit").textContent = t("submit");
  document.querySelectorAll(".bklang button").forEach((b) => b.classList.toggle("on", b.dataset.l === lang));
}
document.querySelectorAll(".bklang button").forEach((b) => b.onclick = () => { lang = b.dataset.l; applyLang(); });

/* init */
$("#fPlan").innerHTML = CONFIG.booking.plans.map((p) => `<option>${p}</option>`).join("");
const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
$("#fDate").min = todayIso;
$("#fTime").value = "18:00";
applyLang();

const workerUrl = (CONFIG.workerUrl || "").replace(/\/$/, "");
if (!workerUrl) {
  $("#bkForm").style.display = "none";
  $("#tentNote").textContent = t("closed");
}

function err(msg) { const e = $("#bkErr"); e.textContent = msg; e.style.display = "block"; }
function docNoPublic() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${CONFIG.booking.docPrefix}-${ymd}-${rand}`;
}
const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

$("#fSubmit").onclick = async () => {
  $("#bkErr").style.display = "none";
  const date = $("#fDate").value, time = $("#fTime").value;
  const name = $("#fName").value.trim(), phone = $("#fPhone").value.trim();
  if (!date || !time || !name || !phone) return err(t("errReq"));
  if (date < todayIso) return err(t("errPast"));
  if (!$("#fConsent").checked) return err(t("errConsent"));

  const b = {
    date, time, end: $("#fEnd").value || "",
    adults: +$("#fAdults").value || 0,
    children: +$("#fChildren").value || 0,
    name, phone,
    email: $("#fEmail").value.trim(),
    group: $("#fGroup").value.trim(),
    plan: $("#fPlan").value,
    nomihodai: $("#fNomi").checked,
    allergies: $("#fAllergy").value.trim(),
    notes: $("#fNotes").value.trim(),
    lang,
    hp: $("#fWebsite").value, // honeypot — humans leave it empty
  };

  $("#bkForm").style.display = "none";
  $("#bkProg").style.display = "block";
  $("#bkProgTxt").textContent = t("prog_pdf");

  try {
    const docNo = docNoPublic();
    // PDF generation is best-effort: an old phone that fails here can still book
    let pdfBytes = null;
    try {
      pdfBytes = await generateBookingPdf({
        docNo, createdDate: new Date().toISOString(),
        dateStart: `${date}T${time}:00${CONFIG.timezoneOffset}`, endTime: b.end,
        adults: b.adults, children: b.children,
        repName: name, phone, email: b.email, company: b.group,
        plan: b.plan, nomihodai: b.nomihodai,
        allergies: b.allergies, notes: b.notes,
        tentative: true, source: "オンライン予約フォーム",
      });
    } catch (pdfErr) { pdfBytes = null; }

    $("#bkProgTxt").textContent = t("prog_send");
    const filename = `ご予約確認書_${docNo}.pdf`;
    const payload = { ...b, docNo, filename };
    if (pdfBytes) payload.pdfBase64 = b64(pdfBytes);
    const res = await fetch(workerUrl + "/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.error || ""; } catch {}
      throw new Error("HTTP " + res.status + (detail ? " — " + detail : ""));
    }

    $("#bkProg").style.display = "none";
    $("#bkDone").style.display = "block";
    $("#doneMsg").innerHTML = `<b>${t("done")}</b>`;
    $("#doneNo").textContent = docNo;
    $("#doneHint").textContent = t("doneHint");
    const a = $("#donePdf");
    if (pdfBytes) {
      const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
      a.href = url; a.download = filename; a.textContent = "▼ " + t("pdf");
    } else a.style.display = "none";
  } catch (e) {
    $("#bkProg").style.display = "none";
    $("#bkForm").style.display = "block";
    err(t("errSend") + "\n[" + (e.message || e) + "]");
  }
};
