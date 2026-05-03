// =====================================================
// DAYBOOK IMPORT (admin side)
// =====================================================
// Adds an "Import Daybook" floating button and a hidden file picker.
// On file select, parses the JSON daybook and writes records straight into
// localStorage["gsc_records"] (bypasses the email parser entirely).
//
// Also patches the bundle's "Download PDF" flow so when a record has photos,
// a multi-page PDF is built (cert page first, then one photo per page).

(function () {
  const DAYBOOK_BTN_ID = "gs-daybook-import-btn";
  const DAYBOOK_FILE_ID = "gs-daybook-file";
  const DAYBOOK_LOG_ID = "gs-daybook-log";

  function ensureUi() {
    if (document.getElementById(DAYBOOK_BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = DAYBOOK_BTN_ID;
    btn.type = "button";
    btn.textContent = "Import Daybook";
    btn.style.cssText = [
      "position:fixed", "right:16px", "bottom:64px", "z-index:9998",
      "background:#2a52d4", "color:#fff", "border:0", "border-radius:999px",
      "padding:12px 18px", "font:800 13px/1 ui-sans-serif,system-ui,sans-serif",
      "letter-spacing:0.04em", "text-transform:uppercase", "cursor:pointer",
      "box-shadow:0 4px 16px rgba(42,82,212,0.45)",
    ].join(";");

    const file = document.createElement("input");
    file.type = "file";
    file.id = DAYBOOK_FILE_ID;
    file.accept = "application/json,.json";
    file.style.display = "none";

    btn.addEventListener("click", () => file.click());
    file.addEventListener("change", onFileChosen);

    const log = document.createElement("div");
    log.id = DAYBOOK_LOG_ID;
    log.style.cssText = [
      "position:fixed", "right:16px", "bottom:120px", "z-index:9998",
      "background:#1a2530", "color:#fff", "border:1px solid #334",
      "border-radius:12px", "padding:14px 18px", "max-width:340px",
      "font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif",
      "display:none", "box-shadow:0 6px 24px rgba(0,0,0,0.4)",
    ].join(";");

    document.body.appendChild(btn);
    document.body.appendChild(file);
    document.body.appendChild(log);
  }

  function showLog(msg, color) {
    const el = document.getElementById(DAYBOOK_LOG_ID);
    if (!el) return;
    el.textContent = msg;
    el.style.borderColor = color || "#334";
    el.style.display = "block";
    clearTimeout(showLog._t);
    showLog._t = setTimeout(() => { el.style.display = "none"; }, 4500);
  }

  function onFileChosen(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { showLog("Could not parse JSON: " + e.message, "#c0392b"); return; }
      const result = importDaybook(data);
      const certs = result.imported || 0;
      const dups  = result.duplicates || 0;
      const na    = result.noAccess || 0;
      let parts = [];
      parts.push("Imported " + certs + " cert" + (certs === 1 ? "" : "s"));
      if (dups) parts.push(dups + " skipped (already imported)");
      if (na) parts.push(na + " no-access logged");
      showLog(parts.join(" · "), "#2a52d4");
    };
    reader.onerror = () => showLog("Could not read file.", "#c0392b");
    reader.readAsText(f);
    // Reset input so re-selecting the same file fires change again.
    ev.target.value = "";
  }

  function importDaybook(data) {
    if (!data || (!Array.isArray(data.certs) && !Array.isArray(data.noAccess))) {
      showLog("Invalid daybook — no certs/noAccess arrays.", "#c0392b");
      return { imported: 0, duplicates: 0, noAccess: 0 };
    }

    let recs = [];
    try { recs = JSON.parse(localStorage.getItem("gsc_records") || "[]"); }
    catch (e) { recs = []; }

    const existingRefs = new Set(
      recs.map(r => r && r.certData && r.certData.certRef).filter(Boolean)
    );

    let imported = 0, duplicates = 0;
    (data.certs || []).forEach(rec => {
      if (!rec || !rec.certData || !rec.certData.certRef) return;
      const ref = rec.certData.certRef;
      // Replace existing record with same certRef from today, otherwise add.
      const todayPrefix = (rec.savedAt || "").slice(0, 10);
      const idx = recs.findIndex(r =>
        r && r.certData && r.certData.certRef === ref &&
        ((r.savedAt || "").slice(0, 10) === todayPrefix)
      );
      // Make sure record matches admin's expected shape — passes through cleanly
      // because the engineer side already builds records using the admin schema.
      const cleaned = Object.assign({}, rec);
      // Ensure id exists (admin ignores it but harmless)
      if (!cleaned.id) cleaned.id = "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      if (idx >= 0) {
        recs[idx] = cleaned;
        duplicates++;
      } else {
        recs.push(cleaned);
        imported++;
      }
    });

    // Save no-access entries separately so we can show them in admin (TODO UI)
    const naKey = "gsc_no_access_log";
    let naLog = [];
    try { naLog = JSON.parse(localStorage.getItem(naKey) || "[]"); } catch (e) {}
    let naAdded = 0;
    (data.noAccess || []).forEach(na => {
      naLog.push(Object.assign({}, na, { date: na.date || data.date || new Date().toISOString().slice(0, 10) }));
      naAdded++;
    });

    try { localStorage.setItem("gsc_records", JSON.stringify(recs)); } catch (e) {}
    try { localStorage.setItem(naKey, JSON.stringify(naLog)); } catch (e) {}

    return { imported, duplicates, noAccess: naAdded };
  }

  // ---------- PDF WITH PHOTOS ----------
  // The bundle generates a single-page cert PDF via html2canvas + jsPDF (or
  // similar). We don't override that — instead we patch the click handler on
  // the "Download PDF" button so AFTER the bundle saves the PDF, we splice
  // photos as additional pages.
  //
  // Simpler approach: hook the saveAs() / download blob URL. But hooking the
  // bundle's internals is fragile. Instead, we add an EXTRA button next to
  // the bundle's Download PDF: "⬇ Download with Photos".
  //
  // This button uses the bundle's existing PDF render, then appends photo
  // pages using pdf-lib (loaded from CDN on first use).

  // Locate the "Download PDF" button on the cert preview screen and add a
  // sibling button with photos.
  let pdfLibPromise = null;
  function loadPdfLib() {
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      s.onload = () => resolve(window.PDFLib);
      s.onerror = () => reject(new Error("pdf-lib failed to load"));
      document.head.appendChild(s);
    });
    return pdfLibPromise;
  }

  function getCurrentPreviewRecord() {
    // The bundle puts the cert preview into the DOM. The certRef shown in
    // top-right of the preview can be matched against gsc_records to find the
    // active record (which has any photos attached).
    let recs = [];
    try { recs = JSON.parse(localStorage.getItem("gsc_records") || "[]"); } catch (e) { return null; }
    const previewArea = document.querySelector("[class*='Preview'], [data-cert-preview], .preview, body");
    const txt = (document.body.textContent || "");
    // Heuristic: find the most recent record whose certRef appears in the page text.
    let match = null;
    for (let i = recs.length - 1; i >= 0; i--) {
      const ref = recs[i] && recs[i].certData && recs[i].certData.certRef;
      if (ref && txt.indexOf(ref) !== -1) { match = recs[i]; break; }
    }
    return match;
  }

  async function buildPhotoPdfPages(record, basePdfBytes) {
    const PDFLib = await loadPdfLib();
    const doc = await PDFLib.PDFDocument.load(basePdfBytes);
    const photos = (record && record.photos) || [];
    for (const ph of photos) {
      if (!ph || !ph.dataUrl || !ph.dataUrl.startsWith("data:image/")) continue;
      const isPng = ph.dataUrl.indexOf("image/png") !== -1;
      const b64 = ph.dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      let img;
      try {
        img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      } catch (e) {
        // try the other format if guess was wrong
        try { img = isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); }
        catch (e2) { continue; }
      }
      const pageWidth = 595.28, pageHeight = 841.89; // A4 portrait
      const page = doc.addPage([pageWidth, pageHeight]);
      const margin = 36;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2 - 40; // leave room for label
      const { width: iw, height: ih } = img.scale(1);
      const ratio = Math.min(maxW / iw, maxH / ih);
      const w = iw * ratio, h = ih * ratio;
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2 + 20;
      page.drawImage(img, { x, y, width: w, height: h });
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const label = (ph.label || "Photo").toUpperCase();
      const labelWidth = font.widthOfTextAtSize(label, 11);
      page.drawText(label, {
        x: (pageWidth - labelWidth) / 2,
        y: y - 24,
        size: 11,
        font,
        color: PDFLib.rgb(0.2, 0.2, 0.2),
      });
    }
    return await doc.save();
  }

  // Add an extra Download-with-photos button next to the existing one.
  function ensurePhotoDownloadBtn() {
    // Find the bundle's Download PDF button on the preview screen.
    const buttons = [...document.querySelectorAll("button")];
    const dlBtn = buttons.find(b => /download pdf/i.test((b.textContent || "")));
    if (!dlBtn) return;
    if (dlBtn.dataset.photoBtnAdded) return;
    // Only show when the active record has photos.
    const rec = getCurrentPreviewRecord();
    if (!rec || !rec.photos || !rec.photos.length) return;

    const wrap = dlBtn.parentElement;
    if (!wrap) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "⬇ With Photos (" + rec.photos.length + ")";
    btn.style.cssText = [
      "background:#2a52d4", "color:#fff", "border:0", "border-radius:8px",
      "padding:8px 12px", "margin-left:8px",
      "font:700 13px/1 ui-sans-serif,system-ui,sans-serif", "cursor:pointer",
    ].join(";");
    btn.addEventListener("click", () => downloadWithPhotos(rec));
    dlBtn.dataset.photoBtnAdded = "1";
    dlBtn.insertAdjacentElement("afterend", btn);
  }

  async function downloadWithPhotos(rec) {
    showLog("Generating PDF with photos…");
    // Step 1: trigger the bundle's existing "Download PDF" via a hidden flow.
    // Easiest: instead of intercepting, build the cert-page server-side using
    // html2canvas + jsPDF on the existing preview DOM. The preview is already
    // mounted (we're on the preview screen).
    try {
      const certPdfBytes = await buildCertPdfFromPreview();
      const finalBytes = await buildPhotoPdfPages(rec, certPdfBytes);
      const blob = new Blob([finalBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ref = (rec.certData && rec.certData.certRef) || "Gas Safety Cert";
      a.href = url;
      a.download = ref.replace(/[^A-Za-z0-9]+/g, "_") + ".pdf";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      showLog("PDF saved with " + rec.photos.length + " photo page(s).", "#2a52d4");
    } catch (e) {
      showLog("PDF generation failed: " + (e.message || "unknown"), "#c0392b");
    }
  }

  // Build the cert-page PDF by rasterising the visible preview DOM.
  async function buildCertPdfFromPreview() {
    await loadHtml2CanvasIfNeeded();
    await loadJsPdfIfNeeded();
    const target = findCertPreviewElement();
    if (!target) throw new Error("Could not find cert preview");
    const canvas = await window.html2canvas(target, { scale: 2, backgroundColor: "#fff", useCORS: true });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const w = canvas.width * ratio, h = canvas.height * ratio;
    pdf.addImage(imgData, "JPEG", (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
    return pdf.output("arraybuffer");
  }

  function findCertPreviewElement() {
    // The bundle's cert preview is a large white block — find the largest
    // descendant of <body> with a substantial table-like structure.
    const candidates = [...document.querySelectorAll("div, section")];
    let best = null, bestScore = 0;
    for (const el of candidates) {
      const txt = el.textContent || "";
      if (txt.length < 500) continue;
      if (!/Gas Safety Record/i.test(txt)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 600 || r.height < 400) continue;
      const score = r.width * r.height;
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }

  let html2canvasPromise = null;
  function loadHtml2CanvasIfNeeded() {
    if (window.html2canvas) return Promise.resolve();
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("html2canvas failed to load"));
      document.head.appendChild(s);
    });
    return html2canvasPromise;
  }

  let jspdfPromise = null;
  function loadJsPdfIfNeeded() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jspdfPromise) return jspdfPromise;
    jspdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("jsPDF failed to load"));
      document.head.appendChild(s);
    });
    return jspdfPromise;
  }

  // ---------- BOOT ----------
  window.addEventListener("DOMContentLoaded", function () {
    setTimeout(ensureUi, 400);
    // Watch for the cert preview to mount, then add the photo-download btn.
    const mo = new MutationObserver(() => {
      ensureUi();
      ensurePhotoDownloadBtn();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
})();
