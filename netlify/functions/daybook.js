// Daybook cloud queue — engineer POSTs FULL daybook (including photo data URLs);
// admin GETs (and clears) the queue on every load.
//
// This is what carries PHOTOS from engineer to admin without the user having
// to manually import the downloaded JSON file.
//
// Storage: Netlify Blobs (built-in, persistent, per-site)
// Endpoint: /api/daybook
//
// Flows:
//   POST /api/daybook  body: { daybook: {certs:[...], noAccess:[...], engineer, date}, savedAt }
//     → no auth (engineer side has no admin key)
//     → appends one item to the queue
//
//   GET  /api/daybook
//     → admin only (x-admin-key)
//     → returns { items: [{id, receivedAt, daybook}] }
//
//   DELETE /api/daybook
//     → admin only
//     → clears the queue (called after successful import)
//
// Each daybook can be ~30KB-2MB depending on photo count. Netlify Blobs has
// a per-key limit well above this.

import { getStore } from "@netlify/blobs";

const KEY = "queue";

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-admin-key",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "content-type": "application/json",
  };
}

export default async (req, context) => {
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const store = getStore("council-daybooks");

  if (method === "POST") {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }
    if (!payload || typeof payload !== "object" || !payload.daybook) {
      return new Response(JSON.stringify({ error: "missing daybook" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const existing = (await store.get(KEY, { type: "json" })) || [];
    const item = {
      id: "d_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      receivedAt: new Date().toISOString(),
      daybook: payload.daybook,
    };
    existing.push(item);
    await store.setJSON(KEY, existing);

    return new Response(JSON.stringify({ ok: true, id: item.id, count: existing.length }), {
      status: 200,
      headers: corsHeaders(),
    });
  }

  // Admin operations require the admin key.
  const adminKey = req.headers.get("x-admin-key");
  const expected = Netlify.env.get("ADMIN_API_KEY");
  if (!expected || adminKey !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: corsHeaders(),
    });
  }

  if (method === "GET") {
    const existing = (await store.get(KEY, { type: "json" })) || [];
    return new Response(JSON.stringify({ items: existing }), {
      status: 200,
      headers: corsHeaders(),
    });
  }

  if (method === "DELETE") {
    await store.setJSON(KEY, []);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders(),
    });
  }

  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: corsHeaders(),
  });
};

export const config = {
  path: "/api/daybook",
};
