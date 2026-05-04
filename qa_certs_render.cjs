/**
 * CERT RENDERING via Admin UI
 * - Navigate to live admin at https://gasapp.online/admin
 * - Log in with "Test"
 * - Inject 3 cert records (with photos) into localStorage
 * - Navigate to each cert, click "View"/"Preview PDF", screenshot the rendered cert
 * - Also try the actual PDF download path
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ADMIN_URL = 'https://gasapp.online/admin';
const CERTS_DIR = '/tmp/cgaf-work/qa_shots/certs';
const SHOTS = '/tmp/cgaf-work/qa_shots';
const RED_PHOTO = fs.readFileSync('/tmp/cgaf-work/qa_shots/red_square.b64.txt', 'utf8').trim();

function log(m) { console.log('[CERT] ' + m); }
function err(m) { console.error('[ERR] ' + m); }

let browser, context, page;
async function shot(name, dir) {
  const p = path.join(dir || SHOTS, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('shot: ' + p);
  return p;
}
async function shotFull(name, dir) {
  const p = path.join(dir || SHOTS, name + '.png');
  await page.screenshot({ path: p, fullPage: true });
  log('shot full: ' + p);
  return p;
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }

function makeCertRecord(idx, addr1, addr2, postcode, appType, appMake, appModel, appLocation, certRef) {
  const now = new Date().toISOString();
  return {
    id: `rec_cert${idx}_${Date.now()}`,
    certData: {
      clientName: "Citizen Housing Group Ltd",
      clientAddr1: "Lakeside",
      clientAddr2: "4040 Solihull Pkwy",
      clientAddr3: "Birmingham",
      clientPostcode: "B37 7YN",
      clientTel: "0300 790 6555",
      clientEmail: "admin@dsplumbingsolutions.co.uk",
      certRef: certRef,
      instName: "The Tenant",
      instAddr1: addr1,
      instAddr2: addr2,
      instAddr3: "",
      instPostcode: postcode,
      instTel: "NA",
    },
    appliances: [{
      location: appLocation,
      type: appType,
      make: appMake,
      model: appModel,
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
      engineerSigImage: RED_PHOTO, // Using red square as signature placeholder
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
      { label: "gas meter", dataUrl: RED_PHOTO },
      { label: "appliance", dataUrl: RED_PHOTO },
    ],
    savedAt: now,
  };
}

function makeCertRecord2Appliances(idx, addr1, postcode, certRef) {
  const rec = makeCertRecord(idx, addr1, "Broxburn", postcode, "Combination Boiler", "Worcester Bosch", "Greenstar 30i", "Kitchen", certRef);
  rec.appliances.push({
    location: "Living Room",
    type: "Gas Fire",
    make: "Baxi",
    model: "Bermuda BS2",
    flueType: "RS",
    landlordsAppliance: "No",
    applianceInspected: "Yes",
    co2: "NA",
    co: "NA",
    combustion: "NA",
    operatingPressure: "NA",
    heatInput: "NA",
    spillageTest: "N/A",
    flueFlow: "N/A",
    ventilation: "Yes",
    flueVisual: "N/A",
    fluePerformance: "N/A",
    applianceServiced: "No",
    applianceSafe: "Yes",
    safetyDevices: "Yes",
  });
  return rec;
}

async function main() {
  browser = await chromium.launch({ 
    headless: true, 
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  page = await context.newPage();

  // Track PDF downloads
  const downloadedPDFs = [];
  page.on('download', async dl => {
    const nm = dl.suggestedFilename();
    const savePath = path.join(CERTS_DIR, nm);
    await dl.saveAs(savePath);
    downloadedPDFs.push(savePath);
    log('Downloaded: ' + savePath);
  });

  try {
    // ============================================================
    // 1. Navigate to admin
    // ============================================================
    log('Loading admin...');
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    await shot('admin_initial', CERTS_DIR);
    
    const adminTxt = await getText();
    log('Admin page: ' + adminTxt.slice(0, 400));
    
    // ============================================================
    // 2. Log in if needed
    // ============================================================
    if (/password|login|sign.in|unlock/i.test(adminTxt)) {
      log('Admin requires login...');
      // Look for password input
      const pwInput = page.locator('input[type="password"], input[placeholder*="pass" i], input[placeholder*="admin" i]').first();
      const pwCount = await pwInput.count();
      if (pwCount > 0) {
        await pwInput.fill('Test');
        await shot('admin_login_filled', CERTS_DIR);
        await page.locator('button').filter({ hasText: /login|sign.in|unlock|enter|ok|submit|continue/i }).first().click();
        await sleep(2000);
      } else {
        // Maybe it's a different input
        const allInputs = await page.locator('input').all();
        log('Found ' + allInputs.length + ' inputs on admin login');
        if (allInputs.length > 0) {
          await allInputs[0].fill('Test');
          await page.locator('button').first().click();
          await sleep(2000);
        }
      }
    }
    
    await shot('admin_after_login', CERTS_DIR);
    const adminTxt2 = await getText();
    log('Admin after login: ' + adminTxt2.slice(0, 400));
    
    // ============================================================
    // 3. Inject cert records into admin localStorage
    // ============================================================
    log('Injecting cert records into admin localStorage...');
    
    const cert1 = makeCertRecord(1, '1 Pass Lane', 'Broxburn', 'EH52 1AA', 'Combination Boiler', 'Baxi', 'Duo 2 HE', 'Kitchen', 'GSC-QA-001');
    const cert2 = makeCertRecord(2, '2 Baker Street', 'Broxburn', 'EH52 2BB', 'Gas Fire', 'Valor', 'Homeflame', 'Living Room', 'GSC-QA-002');
    const cert3 = makeCertRecord2Appliances(3, '3 Multi Way', 'EH52 3CC', 'GSC-QA-003');
    
    // Save source JSON
    fs.writeFileSync(path.join(CERTS_DIR, 'cert_01.json'), JSON.stringify(cert1, null, 2));
    fs.writeFileSync(path.join(CERTS_DIR, 'cert_02.json'), JSON.stringify(cert2, null, 2));
    fs.writeFileSync(path.join(CERTS_DIR, 'cert_03.json'), JSON.stringify(cert3, null, 2));
    log('Cert JSONs saved');
    
    // Inject into admin's localStorage (the admin uses 'gsc_records' or similar)
    // First check what keys the admin uses
    const adminLSKeys = await page.evaluate(() => Object.keys(localStorage));
    log('Admin LS keys: ' + JSON.stringify(adminLSKeys));
    
    // Also inject the daybook for admin import
    const daybook = {
      date: new Date().toISOString().slice(0, 10),
      engineer: { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" },
      certs: [cert1, cert2, cert3],
      noAccess: [],
    };
    
    // Try to find the admin's record storage key
    const recordsRaw = await page.evaluate(() => {
      // Common admin storage keys
      const candidates = ['gsc_records', 'citizenGas.adminRecords', 'admin_records', 'records', 'certs'];
      for (const k of candidates) {
        const v = localStorage.getItem(k);
        if (v) return JSON.stringify({ key: k, value: v.slice(0, 200) });
      }
      return JSON.stringify({ key: null, allKeys: Object.keys(localStorage) });
    });
    log('Admin records check: ' + recordsRaw);
    
    // The admin app loads from Netlify blobs (cloud), but also has local storage
    // Let's look at what keys exist after login
    const allAdminLS = await page.evaluate(() => {
      const result = {};
      for (const k of Object.keys(localStorage)) {
        result[k] = localStorage.getItem(k).slice(0, 100);
      }
      return result;
    });
    log('All admin LS: ' + JSON.stringify(allAdminLS));
    
    // ============================================================
    // 4. Use the Admin's "Import Daybook" feature if available
    // ============================================================
    // The admin has a gs-import-overlay; let's trigger it or navigate to records
    const adminButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim())
    );
    log('Admin buttons: ' + JSON.stringify(adminButtons));
    
    // Look for "Import" or "Records" buttons
    const importTxt = await page.locator('button').filter({ hasText: /import|daybook|records|cert/i }).all();
    log('Import-like buttons: ' + importTxt.length);
    for (const b of importTxt) {
      log('  - ' + (await b.textContent().catch(() => '')));
    }
    
    // ============================================================
    // 5. Try navigating directly to a cert view
    // ============================================================
    // Admin probably has routes. Try /admin/records or /admin/certs
    const routes = ['/admin', '/admin/records', '/admin/certs', '/admin/certificates'];
    for (const route of routes) {
      await page.goto('https://gasapp.online' + route, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      const t = await getText();
      log('Route ' + route + ': ' + t.slice(0, 150));
      await shot('admin_route_' + route.replace(/\//g, '_'), CERTS_DIR);
    }
    
    // ============================================================
    // 6. The REAL approach: use the admin's React app to render certs
    //    by injecting records into whatever storage the admin uses,
    //    then triggering the cert view
    // ============================================================
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    
    // Check admin page structure more carefully
    const adminHTML = await page.evaluate(() => document.body.innerHTML.slice(0, 8000));
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/admin_html.txt', adminHTML);
    
    // Look for the admin's React state / record loading
    // The admin bundle uses 'gsc_records' based on bundle analysis
    // Let's inject records there and reload
    
    const GSC_KEY = await page.evaluate(() => {
      // Try to find by looking at what gets loaded on boot
      const keys = Object.keys(localStorage);
      log('LS keys: ', keys);
      // Check common patterns  
      for (const k of keys) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          if (Array.isArray(v) && v.length > 0 && v[0] && (v[0].certData || v[0].engineerData)) {
            return k;
          }
        } catch(e) {}
      }
      return null;
    });
    log('GSC records key: ' + GSC_KEY);
    
    // Search admin bundle for the storage key
    const bundleSnippet = fs.readFileSync('/tmp/cgaf-work/admin/assets/index-Zyqhj0a4.js', 'utf8');
    // Find gsc_ keys
    const gscKeys = [...bundleSnippet.matchAll(/"gsc[_a-z0-9]*"/gi)].map(m => m[0]);
    log('GSC keys in bundle: ' + [...new Set(gscKeys)].join(', '));
    
  } catch(e) {
    err(e.message + '\n' + e.stack);
    await shot('cert_render_error', CERTS_DIR).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
