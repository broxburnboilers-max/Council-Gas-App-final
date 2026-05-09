// netlify/functions/get-photo.js
//
// Streams a Drive photo back to the admin app so the admin browser doesn't
// need its own Google credentials. The service account has access to the
// shared Drive folder; this function authenticates server-side and proxies
// the bytes.
//
// Endpoint: GET /api/get-photo?id=<driveFileId>
//   header:  x-admin-key: <ADMIN_API_KEY>
//   returns: the raw image bytes with the original Content-Type
//
// Why we don't return a Drive webContentLink directly:
//   webContentLink only works for files shared with everyone, or for callers
//   already authenticated to Google. The shared folder is private to the
//   service account, so we proxy.

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let _tokenCache = { token: "", expiresAt: 0 };

function jsonResp(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "x-admin-key",
      ...extra,
    },
  });
}

async function importRsaPrivateKey(pem) {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64UrlEncode(input) {
  let bytes;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else bytes = new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt > now + 60) return _tokenCache.token;

  const raw = process.env.GOOGLE_SA_KEY || "";
  if (!raw) throw new Error("missing GOOGLE_SA_KEY");
  const sa = JSON.parse(raw);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 };
  const signingInput = base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(claim));
  const key = await importRsaPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + "." + base64UrlEncode(sig);
  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error("token exchange failed");
  _tokenCache = { token: data.access_token, expiresAt: now + Math.max(60, (data.expires_in || 3600) - 60) };
  return _tokenCache.token;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "x-admin-key",
      },
    });
  }
  if (req.method !== "GET") return jsonResp({ error: "method not allowed" }, 405);

  const adminKey = req.headers.get("x-admin-key");
  const expected = process.env.ADMIN_API_KEY || "";
  if (!expected || adminKey !== expected) {
    return jsonResp({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const fileId = url.searchParams.get("id") || "";
  if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return jsonResp({ error: "missing or malformed id" }, 400);
  }

  let token;
  try { token = await getAccessToken(); }
  catch (e) { return jsonResp({ error: "auth_failed", detail: e.message }, 503); }

  const driveResp = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) +
      "?alt=media&supportsAllDrives=true",
    { headers: { authorization: "Bearer " + token } }
  );
  if (!driveResp.ok) {
    const txt = await driveResp.text().catch(() => "");
    return jsonResp({ error: "drive_fetch_failed", status: driveResp.status, detail: txt.slice(0, 300) }, 502);
  }

  // Stream the body straight back. Preserve Content-Type so <img> tags work.
  return new Response(driveResp.body, {
    status: 200,
    headers: {
      "content-type": driveResp.headers.get("content-type") || "image/jpeg",
      "cache-control": "private, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
};

export const config = {
  path: "/api/get-photo",
};
