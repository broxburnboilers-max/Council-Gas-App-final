/**
 * FULL UI DRIVE - Drive React cert form through every screen
 * Focus: get screenshots of every cert step + no-access + end-of-day overlay
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://gasapp.online';
const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = {
  fullName: "Test Engineer QA",
  gasSafeRegNo: "1234567",
  licenceNo: "9876543"
};

let browser, context, page;

function log(m) { console.log('[UI] ' + m); }
function err(m) { console.error('[ERR] ' + m); }

async function shot(name) {
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('shot: ' + name);
}

async function getText() { return page.evaluate(() => document.body.innerText); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getLS(k) { return page.evaluate(k => { try { return localStorage.getItem(k); } catch(e) { return null; } }, k); }
async function setLS(k, v) { await page.evaluate(([k, v]) => { try { localStorage.setItem(k, v); } catch(e) {} }, [k, v]); }

async function allButtonTexts() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim())
  );
}

async function allInputInfo() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea')).map(i => ({
      tag: i.tagName,
      type: i.type,
      name: i.name,
      placeholder: i.placeholder,
      id: i.id,
      label: (document.querySelector(`label[for="${i.id}"]`) || {}).innerText || '',
    }))
  );
}

async function clickBtn(text) {
  const btn = page.locator('button').filter({ hasText: new RegExp(text, 'i') }).first();
  const cnt = await btn.count();
  if (cnt > 0) {
    await btn.click();
    await sleep(600);
    return true;
  }
  return false;
}

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  page = await context.newPage();
  
  let sendDaybookReq = null;
  let sendDaybookResp = null;
  page.on('request', req => {
    if (req.url().includes('/api/send-daybook')) {
      sendDaybookReq = { url: req.url(), body: req.postData() };
    }
  });
  page.on('response', async resp => {
    if (resp.url().includes('/api/send-daybook')) {
      const body = await resp.text().catch(() => '');
      sendDaybookResp = { status: resp.status(), body };
      log('send-daybook response: ' + resp.status() + ' ' + body);
    }
  });
  
  try {
    // ============================================================
    // STEP 1: Load sign-in screen
    // ============================================================
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);
    await shot('signin_screen');
    
    // Clear any existing state
    await page.evaluate(() => {
      Object.keys(localStorage).filter(k => k.startsWith('citizenGas.')).forEach(k => {
        if (k !== 'citizenGas.engineerProfile') localStorage.removeItem(k);
      });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1500);
    await shot('signin_screen');
    
    // ============================================================
    // STEP 2: Sign in
    // ============================================================
    log('Filling sign-in form...');
    await page.fill('#fullName', ENG.fullName);
    await page.fill('#gasSafeRegNo', ENG.gasSafeRegNo);
    await page.fill('#licenceNo', ENG.licenceNo);
    await shot('signin_filled');
    
    await clickBtn('continue');
    await sleep(2000);
    await shot('after_signin');
    
    const txt1 = await getText();
    log('After signin: ' + txt1.slice(0, 300));
    
    // ============================================================
    // STEP 3: Jobs overlay / main screen - take screenshot
    // ============================================================
    // Check for custom jobs overlay
    const overlayShowing = await page.evaluate(() => {
      const o = document.getElementById('cg-jobs-overlay');
      if (o && (o.classList.contains('show') || o.style.display === 'flex')) return true;
      return false;
    });
    log('Jobs overlay showing: ' + overlayShowing);
    await shot('jobs_list');
    
    // ============================================================
    // STEP 4: Navigate to Start New Job
    // ============================================================
    log('Looking for Start new job button...');
    const btns1 = await allButtonTexts();
    log('Buttons: ' + JSON.stringify(btns1));
    
    // Try clicking "Start new job" or equivalent
    let started = await clickBtn('start new job');
    if (!started) started = await clickBtn('start');
    if (!started) started = await clickBtn('begin');
    if (!started) {
      // Maybe there are job cards in the custom overlay
      const jobCards = await page.locator('#cg-jobs-overlay .job').all();
      if (jobCards.length > 0) {
        await jobCards[0].click();
        await sleep(1000);
        started = true;
      }
    }
    
    await sleep(1500);
    await shot('cert_step01_start');
    const txt2 = await getText();
    log('After start: ' + txt2.slice(0, 400));
    
    // ============================================================
    // STEP 5: Walk through cert form screens
    // ============================================================
    const stepScreens = [];
    
    for (let step = 2; step <= 20; step++) {
      const txt = await getText();
      log(`\n--- Cert step ${step} ---`);
      log('Text: ' + txt.slice(0, 300));
      
      const inputs = await allInputInfo();
      const btns = await allButtonTexts();
      log('Inputs: ' + JSON.stringify(inputs.map(i => i.placeholder || i.label || i.id)));
      log('Buttons: ' + JSON.stringify(btns));
      
      // Take screenshot
      const shotName = `cert_step${String(step).padStart(2,'0')}_screen`;
      await shot(shotName);
      stepScreens.push(shotName);
      
      // Fill based on content
      await fillScreen(txt, inputs, btns, step);
      
      // Check if we're at review
      if (/review|summary|all done|job complete|finish.*job|send.*cert/i.test(txt)) {
        log('At review screen!');
        await shot('cert_review');
        break;
      }
      
      // Try to advance
      const advanced = await advanceScreen(btns);
      if (!advanced) {
        log('Could not advance from step ' + step);
        break;
      }
      
      await sleep(1000);
    }
    
    await shot('cert_review');
    
    // Try to finish/send the cert
    log('\n--- Attempting to finish cert ---');
    const finBtns = await allButtonTexts();
    log('Buttons at finish: ' + JSON.stringify(finBtns));
    
    let finished = false;
    for (const t of ['finish', 'send', 'submit', 'done', 'complete', 'confirm']) {
      if (await clickBtn(t)) { finished = true; break; }
    }
    
    await sleep(2000);
    await shot('cert_finished');
    
    const txtAfterFinish = await getText();
    log('After finish: ' + txtAfterFinish.slice(0, 300));
    
    // Check queue
    const queueRaw = await getLS('citizenGas.queue');
    log('Queue after cert: ' + (queueRaw || 'null').slice(0, 300));
    if (queueRaw) fs.writeFileSync(SHOTS + '/queue_body.txt', queueRaw);
    
    const daybookRaw = await getLS('citizenGas.daybook');
    log('Daybook after cert: ' + (daybookRaw || 'null').slice(0, 300));
    if (daybookRaw) fs.writeFileSync(SHOTS + '/daybook_after_cert.json', daybookRaw);
    
    // ============================================================
    // SCENARIO 2: No-access flow
    // ============================================================
    log('\n\n=== SCENARIO 2: No-access ===');
    
    // Navigate to start a new job
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await sleep(1500);
    
    // Sign in again if needed
    const currentTxt = await getText();
    if (/sign.in|engineer sign/i.test(currentTxt)) {
      await page.fill('#fullName', ENG.fullName);
      await page.fill('#gasSafeRegNo', ENG.gasSafeRegNo);
      await page.fill('#licenceNo', ENG.licenceNo);
      await clickBtn('continue');
      await sleep(2000);
    }
    
    // Try Start new job
    await clickBtn('start new job');
    await sleep(1500);
    
    // Look for "No access" option
    const txtNoAccess = await getText();
    log('Job start screen: ' + txtNoAccess.slice(0, 400));
    await shot('noaccess_start');
    
    // Fill address to proceed
    const inputsNA = await allInputInfo();
    log('Inputs for no-access flow: ' + JSON.stringify(inputsNA.map(i => i.placeholder || i.id)));
    
    // Fill address fields
    for (const inp of inputsNA) {
      if (/address|street|road/i.test(inp.placeholder || inp.id)) {
        await page.locator(`[id="${inp.id}"]`).fill('2 No Access Lane').catch(() => {});
      }
      if (/postcode|post.code/i.test(inp.placeholder || inp.id)) {
        await page.locator(`[id="${inp.id}"]`).fill('EH52 2NA').catch(() => {});
      }
    }
    
    await shot('noaccess_screen');
    
    // ============================================================
    // THE REAL PRIORITY: 1 cert + 3 no-access with finishDay overlay
    // ============================================================
    log('\n\n=== PRIORITY SCENARIO: 1 cert + 3 no-access end-to-end ===');
    
    // Reset to clean state
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await sleep(1000);
    
    await page.evaluate(() => {
      localStorage.removeItem('citizenGas.daybook');
      localStorage.removeItem('citizenGas.queue');
      localStorage.setItem('citizenGas.engineerProfile', JSON.stringify({
        fullName: 'Test Engineer QA',
        gasSafeRegNo: '1234567',
        licenceNo: '9876543',
      }));
    });
    
    // Inject 1 cert via queue event
    await injectAndFire(page, certBody('1 Pass Lane', 'Broxburn', 'EH52 1AA', 'CP-FINAL-001'));
    
    const db1 = JSON.parse(await getLS('citizenGas.daybook') || '{}');
    log(`After cert: certs=${db1.certs?.length}, na=${db1.noAccess?.length}`);
    
    // Inject 3 no-access
    await injectAndFire(page, naBody('2 Fault Street', 'EH52 2BB'));
    await injectAndFire(page, naBody('3 Locked Close', 'EH52 3CC'));
    await injectAndFire(page, naBody('4 Away Avenue', 'EH52 4DD'));
    
    const db2 = JSON.parse(await getLS('citizenGas.daybook') || '{}');
    log(`After 3 na: certs=${db2.certs?.length}, na=${db2.noAccess?.length}`);
    fs.writeFileSync(SHOTS + '/daybook_after_mixed.json', JSON.stringify(db2, null, 2));
    
    await shot('daybook_state_mixed');
    
    // Now check for end-of-day overlay
    // The overlay appears when the last job is done — it's in index.html
    // We trigger it by calling cgFinishDay or clicking the "All jobs complete" button
    
    // First check if overlay is already showing (it shows after last queue flush)
    const overlayState = await page.evaluate(() => {
      const o = document.getElementById('cg-sent-overlay');
      return {
        exists: !!o,
        showing: o ? (o.classList.contains('show') || o.style.display === 'flex') : false,
        text: o ? o.innerText : '',
      };
    });
    log('Sent overlay state: ' + JSON.stringify(overlayState));
    
    // The "All jobs complete" overlay in index.html is #cg-jobs-overlay or cg-sent-overlay
    // Let's look at what overlays exist
    const allOverlays = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id^="cg-"]')).map(el => ({
        id: el.id,
        display: el.style.display,
        classList: Array.from(el.classList),
        text: el.innerText.slice(0, 100),
      }));
    });
    log('All CG overlays: ' + JSON.stringify(allOverlays));
    
    // Trigger finishDay
    await page.evaluate(() => {
      if (typeof window.cgFinishDay === 'function') {
        window.cgFinishDay();
      }
    });
    await sleep(800);
    await shot('send_modal');
    
    const modalTxt = await page.evaluate(() => {
      const m = document.getElementById('cg-modal');
      return m ? m.innerText : 'NO MODAL';
    });
    log('Modal: ' + modalTxt);
    
    // Click Send
    await page.evaluate(() => {
      const m = document.getElementById('cg-modal');
      if (m) {
        const btns = Array.from(m.querySelectorAll('button'));
        const sendBtn = btns.find(b => /send/i.test(b.innerText));
        if (sendBtn) sendBtn.click();
        else if (btns.length) btns[btns.length - 1].click();
      }
    });
    
    await sleep(6000);
    await shot('send_success');
    
    log('Final text: ' + (await getText()).slice(0, 300));
    
    if (sendDaybookReq) {
      fs.writeFileSync(SHOTS + '/send_daybook_payload.json', sendDaybookReq.body || '{}');
    }
    if (sendDaybookResp) {
      fs.writeFileSync(SHOTS + '/send_daybook_response.json',
        JSON.stringify({ status: sendDaybookResp.status, body: sendDaybookResp.body }, null, 2));
    }
    
    // Final queue dump
    const finalQueue = await getLS('citizenGas.queue');
    fs.writeFileSync(SHOTS + '/queue_body.txt', finalQueue || 'null');
    
    log('\n=== DONE ===');
    
  } catch(e) {
    err(e.message + '\n' + e.stack);
    await shot('error_state').catch(() => {});
  } finally {
    await browser.close();
  }
}

function certBody(addr1, addr2, postcode, ref) {
  return `Engineer: Test Engineer QA (Gas Safe: 1234567)

==============================

PROPERTY 1
Install Address 1: ${addr1}
Install Address 2: ${addr2}
Install Postcode: ${postcode}
Cert Ref: ${ref}
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
}

function naBody(addr1, postcode) {
  return `Engineer: Test Engineer QA (Gas Safe: 1234567)

==============================

PROPERTY 1
Install Address 1: ${addr1}
Install Address 2: Broxburn
Install Postcode: ${postcode}
Cert Ref: 
Visit: 1
Date: ${new Date().toISOString().slice(0,10)}

ACCESS
No access gained: Tenant not home, note left

==============================
END OF JOB`;
}

async function injectAndFire(page, body) {
  await page.evaluate((body) => {
    let q = [];
    try { q = JSON.parse(localStorage.getItem('citizenGas.queue') || '[]'); } catch(e) {}
    q.push({ body, ts: Date.now() });
    localStorage.setItem('citizenGas.queue', JSON.stringify(q));
    window.dispatchEvent(new CustomEvent('citizenGas:queued'));
  }, body);
  await new Promise(r => setTimeout(r, 400));
}

async function fillScreen(txt, inputs, btns, step) {
  // Address screen
  if (/address|property|install address/i.test(txt)) {
    const fills = {
      'address 1': '1 Test Lane',
      'address 2': 'Broxburn',
      'town': 'Edinburgh',
      'postcode': 'EH52 1AA',
      'cert': 'CP-UI-001',
    };
    for (const inp of inputs) {
      const key = (inp.placeholder + ' ' + inp.label + ' ' + inp.id).toLowerCase();
      for (const [k, v] of Object.entries(fills)) {
        if (key.includes(k.split(' ')[0])) {
          await page.locator(`[id="${inp.id}"]`).fill(v).catch(() => {});
          break;
        }
      }
    }
    // Select dropdowns
    for (const inp of inputs) {
      if (inp.tag === 'SELECT') {
        await page.locator(`[id="${inp.id}"]`).selectOption({ index: 1 }).catch(() => {});
      }
    }
  }
  
  // Gas readings
  if (/reading|meter|inlet|outlet/i.test(txt)) {
    for (const inp of inputs) {
      if (inp.tag === 'INPUT' && inp.type === 'number') {
        await page.locator(`[id="${inp.id}"]`).fill('20').catch(() => {});
      } else if (inp.tag === 'INPUT') {
        const key = (inp.placeholder + ' ' + inp.id).toLowerCase();
        if (/reading|meter|ref/i.test(key)) {
          await page.locator(`[id="${inp.id}"]`).fill('12345').catch(() => {});
        }
      }
    }
  }
  
  // Appliance
  if (/appliance|boiler|heater|cooker|fire/i.test(txt)) {
    const appFills = {
      'location': 'Kitchen',
      'make': 'Baxi',
      'model': 'Duo 2',
      'heat': '24',
      'press': '20',
      'serial': 'SN12345',
    };
    for (const inp of inputs) {
      if (inp.tag !== 'INPUT') continue;
      const key = (inp.placeholder + ' ' + inp.label + ' ' + inp.id).toLowerCase();
      for (const [k, v] of Object.entries(appFills)) {
        if (key.includes(k)) {
          await page.locator(`[id="${inp.id}"]`).fill(v).catch(() => {});
          break;
        }
      }
    }
    // Handle selects
    for (const inp of inputs) {
      if (inp.tag === 'SELECT') {
        await page.locator(`[id="${inp.id}"]`).selectOption({ index: 1 }).catch(() => {});
      }
    }
    // Click Yes / Pass radio buttons
    const radioLabels = await page.locator('label').all();
    for (const rl of radioLabels) {
      const t = await rl.textContent().catch(() => '');
      if (/^(yes|pass|satisfactory|present|working|ok)$/i.test(t.trim())) {
        await rl.click().catch(() => {});
        await new Promise(r => setTimeout(r, 80));
      }
    }
  }
  
  // Checks / operational
  if (/check|operational|combustion|ventilation|alarm/i.test(txt)) {
    const radioLabels = await page.locator('label').all();
    for (const rl of radioLabels) {
      const t = await rl.textContent().catch(() => '');
      if (/^(yes|pass|satisfactory|present|working|ok|fitted)$/i.test(t.trim())) {
        await rl.click().catch(() => {});
        await new Promise(r => setTimeout(r, 80));
      }
    }
  }
  
  // Signature
  if (/sign|signature/i.test(txt)) {
    try {
      const canvas = page.locator('canvas').first();
      const cnt = await canvas.count();
      if (cnt > 0) {
        const box = await canvas.boundingBox();
        if (box) {
          await page.mouse.move(box.x + 20, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + 80, box.y + 30, { steps: 5 });
          await page.mouse.move(box.x + 140, box.y + box.height - 20, { steps: 5 });
          await page.mouse.up();
        }
      }
    } catch(e) { log('Sig draw failed: ' + e.message); }
  }
}

async function advanceScreen(btns) {
  const patterns = [
    /^next$/i, /^continue$/i, /save.+continue/i, /^proceed/i,
    /^done$/i, /^submit$/i, /^send$/i, /^finish/i, /^complete/i,
    /^review$/i, /^confirm/i, /next step/i, /^ok$/i,
    /^save$/i, /add appliance/i,
  ];
  
  for (const pat of patterns) {
    const btn = page.locator('button').filter({ hasText: pat }).first();
    if (await btn.count() > 0) {
      const t = await btn.textContent();
      log('Clicking: ' + t.trim());
      await btn.click();
      await new Promise(r => setTimeout(r, 600));
      return true;
    }
  }
  
  // Fallback: click last non-back button
  const allBtns = await page.locator('button').all();
  for (let i = allBtns.length - 1; i >= 0; i--) {
    const t = await allBtns[i].textContent().catch(() => '');
    if (t.trim() && !/back|cancel|close|delete|remove/i.test(t.trim())) {
      log('Fallback click: ' + t.trim());
      await allBtns[i].click();
      await new Promise(r => setTimeout(r, 600));
      return true;
    }
  }
  return false;
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
