/* ocr.js — attachment text extraction.
 * PDFs: bundled pdf.js (works offline). Scanned pages & images: tesseract.js
 * loaded lazily from a CDN (requires internet; degrades gracefully).
 */
import { CONFIG } from "./config.js";

let pdfjsP = null;
function getPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import("./vendor/pdf.min.mjs").then((mod) => {
      const lib = mod.default || mod;
      (lib.GlobalWorkerOptions || mod.GlobalWorkerOptions).workerSrc = "./vendor/pdf.worker.min.mjs";
      return lib.getDocument ? lib : mod;
    });
  }
  return pdfjsP;
}

let tessP = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("load fail " + src));
    document.head.appendChild(s);
  });
}
async function getTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!tessP) {
    tessP = (async () => {
      let lastErr;
      for (const cdn of CONFIG.ocr.cdns) {
        try { await loadScript(cdn); if (window.Tesseract) return window.Tesseract; }
        catch (e) { lastErr = e; }
      }
      throw lastErr || new Error("tesseract unavailable");
    })();
  }
  return tessP;
}

let workerP = null;
async function getWorker(onProgress) {
  const T = await getTesseract();
  if (!workerP) {
    workerP = T.createWorker(CONFIG.ocr.langs.split("+"), 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100));
      },
    });
  }
  return workerP;
}

async function ocrCanvasOrImage(src, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(src);
  return (data.text || "").trim();
}

async function extractPdf(file, onStatus) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, CONFIG.ocr.maxPdfPages);
  const parts = [];
  let ocrFailed = false;
  for (let i = 1; i <= maxPages; i++) {
    onStatus && onStatus(`p.${i}/${maxPages}`);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = tc.items.map((it) => it.str).join(" ").trim();
    if (text.replace(/\s/g, "").length < 40) {
      // likely scanned — render & OCR
      try {
        const vp = page.getViewport({ scale: 2 });
        const cv = document.createElement("canvas");
        cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        text = await ocrCanvasOrImage(cv, null);
      } catch (e) { ocrFailed = true; }
    }
    if (text) parts.push(`--- ${file.name} p.${i} ---\n${text}`);
  }
  if (doc.numPages > maxPages) parts.push(`（※ ${doc.numPages}ページ中、先頭${maxPages}ページのみ処理）`);
  return { text: parts.join("\n\n"), ocrFailed };
}

/* returns { text, warnings[] } */
export async function extractAttachments(files, onStatus) {
  const out = [];
  const warnings = [];
  for (const f of files) {
    onStatus && onStatus(f.name, "run");
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const { text, ocrFailed } = await extractPdf(f, (s) => onStatus && onStatus(f.name, "run", s));
        if (ocrFailed) warnings.push("ocr");
        if (text) out.push(text);
      } else if (/^image\//.test(f.type)) {
        const url = URL.createObjectURL(f);
        try {
          const text = await ocrCanvasOrImage(url, (p) => onStatus && onStatus(f.name, "run", p + "%"));
          if (text) out.push(`--- ${f.name} ---\n${text}`);
        } finally { URL.revokeObjectURL(url); }
      } else {
        const text = await f.text().catch(() => "");
        if (text && text.length < 20000) out.push(`--- ${f.name} ---\n${text}`);
      }
      onStatus && onStatus(f.name, "ok");
    } catch (e) {
      warnings.push("ocr");
      onStatus && onStatus(f.name, "err");
    }
  }
  return { text: out.join("\n\n"), warnings: [...new Set(warnings)] };
}
