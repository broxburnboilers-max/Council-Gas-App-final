const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" };
function log(m) { console.log('[flow] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
async function shot(name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }); log('📸 ' + name); }

async function clickByInnerText(text) {
  return page.evaluate((t) => {
    const all = Array.from(document.querySelectorAll('*'));
    const el = all.find(e => e.innerText?.trim() === t);
    if (el) { el.click(); return true; }
    return false;
  }, text);
}

async function advanceForm() {
  // Try Continue button first
  const cont = page.locator('button').filter({ hasText: /^continue$/i }).first();
  if (await cont.count() > 0) { await cont.click(); await sleep(600); return true; }
  // Try Next
  const next = page.locator('button').filter({ hasText: /^next$/i }).first();
  if (await next.count() > 0) { await next.click(); await sleep(600); return true; }
  // Try Save
  const save = page.locator('button').filter({ hasText: /^save$/i }).first();
  if (await save.count() > 0) { await save.click(); await sleep(600); return true; }
  // Try clickable divs with Next/Continue
  const divNext = await clickByInnerText('Continue') || await clickByInnerText('Next') || await clickByInnerText('Save');
  if (divNext) { await sleep(600); return true; }
  return false;
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
  await shot('jobs_list');

  // Click "Start new job" div
  await clickByInnerText('Start new job');
  await sleep(2000);
  
  let stepNum = 1;
  let maxSteps = 20;
  let foundNoAccess = false;
  let foundReview = false;
  
  while (maxSteps-- > 0) {
    const txt = await getText();
    log(`\nStep ${stepNum}: ` + txt.slice(0, 200));
    await shot(`cert_step${String(stepNum).padStart(2,'0')}_screen`);
    stepNum++;
    
    // Fill all empty inputs
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,select,textarea'))
        .map(i => ({ id: i.id, ph: i.placeholder, tag: i.tagName, val: i.value, type: i.type }))
    );
    
    for (const inp of inputs) {
      if (inp.val && inp.val !== '' && inp.val !== '0') continue;
      const k = (inp.id + ' ' + inp.ph).toLowerCase();
      if (inp.tag === 'SELECT') { await page.locator(`#${inp.id}`).selectOption({ index: 1 }).catch(() => {}); continue; }
      if (/addr.*1|address.*1|line.*1|road|street/i.test(k)) { await page.locator(`#${inp.id}`).fill('1 Test Lane').catch(async () => await page.locator(`[placeholder="${inp.ph}"]`).fill('1 Test Lane').catch(() => {})); continue; }
      if (/addr.*2|address.*2|line.*2|town|city/i.test(k)) { await page.locator(`#${inp.id}`).fill('Broxburn').catch(() => {}); continue; }
      if (/postcode/i.test(k)) { await page.locator(`#${inp.id}`).fill('EH52 1AA').catch(() => {}); continue; }
      if (/cert.*ref|reference/i.test(k)) { await page.locator(`#${inp.id}`).fill('CP-UI-001').catch(() => {}); continue; }
      if (/location/i.test(k)) { await page.locator(`#${inp.id}`).fill('Kitchen').catch(() => {}); continue; }
      if (/make/i.test(k)) { await page.locator(`#${inp.id}`).fill('Baxi').catch(() => {}); continue; }
      if (/model/i.test(k)) { await page.locator(`#${inp.id}`).fill('Duo 2 HE').catch(() => {}); continue; }
      if (/heat|kw/i.test(k)) { await page.locator(`#${inp.id}`).fill('24').catch(() => {}); continue; }
      if (/pressure|mbar/i.test(k)) { await page.locator(`#${inp.id}`).fill('20').catch(() => {}); continue; }
      if (/serial|number/i.test(k)) { await page.locator(`#${inp.id}`).fill('SN12345').catch(() => {}); continue; }
      if (inp.type === 'number') { await page.locator(`#${inp.id}`).fill('20').catch(() => {}); continue; }
    }
    
    // Click radio YES labels
    const yesLabels = await page.locator('label').filter({ hasText: /^(Yes|YES)$/ }).all();
    for (const l of yesLabels.slice(0, 8)) await l.click().catch(() => {});
    
    // Detect no-access screen
    if (/access|tenant at home|locked/i.test(txt) && !foundNoAccess) {
      foundNoAccess = true;
      await shot('noaccess_screen');
      log('NO-ACCESS SCREEN captured!');
    }
    
    // Detect review screen
    if (/review|summary|finish.*job|send.*cert|all.*done/i.test(txt)) {
      await shot('cert_review');
      foundReview = true;
      log('REVIEW SCREEN captured!');
      
      // Try to finish
      const finBtn = page.locator('button').filter({ hasText: /finish|send|complete|done|confirm/i }).first();
      if (await finBtn.count() > 0) {
        await finBtn.click();
        await sleep(2000);
        await shot('cert_finished');
      }
      break;
    }
    
    // Advance
    const ok = await advanceForm();
    if (!ok) {
      log('Cannot advance — stopping');
      break;
    }
  }
  
  if (!foundNoAccess) {
    log('WARNING: No-access screen not found during cert flow');
    // The no-access flow is different - you choose it BEFORE the cert starts
    // or on the access screen. Let me restart and look for it
  }
  
  await browser.close();
  log(`Done. stepNum=${stepNum}, foundNoAccess=${foundNoAccess}, foundReview=${foundReview}`);
}

main().catch(console.error);
