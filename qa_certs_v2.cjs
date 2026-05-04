/**
 * CERT RENDER v2 - navigate to admin cert app directly,
 * force-click hidden admin button, or go direct to /admin URL
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = '/tmp/cgaf-work/qa_shots/certs';
const RED = fs.readFileSync('/tmp/cgaf-work/qa_shots/red_square.b64.txt', 'utf8').trim();

function log(m) { console.log('[v2] ' + m); }
let browser, page, context;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function shot(name) {
  const p = path.join(CERTS_DIR, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('📸 ' + name);
}
async function shotFull(name) {
  const p = path.join(CERTS_DIR, name + '.png');
  await page.screenshot({ path: p, fullPage: true });
  log('📸FULL ' + name);
}
async function getText() { return page.evaluate(() => document.body.innerText); }

async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    acceptDownloads: true,
  });
  page = await context.newPage();
  
  page.on('download', async dl => {
    const nm = dl.suggestedFilename();
    const sp = path.join(CERTS_DIR, nm);
    await dl.saveAs(sp).catch(e => log('DL err: ' + e.message));
    log('DL: ' + nm);
  });
  
  try {
    // ====== Navigate to /admin which serves the Gas Safety Admin SPA ======
    // The netlify.toml says /admin/* → /admin/index.html
    // But the root domain serves index.html (engineer app)
    // So we need something like /admin/records or just /admin with the SPA
    
    // Try going to a deep admin route that would trigger the admin SPA
    log('Loading /admin/records...');
    await page.goto('https://gasapp.online/admin/records', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => log('Route err: ' + e.message));
    await sleep(2000);
    await shot('admin_records_route');
    log('Text: ' + (await getText()).slice(0, 200));
    
    // Try /admin/overview
    log('Loading /admin/overview...');
    await page.goto('https://gasapp.online/admin/overview', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => log('Route err: ' + e.message));
    await sleep(2000);
    await shot('admin_overview_route');
    log('Text: ' + (await getText()).slice(0, 200));
    
    // Navigate to base /admin and force click hidden admin btn via JS
    log('Loading /admin base...');
    await page.goto('https://gasapp.online/admin', { waitUntil: 'networkidle', timeout: 20000 });
    await sleep(2000);
    
    // Force click the hidden admin button via JavaScript
    const clickResult = await page.evaluate(() => {
      const btn = document.getElementById('cg-admin-btn');
      if (btn) {
        // Make it visible first
        btn.style.display = 'block';
        btn.style.visibility = 'visible';
        btn.click();
        return 'clicked cg-admin-btn';
      }
      return 'button not found';
    });
    log('Admin btn click result: ' + clickResult);
    await sleep(3000);
    await shot('admin_after_force_click');
    log('Text: ' + (await getText()).slice(0, 300));
    
    // Check if we got to admin password screen
    const txt = await getText();
    if (/password|enter.*admin|admin.*pass/i.test(txt)) {
      log('Password screen detected!');
      const pwInput = page.locator('input[type="password"], input').first();
      await pwInput.fill('Test');
      await page.keyboard.press('Enter');
      await sleep(2000);
      await shot('admin_after_password');
    }
    
    // Alternative: the admin cert app (Gas Safety Cert) is at a completely different URL
    // Let's look at what the Admin button ACTUALLY links to
    const adminHref = await page.evaluate(() => {
      const btn = document.getElementById('cg-admin-btn');
      const links = Array.from(document.querySelectorAll('a[href*="admin"], button[onclick*="admin"]'));
      return {
        btn: btn ? { href: btn.getAttribute('href'), onclick: btn.getAttribute('onclick'), 'data-href': btn.getAttribute('data-href') } : null,
        links: links.map(l => ({ href: l.href, text: l.textContent })),
      };
    });
    log('Admin button info: ' + JSON.stringify(adminHref));
    
    // Also check index.html for the admin button target
    const adminBtnCode = await page.evaluate(() => {
      // Look in scripts for where admin button goes
      const scripts = Array.from(document.scripts).map(s => s.textContent).join('\n');
      const match = scripts.match(/cg-admin-btn[\s\S]{0,500}/);
      return match ? match[0].slice(0, 500) : 'not found';
    });
    log('Admin btn code: ' + adminBtnCode.slice(0, 300));
    
    // ====== Now let's look at the admin page HTML code from local files ======
    const adminHTML = fs.readFileSync('/tmp/cgaf-work/admin/index.html', 'utf8');
    // Find the admin btn target
    const indexHTML = fs.readFileSync('/tmp/cgaf-work/index.html', 'utf8');
    const adminBtnSection = indexHTML.match(/cg-admin-btn[\s\S]{0,1000}/);
    log('Local admin btn: ' + (adminBtnSection ? adminBtnSection[0].slice(0, 500) : 'not found'));
    
  } catch(e) {
    log('Error: ' + e.message);
    await shot('v2_error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
