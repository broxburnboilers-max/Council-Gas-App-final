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

// Returns YYYY-MM-DD in Europe/London timezone (where engineers + admin live).
// Using en-CA locale because it formats as YYYY-MM-DD natively.
function londonToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function loadLabels(store, opts) {
  const getOpts = { type: "json" };
  if (opts && opts.strong) getOpts.consistency = "strong";
  const saved = (await store.get(KEY_LABELS, getOpts)) || {};
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
  // Strong consistency so a freshly-renamed engineer shows up on the sign-in screen.
  if (path.endsWith("/engineers/public") && method === "GET") {
    const labels = await loadLabels(store, { strong: true });
    return res(200, {
      slots: SLOTS.map(slot => ({ slotId: slot, label: labels[slot] })),
    });
  }

  // GET /api/jobs/me?slotId=engineer_1[&date=YYYY-MM-DD][&all=1]
  // Default: returns ONLY today's pending jobs (Europe/London) for that slot.
  // ?date=YYYY-MM-DD overrides today (used for testing).
  // ?all=1 returns the entire week's pending jobs (used by admin/debug).
  if (path.endsWith("/jobs/me") && method === "GET") {
    const slotId = (url.searchParams.get("slotId") || "").trim();
    if (!SLOTS.includes(slotId)) return res(400, { error: "invalid slotId" });
    // Strong consistency: engineer must see jobs admin just assigned.
    const jobs = (await store.get(KEY_JOBS, { type: "json", consistency: "strong" })) || [];
    const wantAll = url.searchParams.get("all") === "1";
    const dateParam = (url.searchParams.get("date") || "").trim();
    const today = isValidDate(dateParam) ? dateParam : londonToday();
    const mine = jobs.filter(j => j.slotId === slotId);
    const items = wantAll
      ? mine
      // Match jobs whose dueDate is today, OR jobs with no dueDate at all
      // (legacy/manual assignments — keep visible until cleared).
      : mine.filter(j => !j.dueDate || j.dueDate === today);
    return res(200, { items, today, slotId });
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
  // Strong consistency so a rename is reflected immediately on the next refresh.
  if (path.endsWith("/engineers") && method === "GET") {
    const labels = await loadLabels(store, { strong: true });
    return res(200, {
      slots: SLOTS.map(slot => ({ slotId: slot, label: labels[slot] })),
    });
  }

  // POST /api/engineers/rename  {slotId, label}
  // Returns the FULL updated slot list under `slots` so the caller can render it
  // immediately without doing a follow-up GET. Netlify Blobs has eventual consistency
  // by default — an immediate read after the write would return the stale label and
  // the UI would still show the old name until a second refresh caught up.
  if (path.endsWith("/engineers/rename") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const label = String(payload.label || "").trim();
    if (!label) return res(400, { error: "label required" });
    const saved = (await store.get(KEY_LABELS, { type: "json", consistency: "strong" })) || {};
    saved[payload.slotId] = label;
    await store.setJSON(KEY_LABELS, saved);
    // Build the authoritative slot list from the just-written map.
    const slots = SLOTS.map(slot => ({ slotId: slot, label: saved[slot] || DEFAULT_LABELS[slot] }));
    return res(200, { ok: true, slotId: payload.slotId, label, slots });
  }

  // GET /api/jobs  — all jobs across slots.
  // Strong consistency: admin GET must reflect their own writes immediately, otherwise
  // they see an empty list right after sending and assume the assignment failed.
  if (path.endsWith("/jobs") && method === "GET") {
    const jobs = (await store.get(KEY_JOBS, { type: "json", consistency: "strong" })) || [];
    return res(200, { items: jobs });
  }

  // POST /api/jobs  {slotId, addresses[], dueDate?}
  // Each address may be a string OR an object {address1, address2, postcode, dueDate}.
  // If a top-level dueDate is provided, all addresses inherit it unless they set their own.
  //
  // Returns the FULL updated job list under `allItems` so the caller can render the
  // "Currently assigned" section without doing a follow-up GET. Netlify Blobs has
  // eventual consistency by default — an immediate GET after a POST can return stale
  // data, which made the admin think the send failed and re-submit (causing the
  // duplicates the user reported).
  //
  // Also de-dupes against the existing list: if the same slot already has a pending
  // job with the same address1+postcode+dueDate, that line is skipped instead of
  // creating a duplicate. Defensive — covers a re-submit even if the UI misses the
  // first response.
  if (path.endsWith("/jobs") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
    const defaultDue = isValidDate(payload.dueDate) ? payload.dueDate : null;
    // Strong consistency on read so we don't miss recent additions when deduping.
    const list = (await store.get(KEY_JOBS, { type: "json", consistency: "strong" })) || [];
    const dedupKey = (slotId, a1, pc, due) =>
      [slotId, String(a1 || "").toLowerCase().trim(),
        String(pc || "").toUpperCase().replace(/\s+/g, " ").trim(),
        due || ""].join("|");
    const existing = new Set(list.map(j => dedupKey(j.slotId, j.address1, j.postcode, j.dueDate)));
    const added = [];
    const skipped = [];
    let counter = 0;
    for (const a of addresses) {
      const parsed = typeof a === "string" ? parseAddress(a) : a;
      if (!parsed || !parsed.address1) continue;
      const itemDue = isValidDate(parsed.dueDate) ? parsed.dueDate : defaultDue;
      const k = dedupKey(payload.slotId, parsed.address1, parsed.postcode, itemDue);
      if (existing.has(k)) {
        skipped.push({ address1: parsed.address1, postcode: parsed.postcode || "", dueDate: itemDue || null });
        continue;
      }
      existing.add(k);
      // Counter ensures unique IDs even when Date.now() collides inside one batch.
      const item = {
        id: "j_" + Date.now() + "_" + (counter++) + "_" + Math.random().toString(36).slice(2, 8),
        slotId: payload.slotId,
        address1: parsed.address1 || "",
        address2: parsed.address2 || "",
        postcode: parsed.postcode || "",
        raw: parsed.raw || "",
        dueDate: itemDue || null,
        createdAt: new Date().toISOString(),
      };
      list.push(item);
      added.push(item);
    }
    await store.setJSON(KEY_JOBS, list);
    return res(200, {
      ok: true,
      added: added.length,
      skipped: skipped.length,
      skippedItems: skipped,
      items: added,
      allItems: list,
    });
  }

  // POST /api/jobs/week  {slotId, days: {"YYYY-MM-DD": [addr,addr,addr,addr]}}
  // Atomic weekly replace: clears any future-dated (or undated) jobs for that slot,
  // then inserts the new schedule. Past jobs (dueDate < today) are preserved as history.
  if (path.endsWith("/jobs/week") && method === "POST") {
    let payload;
    try { payload = await req.json(); } catch { return res(400, { error: "invalid json" }); }
    if (!payload || !SLOTS.includes(payload.slotId)) return res(400, { error: "invalid slotId" });
    const days = payload.days || {};
    const today = londonToday();
    const list = (await store.get(KEY_JOBS, { type: "json", consistency: "strong" })) || [];
    // Drop existing jobs for this slot whose dueDate is today or later (or missing).
    const kept = list.filter(j => {
      if (j.slotId !== payload.slotId) return true;
      if (!j.dueDate) return false; // drop legacy undated for this slot
      return j.dueDate < today;
    });
    let added = 0;
    let counter = 0;
    for (const dateKey of Object.keys(days)) {
      if (!isValidDate(dateKey)) continue;
      const addresses = Array.isArray(days[dateKey]) ? days[dateKey] : [];
      for (const a of addresses) {
        const parsed = typeof a === "string" ? parseAddress(a) : a;
        if (!parsed || !parsed.address1) continue;
        kept.push({
          id: "j_" + Date.now() + "_" + (counter++) + "_" + Math.random().toString(36).slice(2, 8),
          slotId: payload.slotId,
          address1: parsed.address1 || "",
          address2: parsed.address2 || "",
          postcode: parsed.postcode || "",
          raw: parsed.raw || "",
          dueDate: dateKey,
          createdAt: new Date().toISOString(),
        });
        added++;
      }
    }
    await store.setJSON(KEY_JOBS, kept);
    return res(200, { ok: true, added, allItems: kept });
  }

  // DELETE /api/jobs[?slotId=xyz]
  if (path.endsWith("/jobs") && method === "DELETE") {
    const slotId = (url.searchParams.get("slotId") || "").trim();
    const list = (await store.get(KEY_JOBS, { type: "json", consistency: "strong" })) || [];
    const next = slotId ? list.filter(j => j.slotId !== slotId) : [];
    await store.setJSON(KEY_JOBS, next);
    return res(200, { ok: true, removed: list.length - next.length, allItems: next });
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
    "/api/jobs/week",
  ],
};
