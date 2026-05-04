const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" };
function log(m) { console.log('[full] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
async function shot(name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }); log('📸 ' + name); }
async function clickByText(text) {
  return page.evaluate((t) => {
    const all = Array.from(document.querySelectorAll('*'));
    const el = all.find(e => e.innerText?.trim() === t);
    if (el) { el.click(); return true; }
    return false;
  }, text);
}

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  page = await context.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  
  // Sign in
  await page.goto('https://gasapp.online', { waitUntil: 'networkidle' });
  await page.evaluate(() => { Object.keys(localStorage).forEach(k => localStorage.removeItem(k)); });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(1000);
  await page.fill('#fullName', ENG.fullName);
  await page.fill('#gasSafeRegNo', ENG.gasSafeRegNo);
  await page.fill('#licenceNo', ENG.licenceNo);
  await page.locator('button').filter({ hasText: /continue/i }).first().click();
  await sleep(2000);
  
  // Start cert
  await clickByText('Start new job');
  await sleep(2000);
  await shot('cert_step01_address');
  log('Step 1 (address): ' + (await getText()).slice(0, 200));
  
  // Fill address
  await page.locator('[placeholder="Address line 1"], #addressLine1, [id*="addr"]').first().fill('1 Test Lane').catch(() => {});
  await page.locator('[placeholder="Town"], #town, [id*="town"]').first().fill('Broxburn').catch(() => {});
  await page.locator('[placeholder="Postcode"], #postcode, [id*="postcode"]').first().fill('EH52 1AA').catch(() => {});
  
  // Actually let's fill by label text
  const step1inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input,select')).map(i => ({ id: i.id, ph: i.placeholder })));
  log('Step 1 inputs: ' + JSON.stringify(step1inputs));
  
  await page.locator('button').filter({ hasText: /continue/i }).first().click().catch(async () => {
    await clickByText('Continue');
  });
  await sleep(1500);
  
  // Step 2: Access screen - click YES
  await shot('cert_step02_access');
  log('Step 2 (access): ' + (await getText()).slice(0, 200));
  await clickByText('Yes');
  await sleep(1500);
  
  // Step 3+
  let stepNum = 3;
  while (stepNum <= 15) {
    const txt = await getText();
    log(`Step ${stepNum}: ` + txt.slice(0, 200));
    await shot(`cert_step${String(stepNum).padStart(2,'0')}_screen`);
    
    // Fill inputs
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea')).map(i => ({ id: i.id, ph: i.placeholder, tag: i.tagName, val: i.value, type: i.type })));
    for (const inp of inputs) {
      if (inp.val && inp.val !== '') continue;
      const k = (inp.id + ' ' + inp.ph).toLowerCase();
      if (inp.tag === 'SELECT') { await page.locator(`#${inp.id}`).selectOption({ index: 1 }).catch(() => {}); continue; }
      if (/^$/.test(inp.id) && !inp.ph) continue;
      const sel = inp.id ? `#${inp.id}` : `[placeholder="${inp.ph}"]`;
      if (/addr.*1|line.*1/i.test(k)) { await page.locator(sel).fill('1 Test Lane').catch(() => {}); continue; }
      if (/addr.*2|line.*2|town|city/i.test(k)) { await page.locator(sel).fill('Broxburn').catch(() => {}); continue; }
      if (/postcode/i.test(k)) { await page.locator(sel).fill('EH52 1AA').catch(() => {}); continue; }
      if (/cert.*ref|ref/i.test(k)) { await page.locator(sel).fill('CP-UI-001').catch(() => {}); continue; }
      if (/location/i.test(k)) { await page.locator(sel).fill('Kitchen').catch(() => {}); continue; }
      if (/make/i.test(k)) { await page.locator(sel).fill('Baxi').catch(() => {}); continue; }
      if (/model/i.test(k)) { await page.locator(sel).fill('Duo 2 HE').catch(() => {}); continue; }
      if (/heat|kw|input/i.test(k)) { await page.locator(sel).fill('24').catch(() => {}); continue; }
      if (/pressure|mbar/i.test(k)) { await page.locator(sel).fill('20').catch(() => {}); continue; }
      if (/serial|number|co2|ppm/i.test(k)) { await page.locator(sel).fill('10.5').catch(() => {}); continue; }
      if (inp.type === 'number') { await page.locator(sel).fill('20').catch(() => {}); continue; }
    }
    
    // Click Yes radio buttons
    const yesLabels = await page.locator('label').filter({ hasText: /^Yes$/ }).all();
    for (const l of yesLabels.slice(0, 10)) await l.click().catch(() => {});
    
    // Check for review
    if (/review|summary|finish.*job|all.*done/i.test(txt)) {
      await shot('cert_review');
      log('REVIEW SCREEN!');
      
      // Try to finish/send
      const finBtn = page.locator('button').filter({ hasText: /finish|send|submit|confirm|complete/i }).first();
      if (await finBtn.count() > 0) {
        await finBtn.click();
        await sleep(3000);
        await shot('cert_finished');
      } else {
        await clickByText('Finish job') || await clickByText('Send') || await clickByText('Submit');
        await sleep(3000);
        await shot('cert_finished');
      }
      break;
    }
    
    // Advance
    let ok = false;
    const contBtn = page.locator('button').filter({ hasText: /^Continue$/ }).first();
    if (await contBtn.count() > 0) { await contBtn.click(); await sleep(800); ok = true; }
    if (!ok) { ok = await clickByText('Continue'); if (ok) await sleep(800); }
    if (!ok) { ok = await clickByText('Next'); if (ok) await sleep(800); }
    if (!ok) { ok = await clickByText('Save'); if (ok) await sleep(800); }
    if (!ok) {
      // Last button fallback
      const allBtns = await page.locator('button').all();
      for (let i = allBtns.length-1; i >= 0; i--) {
        const t = await allBtns[i].textContent().catch(() => '');
        if (t.trim() && !/back|cancel|close|admin/i.test(t)) { await allBtns[i].click(); await sleep(800); ok = true; break; }
      }
    }
    if (!ok) { log('Cannot advance from step ' + stepNum); break; }
    stepNum++;
  }
  
  // Check daybook
  const db = await page.evaluate(() => { try { return localStorage.getItem('citizenGas.daybook'); } catch(e) { return null; } });
  log('Daybook: ' + (db || 'null').slice(0, 200));
  
  await browser.close();
  log('Done. ' + stepNum + ' steps captured');
}

main().catch(console.error);
