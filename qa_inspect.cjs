const { chromium } = require('/home/user/node_modules/playwright');
const SHOTS = '/tmp/cgaf-work/qa_shots';
const ENG = { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" };
function log(m) { console.log('[inspect] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function shot(name) { await page.screenshot({ path: SHOTS + '/' + name + '.png' }); log('📸 ' + name); }

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  page = await context.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  
  await page.goto('https://gasapp.online', { waitUntil: 'networkidle' });
  await page.evaluate(() => { Object.keys(localStorage).forEach(k => localStorage.removeItem(k)); });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(1000);
  
  await page.fill('#fullName', ENG.fullName);
  await page.fill('#gasSafeRegNo', ENG.gasSafeRegNo);
  await page.fill('#licenceNo', ENG.licenceNo);
  await page.locator('button').filter({ hasText: /continue/i }).first().click();
  await sleep(2500);
  
  const txt = await page.evaluate(() => document.body.innerText);
  log('After sign-in: ' + txt);
  
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => ({ text: b.innerText.trim(), id: b.id, disabled: b.disabled })));
  log('Buttons: ' + JSON.stringify(btns));
  
  const dom = await page.evaluate(() => document.getElementById('root')?.innerHTML.slice(0, 3000) || document.body.innerHTML.slice(0, 3000));
  log('DOM: ' + dom.slice(0, 1000));
  
  await shot('after_signin_inspect');
  
  // Check for any clickable divs with "Start new job" text
  const clickable = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all.filter(el => el.innerText && el.innerText.trim() === 'Start new job')
      .map(el => ({ tag: el.tagName, id: el.id, class: el.className.slice(0,50), cursor: getComputedStyle(el).cursor }));
  });
  log('Start new job elements: ' + JSON.stringify(clickable));
  
  // Try clicking any element with "Start new job" text
  const result = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const el = all.find(e => e.innerText?.trim() === 'Start new job');
    if (el) { el.click(); return 'clicked: ' + el.tagName; }
    return 'not found';
  });
  log('Click result: ' + result);
  await sleep(2000);
  await shot('after_start_click');
  log('After click: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  
  await browser.close();
}

main().catch(console.error);
