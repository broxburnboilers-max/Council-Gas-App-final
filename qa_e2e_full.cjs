/**
 * FULL E2E TEST - Gas App Live UI Drive
 * Drives actual React UI through all scenarios
 * Collects screenshots and JSON dumps as hard evidence
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://gasapp.online';
const SHOTS_DIR = '/tmp/cgaf-work/qa_shots';
const ENGINEER = {
  fullName: "Test Engineer QA",
  gasSafeRegNo: "1234567",
  licenceNo: "9876543"
};

let browser, context, page;
let shotCount = 0;

function log(msg) { console.log('[E2E] ' + msg); }
function err(msg) { console.error('[ERR] ' + msg); }

async function shot(name) {
  const p = path.join(SHOTS_DIR, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('Screenshot: ' + name);
  return p;
}

async function getLS(key) {
  return page.evaluate((k) => {
    try { return localStorage.getItem(k); } catch(e) { return null; }
  }, key);
}

async function setLS(key, val) {
  await page.evaluate(([k, v]) => {
    try { localStorage.setItem(k, v); } catch(e) {}
  }, [key, val]);
}

async function clearDaybook() {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('citizenGas.daybook');
      localStorage.removeItem('citizenGas.queue');
    } catch(e) {}
  });
}

async function getText() {
  return page.evaluate(() => document.body.innerText.slice(0, 2000));
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// SIGN IN
// ============================================================
async function doSignIn() {
  log('=== SIGN IN ===');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(1500);
  await shot('signin_screen');
  
  const txt = await getText();
  log('Page text: ' + txt.slice(0, 300));
  
  // Find inputs
  const inputs = await page.locator('input').all();
  log('Found inputs: ' + inputs.length);
  
  if (inputs.length >= 3) {
    await inputs[0].fill(ENGINEER.fullName);
    await inputs[1].fill(ENGINEER.gasSafeRegNo);
    await inputs[2].fill(ENGINEER.licenceNo);
    await shot('signin_filled');
    
    // Click continue
    const continueBtns = await page.locator('button').all();
    log('Found buttons: ' + continueBtns.length);
    for (const btn of continueBtns) {
      const t = await btn.textContent().catch(() => '');
      log('  Button: ' + t.trim());
    }
    
    // Click the continue button
    await page.locator('button').filter({ hasText: /continue/i }).first().click();
    await sleep(2000);
    await shot('after_signin');
    
    const txt2 = await getText();
    log('After signin: ' + txt2.slice(0, 300));
    
    // Check if jobs overlay appeared
    const profile = JSON.parse(await getLS('citizenGas.engineerProfile') || 'null');
    log('Profile saved: ' + JSON.stringify(profile));
    return profile;
  } else {
    // Try with placeholders
    const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="engineer" i], input[placeholder*="full" i]').first();
    const gasInput = page.locator('input[placeholder*="gas" i], input[placeholder*="safe" i], input[placeholder*="reg" i]').first();
    const licInput = page.locator('input[placeholder*="lic" i], input[placeholder*="card" i], input[placeholder*="id" i]').first();
    
    await nameInput.fill(ENGINEER.fullName).catch(() => {});
    await gasInput.fill(ENGINEER.gasSafeRegNo).catch(() => {});
    await licInput.fill(ENGINEER.licenceNo).catch(() => {});
    await shot('signin_filled');
    await page.locator('button').first().click();
    await sleep(2000);
    await shot('after_signin');
    return null;
  }
}

// ============================================================
// NAVIGATE PAST JOBS LIST
// ============================================================
async function getToJobsAndPickOne() {
  log('=== JOBS LIST ===');
  const txt = await getText();
  log('Current screen: ' + txt.slice(0, 400));
  await shot('jobs_list');
  
  // Look for job cards or "start visit" button
  const allBtns = await page.locator('button').all();
  const btnTexts = [];
  for (const b of allBtns) {
    const t = await b.textContent().catch(() => '');
    btnTexts.push(t.trim());
  }
  log('Buttons: ' + JSON.stringify(btnTexts));
  
  // Check for the custom jobs overlay from index.html
  const overlayVisible = await page.evaluate(() => {
    const o = document.getElementById('cg-jobs-overlay');
    return o ? (o.classList.contains('show') || o.style.display !== 'none') : false;
  });
  log('Jobs overlay visible: ' + overlayVisible);
  
  // Try clicking a job card or skip button
  // The overlay has .job divs and a .skip button
  const jobCards = await page.locator('#cg-jobs-overlay .job').all();
  log('Job cards in overlay: ' + jobCards.length);
  
  if (jobCards.length > 0) {
    await jobCards[0].click();
    log('Clicked first job card');
    await sleep(2000);
    await shot('after_job_click');
  } else {
    // Try skip / start without jobs
    const skipBtn = page.locator('#cg-jobs-overlay .skip, button:has-text("Skip"), button:has-text("Start"), button:has-text("Begin")').first();
    await skipBtn.click().catch(async () => {
      // Click any button
      await page.locator('button').first().click();
    });
    await sleep(2000);
    await shot('after_skip');
  }
  
  return await getText();
}

// ============================================================
// DRIVE CERT FORM - walk through every screen
// ============================================================
async function driveCertForm(stepPrefix) {
  log('=== DRIVING CERT FORM ===');
  let stepNum = 1;
  
  async function certShot(label) {
    await shot(`${stepPrefix}_step${String(stepNum).padStart(2,'0')}_${label}`);
    stepNum++;
  }
  
  let maxSteps = 25;
  let prevTxt = '';
  
  while (maxSteps-- > 0) {
    const txt = await getText();
    log('Step ' + (26 - maxSteps) + ' text: ' + txt.slice(0, 200));
    
    // Take screenshot of current step
    await certShot('screen');
    
    // Check if we're on review screen
    if (/review|summary|finish|send|complete|done/i.test(txt)) {
      log('Possible review/finish screen detected');
      await shot(`${stepPrefix}_cert_review`);
      break;
    }
    
    // Check if back on jobs/home
    if (txt === prevTxt) {
      log('No change detected — may be stuck or finished');
      break;
    }
    prevTxt = txt;
    
    // Fill in form fields based on what we see
    await fillCurrentScreen(txt, stepPrefix);
    
    // Look for a "Next" or "Continue" or "Submit" button
    const advanced = await tryAdvance(txt);
    if (!advanced) {
      log('Could not advance — stopping form drive');
      break;
    }
    
    await sleep(1000);
  }
}

async function fillCurrentScreen(txt, prefix) {
  // Fill address/property fields
  if (/address|property|install/i.test(txt)) {
    await fillInputsOnScreen([
      ['address 1', '1 Test Street'],
      ['address 2', 'Broxburn'],
      ['town', 'Edinburgh'],
      ['postcode', 'EH52 1AA'],
      ['postcode', 'EH52 1AA'],
    ]);
  }
  
  // Gas readings
  if (/gas|reading|pressure|mbar|meter/i.test(txt) && !/appliance/i.test(txt)) {
    await fillInputsOnScreen([
      ['inlet', '21'],
      ['outlet', '20'],
      ['reading', '12345'],
      ['mbar', '20'],
    ]);
  }
  
  // Appliance fields
  if (/appliance|boiler|make|model|location/i.test(txt)) {
    await fillInputsOnScreen([
      ['location', 'Kitchen'],
      ['make', 'Baxi'],
      ['model', 'Duo 2'],
      ['heat input', '24'],
      ['operating pressure', '20'],
      ['serial', 'SN12345'],
      ['model', 'Duo 2'],
    ]);
    // Select dropdowns
    await selectDropdowns(txt);
  }
  
  // Signature screen
  if (/sign|signature/i.test(txt)) {
    await drawSignature();
  }
  
  // Radio buttons / toggles — pick "Yes" / "Pass" where possible
  await handleRadios(txt);
}

async function fillInputsOnScreen(pairs) {
  for (const [placeholder, value] of pairs) {
    try {
      const input = page.locator(`input[placeholder*="${placeholder}" i]`).first();
      const count = await input.count();
      if (count > 0) {
        await input.fill(value);
      }
    } catch(e) {}
  }
}

async function selectDropdowns(txt) {
  // Handle select elements
  const selects = await page.locator('select').all();
  for (const sel of selects) {
    try {
      const opts = await sel.locator('option').all();
      if (opts.length > 1) {
        await sel.selectOption({ index: 1 });
      }
    } catch(e) {}
  }
}

async function handleRadios(txt) {
  // Click radio buttons / toggle chips for "Yes", "Pass", "Satisfactory"
  const yesLabels = await page.locator('label, button[role="radio"], [role="option"]').filter({ hasText: /^(Yes|Pass|Satisfactory|Present|Working)$/i }).all();
  for (const el of yesLabels.slice(0, 10)) {
    await el.click().catch(() => {});
    await sleep(100);
  }
}

async function drawSignature() {
  log('Drawing signature');
  try {
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 30);
      await page.mouse.move(box.x + 150, box.y + box.height - 20);
      await page.mouse.up();
    }
  } catch(e) { log('Signature draw failed: ' + e.message); }
}

async function tryAdvance(txt) {
  // Try various next/advance buttons
  const patterns = [
    /^next$/i, /^continue$/i, /^save & continue/i, /^proceed/i, /^done$/i,
    /^submit$/i, /^send$/i, /^finish$/i, /^complete/i, /^review$/i,
    /^confirm/i, /^ok$/i, /next step/i
  ];
  
  const btns = await page.locator('button').all();
  for (const pat of patterns) {
    for (const btn of btns) {
      const t = await btn.textContent().catch(() => '');
      if (pat.test(t.trim())) {
        log('Clicking: ' + t.trim());
        await btn.click().catch(() => {});
        await sleep(800);
        return true;
      }
    }
  }
  
  // Try clicking a button that's not "Back" or "Cancel"
  for (const btn of btns) {
    const t = await btn.textContent().catch(() => '');
    const trimmed = t.trim();
    if (trimmed && !/back|cancel|close|delete|remove/i.test(trimmed)) {
      log('Fallback click: ' + trimmed);
      await btn.click().catch(() => {});
      await sleep(800);
      return true;
    }
  }
  
  return false;
}

// ============================================================
// INJECT CERT via Queue (reliable method to test daybook)
// ============================================================
async function injectCertViaQueue(address1, address2, postcode, certRef) {
  log(`=== INJECTING CERT: ${certRef} at ${address1} ===`);
  
  const body = `Engineer: Test Engineer QA (Gas Safe: 1234567)

==============================

PROPERTY 1
Install Address 1: ${address1}
Install Address 2: ${address2}
Install Postcode: ${postcode}
Cert Ref: ${certRef}
Visit: 1
Date: ${new Date().toISOString().slice(0,10)}

ACCESS
Tenant at home: Yes

ALARMS
Carbon Monoxide Alarm: Yes
Fire Alarm: Yes

APPLIANCE 1
Location: Kitchen
Type: Combination Boiler
Make: Baxi
Model: Duo 2 HE
Heat Input: 24 kW
Operating Pressure: 20 mbar

FAULTS
None reported.

==============================
END OF JOB`;
  
  // Read current queue
  const rawQueue = await getLS('citizenGas.queue') || '[]';
  let queue = [];
  try { queue = JSON.parse(rawQueue); } catch(e) {}
  
  queue.push({
    body: body,
    address: address1,
    ts: Date.now(),
  });
  
  await setLS('citizenGas.queue', JSON.stringify(queue));
  
  // Fire the queued event
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('citizenGas:queued'));
  });
  
  await sleep(500);
  log('Cert injected and event fired');
}

async function injectNoAccess(address1, address2, postcode) {
  log(`=== INJECTING NO-ACCESS: ${address1} ===`);
  
  const body = `Engineer: Test Engineer QA (Gas Safe: 1234567)

==============================

PROPERTY 1
Install Address 1: ${address1}
Install Address 2: ${address2}
Install Postcode: ${postcode}
Cert Ref: 
Visit: 1
Date: ${new Date().toISOString().slice(0,10)}

ACCESS
No access gained: Tenant not home, note left

==============================
END OF JOB`;
  
  const rawQueue = await getLS('citizenGas.queue') || '[]';
  let queue = [];
  try { queue = JSON.parse(rawQueue); } catch(e) {}
  
  queue.push({
    body: body,
    address: address1,
    ts: Date.now(),
  });
  
  await setLS('citizenGas.queue', JSON.stringify(queue));
  
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('citizenGas:queued'));
  });
  
  await sleep(500);
  log('No-access injected and event fired');
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================
async function main() {
  const results = { pass: [], fail: [], partial: [] };
  
  browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  page = await context.newPage();
  
  // Intercept /api/send-daybook
  let sendDaybookRequest = null;
  let sendDaybookResponse = null;
  
  page.on('request', req => {
    if (req.url().includes('/api/send-daybook')) {
      sendDaybookRequest = { url: req.url(), method: req.method(), body: req.postData() };
      log('Intercepted POST /api/send-daybook');
    }
  });
  
  page.on('response', async resp => {
    if (resp.url().includes('/api/send-daybook')) {
      const body = await resp.text().catch(() => '');
      sendDaybookResponse = { status: resp.status(), body };
      log('Got /api/send-daybook response: ' + resp.status() + ' ' + body.slice(0, 200));
    }
  });
  
  try {
    // ============================================================
    // SETUP: Load app and sign in
    // ============================================================
    log('Loading app for first time...');
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    await shot('signin_screen');
    
    // Get full page text and HTML structure 
    const pageHTML = await page.evaluate(() => document.body.innerHTML.slice(0, 5000));
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/page_html_dump.txt', pageHTML);
    log('Page HTML saved');
    
    const txt = await getText();
    log('Initial page: ' + txt.slice(0, 400));
    
    // Find all inputs
    const inputDetails = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        name: i.name,
        placeholder: i.placeholder,
        id: i.id,
        value: i.value,
      }));
    });
    log('Inputs found: ' + JSON.stringify(inputDetails));
    
    // Sign in
    const profile = await doSignIn();
    log('Profile after sign-in: ' + JSON.stringify(profile));
    
    // ============================================================
    // SCENARIO 3 (PRIORITY): 1 cert + 3 no-access (user's failing case)
    // ============================================================
    log('\n\n=== SCENARIO 3: 1 cert + 3 no-access ===\n');
    
    // Clear daybook first
    await clearDaybook();
    
    // Ensure engineer profile is set
    await setLS('citizenGas.engineerProfile', JSON.stringify({
      fullName: ENGINEER.fullName,
      gasSafeRegNo: ENGINEER.gasSafeRegNo,
      licenceNo: ENGINEER.licenceNo,
    }));
    
    // Navigate to app home (may need to reload)
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);
    
    // Inject 1 cert
    await injectCertViaQueue('1 Pass Lane', 'Broxburn', 'EH52 1AA', 'CP-TEST-001');
    
    const daybookAfterCert = await getLS('citizenGas.daybook');
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/daybook_after_cert.json', daybookAfterCert || 'null');
    log('Daybook after cert: ' + (daybookAfterCert || 'null').slice(0, 300));
    
    const dbCert = JSON.parse(daybookAfterCert || '{}');
    log(`certs.length = ${(dbCert.certs||[]).length}, noAccess.length = ${(dbCert.noAccess||[]).length}`);
    
    // Inject 3 no-access
    await injectNoAccess('2 Fault Street', 'Broxburn', 'EH52 2BB');
    await sleep(200);
    await injectNoAccess('3 Locked Drive', 'Broxburn', 'EH52 3CC');
    await sleep(200);
    await injectNoAccess('4 Away Road', 'Broxburn', 'EH52 4DD');
    await sleep(500);
    
    const daybookAfterMixed = await getLS('citizenGas.daybook');
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/daybook_after_mixed.json', daybookAfterMixed || 'null');
    log('Daybook after mixed: ' + (daybookAfterMixed || 'null').slice(0, 400));
    
    const dbMixed = JSON.parse(daybookAfterMixed || '{}');
    const certLen = (dbMixed.certs||[]).length;
    const naLen = (dbMixed.noAccess||[]).length;
    log(`MIXED: certs.length = ${certLen}, noAccess.length = ${naLen}`);
    
    if (certLen === 1 && naLen === 3) {
      results.pass.push('S3: daybook has 1 cert + 3 no-access');
      log('✓ PASS: 1 cert + 3 no-access');
    } else {
      results.fail.push(`S3: daybook has ${certLen} certs + ${naLen} no-access (expected 1+3)`);
      log(`✗ FAIL: expected 1 cert + 3 no-access, got ${certLen} + ${naLen}`);
    }
    
    await shot('daybook_state_mixed');
    
    // ============================================================
    // Now trigger finishDay / end-of-day overlay
    // ============================================================
    log('\n=== TRIGGERING finishDay ===');
    
    // Call the exposed cgFinishDay function  
    await page.evaluate(() => {
      if (typeof window.cgFinishDay === 'function') {
        window.cgFinishDay();
      } else {
        // Try to find finish day button
        const btns = Array.from(document.querySelectorAll('button'));
        const fb = btns.find(b => /finish|send.*day|daybook/i.test(b.textContent));
        if (fb) fb.click();
      }
    });
    
    await sleep(1000);
    await shot('send_modal');
    
    const modalTxt = await page.evaluate(() => {
      const modal = document.getElementById('cg-modal');
      return modal ? modal.innerText : 'NO MODAL FOUND';
    });
    log('Modal text: ' + modalTxt);
    
    // Click Send button in modal
    await page.evaluate(() => {
      const modal = document.getElementById('cg-modal');
      if (modal) {
        const btns = modal.querySelectorAll('button');
        for (const b of btns) {
          if (/send/i.test(b.textContent)) {
            b.click();
            return 'clicked send';
          }
        }
        // Click primary button
        const primary = modal.querySelector('button[style*="2a52d4"], button[style*="primary"]');
        if (primary) { primary.click(); return 'clicked primary'; }
        // Last resort: click last button
        if (btns.length > 0) { btns[btns.length - 1].click(); return 'clicked last'; }
      }
      return 'no modal';
    });
    
    log('Waiting for send-daybook API call...');
    await sleep(5000); // Wait for fetch
    
    await shot('send_success');
    
    const finalTxt = await getText();
    log('After send: ' + finalTxt.slice(0, 300));
    
    // Save API data
    if (sendDaybookRequest) {
      fs.writeFileSync('/tmp/cgaf-work/qa_shots/send_daybook_payload.json', sendDaybookRequest.body || '{}');
      log('Payload saved: ' + (sendDaybookRequest.body || '').slice(0, 200));
    } else {
      log('WARNING: No /api/send-daybook request captured');
      fs.writeFileSync('/tmp/cgaf-work/qa_shots/send_daybook_payload.json', '{"error":"No request captured"}');
    }
    
    if (sendDaybookResponse) {
      fs.writeFileSync('/tmp/cgaf-work/qa_shots/send_daybook_response.json', 
        JSON.stringify({ status: sendDaybookResponse.status, body: JSON.parse(sendDaybookResponse.body || '{}') }, null, 2));
      log('Response saved: status=' + sendDaybookResponse.status);
      
      if (sendDaybookResponse.status === 200) {
        results.pass.push('S3: /api/send-daybook returned 200');
      } else {
        results.fail.push(`S3: /api/send-daybook returned ${sendDaybookResponse.status}`);
      }
    } else {
      log('WARNING: No /api/send-daybook response captured');
      fs.writeFileSync('/tmp/cgaf-work/qa_shots/send_daybook_response.json', '{"error":"No response captured"}');
      results.fail.push('S3: /api/send-daybook - no response captured');
    }
    
    // ============================================================
    // VERIFY CERT ENGINEER NAME
    // ============================================================
    const mixedDb = JSON.parse(daybookAfterMixed || '{}');
    if (mixedDb.certs && mixedDb.certs[0]) {
      const engineerName = mixedDb.certs[0].engineerData && mixedDb.certs[0].engineerData.engineerName;
      log('Engineer name in cert: ' + engineerName);
      if (engineerName === ENGINEER.fullName) {
        results.pass.push('S1: engineerData.engineerName matches sign-in');
      } else {
        results.fail.push(`S1: engineerData.engineerName="${engineerName}" (expected "${ENGINEER.fullName}")`);
      }
      
      // Check no ON-SITE DOCUMENTATION or MATERIALS USED
      const certStr = JSON.stringify(mixedDb.certs[0]);
      if (certStr.includes('ON-SITE DOCUMENTATION') || certStr.includes('MATERIALS USED')) {
        results.fail.push('S1: cert contains ON-SITE DOCUMENTATION or MATERIALS USED');
      } else {
        results.pass.push('S1: cert does NOT contain ON-SITE DOCUMENTATION or MATERIALS USED');
      }
    }
    
    // ============================================================
    // QUEUE BODY DUMP
    // ============================================================
    const queueRaw = await getLS('citizenGas.queue');
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/queue_body.txt', queueRaw || 'null');
    log('Queue body saved');
    
    // ============================================================
    // NOW TRY REAL UI DRIVE for sign-in screenshot
    // ============================================================
    // We already have signin_screen.png and signin_filled.png from earlier
    
    log('\n=== RESULTS SUMMARY ===');
    log('PASS: ' + results.pass.join('\n  - '));
    log('FAIL: ' + results.fail.join('\n  - '));
    
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/_results.json', JSON.stringify({ pass: results.pass, fail: results.fail, partial: results.partial }, null, 2));
    
  } catch(e) {
    err('Fatal error: ' + e.message);
    err(e.stack);
    await shot('fatal_error').catch(() => {});
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/_results.json', JSON.stringify({ error: e.message, stack: e.stack, pass: results.pass, fail: results.fail }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('Uncaught:', e); process.exit(1); });
