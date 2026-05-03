// Engineer slots + job assignments.
// Three fixed engineer slots (engineer_1, engineer_2, engineer_3). Admin can
// rename a slot's display label once the real engineer is hired. Slot IDs
// never change, so any jobs assigned to a slot survive renames.
//
// Endpoints:
//   GET  /api/engineers                         (admin: list all 3 slots with labels)
//   GET  /api/engineers/public                  (no auth: list slots + display labels for sign-in)
//   POST /api/engineers/rename  {slotId,label}  (admin: set the display label)
//   GET  /api/jobs                              (admin: all jobs across slots)
//   POST /api/jobs  {slotId, addresses[]}       (admin: assign list of addresses)
//   DELETE /api/jobs?slotId=xyz                 (admin: clear that slot, or all if no slotId)
//   GET  /api/jobs/me?slotId=xyz                (no auth: pending jobs for a slot)
//   POST /api/jobs/complete  {id, slotId}       (no auth: engineer marks one job done)
//
// Storage: Netlify Blobs.
import { getStore } from "@netlify/blobs";

const KEY_JOBS = "jobs";
const KEY_LABELS = "slot_labels";

const SLOTS = ["engineer_1", "engineer_2", "engineer_3"];
const DEFAULT_LABELS = {
  engineer_1: "Engineer 1",
  engineer_2: "Engineer 2",
  engineer_3: "Engineer 3",
};

function corsHeaders() {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-admin-key",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}
function res(status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

// UK postcode regex — catches the trailing token if present.
const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2})\b/i;
function parseAddress(line) {
  const raw = String(line).trim();
  if (!raw) return null;
  const pcMatch = raw.match(POSTCODE_RE);
  let postcode = "";
  let withoutPc = raw;
  if (pcMatch) {
    postcode = pcMatch[1].toUpperCase().replace(/\s+/g, " ").trim();
    withoutPc = raw.replace(pcMatch[0], "").trim().replace(/,\s*$/, "").trim();
  }
  const parts = withoutPc.split(",").map(p => p.trim()).filter(Boolean);
  return {
    address1: parts[0] || "",
    address2: parts.slice(1).join(", "),
    postcode,
    raw,
  };
}

async function loadLabels(store) {
  const saved = (await store.get(KEY_LABELS, { type: "json" })) || {};
  // Always return all 3 slots, falling back to defaults for any slot not yet renamed.
  const out = {};
  for (const slot of SLOTS) {
    out[slot] = saved[slot] || DEFAULT_LABELS[slot];
  }
  return out;
}

export default async (req) => {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const store = getStore("council-jobs");

  // ─── Public (no auth) endpoints ───

  // GET /api/engineers/public  — for the engineer sign-in dropdown.
  if (path.endsWith("/engineers/public") && method === "GET") {
    const labels = await loadLabels(store);
    return res(200, {
      slots: SLOTS.map(slot => ({ slotId: slot, label: labels[slot] })),
    });
  }

  // GET /api/jobs/me?slotId=engineer_1
  if (path.endsWith("/jobs/me") && method === "GET") {
    const slotId = (url.searchParams.get("slotId") || "").trim();
    if (!SLOTS.includes(slotId)) return res(400, { error: "invalid slotId" });
    const jobs = (await store.get(KEY_JOBS, { type: "json" })) || [];
    return res(200, { items: jobs.filter(j => j.slotId === slotId) });
  }

  // POST /api/jobs/complete  {id, slotId}
  if (path.endsWith("/jobs/complete") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !payload.id || !payload.slotId) return res(400, { error: "missing id or slotId" });
    if (!SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const jobs = (await store.get(KEY_JOBS, { type: "json" })) || [];
    const next = jobs.filter(j => !(j.id === payload.id && j.slotId === payload.slotId));
    await store.setJSON(KEY_JOBS, next);
    return res(200, { ok: true, removed: jobs.length - next.length });
  }

  // ─── Admin endpoints (require x-admin-key) ───
  const adminKey = req.headers.get("x-admin-key");
  const expected = Netlify.env.get("ADMIN_API_KEY");
  if (!expected || adminKey !== expected) {
    return res(401, { error: "unauthorized" });
  }

  // GET /api/engineers  — admin view (same shape as public for now).
  if (path.endsWith("/engineers") && method === "GET") {
    const labels = await loadLabels(store);
    return res(200, {
      slots: SLOTS.map(slot => ({ slotId: slot, label: labels[slot] })),
    });
  }

  // POST /api/engineers/rename  {slotId, label}
  if (path.endsWith("/engineers/rename") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const label = String(payload.label || "").trim();
    if (!label) return res(400, { error: "label required" });
    const saved = (await store.get(KEY_LABELS, { type: "json" })) || {};
    saved[payload.slotId] = label;
    await store.setJSON(KEY_LABELS, saved);
    return res(200, { ok: true, slotId: payload.slotId, label });
  }

  // GET /api/jobs  — all jobs across slots
  if (path.endsWith("/jobs") && method === "GET") {
    const jobs = (await store.get(KEY_JOBS, { type: "json" })) || [];
    return res(200, { items: jobs });
  }

  // POST /api/jobs  {slotId, addresses[]}
  if (path.endsWith("/jobs") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
    const list = (await store.get(KEY_JOBS, { type: "json" })) || [];
    const added = [];
    for (const a of addresses) {
      const parsed = typeof a === "string" ? parseAddress(a) : a;
      if (!parsed || !parsed.address1) continue;
      const item = {
        id: "j_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        slotId: payload.slotId,
        address1: parsed.address1 || "",
        address2: parsed.address2 || "",
        postcode: parsed.postcode || "",
        raw: parsed.raw || "",
        createdAt: new Date().toISOString(),
      };
      list.push(item);
      added.push(item);
    }
    await store.setJSON(KEY_JOBS, list);
    return res(200, { ok: true, added: added.length, items: added });
  }

  // DELETE /api/jobs[?slotId=xyz]
  if (path.endsWith("/jobs") && method === "DELETE") {
    const slotId = (url.searchParams.get("slotId") || "").trim();
    const list = (await store.get(KEY_JOBS, { type: "json" })) || [];
    const next = slotId ? list.filter(j => j.slotId !== slotId) : [];
    await store.setJSON(KEY_JOBS, next);
    return res(200, { ok: true, removed: list.length - next.length });
  }

  return res(405, { error: "method not allowed" });
};

export const config = {
  path: [
    "/api/engineers",
    "/api/engineers/public",
    "/api/engineers/rename",
    "/api/jobs",
    "/api/jobs/me",
    "/api/jobs/complete",
  ],
};
