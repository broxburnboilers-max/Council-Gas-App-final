/**
 * CERT RENDER v4 - Properly unlock admin, inject records, render certs
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = '/tmp/cgaf-work/qa_shots/certs';
const RED = fs.readFileSync('/tmp/cgaf-work/qa_shots/red_square.b64.txt', 'utf8').trim();

function log(m) { console.log('[v4] ' + m); }
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

function makeRecord(certRef, addr1, addr2, postcode, appliances) {
  const now = new Date().toISOString();
  return {
    id: `rec_${certRef}_${Date.now()}`,
    certData: {
      clientName: "Citizen Housing Group Ltd",
      clientAddr1: "Lakeside",
      clientAddr2: "4040 Solihull Pkwy",
      clientAddr3: "Birmingham",
      clientPostcode: "B37 7YN",
      clientTel: "0300 790 6555",
      clientEmail: "admin@dsplumbingsolutions.co.uk",
      certRef,
      instName: "The Tenant",
      instAddr1: addr1,
      instAddr2: addr2,
      instAddr3: "",
      instPostcode: postcode,
      instTel: "07700900001",
    },
    appliances,
    faults: [],
    finalChecks: {
      gasTightness: "YES", pipeworkVisual: "YES", emergencyControl: "YES",
      bonding: "YES", installationPass: "YES", coAlarm: "YES", smokeAlarm: "YES",
      inspectionDate: new Date(new Date().getFullYear()+1, new Date().getMonth(), new Date().getDate()).toISOString(),
    },
    signatureData: { engineerSigImage: RED },
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
  };
}

const APPLIANCE_COMBI = (loc) => [{
  location: loc || "Kitchen", type: "Combination Boiler", make: "Baxi", model: "Duo 2 HE",
  flueType: "RS", landlordsAppliance: "Yes", applianceInspected: "Yes",
  co2: "10.06 %", co: "66 ppm", combustion: "0.0019",
  operatingPressure: "20 mbar", heatInput: "24 kW",
  spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass",
  flueVisual: "Pass", fluePerformance: "Pass",
  applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes",
}];

const APPLIANCE_FIRE = (loc) => [{
  location: loc || "Living Room", type: "Gas Fire", make: "Valor", model: "Homeflame",
  flueType: "RS", landlordsAppliance: "No", applianceInspected: "Yes",
  co2: "8.5 %", co: "40 ppm", combustion: "0.001",
  operatingPressure: "18 mbar", heatInput: "6 kW",
  spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass",
  flueVisual: "Pass", fluePerformance: "Pass",
  applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes",
}];

async function main() {
  const records = [
    makeRecord("GSC-QA-001", "1 Pass Lane", "Broxburn", "EH52 1AA", APPLIANCE_COMBI("Kitchen")),
    makeRecord("GSC-QA-002", "2 Baker Street", "Broxburn", "EH52 2BB", APPLIANCE_FIRE("Living Room")),
    makeRecord("GSC-QA-003", "3 Multi Way", "Broxburn", "EH52 3CC", [
      ...APPLIANCE_COMBI("Kitchen"),
      { location: "Living Room", type: "Gas Fire", make: "Valor", model: "Homeflame 2", flueType: "RS", landlordsAppliance: "No", applianceInspected: "Yes", co2: "NA", co: "NA", combustion: "NA", operatingPressure: "NA", heatInput: "6 kW", spillageTest: "N/A", flueFlow: "N/A", ventilation: "Yes", flueVisual: "N/A", fluePerformance: "N/A", applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes" },
    ]),
  ];
  
  records.forEach((r, i) => fs.writeFileSync(path.join(CERTS_DIR, `cert_0${i+1}.json`), JSON.stringify(r, null, 2)));
  log('Saved cert JSONs');
  
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    acceptDownloads: true,
  });
  page = await context.newPage();
  
  page.on('dialog', async d => {
    log('Dialog(' + d.type() + '): ' + d.message().slice(0, 80));
    if (d.type() === 'prompt') await d.accept('Test');
    else await d.dismiss();
  });
  page.on('download', async dl => {
    const nm = dl.suggestedFilename();
    const sp = path.join(CERTS_DIR, nm);
    await dl.saveAs(sp).catch(e => log('DL err: ' + e));
    log('DL saved: ' + nm + ' → ' + sp);
  });
  
  try {
    // Navigate to admin via the admin button (which prompts for password)
    log('Navigating to engineer app to click Admin button...');
    await page.goto('https://gasapp.online', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    
    // Show and click admin button (dialog handler accepts 'Test')
    await page.evaluate(() => {
      const btn = document.getElementById('cg-admin-btn');
      if (btn) { btn.style.display = 'block'; btn.click(); }
    });
    await sleep(3000);
    
    const url = page.url();
    log('URL: ' + url);
    const txt = await getText();
    log('Admin text: ' + txt.slice(0, 400));
    await shot('admin_landed');
    
    // Now we should be at /admin/ with a password screen  
    // Find and fill the password input
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, placeholder: i.placeholder, id: i.id
    })));
    log('Admin inputs: ' + JSON.stringify(inputs));
    
    // Fill password
    const pwInput = page.locator('input[type="password"], input').first();
    if (await pwInput.count() > 0) {
      await pwInput.fill('Test');
      await sleep(300);
      await shot('admin_pw_filled');
      
      // Click Unlock/Submit
      const unlockBtn = page.locator('button').filter({ hasText: /unlock|submit|login|enter|ok|continue/i }).first();
      if (await unlockBtn.count() > 0) {
        await unlockBtn.click({ force: true });
        await sleep(3000);
      } else {
        await page.keyboard.press('Enter');
        await sleep(3000);
      }
    }
    
    await shot('admin_after_unlock');
    const txt2 = await getText();
    log('After unlock: ' + txt2.slice(0, 500));
    
    const url2 = page.url();
    log('URL: ' + url2);
    
    // Inject records
    log('Injecting records...');
    await page.evaluate((recs) => {
      localStorage.setItem('gsc_records', JSON.stringify(recs));
      log('[page] gsc_records set: ' + recs.length);
    }, records);
    
    // Reload to pick up records
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(3000);
    
    // Might need to unlock again after reload
    const txt3 = await getText();
    log('After reload: ' + txt3.slice(0, 300));
    
    if (/unlock|password|enter.*pass/i.test(txt3)) {
      log('Need to unlock again after reload...');
      const pwInput2 = page.locator('input[type="password"], input').first();
      if (await pwInput2.count() > 0) {
        await pwInput2.fill('Test');
        const unlockBtn2 = page.locator('button').filter({ hasText: /unlock|submit|login|enter|ok/i }).first();
        if (await unlockBtn2.count() > 0) {
          await unlockBtn2.click({ force: true });
        } else {
          await page.keyboard.press('Enter');
        }
        await sleep(3000);
      }
    }
    
    await shot('admin_unlocked');
    await shotFull('admin_full');
    const txt4 = await getText();
    log('Final admin text: ' + txt4.slice(0, 800));
    
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(t => t));
    log('Buttons: ' + JSON.stringify(btns));
    
    // Check if records are showing
    const hasRecords = /GSC-QA|Pass Lane|Baker Street|Multi Way/i.test(txt4);
    log('Records visible: ' + hasRecords);
    
    // Get DOM structure
    const rootHTML = await page.evaluate(() => {
      const r = document.getElementById('root');
      return r ? r.innerHTML.slice(0, 8000) : document.body.innerHTML.slice(0, 8000);
    });
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/admin_unlocked_dom.txt', rootHTML);
    
    // ====== Try to trigger cert view for each record ======
    // Look for cert ref text or address text that we can click
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const certRef = rec.certData.certRef;
      const addr = rec.certData.instAddr1;
      
      log(`\n--- Record ${i+1}: ${certRef} ---`);
      
      // Try clicking on certRef or address
      const el = page.locator(`text="${certRef}"`).first();
      if (await el.count() > 0) {
        log('Found cert ref in DOM, clicking...');
        await el.click();
        await sleep(2000);
        await shot(`cert_0${i+1}_view_opened`);
        
        // Look for Preview PDF
        const pdfBtn = page.locator('button').filter({ hasText: /preview.*pdf|download.*pdf|view.*cert|PREVIEW PDF/i }).first();
        if (await pdfBtn.count() > 0) {
          log('Clicking Preview PDF...');
          await pdfBtn.click({ force: true });
          await sleep(5000); // PDF generation takes time
          await shot(`cert_0${i+1}_pdf_view`);
          await shotFull(`cert_0${i+1}_pdf_full`);
        } else {
          // Try options menu
          const optBtn = page.locator('button').filter({ hasText: /option|more|⋮|•••/i }).first();
          if (await optBtn.count() > 0) {
            await optBtn.click();
            await sleep(1000);
            await shot(`cert_0${i+1}_options`);
            const pdfBtn2 = page.locator('button, li').filter({ hasText: /preview.*pdf|download.*pdf|PREVIEW PDF/i }).first();
            if (await pdfBtn2.count() > 0) {
              await pdfBtn2.click();
              await sleep(5000);
              await shot(`cert_0${i+1}_pdf_view`);
            }
          }
        }
        
        // Go back to list
        const backBtn = page.locator('button').filter({ hasText: /back|close|done|cancel/i }).first();
        if (await backBtn.count() > 0) {
          await backBtn.click({ force: true });
          await sleep(1500);
        }
      } else {
        log('Cert ref not found in DOM. Trying address: ' + addr);
        const addrEl = page.locator(`text="${addr}"`).first();
        if (await addrEl.count() > 0) {
          await addrEl.click();
          await sleep(2000);
          await shot(`cert_0${i+1}_via_addr`);
        }
      }
    }
    
    // ====== FALLBACK: Navigate admin React app to the cert view programmatically ======
    // The admin has a cert preview component. Let's trigger it by manipulating React state
    log('\n=== Attempting React state manipulation for cert preview ===');
    
    // Find React root and fiber
    const reactStateResult = await page.evaluate((recs) => {
      // Find React fiber root
      const root = document.getElementById('root');
      if (!root) return 'no root';
      
      // Look for __reactFiber or __reactInternalInstance
      const fiberKey = Object.keys(root).find(k => k.startsWith('__react'));
      if (!fiberKey) return 'no fiber key found. Keys: ' + Object.keys(root).join(',');
      
      return 'fiber found: ' + fiberKey;
    }, records);
    log('React state result: ' + reactStateResult);
    
    // ====== IMPORT DAYBOOK approach ======
    // The admin has "IMPORT DAYBOOK" button - use it
    log('\n=== Trying IMPORT DAYBOOK button ===');
    const importBtn = page.locator('button').filter({ hasText: /import.daybook|import/i }).first();
    if (await importBtn.count() > 0) {
      log('Found Import Daybook button');
      
      // Create a daybook file to import
      const daybook = {
        date: new Date().toISOString().slice(0, 10),
        engineer: { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" },
        certs: records,
        noAccess: [],
      };
      const daybookStr = JSON.stringify(daybook);
      
      // Trigger the import with a file
      await importBtn.click({ force: true });
      await sleep(1500);
      await shot('import_daybook_clicked');
      
      const afterImport = await getText();
      log('After import click: ' + afterImport.slice(0, 300));
      
      // Look for file input
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        // Create temp daybook file
        const tmpFile = '/tmp/cgaf-work/qa_shots/daybook_import.json';
        fs.writeFileSync(tmpFile, daybookStr);
        await fileInput.setInputFiles(tmpFile);
        await sleep(3000);
        await shot('after_file_import');
        log('After file import: ' + (await getText()).slice(0, 400));
      } else {
        // Maybe it opens a dialog or paste input
        log('No file input found after import click');
        const importInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input, textarea')).map(i => ({
          type: i.type, id: i.id, placeholder: i.placeholder
        })));
        log('Inputs after import: ' + JSON.stringify(importInputs));
      }
    }
    
    await shotFull('admin_final_state');
    log('Files in certs dir: ' + fs.readdirSync(CERTS_DIR).join(', '));
    
  } catch(e) {
    log('Error: ' + e.message + '\n' + e.stack.split('\n').slice(0, 5).join('\n'));
    await shot('v4_error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
