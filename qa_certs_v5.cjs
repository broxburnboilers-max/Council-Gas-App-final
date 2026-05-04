/**
 * CERT RENDER v5 - Full flow: unlock → inject records → navigate → screenshot certs
 */

const { chromium } = require('/home/user/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = '/tmp/cgaf-work/qa_shots/certs';
const RED = fs.readFileSync('/tmp/cgaf-work/qa_shots/red_square.b64.txt', 'utf8').trim();

function log(m) { console.log('[v5] ' + m); }
let page, browser, context;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getText() { return page.evaluate(() => document.body.innerText); }
async function shot(name) {
  const p = path.join(CERTS_DIR, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  log('📸 ' + name);
  return p;
}
async function shotFull(name) {
  const p = path.join(CERTS_DIR, name + '.png');
  await page.screenshot({ path: p, fullPage: true });
  log('📸FULL ' + name);
  return p;
}
async function getLS(k) { return page.evaluate(k => { try { return localStorage.getItem(k); } catch(e) { return null; } }, k); }
async function setLS(k, v) { await page.evaluate(([k,v]) => { try { localStorage.setItem(k,v); } catch(e) {} }, [k,v]); }

function makeRecord(certRef, addr1, addr2, postcode, appliances) {
  const now = new Date().toISOString();
  return {
    id: `rec_${certRef.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}`,
    certData: {
      clientName: "Citizen Housing Group Ltd",
      clientAddr1: "Lakeside", clientAddr2: "4040 Solihull Pkwy",
      clientAddr3: "Birmingham", clientPostcode: "B37 7YN",
      clientTel: "0300 790 6555", clientEmail: "admin@dsplumbingsolutions.co.uk",
      certRef, instName: "The Tenant",
      instAddr1: addr1, instAddr2: addr2, instAddr3: "", instPostcode: postcode, instTel: "07700900001",
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
      gasSafeNo: "1234567", gasId: "9876543",
      companyName: "West Lothian Gas Ltd", companyAddr: "18 Mauldeth Rd Broxburn",
      companyPostcode: "EH52 6FB", companyTel: "07961768920",
      companyEmail: "akingpage@gmail.com", companyWeb: "www.westlothiangas.com",
      certDate: now,
    },
    photos: [{ label: "gas meter photo", dataUrl: RED }, { label: "appliance photo", dataUrl: RED }],
    savedAt: now,
  };
}

async function unlockAdmin() {
  // Navigate via admin button on engineer app
  await page.goto('https://gasapp.online', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await page.evaluate(() => {
    const btn = document.getElementById('cg-admin-btn');
    if (btn) { btn.style.display = 'block'; btn.click(); }
  });
  await sleep(3000);
  log('URL after admin: ' + page.url());
  
  // Fill admin password
  const pwInput = page.locator('input[type="password"]').first();
  if (await pwInput.count() > 0) {
    await pwInput.fill('Test');
    const unlockBtn = page.locator('button').filter({ hasText: /unlock/i }).first();
    await unlockBtn.click({ force: true });
    await sleep(3000);
  }
  
  const txt = await getText();
  log('After unlock: ' + txt.slice(0, 200));
  return txt;
}

async function main() {
  const records = [
    makeRecord("GSC-QA-001", "1 Pass Lane",    "Broxburn", "EH52 1AA", [{
      location: "Kitchen", type: "Combination Boiler", make: "Baxi", model: "Duo 2 HE",
      flueType: "RS", landlordsAppliance: "Yes", applianceInspected: "Yes",
      co2: "10.06 %", co: "66 ppm", combustion: "0.0019",
      operatingPressure: "20 mbar", heatInput: "24 kW",
      spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass", flueVisual: "Pass", fluePerformance: "Pass",
      applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes",
    }]),
    makeRecord("GSC-QA-002", "2 Baker Street", "Broxburn", "EH52 2BB", [{
      location: "Living Room", type: "Gas Fire", make: "Valor", model: "Homeflame",
      flueType: "RS", landlordsAppliance: "No", applianceInspected: "Yes",
      co2: "8.5 %", co: "40 ppm", combustion: "0.001",
      operatingPressure: "18 mbar", heatInput: "6 kW",
      spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass", flueVisual: "Pass", fluePerformance: "Pass",
      applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes",
    }]),
    makeRecord("GSC-QA-003", "3 Multi Way",    "Broxburn", "EH52 3CC", [
      { location: "Kitchen", type: "Combination Boiler", make: "Worcester Bosch", model: "Greenstar 30i", flueType: "RS", landlordsAppliance: "Yes", applianceInspected: "Yes", co2: "10.06 %", co: "66 ppm", combustion: "0.0019", operatingPressure: "20 mbar", heatInput: "30 kW", spillageTest: "Pass", flueFlow: "Pass", ventilation: "Pass", flueVisual: "Pass", fluePerformance: "Pass", applianceServiced: "No", applianceSafe: "Yes", safetyDevices: "Yes" },
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
    log('Dialog(' + d.type() + '): ' + d.message().slice(0, 60));
    if (d.type() === 'prompt') await d.accept('Test');
    else await d.dismiss();
  });
  page.on('download', async dl => {
    const nm = dl.suggestedFilename();
    const sp = path.join(CERTS_DIR, nm);
    await dl.saveAs(sp).catch(e => log('DL err: ' + e));
    log('DL saved: ' + nm);
  });
  
  try {
    await unlockAdmin();
    await shot('admin_unlocked');
    
    // Now inject records
    await setLS('gsc_records', JSON.stringify(records));
    log('Records injected into gsc_records');
    
    // Reload to pick up records
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(3000);
    
    // May need to unlock again
    let txt = await getText();
    if (/unlock|password|enter.*pass/i.test(txt)) {
      log('Need unlock again after reload');
      const pwInput = page.locator('input[type="password"]').first();
      if (await pwInput.count() > 0) {
        await pwInput.fill('Test');
        await page.locator('button').filter({ hasText: /unlock/i }).first().click({ force: true });
        await sleep(2000);
        txt = await getText();
      }
    }
    
    log('After reload text: ' + txt.slice(0, 400));
    await shot('admin_after_reload');
    await shotFull('admin_after_reload_full');
    
    // Get all buttons
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText.trim(), id: b.id, class: b.className.slice(0, 50)
    })).filter(b => b.text));
    log('Buttons: ' + JSON.stringify(btns));
    
    // Click "Records" to see the records list
    const recordsBtn = page.locator('button, a').filter({ hasText: /^Records$|^records$/i }).first();
    if (await recordsBtn.count() > 0) {
      log('Clicking Records...');
      await recordsBtn.click({ force: true });
      await sleep(2000);
      await shot('records_screen');
      log('Records screen: ' + (await getText()).slice(0, 400));
    }
    
    // Also try GSC
    const gscBtn = page.locator('button, a').filter({ hasText: /^GSC$/i }).first();
    if (await gscBtn.count() > 0) {
      log('Clicking GSC...');
      await gscBtn.click({ force: true });
      await sleep(2000);
      await shot('gsc_screen');
      log('GSC screen: ' + (await getText()).slice(0, 400));
    }
    
    await shotFull('main_menu_full');
    
    // Check DOM for cert data
    const domText = await page.evaluate(() => document.body.innerText);
    const hasCertData = domText.includes('GSC-QA') || domText.includes('Pass Lane') || domText.includes('Baker Street');
    log('Cert data visible in DOM: ' + hasCertData);
    
    // ====== Try navigating into GSC records list and clicking each cert ======
    // Look for any clickable element containing cert data
    const certElements = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els
        .filter(el => el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
        .filter(el => /GSC-QA|Pass Lane|Baker Street|Multi Way/i.test(el.textContent))
        .map(el => ({ tag: el.tagName, text: el.textContent.trim(), id: el.id, class: el.className }))
        .slice(0, 10);
    });
    log('Cert elements in DOM: ' + JSON.stringify(certElements));
    
    // ====== New approach: Navigate to GSC route in admin app ======
    // The admin bundle has routes. Let's try to navigate to each
    const routes = ['', '#records', '#gsc', '#certs', '#list', '?view=records', '?section=gsc'];
    for (const r of routes) {
      await page.goto('https://gasapp.online/admin/' + r, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await sleep(1000);
      const t = await getText();
      if (/GSC-QA|Pass Lane|cert/i.test(t)) {
        log('Found cert data at route: ' + r);
        await shot('certs_at_' + (r || 'root').replace(/[^a-z0-9]/gi,'_'));
        break;
      }
    }
    
    // ====== IMPORT DAYBOOK - direct file injection ======
    log('\n=== Import Daybook approach ===');
    await page.goto('https://gasapp.online/admin/', { waitUntil: 'networkidle', timeout: 20000 });
    await sleep(2000);
    
    // May need to unlock
    const txt5 = await getText();
    if (/unlock|password/i.test(txt5)) {
      const pw = page.locator('input[type="password"]').first();
      if (await pw.count() > 0) {
        await pw.fill('Test');
        await page.locator('button').filter({ hasText: /unlock/i }).first().click({ force: true });
        await sleep(2000);
      }
    }
    
    // Create daybook file
    const daybook = {
      date: new Date().toISOString().slice(0, 10),
      engineer: { fullName: "Test Engineer QA", gasSafeRegNo: "1234567", licenceNo: "9876543" },
      certs: records,
      noAccess: [],
    };
    const tmpDaybookPath = '/tmp/cgaf-work/qa_shots/daybook_for_import.json';
    fs.writeFileSync(tmpDaybookPath, JSON.stringify(daybook));
    
    // Find file input (gs-daybook-file)
    const fileInput = page.locator('#gs-daybook-file, input[type="file"]').first();
    if (await fileInput.count() > 0) {
      log('Found file input! Uploading daybook...');
      await fileInput.setInputFiles(tmpDaybookPath);
      await sleep(5000); // Wait for import processing
      await shot('after_daybook_import');
      await shotFull('after_daybook_import_full');
      log('After import: ' + (await getText()).slice(0, 600));
      
      // Re-inject gsc_records after import (in case import added to it)
      const gscRecords = await getLS('gsc_records');
      log('gsc_records after import: ' + (gscRecords || '').slice(0, 200));
    } else {
      log('No file input found');
    }
    
    // ====== Now try to view certs in the admin UI ======
    log('\n=== Looking for cert records in admin UI ===');
    
    await setLS('gsc_records', JSON.stringify(records));
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2000);
    
    // Unlock if needed
    const t6 = await getText();
    if (/unlock|password/i.test(t6)) {
      const pw = page.locator('input[type="password"]').first();
      if (await pw.count() > 0) {
        await pw.fill('Test');
        await page.locator('button').filter({ hasText: /unlock/i }).first().click({ force: true });
        await sleep(2000);
      }
    }
    
    // Click GSC to get to the cert list
    const gscBtn2 = page.locator('button').filter({ hasText: /gsc/i }).first();
    if (await gscBtn2.count() > 0) {
      await gscBtn2.click({ force: true });
      await sleep(2000);
      await shot('gsc_view');
      await shotFull('gsc_full');
      
      const gscTxt = await getText();
      log('GSC view: ' + gscTxt.slice(0, 600));
      
      const gscBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()));
      log('GSC buttons: ' + JSON.stringify(gscBtns));
      
      // Look for cert entries
      const certLinks = await page.locator('text=GSC-QA, text=Pass Lane').all();
      log('Cert links: ' + certLinks.length);
      
      if (certLinks.length > 0) {
        for (let i = 0; i < Math.min(certLinks.length, 3); i++) {
          await certLinks[i].click({ force: true });
          await sleep(2000);
          await shot(`cert_view_${i+1}`);
          
          const cTxt = await getText();
          log(`Cert ${i+1} view: ` + cTxt.slice(0, 300));
          
          // Click PREVIEW PDF
          const pdfBtn = page.locator('button').filter({ hasText: /preview.*pdf|PREVIEW PDF|download.*pdf/i }).first();
          if (await pdfBtn.count() > 0) {
            await pdfBtn.click({ force: true });
            await sleep(8000); // PDF gen takes time
            await shot(`cert_0${i+1}_pdf_rendered`);
            await shotFull(`cert_0${i+1}_pdf_full`);
          }
          
          // Go back
          const backBtn = page.locator('button').filter({ hasText: /back|←|‹/i }).first();
          if (await backBtn.count() > 0) {
            await backBtn.click({ force: true });
            await sleep(1000);
          }
        }
      }
      
      // Also try clicking on any visible list items
      const listItems = await page.locator('li, [role="listitem"]').all();
      log('List items: ' + listItems.length);
      for (const item of listItems.slice(0, 3)) {
        const itemTxt = await item.textContent();
        log('List item: ' + itemTxt.slice(0, 80));
        await item.click({ force: true }).catch(() => {});
        await sleep(1500);
      }
    }
    
    // Get final DOM state
    const finalDom = await page.evaluate(() => document.body.innerHTML.slice(0, 15000));
    fs.writeFileSync('/tmp/cgaf-work/qa_shots/admin_final_dom.txt', finalDom);
    await shotFull('admin_final_full');
    
    log('\nFiles in certs dir:');
    log(fs.readdirSync(CERTS_DIR).join('\n'));
    
  } catch(e) {
    log('Error: ' + e.message + '\n' + e.stack.split('\n').slice(0,8).join('\n'));
    await shot('v5_error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
