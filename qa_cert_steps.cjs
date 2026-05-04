const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" };

function log(m) { console.log('[steps] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
async function shot(name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }); log('📸 ' + name); }

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  page = await context.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  
  // Start fresh with engineer signed in
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
  
  // Click Start new job
  const startBtn = page.locator('button').filter({ hasText: /start new job/i }).first();
  if (await startBtn.count() === 0) { log('No start button'); await browser.close(); return; }
  await startBtn.click();
  await sleep(2000);
  await shot('cert_step01_address');
  
  log('Step 1: ' + (await getText()).slice(0, 200));
  
  // Fill address step
  const inp1 = await page.evaluate(() => Array.from(document.querySelectorAll('input,select')).map(i => ({ id: i.id, ph: i.placeholder, tag: i.tagName })));
  log('Inputs: ' + JSON.stringify(inp1));
  
  for (const inp of inp1) {
    const k = (inp.id + ' ' + inp.ph).toLowerCase();
    if (/addr.*1|address.*1|line.*1/i.test(k)) await page.locator(`#${inp.id || '[placeholder="'+inp.ph+'"]'}`).fill('1 Test Lane').catch(() => {});
    if (/addr.*2|address.*2|line.*2/i.test(k)) await page.locator(`#${inp.id}`).fill('Broxburn').catch(() => {});
    if (/postcode/i.test(k)) await page.locator(`#${inp.id}`).fill('EH52 1AA').catch(() => {});
    if (/cert.*ref|reference/i.test(k)) await page.locator(`#${inp.id}`).fill('CP-UI-TEST').catch(() => {});
    if (inp.tag === 'SELECT') await page.locator(`#${inp.id}`).selectOption({ index: 1 }).catch(() => {});
  }
  
  // Click Next/Continue
  await page.locator('button').filter({ hasText: /next|continue|save/i }).first().click().catch(async () => {
    const btns = await page.locator('button').all();
    for (let i = btns.length-1; i >= 0; i--) {
      const t = await btns[i].textContent().catch(() => '');
      if (!/back|cancel/i.test(t)) { await btns[i].click(); break; }
    }
  });
  await sleep(1500);
  await shot('cert_step02_screen');
  log('Step 2: ' + (await getText()).slice(0, 200));
  
  // Keep going for steps 3-8
  for (let s = 3; s <= 10; s++) {
    const txt = await getText();
    log(`Step ${s}: ` + txt.slice(0, 200));
    await shot(`cert_step0${s}_screen`);
    
    // Fill inputs
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea')).map(i => ({ id: i.id, ph: i.placeholder, tag: i.tagName, val: i.value })));
    for (const inp of inputs) {
      if (inp.val) continue; // skip already filled
      const k = (inp.id + ' ' + inp.ph).toLowerCase();
      if (inp.tag === 'SELECT') { await page.locator(`#${inp.id}`).selectOption({ index: 1 }).catch(() => {}); continue; }
      if (/location/i.test(k)) await page.locator(`#${inp.id}`).fill('Kitchen').catch(() => {});
      else if (/make/i.test(k)) await page.locator(`#${inp.id}`).fill('Baxi').catch(() => {});
      else if (/model/i.test(k)) await page.locator(`#${inp.id}`).fill('Duo 2 HE').catch(() => {});
      else if (/heat/i.test(k)) await page.locator(`#${inp.id}`).fill('24').catch(() => {});
      else if (/pressure/i.test(k)) await page.locator(`#${inp.id}`).fill('20').catch(() => {});
      else if (/serial/i.test(k)) await page.locator(`#${inp.id}`).fill('SN12345').catch(() => {});
      else if (/reading|meter|gas/i.test(k)) await page.locator(`#${inp.id}`).fill('12345').catch(() => {});
    }
    
    // Click radio/checkbox yes labels
    const yesLabels = await page.locator('label').filter({ hasText: /^yes$/i }).all();
    for (const l of yesLabels.slice(0, 5)) await l.click().catch(() => {});
    
    // Check for no-access screen
    if (/access|tenant at home|locked|occupied/i.test(txt)) {
      log('NO-ACCESS SCREEN FOUND!');
      await shot('noaccess_screen');
    }
    
    // Check for review screen
    if (/review|summary|finish|all done/i.test(txt)) {
      await shot('cert_review');
      break;
    }
    
    // Advance
    let ok = false;
    for (const pat of [/^next$/i, /^continue$/i, /save.*next/i, /save.*cont/i, /^save$/i]) {
      const btn = page.locator('button').filter({ hasText: pat }).first();
      if (await btn.count() > 0) { await btn.click(); await sleep(800); ok = true; break; }
    }
    if (!ok) {
      // fallback
      const btns = await page.locator('button').all();
      for (let i = btns.length-1; i >= 0; i--) {
        const t = await btns[i].textContent().catch(() => '');
        if (t.trim() && !/back|cancel|close|admin/i.test(t)) { await btns[i].click(); await sleep(800); ok = true; break; }
      }
    }
    if (!ok) break;
  }
  
  await browser.close();
  log('Done. Files: ' + fs.readdirSync(SHOTS).filter(f=>f.endsWith('.png')).length + ' screenshots');
}

main().catch(console.error);
