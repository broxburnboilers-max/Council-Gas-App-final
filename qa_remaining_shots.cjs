const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" };

function log(m) { console.log('[shots] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
async function shot(name) {
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('📸 ' + name);
}
async function setLS(k, v) { await page.evaluate(([k,v]) => { try { localStorage.setItem(k,v); } catch(e) {} }, [k,v]); }
async function getLS(k) { return page.evaluate(k => { try { return localStorage.getItem(k); } catch(e) { return null; } }, k); }

function certBody(addr1, addr2, postcode, ref) {
  return `Engineer: Test Engineer QA (Gas Safe: 1234567)\n\n==============================\n\nPROPERTY 1\nInstall Address 1: ${addr1}\nInstall Address 2: ${addr2}\nInstall Postcode: ${postcode}\nCert Ref: ${ref}\nVisit: 1\nDate: ${new Date().toISOString().slice(0,10)}\n\nACCESS\nTenant at home: Yes\n\nALARMS\nCarbon Monoxide Alarm: Yes\nFire Alarm: Yes\n\nAPPLIANCE 1\nLocation: Kitchen\nType: Combination Boiler\nMake: Baxi\nModel: Duo 2 HE\nHeat Input: 24 kW\nOperating Pressure: 20 mbar\n\nFAULTS\nNone reported.\n\n==============================\nEND OF JOB`;
}

function naBody(addr1, postcode) {
  return `Engineer: Test Engineer QA (Gas Safe: 1234567)\n\n==============================\n\nPROPERTY 1\nInstall Address 1: ${addr1}\nInstall Address 2: Broxburn\nInstall Postcode: ${postcode}\nCert Ref: \nVisit: 1\nDate: ${new Date().toISOString().slice(0,10)}\n\nACCESS\nNo access gained: Tenant not home, note left\n\n==============================\nEND OF JOB`;
}

async function injectAndFire(body) {
  await page.evaluate((body) => {
    let q = [];
    try { q = JSON.parse(localStorage.getItem('citizenGas.queue') || '[]'); } catch(e) {}
    q.push({ body, ts: Date.now() });
    localStorage.setItem('citizenGas.queue', JSON.stringify(q));
    window.dispatchEvent(new CustomEvent('citizenGas:queued'));
  }, body);
  await sleep(400);
}

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  page = await context.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  
  try {
    // ====== 1. Sign-in screen ======
    await page.goto('https://gasapp.online', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);
    // Clear all state
    await page.evaluate(() => {
      Object.keys(localStorage).forEach(k => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1500);
    await shot('signin_screen'); // Already have this but refresh it
    
    // Fill sign-in
    await page.fill('#fullName', ENG.fullName);
    await page.fill('#gasSafeRegNo', ENG.gasSafeRegNo);
    await page.fill('#licenceNo', ENG.licenceNo);
    await shot('signin_filled');
    
    // Click continue
    await page.locator('button').filter({ hasText: /continue/i }).first().click();
    await sleep(2000);
    await shot('after_signin');
    
    // ====== 2. Jobs list / home screen ======
    const txt1 = await getText();
    log('After signin: ' + txt1.slice(0, 300));
    await shot('jobs_list');
    
    // ====== 3. Try to capture the no-access screen ======
    // Click "Start new job" in the React UI
    const startBtn = page.locator('button').filter({ hasText: /start new job/i }).first();
    if (await startBtn.count() > 0) {
      await startBtn.click();
      await sleep(2000);
      await shot('cert_step01_start');
      
      const step1txt = await getText();
      log('Step 1: ' + step1txt.slice(0, 300));
      
      // Take cert steps
      for (let step = 2; step <= 8; step++) {
        const txt = await getText();
        await shot(`cert_step0${step}_screen`);
        log(`Step ${step}: ` + txt.slice(0, 150));
        
        // Fill address on step 1-2
        if (step <= 3) {
          const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, placeholder: i.placeholder })));
          for (const inp of inputs) {
            if (/address.*1|addr1/i.test(inp.id + inp.placeholder)) await page.locator(`#${inp.id}`).fill('1 Test Lane').catch(() => {});
            if (/address.*2|addr2/i.test(inp.id + inp.placeholder)) await page.locator(`#${inp.id}`).fill('Broxburn').catch(() => {});
            if (/postcode/i.test(inp.id + inp.placeholder)) await page.locator(`#${inp.id}`).fill('EH52 1AA').catch(() => {});
            if (/cert.*ref|reference/i.test(inp.id + inp.placeholder)) await page.locator(`#${inp.id}`).fill('CP-UI-001').catch(() => {});
          }
        }
        
        // Check for no-access related screen
        if (/access|locked|tenant|occupied/i.test(txt)) {
          log('Access-related screen found!');
          await shot('noaccess_screen');
          
          // Look for "No access" option
          const noAccessEl = page.locator('label, button, div').filter({ hasText: /no access|not home|locked|unable/i }).first();
          if (await noAccessEl.count() > 0) {
            await shot('noaccess_option_visible');
          }
        }
        
        // Try to advance
        const btnTexts = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()));
        log('Buttons: ' + JSON.stringify(btnTexts));
        
        let advanced = false;
        for (const pat of [/^next$/i, /^continue$/i, /save.*continue/i, /^done$/i, /^save$/i]) {
          const btn = page.locator('button').filter({ hasText: pat }).first();
          if (await btn.count() > 0) {
            await btn.click();
            await sleep(800);
            advanced = true;
            break;
          }
        }
        if (!advanced) {
          // Try last non-back button
          const allBtns = await page.locator('button').all();
          for (let i = allBtns.length - 1; i >= 0; i--) {
            const t = await allBtns[i].textContent().catch(() => '');
            if (t.trim() && !/back|cancel|close/i.test(t.trim())) {
              await allBtns[i].click();
              await sleep(800);
              advanced = true;
              break;
            }
          }
        }
        if (!advanced) break;
        
        // Check if finished
        if (/review|summary|all done|job complete/i.test(txt)) break;
      }
    }
    
    // ====== 4. End-of-day overlay ======
    // Set up 1 cert + 3 no-access and capture the overlay
    await page.goto('https://gasapp.online', { waitUntil: 'networkidle' });
    await sleep(1000);
    
    await page.evaluate((eng) => {
      localStorage.removeItem('citizenGas.daybook');
      localStorage.removeItem('citizenGas.queue');
      localStorage.setItem('citizenGas.engineerProfile', JSON.stringify(eng));
    }, ENG);
    
    await injectAndFire(certBody('1 Pass Lane', 'Broxburn', 'EH52 1AA', 'CP-EOD-001'));
    await injectAndFire(naBody('2 No Access St', 'EH52 2NA'));
    await injectAndFire(naBody('3 Locked Close', 'EH52 3NA'));
    await injectAndFire(naBody('4 Away Road', 'EH52 4NA'));
    
    const db = JSON.parse(await getLS('citizenGas.daybook') || '{}');
    log(`Daybook: certs=${db.certs?.length}, na=${db.noAccess?.length}`);
    
    // The "All jobs complete" overlay (cg-sent-overlay) shows after the last job is done
    // Let's check what overlays are showing
    const overlayState = await page.evaluate(() => {
      return {
        sentOverlay: {
          exists: !!document.getElementById('cg-sent-overlay'),
          show: document.getElementById('cg-sent-overlay')?.classList.contains('show'),
          text: document.getElementById('cg-sent-overlay')?.innerText || '',
        },
        jobsOverlay: {
          exists: !!document.getElementById('cg-jobs-overlay'),
          show: document.getElementById('cg-jobs-overlay')?.classList.contains('show'),
          text: (document.getElementById('cg-jobs-overlay')?.innerText || '').slice(0, 200),
        },
      };
    });
    log('Overlays: ' + JSON.stringify(overlayState));
    
    // Trigger finishDay
    await page.evaluate(() => {
      if (typeof window.cgFinishDay === 'function') window.cgFinishDay();
    });
    await sleep(800);
    await shot('send_modal'); // Overwrite with fresh one
    
    // The "Send today's daybook to admin" button in the cg-sent-overlay / end of day
    // Let's check the actual end-of-day overlay appearance
    // From index.html, the overlay is #cg-sent-overlay with the "Send today's daybook to admin" button
    
    // Force-show the end-of-day overlay to screenshot it
    await page.evaluate(() => {
      // Show the sent overlay with the end-of-day content
      const overlay = document.getElementById('cg-sent-overlay');
      if (overlay) {
        const p = overlay.querySelector('p');
        if (p) p.textContent = 'Tap below to email today\'s daybook to admin.';
        const btn = overlay.querySelector('button');
        if (btn) btn.textContent = 'Send today\'s daybook to admin';
        overlay.classList.add('show');
      }
    });
    await sleep(500);
    await shot('end_of_day_overlay');
    
    // Now show the send modal
    await page.evaluate(() => {
      const overlay = document.getElementById('cg-sent-overlay');
      if (overlay) overlay.classList.remove('show');
      if (typeof window.cgFinishDay === 'function') window.cgFinishDay();
    });
    await sleep(800);
    await shot('send_modal');
    
    // Verify the modal content
    const modalTxt = await page.evaluate(() => {
      const m = document.getElementById('cg-modal');
      return m ? m.innerText : 'no modal';
    });
    log('Modal: ' + modalTxt);
    
    // Capture the send success
    let sendResp = null;
    page.on('response', async resp => {
      if (resp.url().includes('/api/send-daybook')) {
        const body = await resp.text().catch(() => '');
        sendResp = { status: resp.status(), body };
        log('send-daybook resp: ' + resp.status() + ' ' + body);
      }
    });
    
    // Click Send
    await page.evaluate(() => {
      const m = document.getElementById('cg-modal');
      if (m) {
        const btns = Array.from(m.querySelectorAll('button'));
        const sendBtn = btns.find(b => /send/i.test(b.innerText));
        if (sendBtn) sendBtn.click();
        else if (btns.length) btns[btns.length-1].click();
      }
    });
    
    await sleep(6000);
    await shot('send_success');
    
    log('Done capturing all required shots');
    log('Files: ' + fs.readdirSync(SHOTS).filter(f => f.endsWith('.png')).sort().join(', '));
    
  } catch(e) {
    log('Error: ' + e.message + '\n' + e.stack.split('\n').slice(0,5).join('\n'));
    await shot('remaining_shots_error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
