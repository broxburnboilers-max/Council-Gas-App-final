// Submissions queue — engineer POSTs visit body, admin GETs (and clears) the queue.
// Storage: Netlify Blobs (built-in, persistent, per-site)
import { getStore } from "@netlify/blobs";

const KEY = "queue";

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-admin-key",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export default async (req, context) => {
  // Convert Web Request to a small handler-friendly shape
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, x-admin-key",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      },
    });
  }

  const store = getStore("council-submissions");

  if (method === "POST") {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (!payload || typeof payload !== "object" || !payload.body) {
      return new Response(JSON.stringify({ error: "missing body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const existing = (await store.get(KEY, { type: "json" })) || [];
    const item = {
      id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      receivedAt: new Date().toISOString(),
      subject: String(payload.subject || "Citizen Gas Visit"),
      body: String(payload.body),
      engineer: payload.engineer || null,
    };
    existing.push(item);
    await store.setJSON(KEY, existing);

    return new Response(JSON.stringify({ ok: true, id: item.id, count: existing.length }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  }

  // Admin operations require the admin key
  const adminKey = req.headers.get("x-admin-key");
  const expected = Netlify.env.get("ADMIN_API_KEY");
  if (!expected || adminKey !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (method === "GET") {
    const existing = (await store.get(KEY, { type: "json" })) || [];
    return new Response(JSON.stringify({ items: existing }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (method === "DELETE") {
    await store.setJSON(KEY, []);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  path: "/api/submissions",
};
