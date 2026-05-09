// netlify/functions/upload-photo.js
//
// Receives ONE photo from the engineer's phone, uploads it to a Google Drive
// folder using a service account, returns the Drive fileId so the engineer
// app can store a small reference instead of the full base64 data URL.
//
// Why this exists:
//   The engineer side used to embed every photo as a base64 data URL inside
//   gscFolder daybook JSON. With 12 certs and a few photos each the JSON hit
//   133 MB which (a) exceeded Netlify Functions' 6 MB request body limit so
//   the daybook never reached the server, and (b) overflowed localStorage on
//   the admin side (5–10 MB cap) so imported certs vanished.
//
//   Each photo is now uploaded individually (typically 100–500 KB) to Drive.
//   The daybook JSON shrinks to ~50 KB and rides through the existing
//   /api/daybook channel without trouble.
//
// Auth model:
//   The engineer app is unauthenticated — anyone with the URL can submit a
//   daybook. To avoid putting a Drive credential in front-end JS we use a
//   server-side Google service account. The service account's JSON key is
//   stored in the GOOGLE_SA_KEY Netlify env var; it has access ONLY to the
//   single Drive folder the user shared with it (DRIVE_PHOTOS_FOLDER_ID).
//
// Endpoint: POST /api/upload-photo
//   body: {
//     certRef:  "GSC123",          // for filename + audit trail
//     filename: "12-Pass-Lane_1_Boiler-front.jpg",
//     mimeType: "image/jpeg",
//     base64:   "<base64 of the JPEG bytes — NO data: prefix>",
//   }
//   returns: { ok: true, fileId, webViewLink }
//
// Security note:
//   Anyone who can reach this endpoint can upload to the Drive folder. That's
//   intentional for now (the engineer app is open). To gate it later, add a
//   shared engineer key as an x-engineer-key header check.

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const UPLOAD_URI = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

// Cache the access token across warm invocations of the same Lambda.
let _tokenCache = { token: "", expiresAt: 0 };

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json",
  };
}

// Convert PEM private key to a CryptoKey object for SubtleCrypto signing.
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

// Build a signed JWT for the service account and exchange it for an OAuth
// access token. Tokens last 1h; we cache until 60s before expiry.
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

// Multipart upload body — Google's "related" multipart format. The first
// part is the metadata JSON, the second is the raw file bytes. We assemble
// it as a Blob so the runtime handles binary correctly.
function buildMultipartBody(metadata, mimeType, fileBytes) {
  const boundary = "cg_boundary_" + Math.random().toString(36).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: " + mimeType + "\r\n\r\n"
  );
  const tail = enc.encode("\r\n--" + boundary + "--\r\n");

  const body = new Uint8Array(head.length + fileBytes.length + tail.length);
  body.set(head, 0);
  body.set(fileBytes, head.length);
  body.set(tail, head.length + fileBytes.length);
  return { body, contentType: "multipart/related; boundary=" + boundary };
}

function decodeBase64(b64) {
  // Strip any "data:image/...;base64," prefix the caller may have left in.
  const stripped = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
  const bin = atob(stripped);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

  const { certRef, filename, mimeType, base64 } = payload || {};
  if (!filename || !base64) {
    return new Response(JSON.stringify({ error: "filename and base64 required" }), {
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

  let fileBytes;
  try { fileBytes = decodeBase64(base64); }
  catch (e) {
    return new Response(JSON.stringify({ error: "bad base64", detail: e.message }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const metadata = {
    name: String(filename).slice(0, 200),
    parents: [folderId],
    description: "Citizen Gas daybook photo" + (certRef ? " for cert " + certRef : ""),
    properties: certRef ? { certRef: String(certRef) } : undefined,
  };
  const { body, contentType } = buildMultipartBody(
    metadata,
    mimeType || "image/jpeg",
    fileBytes
  );

  const resp = await fetch(UPLOAD_URI + "&fields=id,webViewLink,webContentLink", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": contentType,
    },
    body,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return new Response(JSON.stringify({
      error: "drive_upload_failed",
      status: resp.status,
      detail: JSON.stringify(data).slice(0, 500),
    }), { status: 502, headers: corsHeaders() });
  }

  return new Response(JSON.stringify({
    ok: true,
    fileId: data.id,
    webViewLink: data.webViewLink || null,
  }), { status: 200, headers: corsHeaders() });
};

export const config = {
  path: "/api/upload-photo",
};
