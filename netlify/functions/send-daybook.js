// netlify/functions/send-daybook.js
//
// Receives the engineer's end-of-day daybook JSON and emails it to the
// designated admin inbox using Resend (https://resend.com). Falls back to a
// 503 response if RESEND_API_KEY is missing — the caller (engineer's phone)
// then triggers the mailto: fallback.
//
// Body expected:
//   {
//     daybook: { date, engineer: {...}, certs: [...], noAccess: [...] },
//     summary: { jobCount, noAccessCount },
//     filename: "daybook-YYYY-MM-DD.json"
//   }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method not allowed" };
  }

  const RESEND_KEY = process.env.RESEND_API_KEY || "";
  const TO = process.env.DAYBOOK_TO || "broxburnboilers@gmail.com";
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

  const jsonStr = JSON.stringify(daybook, null, 2);
  const b64 = Buffer.from(jsonStr, "utf8").toString("base64");

  // Plain-text body — lists no-access addresses + job count.
  const lines = [];
  lines.push("Citizen Gas — End of Day Daybook");
  lines.push("Date: " + (daybook.date || new Date().toISOString().slice(0, 10)));
  lines.push("Engineer: " + ((daybook.engineer && daybook.engineer.fullName) || "Unknown"));
  lines.push("");
  lines.push("Jobs completed: " + summary.jobCount);
  lines.push("No-access properties: " + summary.noAccessCount);
  lines.push("");
  if (Array.isArray(daybook.noAccess) && daybook.noAccess.length) {
    lines.push("=== NO ACCESS ===");
    daybook.noAccess.forEach(function (na) {
      const a = [na.address1, na.address2, na.postcode].filter(Boolean).join(", ");
      lines.push("- " + a + (na.notes ? " (" + na.notes + ")" : ""));
    });
    lines.push("");
  }
  lines.push("The daybook JSON file is attached.");
  lines.push("Open the admin app → Records → GSC → Import Daybook to load these certs.");

  const textBody = lines.join("\n");

  const subject =
    "Citizen Gas Daybook — " +
    (daybook.date || new Date().toISOString().slice(0, 10)) +
    " (" + summary.jobCount + " job" + (summary.jobCount === 1 ? "" : "s") +
    (summary.noAccessCount ? ", " + summary.noAccessCount + " no-access" : "") +
    ")";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + RESEND_KEY,
    },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      subject: subject,
      text: textBody,
      attachments: [
        {
          filename: filename,
          content: b64,
        },
      ],
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch (e) {}
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, reason: "resend_error", status: resp.status, detail: detail.slice(0, 500) }),
    };
  }

  const data = await resp.json().catch(function () { return {}; });
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true, id: data.id || null }),
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
