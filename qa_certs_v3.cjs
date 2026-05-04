/**
 * CERT RENDER v3
 * - Set sessionStorage.gsAdminKey = "Test" and go to /admin/
 * - The Gas Safety Cert admin SPA loads with gsc_records
 * - Inject records, trigger cert view, screenshot at A4
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = '/tmp/cgaf-work/qa_shots/certs';
const RED = fs.readFileSync('/tmp/cgaf-work/qa_shots/red_square.b64.txt', 'utf8').trim();

function log(m) { console.log('[v3] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
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

function makeRecord(overrides) {
  const now = new Date().toISOString();
  return Object.assign({
    id: `rec_qa_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    certData: {
      clientName: "Citizen Housing Group Ltd",
      clientAddr1: "Lakeside",
      clientAddr2: "4040 Solihull Pkwy",
      clientAddr3: "Birmingham",
      clientPostcode: "B37 7YN",
      clientTel: "0300 790 6555",
      clientEmail: "admin@dsplumbingsolutions.co.uk",
      certRef: "GSC-QA-001",
      instName: "The Tenant",
      instAddr1: "1 Pass Lane",
      instAddr2: "Broxburn",
      instAddr3: "",
      instPostcode: "EH52 1AA",
      instTel: "07700900001",
    },
    appliances: [{
      location: "Kitchen",
      type: "Combination Boiler",
      make: "Baxi",
      model: "Duo 2 HE",
      flueType: "RS",
      landlordsAppliance: "Yes",
      applianceInspected: "Yes",
      co2: "10.06 %",
      co: "66 ppm",
      combustion: "0.0019",
      operatingPressure: "20 mbar",
      heatInput: "24 kW",
      spillageTest: "Pass",
      flueFlow: "Pass",
      ventilation: "Pass",
      flueVisual: "Pass",
      fluePerformance: "Pass",
      applianceServiced: "No",
      applianceSafe: "Yes",
      safetyDevices: "Yes",
    }],
    faults: [],
    finalChecks: {
      gasTightness: "YES",
      pipeworkVisual: "YES",
      emergencyControl: "YES",
      bonding: "YES",
      installationPass: "YES",
      coAlarm: "YES",
      smokeAlarm: "YES",
      inspectionDate: new Date(new Date().getFullYear() + 1, new Date().getMonth(), new Date().getDate()).toISOString(),
    },
    signatureData: {
      engineerSigImage: RED,
    },
    engineerData: {
      engineerName: "Test Engineer QA",
      gasSafeNo: "1234567",
      gasId: "9876543",
      companyName: "West Lothian Gas Ltd",
      companyAddr: "18 Mauldeth Rd Broxburn",
      companyPostcode: "EH52 6FB",
      companyTel: "07961768920",
      companyEmail: "akingpage@gmail.com",
      companyWeb: "www.westlothiangas.com",
      certDate: now,
    },
    photos: [
      { label: "gas meter photo", dataUrl: RED },
      { label: "appliance photo", dataUrl: RED },
    ],
    savedAt: now,
  }, overrides);
}

async function main() {
  const cert1 = makeRecord({ certData: { clientName: "Citizen Housing Group Ltd", clientAddr1: "Lakeside", clientAddr2: "4040 Solihull Pkwy", clientAddr3: "Birmingham", clientPostcode: "B37 7YN", clientTel: "0300 790 6555", clientEmail: "admin@dsplumbingsolutions.co.uk", certRef: "GSC-QA-001", instName: "The Tenant", instAddr1: "1 Pass Lane", instAddr2: "Broxburn", instAddr3: "", instPostcode: "EH52 1AA", instTel: "07700900001" } });
  
  const cert2 = makeRecord({
    certData: { clientName: "Citizen Housing Group Ltd", clientAddr1: "Lakeside", clientAddr2: "4040 Solihull Pkwy", clientAddr3: "Birmingham", clientPostcode: "B37 7YN", clientTel: "0300 790 6555", clientEmail: "admin@dsplumbingsolutions.co.uk", certRef: "GSC-QA-002", instName: "The Tenant", instAddr1: "2 Baker Street", instAddr2: "Broxburn", instAddr3: "", instPostcode: "EH52 2BB", instTel: "07700900002" },
    appliances: [{ location: "Living Room", type: "Gas Fire", make: "Valor", model: "Homeflame", flueType: "RS", landlordsAppliance: "No", applianceInspected: "Yes", co2: "8.5 %", co: "40 ppm", combustion: "0.001", operatingPressure: "18 mbar", heatInput: "6 kW", spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass", flueVisual: "Pass", fluePerformance: "Pass", applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes" }],
  });
  
  const cert3 = makeRecord({
    certData: { clientName: "Citizen Housing Group Ltd", clientAddr1: "Lakeside", clientAddr2: "4040 Solihull Pkwy", clientAddr3: "Birmingham", clientPostcode: "B37 7YN", clientTel: "0300 790 6555", clientEmail: "admin@dsplumbingsolutions.co.uk", certRef: "GSC-QA-003", instName: "The Tenant", instAddr1: "3 Multi Way", instAddr2: "Broxburn", instAddr3: "", instPostcode: "EH52 3CC", instTel: "07700900003" },
    appliances: [
      { location: "Kitchen", type: "Combination Boiler", make: "Worcester Bosch", model: "Greenstar 30i", flueType: "RS", landlordsAppliance: "Yes", applianceInspected: "Yes", co2: "10.06 %", co: "66 ppm", combustion: "0.0019", operatingPressure: "20 mbar", heatInput: "30 kW", spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass", flueVisual: "Pass", fluePerformance: "Pass", applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes" },
      { location: "Living Room", type: "Gas Fire", make: "Valor", model: "Homeflame 2", flueType: "RS", landlordsAppliance: "No", applianceInspected: "Yes", co2: "NA", co: "NA", combustion: "NA", operatingPressure: "NA", heatInput: "6 kW", spillageTest: "N/A", flueFlow: "N/A", ventilation: "Yes", flueVisual: "N/A", fluePerformance: "N/A", applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes" },
    ],
  });
  
  const records = [cert1, cert2, cert3];
  records.forEach((r, i) => {
    fs.writeFileSync(path.join(CERTS_DIR, `cert_0${i+1}.json`), JSON.stringify(r, null, 2));
  });
  log('Saved 3 cert JSONs');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    acceptDownloads: true,
  });
  page = await context.newPage();
  
  // Handle dialog prompts automatically
  page.on('dialog', async dialog => {
    log('Dialog: ' + dialog.type() + ' - ' + dialog.message());
    if (dialog.type() === 'prompt') {
      await dialog.accept('Test');
    } else {
      await dialog.dismiss();
    }
  });
  
  page.on('download', async dl => {
    const nm = dl.suggestedFilename();
    const sp = path.join(CERTS_DIR, nm);
    await dl.saveAs(sp).catch(e => log('DL err: ' + e.message));
    log('Downloaded: ' + nm);
  });
  
  try {
    // ====== APPROACH 1: Click Admin button (which triggers window.prompt) ======
    log('Loading engineer app...');
    await page.goto('https://gasapp.online', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    
    // Force-show the admin button and click it
    await page.evaluate(() => {
      const btn = document.getElementById('cg-admin-btn');
      if (btn) {
        btn.style.display = 'block';
        btn.style.visibility = 'visible';
        btn.style.opacity = '1';
      }
    });
    await sleep(300);
    await page.locator('#cg-admin-btn').click({ force: true });
    await sleep(2000);
    
    const txt1 = await getText();
    log('After admin click: ' + txt1.slice(0, 200));
    await shot('admin_after_click');
    
    // Check if we're now at /admin/
    const url1 = page.url();
    log('URL after admin click: ' + url1);
    
    if (url1.includes('/admin')) {
      log('Successfully navigated to admin!');
    } else {
      // ====== APPROACH 2: Set sessionStorage and navigate directly ======
      log('Admin click did not navigate. Trying direct sessionStorage approach...');
      await page.evaluate(() => {
        sessionStorage.setItem('gsAdminKey', 'Test');
      });
      await page.goto('https://gasapp.online/admin/', { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(3000);
    }
    
    const url2 = page.url();
    const txt2 = await getText();
    log('URL: ' + url2);
    log('Text: ' + txt2.slice(0, 400));
    await shot('admin_loaded');
    
    // ====== Inject records ======
    log('Injecting records into gsc_records...');
    await page.evaluate((recs) => {
      localStorage.setItem('gsc_records', JSON.stringify(recs));
    }, records);
    
    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(3000);
    await shot('admin_with_records');
    
    const txt3 = await getText();
    log('Admin with records: ' + txt3.slice(0, 600));
    
    // Check what's visible
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()));
    log('Buttons: ' + JSON.stringify(btns.slice(0, 20)));
    
    // Check for cert cards
    const recordCount = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="record"], [class*="cert"], [class*="card"], [class*="item"]');
      return els.length;
    });
    log('Record-like elements: ' + recordCount);
    
    // Try to view cert 1
    log('\n--- Attempting to view cert 1 ---');
    const certCard = page.locator('text=GSC-QA-001, text=Pass Lane, text=1 Pass').first();
    if (await certCard.count() > 0) {
      await certCard.click();
      await sleep(2000);
      await shot('cert01_view');
    }
    
    // Try Preview PDF button
    const previewBtn = page.locator('button').filter({ hasText: /preview.pdf|download.pdf|view.cert|open.cert/i }).first();
    if (await previewBtn.count() > 0) {
      await previewBtn.click();
      await sleep(3000);
      await shot('cert01_pdf_preview');
    }
    
    await shotFull('admin_full_page');
    
    // ====== APPROACH 3: Render certs via the actual cert-preview React component ======
    // Navigate through records to find and view each cert
    // The admin shows records in a list, clicking one opens the cert view
    
    // Look for any list items or cert rows
    const listItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('li, [role="listitem"], tr')).map(el => ({
        text: el.innerText.slice(0, 100),
        tag: el.tagName,
      })).filter(i => i.text.trim());
    });
    log('List items: ' + JSON.stringify(listItems.slice(0, 10)));
    
    // Full DOM dump for analysis
    const adminDom = await page.evaluate(() => document.body.innerHTML.slice(0, 10000));
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/admin_dom.txt', adminDom);
    
  } catch(e) {
    log('Error: ' + e.message);
    await shot('v3_error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
