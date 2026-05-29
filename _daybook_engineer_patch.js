// =====================================================
// DAYBOOK SYSTEM (engineer side)
// =====================================================
// Hook the existing `citizenGas:queued` event and parse the body+DOM into a
// structured cert object. Persist into localStorage["citizenGas.daybook"].
// Add a "Finish day & email" button so the engineer can email the JSON
// to the admin inbox at end of shift.

(function () {
  const DAYBOOK_KEY = "citizenGas.daybook";
  const DEFAULT_CLIENT = {
    clientName: "Citizen Housing Group Ltd",
    clientAddr1: "Lakeside",
    clientAddr2: "4040 Solihull Pkwy",
    clientAddr3: "Birmingham",
    clientPostcode: "B37 7YN",
    clientTel: "0300 790 6555",
    clientEmail: "admin@dsplumbingsolutions.co.uk",
  };
  const COMPANY_DEFAULTS = {
    companyName: "Andrew King-Page",
    companyAddr: "47 Alspath Road, Meriden",
    companyPostcode: "CV7 7LU",
    companyTel: "07961768920",
    companyEmail: "akingpage@gmail.com",
    companyWeb: "www.westlothiangas.com",
  };

  function readDaybook() {
    try { return JSON.parse(localStorage.getItem(DAYBOOK_KEY) || '{"date":"","certs":[],"noAccess":[]}'); }
    catch (e) { return { date: "", certs: [], noAccess: [] }; }
  }
  function writeDaybook(d) {
    try { localStorage.setItem(DAYBOOK_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function todayStamp() { return new Date().toISOString().slice(0, 10); }

  // ---------- BODY PARSER ----------
  // Inverse of the bundle's W0 builder. Splits on '==============================' and
  // 'END OF JOB' markers. Each block becomes a structured property object.
  function parseDaybookBody(body) {
    if (!body || typeof body !== "string") return [];
    const blocks = body
      .split(/\n=+\n/)            // property separator
      .flatMap(b => b.split(/\nEND OF JOB\n/));
    const properties = [];
    for (const block of blocks) {
      const txt = block.replace(/^\s+|\s+$/g, "");
      if (!txt) continue;
      // Skip the "Engineer:" header-only lines.
      if (/^Engineer:/.test(txt) && !/PROPERTY/i.test(txt)) continue;
      const prop = parseProperty(txt);
      if (prop) properties.push(prop);
    }
    return properties;
  }

  function getField(txt, label) {
    const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+?)\\s*$", "m");
    const m = txt.match(re);
    return m ? m[1].trim() : "";
  }

  function getSection(txt, heading) {
    // Returns the content between a heading line and the next blank-line + heading,
    // or the next ====== separator, or end of input.
    const lines = txt.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === heading) { start = i + 1; break; }
    }
    if (start === -1) return null;
    // Skip dashed underline if present.
    if (start < lines.length && /^-+$/.test(lines[start].trim())) start++;
    const KNOWN = [
      "PROPERTY ", "ACCESS", "ALARMS", "APPLIANCE 1", "APPLIANCE 2", "APPLIANCE 3",
      "COOKER CAP", "COOKER INSTALL", "FAULTS", "FAULT ", "ON-SITE DOCUMENTATION", "MATERIALS USED"
    ];
    let end = lines.length;
    for (let j = start; j < lines.length; j++) {
      const ln = lines[j].trim();
      if (/^=+$/.test(ln)) { end = j; break; }
      if (j > start && lines[j - 1].trim() === "" && KNOWN.some(k => ln === k.trim() || ln.indexOf(k) === 0)) {
        end = j - 1;
        break;
      }
    }
    return lines.slice(start, end).join("\n").trim();
  }

  function parseProperty(txt) {
    // Detect no-access first.
    const access = getSection(txt, "ACCESS");
    const certRef = getField(txt, "Cert Ref") || "";
    const address1 = getField(txt, "Install Address 1") || "";
    const address2 = getField(txt, "Install Address 2") || "";
    const postcode = getField(txt, "Install Postcode") || "";
    const visit = parseInt(getField(txt, "Visit") || "1", 10);
    const date = getField(txt, "Date") || "";

    if (!certRef && !address1) return null;

    const noAccess = access && /no access gained/i.test(access);

    // Alarms
    const alarmsBlock = getSection(txt, "ALARMS");
    const alarmField = (label) => {
      if (!alarmsBlock) return null;
      const m = alarmsBlock.match(new RegExp(label + ":\\s*(\\w+)", "i"));
      return m ? m[1] : null;
    };
    const coAlarm = alarmField("Carbon Monoxide Alarm");
    const fireAlarm = alarmField("Fire Alarm");
    const hasGas = !alarmsBlock; // ALARMS section is only emitted when !hasGas

    // Appliances
    const appliances = [];
    function readAppliance(heading, isVisualOnly) {
      const blk = getSection(txt, heading);
      if (!blk) return null;
      return {
        heading,
        location: (blk.match(/Location:\s*(.+)/) || [])[1] || "",
        type: (blk.match(/Type:\s*(.+)/) || [])[1] || "",
        make: (blk.match(/Make:\s*(.+)/) || [])[1] || "",
        model: (blk.match(/Model:\s*(.+)/) || [])[1] || "",
        heatInput: (blk.match(/Heat Input:\s*(.+)/) || [])[1] || "",
        operatingPressure: (blk.match(/Operating Pressure:\s*(.+)/) || [])[1] || "",
        visualOnly: !!isVisualOnly,
      };
    }
    const a1 = readAppliance("APPLIANCE 1", false); if (a1) appliances.push(a1);
    const a2 = readAppliance("APPLIANCE 2", false); if (a2) appliances.push(a2);
    const a3 = readAppliance("APPLIANCE 3", true);  if (a3) appliances.push(a3);

    // Faults (multiple FAULT N blocks, or "None reported.")
    const faults = [];
    const faultRegex = /FAULT \d+\s*\nFault Details:\s*(.+?)\nRemedial Work Taken:\s*(.+?)\nWarning Notice Fixed:\s*(\w+)(?:\nWarning Notice Notes:\s*(.+?))?(?=\n\n|\nFAULT |\n=+|\nMATERIALS USED|\nON-SITE|$)/gms;
    let fm;
    while ((fm = faultRegex.exec(txt)) !== null) {
      faults.push({
        details: (fm[1] || "").trim(),
        remedial: (fm[2] || "").trim(),
        warningNotice: /yes/i.test(fm[3] || "") ? "Yes" : "No",
      });
    }

    // Materials Used (engineer-only, do NOT emit to cert)
    // Documentation flags (engineer-only)
    return {
      certRef,
      address1, address2, postcode,
      visit, date,
      noAccess,
      hasGas,
      coAlarm: coAlarm ? /yes/i.test(coAlarm) : null,
      fireAlarm: fireAlarm ? /yes/i.test(fireAlarm) : null,
      appliances,
      faults,
    };
  }

  // ---------- PHOTO HARVESTER ----------
  // At the moment 'queued' fires, scrape data: URLs from the review-screen DOM.
  // The bundle renders thumbnails like:
  //   <img src="data:image/jpeg;base64,..." alt="..."> with a small label below
  //   ("Gas works", "Gas isolation", "Cooker capped", "Tightness test", etc.)
  function harvestPhotosFromReview() {
    const photos = []; // [{labelKey, dataUrl, addressLine}]
    const imgs = document.querySelectorAll("img");
    imgs.forEach(img => {
      const src = img.getAttribute("src") || "";
      if (!src.startsWith("data:image/")) return;
      // Find the nearest text label.
      let label = "";
      const parent = img.closest("div");
      if (parent) {
        const txt = (parent.textContent || "").trim().toLowerCase();
        if (txt.length < 80) label = txt;
      }
      // Find the property heading nearest above (e.g. "1 Pass Lane, ...").
      // The review screen lists properties; each property has a heading.
      let addr = "";
      let walker = img.parentElement;
      for (let depth = 0; depth < 12 && walker; depth++) {
        const h = walker.querySelector && walker.querySelector("h2, h3, h4, [class*='Heading']");
        if (h && h.textContent && h.textContent.length < 200) { addr = h.textContent.trim(); break; }
        walker = walker.parentElement;
      }
      photos.push({ label, dataUrl: src, addr });
    });
    return photos;
  }

  // ---------- BUILD CERT RECORD ----------
  // Convert a parsed property + harvested photos into the admin's record shape.
  function buildRecord(prop, engineerProfile, photos) {
    const NOW = new Date();
    const certDate = NOW.toISOString();
    const inspectionDate = new Date(NOW.getFullYear() + 1, NOW.getMonth(), NOW.getDate()).toISOString();

    const engineerData = Object.assign({}, COMPANY_DEFAULTS, {
      gasSafeNo: engineerProfile && engineerProfile.gasSafeRegNo || "",
      engineerName: engineerProfile && engineerProfile.fullName || "",
      gasId: engineerProfile && engineerProfile.licenceNo || "",
      certDate,
    });

    const certData = Object.assign({}, DEFAULT_CLIENT, {
      certRef: prop.certRef,
      instName: "The Tenant",
      instAddr1: prop.address1 || "",
      instAddr2: prop.address2 || "",
      instAddr3: "",
      instPostcode: prop.postcode || "",
      instTel: "NA",
    });

    // Translate parsed appliances into the admin's wide record shape
    function naAppliance() {
      return {
        location: "", type: "", make: "", model: "", flueType: "",
        landlordsAppliance: "N/A", applianceInspected: "N/A",
        co2: "", co: "", combustion: "",
        operatingPressure: "", heatInput: "",
        spillageTest: "N/A", flueFlow: "N/A", ventilation: "N/A",
        flueVisual: "N/A", fluePerformance: "N/A",
        applianceServiced: "N/A", applianceSafe: "N/A", safetyDevices: "N/A",
      };
    }
    const appliances = (prop.appliances || []).map(a => {
      const base = naAppliance();
      base.location = a.location || base.location;
      base.type = a.type || base.type;
      base.make = a.make || base.make;
      base.model = a.model || base.model;
      base.heatInput = a.heatInput || base.heatInput;
      base.operatingPressure = a.operatingPressure || base.operatingPressure;
      if (a.visualOnly) {
        // gas fire visual only — already N/A everywhere
      } else {
        base.flueType = a.heading === "APPLIANCE 1" ? "RS" : (a.heading === "APPLIANCE 2" ? "FL" : "");
        base.applianceInspected = "Yes";
        base.applianceSafe = "Yes";
        base.safetyDevices = "Yes";
        base.ventilation = a.heading === "APPLIANCE 1" ? "Pass" : "Yes";
        base.flueVisual = a.heading === "APPLIANCE 1" ? "Pass" : "N/A";
        base.fluePerformance = a.heading === "APPLIANCE 1" ? "Pass" : "N/A";
        base.applianceServiced = "No";
        base.landlordsAppliance = a.heading === "APPLIANCE 1" ? "Yes" : "No";
        if (a.heading === "APPLIANCE 1") {
          base.co2 = "10.06 %"; base.co = "66 ppm"; base.combustion = "0.0019";
          base.operatingPressure = base.operatingPressure || "NA";
        } else if (a.heading === "APPLIANCE 2") {
          base.co2 = "NA"; base.co = "NA"; base.combustion = "NA";
          base.heatInput = "NA";
        }
      }
      return base;
    });

    // Faults
    const faults = (prop.faults || []).map(f => ({
      details: f.details || "",
      remedial: f.remedial || "",
      warningNotice: f.warningNotice === "Yes" ? "Yes" : "No",
    }));

    // FINAL CHECKS — Feature 2 logic
    let finalChecks;
    if (prop.hasGas === false) {
      // No-gas: 5 main checks NO. CO/Smoke alarms follow engineer answer.
      finalChecks = {
        gasTightness: "NO",
        pipeworkVisual: "NO",
        emergencyControl: "NO",
        bonding: "NO",
        installationPass: "NO",
        coAlarm: prop.coAlarm ? "YES" : "NO",
        smokeAlarm: prop.fireAlarm ? "YES" : "NO",
        inspectionDate,
      };
      // Auto-add "No gas supply" fault if no faults entered
      if (faults.length === 0) {
        faults.push({ details: "No gas supply", remedial: "—", warningNotice: "No" });
      }
    } else {
      finalChecks = {
        gasTightness: "YES",
        pipeworkVisual: "YES",
        emergencyControl: "YES",
        bonding: "YES",
        installationPass: "YES",
        coAlarm: "YES",
        smokeAlarm: "YES",
        inspectionDate,
      };
    }

    // Photos: attach those that look like they belong to this property
    const attachedPhotos = (photos || []).filter(ph => {
      if (!ph || !ph.dataUrl) return false;
      // If the harvested addr matches this property, attach.
      const propAddrFlat = (prop.address1 + " " + prop.postcode).toLowerCase();
      const phAddrFlat = (ph.addr || "").toLowerCase();
      return phAddrFlat.includes((prop.address1 || "").toLowerCase()) ||
             propAddrFlat.includes(phAddrFlat) ||
             ph.addr === ""; // attach unknown photos to all (de-dup later if needed)
    });

    return {
      id: "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      certData,
      appliances,
      faults,
      finalChecks,
      signatureData: {},
      engineerData,
      photos: attachedPhotos.map(p => ({ label: p.label, dataUrl: p.dataUrl })),
      savedAt: NOW.toISOString(),
    };
  }

  // ---------- HOOK INTO THE EXISTING QUEUE EVENT ----------
  function captureLatestQueue() {
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem("citizenGas.queue") || "[]"); }
    catch (e) { return; }
    if (!queue.length) return;
    const latest = queue[queue.length - 1];
    if (!latest || latest._daybookSaved) return;

    let profile = null;
    try { profile = JSON.parse(localStorage.getItem("citizenGas.engineerProfile") || "null"); } catch (e) {}

    // Snapshot the photos *now*, before React unmounts the review screen.
    const photos = harvestPhotosFromReview();

    // Parse all PROPERTY blocks from the body
    const properties = parseDaybookBody(latest.body || "");
    if (!properties.length) return;

    const daybook = readDaybook();
    if (!daybook.date) daybook.date = todayStamp();
    daybook.engineer = profile || {};

    properties.forEach(prop => {
      if (prop.noAccess) {
        daybook.noAccess = daybook.noAccess || [];
        daybook.noAccess.push({
          address1: prop.address1,
          address2: prop.address2,
          postcode: prop.postcode,
          date: prop.date || todayStamp(),
        });
      } else {
        const rec = buildRecord(prop, profile, photos);
        daybook.certs = daybook.certs || [];
        // Replace any existing record with the same certRef from today
        daybook.certs = daybook.certs.filter(r => r.certData.certRef !== rec.certData.certRef);
        daybook.certs.push(rec);
      }
    });

    writeDaybook(daybook);

    // Mark the queue entry so we don't double-save.
    try {
      const q2 = JSON.parse(localStorage.getItem("citizenGas.queue") || "[]");
      for (let i = q2.length - 1; i >= 0; i--) {
        if (q2[i].id === latest.id) { q2[i]._daybookSaved = true; break; }
      }
      localStorage.setItem("citizenGas.queue", JSON.stringify(q2));
    } catch (e) {}

    refreshDaybookButton();
  }

  // Listen — same event the existing cloud-push uses, but we run AFTER it.
  window.addEventListener("citizenGas:queued", function () {
    setTimeout(captureLatestQueue, 50); // slightly before cloud push so photos are still in DOM
  });

  // ---------- FINISH & SEND UI ----------
  function ensureDaybookButton() {
    if (document.getElementById("cg-daybook-btn")) return;
    const btn = document.createElement("button");
    btn.id = "cg-daybook-btn";
    btn.type = "button";
    btn.textContent = "Finish day & email";
    btn.style.cssText = [
      "position:fixed", "left:16px", "bottom:16px", "z-index:9998",
      "background:#2a52d4", "color:#fff", "border:0", "border-radius:999px",
      "padding:10px 16px", "font:700 13px/1 ui-sans-serif,system-ui,sans-serif",
      "letter-spacing:0.04em", "text-transform:uppercase",
      "box-shadow:0 4px 16px rgba(0,0,0,0.35)", "cursor:pointer", "display:none",
    ].join(";");
    btn.addEventListener("click", finishDay);
    document.body.appendChild(btn);
  }
  function refreshDaybookButton() {
    ensureDaybookButton();
    const btn = document.getElementById("cg-daybook-btn");
    if (!btn) return;
    const d = readDaybook();
    const has = (d.certs && d.certs.length) || (d.noAccess && d.noAccess.length);
    const isSignedIn = !!localStorage.getItem("citizenGas.engineerProfile");
    btn.style.display = (isSignedIn && has) ? "inline-flex" : "none";
    if (has) {
      const c = (d.certs || []).length;
      const na = (d.noAccess || []).length;
      btn.textContent = "Finish day & email (" + c + " cert" + (c === 1 ? "" : "s") +
        (na ? ", " + na + " no-access" : "") + ")";
    }
  }

  async function finishDay() {
    const d = readDaybook();
    if (!d.certs || !d.certs.length) {
      if (!d.noAccess || !d.noAccess.length) {
        alert("Nothing to send yet — finish at least one job first.");
        return;
      }
    }
    if (!confirm("Send today's daybook to the office?")) return;

    const dateStamp = d.date || todayStamp();
    const filename = "daybook-" + dateStamp + ".json";
    const summary = {
      jobCount: (d.certs || []).length,
      noAccessCount: (d.noAccess || []).length,
    };

    let resendOk = false;
    let resendErr = "";
    try {
      const resp = await fetch("/api/send-daybook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daybook: d, summary, filename }),
      });
      if (resp.ok) {
        const j = await resp.json().catch(() => ({}));
        resendOk = !!(j && j.ok);
      } else {
        resendErr = "HTTP " + resp.status;
      }
    } catch (e) {
      resendErr = e.message || "network";
    }

    if (resendOk) {
      // Offer download as backup, then clear daybook.
      downloadJsonLocally(d, filename);
      alert("Sent. A copy was also saved to your device's Downloads.");
      writeDaybook({ date: "", certs: [], noAccess: [] });
      refreshDaybookButton();
      return;
    }

    // Fallback: download JSON locally + open mailto so user attaches it.
    downloadJsonLocally(d, filename);
    const mailto =
      "mailto:broxburnboilers@gmail.com" +
      "?subject=" + encodeURIComponent("Citizen Gas Daybook — " + dateStamp) +
      "&body=" + encodeURIComponent(buildMailtoBody(d, summary, filename));
    setTimeout(function () { window.location.href = mailto; }, 400);
    alert(
      "Saved to Downloads as " + filename + ".\n" +
      "An email draft will open — attach the downloaded file before sending."
    );
    // Don't clear the daybook on fallback path — engineer needs to confirm send.
  }

  function buildMailtoBody(d, summary, filename) {
    const lines = [];
    lines.push("Citizen Gas — End of Day Daybook");
    lines.push("Date: " + d.date);
    lines.push("Engineer: " + ((d.engineer && d.engineer.fullName) || ""));
    lines.push("");
    lines.push("Jobs completed: " + summary.jobCount);
    lines.push("No-access: " + summary.noAccessCount);
    lines.push("");
    if (d.noAccess && d.noAccess.length) {
      lines.push("=== NO ACCESS ===");
      d.noAccess.forEach(na => {
        lines.push("- " + [na.address1, na.address2, na.postcode].filter(Boolean).join(", "));
      });
      lines.push("");
    }
    lines.push("ATTACH the file: " + filename);
    lines.push("(downloaded to your phone's Downloads folder)");
    return lines.join("\n");
  }

  function downloadJsonLocally(daybook, filename) {
    const json = JSON.stringify(daybook, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // ---------- BOOTSTRAP ----------
  window.addEventListener("DOMContentLoaded", function () {
    ensureDaybookButton();
    refreshDaybookButton();
    // Refresh button every 1.5s so it appears as soon as a profile/cert exists
    setInterval(refreshDaybookButton, 1500);
  });
})();
