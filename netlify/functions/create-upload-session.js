// netlify/functions/create-upload-session.js
//
// Creates a Google Drive resumable upload session and hands the session URL
// back to the browser. The browser then PUTs the photo bytes DIRECTLY to
// googleapis.com, completely bypassing Netlify's 6 MB request body cap.
//
// Why this exists:
//   /api/upload-photo posts the raw photo through Netlify Functions. Phone
//   camera photos can be 5+ MB after base64 expansion and Netlify silently
//   drops the request body once it crosses 6 MB, so uploads fail and the
//   daybook never makes it to Drive. Resumable upload lets the bytes go
//   straight to Google — Netlify only mints a short-lived session URL.
//
// Endpoint: POST /api/create-upload-session
//   body:    { certRef, filename, mimeType }
//   returns: { ok: true, sessionUrl, certRef, filename }

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const RESUMABLE_URI = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let _tokenCache = { token: "", expiresAt: 0 };

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json",
  };
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
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt > now + 60) {
    return _tokenCache.token;
  }

  const raw = process.env.GOOGLE_SA_KEY || "";
  if (!raw) throw new Error("missing GOOGLE_SA_KEY env var");

  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) { throw new Error("GOOGLE_SA_KEY is not valid JSON: " + e.message); }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SA_KEY missing client_email or private_key");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimB64 = base64UrlEncode(JSON.stringify(claim));
  const signingInput = headerB64 + "." + claimB64;

  const key = await importRsaPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = signingInput + "." + base64UrlEncode(sig);

  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" +
      "&assertion=" + encodeURIComponent(jwt),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error("token exchange failed: " + JSON.stringify(data).slice(0, 300));
  }
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + Math.max(60, (data.expires_in || 3600) - 60),
  };
  return _tokenCache.token;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: corsHeaders(),
    });
  }

  let payload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const { certRef, filename, mimeType } = payload || {};
  if (!filename) {
    return new Response(JSON.stringify({ error: "filename required" }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const folderId = process.env.DRIVE_PHOTOS_FOLDER_ID || "";
  if (!folderId) {
    return new Response(JSON.stringify({ error: "DRIVE_PHOTOS_FOLDER_ID env var not set" }), {
      status: 503,
      headers: corsHeaders(),
    });
  }

  let token;
  try { token = await getAccessToken(); }
  catch (e) {
    return new Response(JSON.stringify({ error: "auth_failed", detail: e.message }), {
      status: 503,
      headers: corsHeaders(),
    });
  }

  const metadata = {
    name: String(filename).slice(0, 200),
    parents: [folderId],
    description: "Citizen Gas daybook photo" + (certRef ? " for cert " + certRef : ""),
    properties: certRef ? { certRef: String(certRef) } : undefined,
  };

  let resp;
  try {
    resp = await fetch(RESUMABLE_URI, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType || "image/jpeg",
      },
      body: JSON.stringify(metadata),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "drive_unreachable", detail: e.message }), {
      status: 502,
      headers: corsHeaders(),
    });
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return new Response(JSON.stringify({
      error: "drive_session_failed",
      status: resp.status,
      detail: detail.slice(0, 500),
    }), { status: 502, headers: corsHeaders() });
  }

  const sessionUrl = resp.headers.get("location") || resp.headers.get("Location");
  if (!sessionUrl) {
    return new Response(JSON.stringify({
      error: "no_session_url",
      detail: "Drive did not return a Location header",
    }), { status: 502, headers: corsHeaders() });
  }

  return new Response(JSON.stringify({
    ok: true,
    sessionUrl,
    certRef: certRef || null,
    filename: String(filename).slice(0, 200),
  }), { status: 200, headers: corsHeaders() });
};

export const config = {
  path: "/api/create-upload-session",
};
