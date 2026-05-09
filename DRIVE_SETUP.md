# Drive-backed photo storage — setup guide

This guide walks you through the **one-time setup** required to make the new
`/api/upload-photo` and `/api/get-photo` Netlify Functions work.

You only need to do this once. After it's done, every engineer daybook will
upload photos to Google Drive automatically — no more 133 MB JSON, no more
"Email failed", no more empty Records folder in admin.

Total time: ~15 minutes.

---

## Why this is needed

The engineer phone used to embed every photo as a base64 data URL inside the
daybook JSON. With 12 certs × ~5 photos each, the JSON was 133 MB — far above:

- Netlify Functions' **6 MB request body limit** → email and `/api/daybook`
  POSTs failed with "Failed to fetch".
- The browser's **5–10 MB localStorage quota** → admin import silently failed
  and Records folder was empty.

The new flow uploads each photo individually to a Google Drive folder owned
by you. The daybook JSON shrinks to ~50 KB and rides through every existing
channel without trouble.

---

## Step 1 — Create a Google Cloud project

1. Go to **<https://console.cloud.google.com/>** and sign in with
   `broxburnboilers@gmail.com`.
2. Click the project dropdown in the top bar → **New Project**.
3. Name it `citizen-gas-daybook` (or anything you like). Leave organisation
   blank. Click **Create**.
4. Wait ~10 seconds for the project to be created, then make sure it's the
   active project (project name shown in the top bar).

## Step 2 — Enable the Drive API

1. From the left menu: **APIs & Services → Library**.
2. Search for `Google Drive API`.
3. Click it, then click **Enable**.

## Step 3 — Create the service account

1. Left menu: **APIs & Services → Credentials**.
2. Click **+ Create credentials → Service account**.
3. Service account name: `citizen-gas-uploader`. The ID auto-fills.
4. Click **Create and continue**.
5. Skip the "Grant this service account access to project" step — click
   **Continue**.
6. Skip "Grant users access to this service account" — click **Done**.
7. You'll now see the service account in the list. Note its email address —
   it looks like
   `citizen-gas-uploader@citizen-gas-daybook.iam.gserviceaccount.com`.
   **Copy that email address — you'll need it in Step 5.**

## Step 4 — Generate the JSON key

1. Click the service account row to open its details.
2. Go to the **Keys** tab.
3. **Add key → Create new key → JSON → Create**.
4. A `.json` file downloads to your computer. Keep it safe — it's the
   service account's password. Anyone with this file can write to your
   shared Drive folder.

## Step 5 — Create the Drive folder

1. Open <https://drive.google.com/> in the same Google account.
2. Click **+ New → New folder**. Name it `Citizen Gas — Daybook Photos`.
3. Right-click the new folder → **Share**.
4. In the "Add people and groups" box, paste the service account email from
   Step 3 (e.g. `citizen-gas-uploader@…iam.gserviceaccount.com`).
5. Set the role to **Editor** (so the service account can upload files).
6. Untick "Notify people" (the service account doesn't have an inbox).
7. Click **Share**.
8. Open the folder. The URL will look like:

       https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt-uVwXyZ

   **Copy the part after `/folders/` — that's the folder ID. You'll paste
   it into Netlify in Step 6.**

## Step 6 — Add env vars to Netlify

1. Go to <https://app.netlify.com/> and open the `Council-Gas-App-final`
   site.
2. **Site configuration → Environment variables**.
3. Add the following three variables:

   | Name | Value |
   |---|---|
   | `GOOGLE_SA_KEY` | The **entire contents** of the JSON file from Step 4. Open it in a text editor, copy everything (including the curly braces), paste as the value. |
   | `DRIVE_PHOTOS_FOLDER_ID` | The folder ID from Step 5 (e.g. `1AbCdEfGhIjKlMnOpQrSt-uVwXyZ`). |
   | `ADMIN_API_KEY` | Already exists if your admin login works today. If it doesn't, set it to a long random string and copy the same value into the admin app's password screen. |

4. Hit **Save**.

## Step 7 — Deploy

1. Merge the PR (or push the `drive-photo-storage` branch to `main`).
2. Netlify auto-deploys.
3. Visit `https://gasapp.online` to check the engineer flow loads, and
   `https://gasapp.online/admin` to check the admin loads.

## Step 8 — Smoke test before relying on it

1. On a phone, open the engineer app. Sign in. Create **one** test cert
   with one or two photos.
2. Hit **Finish day & email**. You should see a "Uploading photos…" modal
   followed by "Sent." or the existing fallback dialog.
3. Open <https://drive.google.com/> and go to the `Citizen Gas — Daybook
   Photos` folder. The photos should appear with filenames like
   `GSC123_1-Pass-Lane_01_Boiler-front.jpg`.
4. Open the admin app. The cert should appear in Records within ~30 s.
5. Open the cert preview and download the PDF with photos. Confirm the
   photo pages render — those are being lazy-loaded from Drive via
   `/api/get-photo`.

## Step 9 — Recover the 12 lost certs

Once steps 1–8 are working:

1. Get the `daybook-2026-05-07.json` file from your Drive onto your laptop.
2. I'll provide a small Node script that reads that JSON and POSTs each
   photo through `/api/upload-photo` and the slimmed daybook through
   `/api/daybook`. The admin will pick it up on next load.

---

## Troubleshooting

**"DRIVE_PHOTOS_FOLDER_ID env var not set"** — Step 6 not done, or you
typoed the variable name.

**"auth_failed"** — `GOOGLE_SA_KEY` isn't valid JSON. Open the JSON file in
a real text editor (not Notepad — use VS Code, Sublime, or similar) and
re-paste. Make sure no characters were stripped.

**"drive_upload_failed: 403"** — The Drive folder isn't shared with the
service account email, or the role isn't Editor. Re-do Step 5.

**Photos upload but admin can't see them** — `ADMIN_API_KEY` mismatch.
The value in Netlify env vars must match what the admin app sends in
`x-admin-key` (which is whatever you typed at the password screen).

---

## Security notes

- The service account JSON key only has access to the **single** Drive
  folder you shared with it. It cannot see your inbox, calendar, other
  Drive folders, or anything else in your Google account.
- `/api/upload-photo` is currently open (matches the existing engineer
  app's no-auth posture). If you want to lock it later, add a shared
  engineer secret as an `x-engineer-key` header check inside
  `upload-photo.js` and bake the key into the engineer-side fetch.
- `/api/get-photo` is gated by `ADMIN_API_KEY`, so only the admin app
  (after password unlock) can read photos back.
