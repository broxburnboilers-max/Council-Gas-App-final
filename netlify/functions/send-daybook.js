// netlify/functions/send-daybook.js
//
// Receives the engineer's end-of-day daybook (with photos intact) and emails
// it to the admin inbox using Resend.
//
// FEATURE (Photos in email): each photo from each cert is decoded from its
// data URL and attached to the email as a JPEG file. The email HTML body
// also embeds each photo inline (via cid: references) so the user sees them
// rendered directly in the message — no need to open attachments or download
// the JSON.
//
// Body expected:
//   {
//     daybook: { date, engineer:{...}, certs:[{...,photos:[{label,dataUrl}]}], noAccess:[...] },
//     summary: { jobCount, noAccessCount },
//     filename: "daybook-YYYY-MM-DD.json"
//   }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method not allowed" };
  }

  const RESEND_KEY = process.env.RESEND_API_KEY || "";
  // Send the daily daybook email to BOTH recipients automatically so the
  // engineer doesn't have to manually forward anything. DAYBOOK_TO env var
  // can be a single address or comma-separated list.
  const TO_ENV = process.env.DAYBOOK_TO || "broxburnboilers@gmail.com,lspapandh@gmail.com";
  const TO = TO_ENV.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const FROM = process.env.DAYBOOK_FROM || "Citizen Gas <onboarding@resend.dev>";

  if (!RESEND_KEY) {
    return {
      statusCode: 503,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, reason: "no_api_key" }),
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, reason: "bad_json" }) };
  }

  const daybook = payload.daybook || {};
  const summary = payload.summary || { jobCount: 0, noAccessCount: 0 };
  const filename = payload.filename || ("daybook-" + new Date().toISOString().slice(0, 10) + ".json");

  // ─── Build photo attachments + inline references ───
  // Each photo gets:
  //  - an attachment entry with a unique filename and base64 content
  //  - a content_id so the HTML body can render <img src="cid:..."> inline
  // Total payload to Resend is capped at 40 MB. We keep a running byte counter
  // and stop attaching photos once we're approaching the cap; any remaining
  // photos are just listed in the body so they're visible at least in name.
  const RESEND_BYTE_CAP = 35 * 1024 * 1024; // leave 5 MB headroom for JSON envelope
  let usedBytes = 0;
  const photoAttachments = []; // [{filename, content, content_id, certRef, label, address}]
  const droppedPhotos = []; // [{certRef, label, address}]

  (daybook.certs || []).forEach(function (cert, certIdx) {
    const certRef = (cert.certData && cert.certData.certRef) || ("cert" + (certIdx + 1));
    const safeRef = String(certRef).replace(/[^A-Za-z0-9_-]/g, "_");
    const address = cert.certData
      ? [cert.certData.instAddr1, cert.certData.instAddr2, cert.certData.instPostcode].filter(Boolean).join(", ")
      : "";
    // Build a short, filesystem-safe address slug for the filename so the
    // photo file names alone make it clear which job they belong to.
    const addrSlug = (cert.certData && cert.certData.instAddr1)
      ? String(cert.certData.instAddr1).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
      : "";
    (cert.photos || []).forEach(function (photo, photoIdx) {
      if (!photo || !photo.dataUrl) return;
      const m = String(photo.dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!m) return;
      const mime = m[1];
      const b64 = m[2];
      const ext = mime === "image/png" ? "png" : (mime === "image/webp" ? "webp" : "jpg");
      // Photo description: prefer engineer-provided label, else use "photo N".
      // The MutationObserver path uses the placeholder label "capture" — in
      // that case fall back to a numbered label so the user sees something
      // meaningful instead of three identical "capture" lines.
      var rawLabel = photo.label && photo.label !== "capture"
        ? String(photo.label)
        : ("Photo " + (photoIdx + 1));
      const safeLabel = rawLabel.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
      // Filename pattern: <CertRef>_<AddressSlug>_<N>_<Label>.<ext>
      // Example: GSC123_12-Materials-Way_1_Boiler-front.jpg
      const numStr = String(photoIdx + 1).padStart(2, "0");
      const fnameParts = [safeRef];
      if (addrSlug) fnameParts.push(addrSlug);
      fnameParts.push(numStr);
      fnameParts.push(safeLabel);
      const fname = fnameParts.join("_") + "." + ext;
      const contentId = safeRef + "_p" + numStr + "@citizengas";
      const approxBytes = b64.length;
      if (usedBytes + approxBytes > RESEND_BYTE_CAP) {
        droppedPhotos.push({ certRef, label: rawLabel, address, photoNum: photoIdx + 1 });
        return;
      }
      usedBytes += approxBytes;
      photoAttachments.push({
        filename: fname,
        content: b64,
        content_id: contentId,
        type: mime,
        certRef,
        label: rawLabel,
        photoNum: photoIdx + 1,
        totalForCert: (cert.photos || []).length,
        address,
      });
    });
  });

  // ─── Build the JSON attachment (photos stripped to keep size sane) ───
  // The JSON includes only metadata — photos are now in the email itself.
  const jsonForAttachment = JSON.parse(JSON.stringify(daybook));
  (jsonForAttachment.certs || []).forEach(function (c) {
    if (Array.isArray(c.photos)) {
      c._photoCount = c.photos.length;
      c.photos = []; // keep field present but empty
    }
  });
  const jsonStr = JSON.stringify(jsonForAttachment, null, 2);
  const jsonB64 = Buffer.from(jsonStr, "utf8").toString("base64");

  // ─── Build plain-text + HTML bodies ───
  const totalPhotos = photoAttachments.length + droppedPhotos.length;
  const dateStr = daybook.date || new Date().toISOString().slice(0, 10);
  const engineerName = (daybook.engineer && daybook.engineer.fullName) || "Unknown";

  const lines = [];
  lines.push("Citizen Gas — End of Day Daybook");
  lines.push("Date: " + dateStr);
  lines.push("Engineer: " + engineerName);
  lines.push("");
  lines.push("Jobs completed: " + summary.jobCount);
  lines.push("No-access properties: " + summary.noAccessCount);
  lines.push("Photos attached: " + photoAttachments.length + (droppedPhotos.length ? (" (" + droppedPhotos.length + " not attached due to size)") : ""));
  lines.push("");
  if (Array.isArray(daybook.noAccess) && daybook.noAccess.length) {
    lines.push("=== NO ACCESS ===");
    daybook.noAccess.forEach(function (na) {
      const a = [na.address1, na.address2, na.postcode].filter(Boolean).join(", ");
      lines.push("- " + a + (na.notes ? " (" + na.notes + ")" : ""));
    });
    lines.push("");
  }
  // Materials summary (from cert.materials and noAccess.materials)
  const matEntries = []
    .concat(daybook.certs || [])
    .concat(daybook.noAccess || []);
  let anyMaterials = false;
  const matLines = [];
  matEntries.forEach(function (entry) {
    const mats = entry && entry.materials;
    if (!Array.isArray(mats) || !mats.length) return;
    anyMaterials = true;
    const addr = entry.certData
      ? [entry.certData.instAddr1, entry.certData.instAddr2, entry.certData.instPostcode].filter(Boolean).join(", ")
      : [entry.address1, entry.address2, entry.postcode].filter(Boolean).join(", ");
    matLines.push("");
    matLines.push((addr || "(unknown address)") + ":");
    mats.forEach(function (m) { matLines.push("  • " + m); });
  });
  lines.push("=== MATERIALS USED ===");
  if (anyMaterials) lines.push.apply(lines, matLines); else lines.push("(none recorded)");
  lines.push("");
  lines.push("=== PHOTOS ===");
  if (photoAttachments.length) {
    // Group by cert in plain text too, so the labels are clear.
    const ptByCert = {};
    photoAttachments.forEach(function (p) {
      const k = p.certRef + "|" + p.address;
      if (!ptByCert[k]) ptByCert[k] = { certRef: p.certRef, address: p.address, photos: [] };
      ptByCert[k].photos.push(p);
    });
    Object.keys(ptByCert).forEach(function (k) {
      const grp = ptByCert[k];
      lines.push("");
      lines.push("Cert " + grp.certRef + " — " + (grp.address || "(no address)"));
      grp.photos.forEach(function (p) {
        lines.push("  Photo " + p.photoNum + " of " + p.totalForCert + " — " + p.label + " [" + p.filename + "]");
      });
    });
  } else {
    lines.push("(no photos)");
  }
  if (droppedPhotos.length) {
    lines.push("");
    lines.push("Photos NOT attached (would exceed size limit):");
    droppedPhotos.forEach(function (p) {
      lines.push("- " + p.label + " — " + (p.address || p.certRef));
    });
  }
  lines.push("");
  lines.push("Daybook JSON (metadata only) is attached as " + filename + ".");
  lines.push("Photos are attached as separate JPEGs and shown inline below.");

  const textBody = lines.join("\n");

  // HTML body — group photos by cert so they're easy to scan
  const esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  const htmlParts = [];
  htmlParts.push('<div style="font:14px/1.5 system-ui,Arial,sans-serif;color:#1a2330;max-width:680px;">');
  htmlParts.push('<h2 style="margin:0 0 4px;">Citizen Gas — End of Day Daybook</h2>');
  htmlParts.push('<div style="color:#475569;margin-bottom:14px;">' + esc(dateStr) + ' · Engineer: ' + esc(engineerName) + '</div>');
  htmlParts.push('<table style="border-collapse:collapse;margin-bottom:18px;">');
  htmlParts.push('<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Jobs completed</td><td style="font-weight:700;">' + summary.jobCount + '</td></tr>');
  htmlParts.push('<tr><td style="padding:2px 12px 2px 0;color:#64748b;">No-access</td><td style="font-weight:700;">' + summary.noAccessCount + '</td></tr>');
  htmlParts.push('<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Photos</td><td style="font-weight:700;">' + photoAttachments.length + (droppedPhotos.length ? (' <span style="color:#b91c1c;font-weight:500;">(' + droppedPhotos.length + ' not attached, too big)</span>') : '') + '</td></tr>');
  htmlParts.push('</table>');
  if (anyMaterials) {
    htmlParts.push('<h3 style="margin:18px 0 6px;">Materials used</h3>');
    htmlParts.push('<div style="white-space:pre-wrap;background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;font-size:13px;">' + esc(matLines.join("\n").trim()) + '</div>');
  }
  // Group photos by certRef so each property's photos appear together.
  if (photoAttachments.length) {
    htmlParts.push('<h3 style="margin:24px 0 8px;">Photos</h3>');
    const byCert = {};
    photoAttachments.forEach(function (p) {
      const key = p.certRef + "|" + p.address;
      if (!byCert[key]) byCert[key] = { certRef: p.certRef, address: p.address, photos: [] };
      byCert[key].photos.push(p);
    });
    Object.keys(byCert).forEach(function (key) {
      const grp = byCert[key];
      // Heading shows BOTH cert ref and address — every photo block is
      // unambiguous about which gas safety certificate it belongs to.
      htmlParts.push(
        '<div style="margin:18px 0 8px;padding:10px 12px;background:#f1f5f9;border-radius:8px;border-left:4px solid #2a52d4;">' +
          '<div style="font-weight:800;font-size:14px;color:#1a2330;">Cert ' + esc(grp.certRef) + '</div>' +
          (grp.address ? '<div style="font-size:13px;color:#475569;margin-top:2px;">' + esc(grp.address) + '</div>' : '') +
          '<div style="font-size:12px;color:#64748b;margin-top:2px;">' + grp.photos.length + ' photo' + (grp.photos.length === 1 ? '' : 's') + '</div>' +
        '</div>'
      );
      htmlParts.push('<div>');
      grp.photos.forEach(function (p) {
        // Caption pattern: "Photo N of M — <label>" so each image is clearly
        // identified. Filename also shown in a smaller line for download cross-ref.
        var caption = 'Photo ' + p.photoNum + ' of ' + p.totalForCert +
                      ' — ' + esc(p.label);
        htmlParts.push(
          '<div style="display:inline-block;margin:0 10px 14px 0;vertical-align:top;width:280px;">' +
            '<img src="cid:' + esc(p.content_id) + '" alt="' + esc(grp.certRef + ' ' + p.label) + '" ' +
              'style="display:block;width:100%;max-width:280px;max-height:280px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" />' +
            '<div style="font-size:12px;color:#1a2330;margin-top:6px;font-weight:600;">' + caption + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:2px;font-family:ui-monospace,monospace;word-break:break-all;">' + esc(p.filename) + '</div>' +
          '</div>'
        );
      });
      htmlParts.push('</div>');
    });
  } else {
    htmlParts.push('<div style="color:#64748b;margin-top:18px;">No photos for today.</div>');
  }
  if (droppedPhotos.length) {
    htmlParts.push('<h3 style="margin:24px 0 8px;color:#b91c1c;">Photos not attached (size limit)</h3><ul>');
    droppedPhotos.forEach(function (p) {
      htmlParts.push('<li>' + esc(p.label) + ' — ' + esc(p.address || p.certRef) + '</li>');
    });
    htmlParts.push('</ul>');
  }
  htmlParts.push('<div style="margin-top:24px;color:#94a3b8;font-size:12px;">Sent from Citizen Gas. Daybook metadata attached as ' + esc(filename) + '.</div>');
  htmlParts.push('</div>');
  const htmlBody = htmlParts.join("");

  const subject =
    "Citizen Gas Daybook — " + dateStr +
    " (" + summary.jobCount + " job" + (summary.jobCount === 1 ? "" : "s") +
    (summary.noAccessCount ? ", " + summary.noAccessCount + " no-access" : "") +
    (photoAttachments.length ? ", " + photoAttachments.length + " photo" + (photoAttachments.length === 1 ? "" : "s") : "") +
    ")";

  // Resend attachments: photos + the JSON metadata file
  const resendAttachments = photoAttachments.map(function (p) {
    return {
      filename: p.filename,
      content: p.content,
      content_id: p.content_id,
      content_type: p.type,
    };
  });
  resendAttachments.push({
    filename: filename,
    content: jsonB64,
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + RESEND_KEY,
    },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: subject,
      text: textBody,
      html: htmlBody,
      attachments: resendAttachments,
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch (e) {}
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: false,
        reason: "resend_error",
        status: resp.status,
        detail: detail.slice(0, 500),
        photoCount: photoAttachments.length,
        droppedPhotoCount: droppedPhotos.length,
      }),
    };
  }

  const data = await resp.json().catch(function () { return {}; });
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      ok: true,
      id: data.id || null,
      photoCount: photoAttachments.length,
      droppedPhotoCount: droppedPhotos.length,
    }),
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}
