import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5173';
const SHOT_DIR = path.join(__dirname, 'shots');
const REPORT_PATH = path.join(__dirname, 'report.json');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const STATE = 'Maharashtra';
const PHC_ID = 'PHC-0001';
const MEDICINE = 'Cotrimoxazole Syrup';

const findings = [];
const issues = [];
const downloads = [];
let curPage = 'init';
let shotN = 0;

function shotName(label) {
  shotN++;
  return path.join(SHOT_DIR, `${String(shotN).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`);
}

function record(control, action, expected, actual, severity = 'info', screenshot = null) {
  findings.push({ page: curPage, control, action, expected, actual, severity, screenshot });
}

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('crash', () => issues.push({ page: curPage, type: 'PAGE-CRASH', text: 'renderer process crashed' }));

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') issues.push({ page: curPage, type: 'console-' + t, text: msg.text().slice(0, 300) });
  });
  page.on('pageerror', (err) => issues.push({ page: curPage, type: 'pageerror', text: String(err).slice(0, 300) }));
  page.on('requestfailed', (req) => {
    const f = req.failure();
    if (f && !['net::ERR_ABORTED', 'NS_BINDING_ABORTED'].includes(f.errorText)) {
      issues.push({ page: curPage, type: 'requestfailed', text: `${req.method()} ${req.url()} :: ${f.errorText}` });
    }
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) issues.push({ page: curPage, type: 'http-' + resp.status(), text: resp.url() });
  });
  page.on('dialog', async (dlg) => {
    issues.push({ page: curPage, type: 'dialog-' + dlg.type(), text: dlg.message().slice(0, 300) });
    try { await dlg.dismiss(); } catch { try { await dlg.accept(); } catch {} }
  });
  page.on('download', (dl) => downloads.push({ page: curPage, filename: dl.suggestedFilename() }));

  async function shot(label) {
    const f = shotName(label);
    await page.screenshot({ path: f }).catch(() => {});
    return f;
  }

  async function goto(url, label) {
    curPage = label;
    console.log('--- PAGE', label, url);
    try {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      record('(navigation)', `goto ${url}`, 'page loads', `FAILED: ${e.message}`, 'critical', await shot(label + '-navfail'));
      return false;
    }
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
    await page.waitForTimeout(400);
    return true;
  }

  async function tryClick(locator, label, { waitAfter = 500 } = {}) {
    const before = issues.length;
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
    } catch (e) {
      record(label, 'click', 'clicks without throwing', `EXCEPTION: ${String(e.message).split('\n')[0]}`, 'warn');
      return false;
    }
    await page.waitForTimeout(waitAfter);
    const newIssues = issues.slice(before);
    if (newIssues.length) {
      record(label, 'click', 'no console errors / failed requests', JSON.stringify(newIssues), 'warn', await shot(label));
    } else {
      record(label, 'click', 'no console errors / failed requests', 'OK', 'ok');
    }
    return true;
  }

  // Generic sweep of plain buttons/selects/checkboxes currently on screen.
  // Deliberately excludes <a> (handled by explicit navigation) and anything
  // whose text matches `skip` (already handled explicitly elsewhere).
  async function genericSweep(skip = []) {
    const sel = 'button:visible, [role="button"]:visible';
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) {
      const loc = page.locator(sel).nth(i);
      let text = '';
      try { text = (await loc.innerText({ timeout: 800 })).trim().replace(/\s+/g, ' ').slice(0, 50); } catch {}
      if (!text) { try { text = (await loc.getAttribute('aria-label')) || (await loc.getAttribute('title')) || ''; } catch {} }
      const label = text || `button#${i}`;
      if (skip.some((s) => label.includes(s))) continue;
      let disabled = false;
      try { disabled = await loc.isDisabled({ timeout: 500 }); } catch {}
      if (disabled) { record(label, 'skip', 'n/a', 'disabled at sweep time, skipped', 'info'); continue; }
      await tryClick(loc, label);
    }
    const selSel = 'select:visible';
    const selCount = await page.locator(selSel).count();
    for (let i = 0; i < selCount; i++) {
      const loc = page.locator(selSel).nth(i);
      let name = (await loc.getAttribute('aria-label')) || (await loc.getAttribute('title')) || `select#${i}`;
      if (skip.some((s) => name.includes(s))) continue;
      try {
        const vals = await loc.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
        if (vals.length > 1) {
          const before = issues.length;
          await loc.selectOption(vals[1]);
          await page.waitForTimeout(400);
          const ni = issues.slice(before);
          record(name, `select "${vals[1]}"`, 'no console errors', ni.length ? JSON.stringify(ni) : 'OK', ni.length ? 'warn' : 'ok');
        }
      } catch (e) {
        record(name, 'select', 'changes without throwing', `EXCEPTION: ${String(e.message).split('\n')[0]}`, 'warn');
      }
    }
  }

  // ============ 1. Dashboard + header chrome (tested once, shared layout) ============
  await goto('/', 'Dashboard');
  await shot('dashboard-initial');

  // Language switcher: cycle every option, end back on English.
  try {
    const langSel = page.locator('header select').last();
    const langVals = await langSel.locator('option').evaluateAll((o) => o.map((x) => x.value));
    for (const v of langVals) {
      await langSel.selectOption(v);
      await page.waitForTimeout(250);
    }
    await langSel.selectOption('en');
    record('Language switcher', `cycle through ${langVals.join(',')}`, 'UI text changes language, no errors', 'OK', 'ok');
  } catch (e) { record('Language switcher', 'cycle', 'works', `EXCEPTION: ${e.message}`, 'warn'); }

  // Acting-as picker: cycle through every demo user, end back on national_admin.
  try {
    const actingSel = page.locator('header select').first();
    const opts = await actingSel.locator('option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent })));
    for (const o of opts) {
      if (!o.v) continue;
      await actingSel.selectOption(o.v);
      await page.waitForTimeout(300);
    }
    await actingSel.selectOption('national_admin');
    await page.waitForTimeout(300);
    record('Acting-as picker', `cycle through ${opts.map((o) => o.v).join(',')}`, 'switches identity, no errors', 'OK', 'ok');
  } catch (e) { record('Acting-as picker', 'cycle', 'works', `EXCEPTION: ${e.message}`, 'warn'); }

  // Command palette (Ctrl+K button + Escape to close)
  await tryClick(page.getByRole('button', { name: /search/i }).first().or(page.locator('button[title]').filter({ has: page.locator('kbd') })).first(), 'Header: search/CommandPalette button');
  await page.waitForTimeout(300);
  const paletteVisible = await page.locator('[role="dialog"][aria-modal="true"]').isVisible().catch(() => false);
  record('Command palette', 'open via button', 'dialog appears', paletteVisible ? 'OK - opened' : 'NOT FOUND - did not open', paletteVisible ? 'ok' : 'warn', paletteVisible ? null : await shot('cmdk-not-open'));
  if (paletteVisible) {
    // type a query, arrow down, escape
    try {
      await page.keyboard.type('dashboard');
      await page.waitForTimeout(300);
      await shot('cmdk-query');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const stillVisible = await page.locator('[role="dialog"][aria-modal="true"]').isVisible().catch(() => false);
      record('Command palette', 'type query + Escape', 'closes on Escape', stillVisible ? 'STILL OPEN after Escape' : 'OK - closed', stillVisible ? 'warn' : 'ok');
    } catch (e) { record('Command palette', 'interact', 'works', `EXCEPTION: ${e.message}`, 'warn'); }
  }

  // Notification bell
  const bellBtn = page.locator('#notification-bell button').first();
  await tryClick(bellBtn, 'Header: Notification bell');
  const bellOpen = await page.locator('#notification-bell [role="dialog"]').isVisible().catch(() => false);
  record('Notification bell', 'open', 'dropdown panel appears', bellOpen ? 'OK - opened' : 'NOT FOUND', bellOpen ? 'ok' : 'warn');
  if (bellOpen) {
    const checkNowBtn = page.locator('#notification-bell').getByRole('button', { name: /check now/i });
    await tryClick(checkNowBtn, 'Notification bell: Check now');
    await tryClick(bellBtn, 'Header: Notification bell (close)');
  }

  // Tour button
  const tourBtn = page.getByRole('button', { name: /take a tour|tour/i }).first();
  const tourExists = await tourBtn.count();
  if (tourExists) {
    await tryClick(tourBtn, 'Header: Take a tour (Dashboard)');
    await page.waitForTimeout(1500);
    await shot('tour-dashboard-running');
    // Joyride overlay: try Escape to dismiss / skip
    await page.keyboard.press('Escape').catch(() => {});
    const skipBtn = page.getByRole('button', { name: /skip/i });
    if (await skipBtn.count()) await tryClick(skipBtn.first(), 'Tour: Skip button');
    await page.waitForTimeout(300);
  } else {
    record('Header: Take a tour', 'locate button', 'button present', 'NOT FOUND on Dashboard', 'warn');
  }

  // ============ 2. Dashboard body controls ============
  await goto('/', 'Dashboard (body)');

  // Crisis simulator selects, then Trigger, observe, then Reset.
  try {
    const sim = page.locator('#crisis-simulator');
    const selects = sim.locator('select');
    const n = await selects.count();
    for (let i = 0; i < n; i++) {
      const vals = await selects.nth(i).locator('option').evaluateAll((o) => o.map((x) => x.value));
      if (vals.length > 1) { await selects.nth(i).selectOption(vals[vals.length - 1]); await page.waitForTimeout(200); }
    }
    record('Crisis simulator selects', 'cycle target-type/state/district/crisis-type', 'change without error', 'OK', 'ok');
  } catch (e) { record('Crisis simulator selects', 'cycle', 'works', `EXCEPTION: ${e.message}`, 'warn'); }

  await tryClick(page.locator('#trigger-crisis-btn'), 'Trigger crisis: Simulate Outbreak', { waitAfter: 1500 });
  await shot('after-trigger-crisis');
  await tryClick(page.locator('#crisis-simulator').getByRole('button', { name: /reset/i }), 'Crisis simulator: Reset (inline)', { waitAfter: 1000 });

  // Redistribution list: Why? + Execute on the first recommendation.
  const whyBtn = page.locator('#redistribution-panel').getByRole('button', { name: /why\?/i }).first();
  if (await whyBtn.count()) {
    await tryClick(whyBtn, 'Redistribution: Why? (row 1)', { waitAfter: 1200 });
    await tryClick(whyBtn, 'Redistribution: Why? (row 1, toggle closed)');
  } else {
    record('Redistribution: Why?', 'locate', 'at least one recommendation with Why? button', 'NOT FOUND (no recs, or all pre-explained)', 'info');
  }
  const execBtn = page.locator('#redistribution-panel').getByRole('button', { name: /^execute$/i }).first();
  if (await execBtn.count()) {
    await tryClick(execBtn, 'Redistribution: Execute (row 1)', { waitAfter: 1500 });
    await shot('after-execute-transfer');
  } else {
    record('Redistribution: Execute', 'locate', 'at least one executable recommendation', 'NOT FOUND (no recs currently)', 'info');
  }

  // Alerts list: Explain on first alert
  const explainBtn = page.locator('#alerts-panel').getByRole('button', { name: /explain/i }).first();
  if (await explainBtn.count()) {
    await tryClick(explainBtn, 'Alerts: Explain (row 1)', { waitAfter: 1500 });
    await tryClick(explainBtn, 'Alerts: Explain (row 1, toggle closed)');
  } else {
    record('Alerts: Explain', 'locate', 'at least one alert', 'NOT FOUND', 'info');
  }

  // "Demo Mode" full run (scripted ~15s sequence: reset, crisis, transfer)
  const demoBtn = page.locator('#demo-mode-btn');
  if (await demoBtn.count()) {
    console.log('running Run Demo flow (~15s)...');
    await tryClick(demoBtn, 'Dashboard: Run Demo', { waitAfter: 100 });
    await page.waitForTimeout(16000);
    await shot('after-run-demo');
    record('Run Demo (#demo-mode-btn)', 'full scripted run', 'completes: reset, crisis, forecast update, transfer, refresh', 'ran to completion (see screenshot + issues log)', 'info');
  } else {
    record('Dashboard: Run Demo', 'locate', 'button present', 'NOT FOUND', 'warn');
  }

  // Reset Simulation (top banner, if an active crisis is showing) — restore clean state
  const resetBtn = page.getByRole('button', { name: /reset simulation/i }).first();
  if (await resetBtn.count()) {
    await tryClick(resetBtn, 'Dashboard: Reset Simulation (cleanup)', { waitAfter: 1500 });
  }

  // National map: click a state marker if the SVG/leaflet layer renders one
  try {
    const marker = page.locator('#national-map').locator('path, circle, .leaflet-marker-icon').first();
    if (await marker.count()) {
      await tryClick(marker, 'National map: state marker (row 1)', { waitAfter: 800 });
    } else {
      record('National map marker', 'locate', 'at least one clickable marker', 'NOT FOUND with generic selector', 'info');
    }
  } catch (e) { record('National map marker', 'click', 'works', `EXCEPTION: ${e.message}`, 'warn'); }

  // State list clickthrough -> StateView -> back
  const stateListLink = page.locator('#state-list a, #state-list button').first();
  if (await stateListLink.count()) {
    const before = issues.length;
    await stateListLink.click().catch((e) => record('State list: first row', 'click', 'navigates to state view', `EXCEPTION: ${e.message}`, 'warn'));
    await page.waitForTimeout(800);
    const url = page.url();
    record('State list: first row', 'click', 'navigates to /states/:state', url.includes('/states/') ? `OK -> ${url}` : `unexpected URL: ${url}`, url.includes('/states/') ? 'ok' : 'warn');
  }

  // Generic sweep of anything left on the Dashboard not explicitly covered
  await goto('/', 'Dashboard (generic sweep)');
  await genericSweep(['Simulate Outbreak', 'Reset Simulation', 'Reset', 'Run Demo', 'Why?', 'Execute', 'Explain', 'Take a tour', 'Check now', 'Mark all', 'Sign out']);

  // ============ 3. StateView ============
  await goto(`/states/${encodeURIComponent(STATE)}`, 'StateView');
  await shot('stateview-initial');
  const phcRowLink = page.locator('#state-phc-table a').first();
  if (await phcRowLink.count()) {
    const href = await phcRowLink.getAttribute('href');
    await phcRowLink.click().catch((e) => record('StateView PHC table: first row', 'click', 'navigates to /phcs/:id', `EXCEPTION: ${e.message}`, 'warn'));
    await page.waitForTimeout(600);
    record('StateView PHC table: first row', 'click', `navigates to ${href}`, page.url().includes('/phcs/') ? `OK -> ${page.url()}` : `unexpected URL ${page.url()}`, page.url().includes('/phcs/') ? 'ok' : 'warn');
    await page.goBack();
    await page.waitForTimeout(500);
  } else {
    record('StateView PHC table', 'locate rows', 'at least one PHC row', 'NOT FOUND (empty state?)', 'warn', await shot('stateview-empty'));
  }
  await tryClick(page.locator('#state-header a'), 'StateView: back-to-dashboard link');
  await goto(`/states/${encodeURIComponent(STATE)}`, 'StateView (generic sweep)');
  await genericSweep(['Take a tour']);

  // ============ 4. PHCDetail ============
  await goto(`/phcs/${PHC_ID}`, 'PHCDetail');
  await shot('phcdetail-initial');
  await genericSweep(['Take a tour']); // exercises the medicine <select> too
  await tryClick(page.locator('#phc-header a'), 'PHCDetail: back-to-state link');

  // ============ 5. MedicineStateDetail ============
  await goto(`/medicines/${encodeURIComponent(MEDICINE)}/states/${encodeURIComponent(STATE)}`, 'MedicineStateDetail');
  await shot('medstatedetail-initial');
  const viewBtn = page.locator('#med-phc-list').getByRole('button', { name: /^view$/i }).first();
  if (await viewBtn.count()) {
    await tryClick(viewBtn, 'MedicineStateDetail: View (row 1)', { waitAfter: 1000 });
    await shot('medstatedetail-after-view');
  } else {
    record('MedicineStateDetail: View', 'locate', 'at least one PHC row', 'NOT FOUND', 'warn');
  }
  await tryClick(page.locator('#med-header a'), 'MedicineStateDetail: back-to-dashboard link');

  // ============ 6. Explore ============
  await goto('/explore', 'Explore');
  await shot('explore-initial');
  await genericSweep(['Take a tour']);

  // ============ 7. Federated ============
  await goto('/federated', 'Federated');
  await shot('federated-initial');
  await tryClick(page.getByRole('button', { name: /show raw data/i }), 'Federated: Show Raw Data toggle', { waitAfter: 500 });
  await shot('federated-raw-mode');
  await tryClick(page.getByRole('button', { name: /aggregated only/i }), 'Federated: Aggregated Only toggle', { waitAfter: 500 });
  await genericSweep(['Take a tour', 'Aggregated Only', 'Show Raw Data']);

  // ============ 8. Transfers ============
  await goto('/transfers', 'Transfers');
  await shot('transfers-initial');
  await tryClick(page.locator('#transfers-refresh'), 'Transfers: Refresh', { waitAfter: 1000 });
  const fhirBtn = page.locator('#transfers-table').getByRole('button', { name: /fhir/i }).first();
  if (await fhirBtn.count()) {
    await tryClick(fhirBtn, 'Transfers: FHIR R4 export (row 1)', { waitAfter: 1500 });
  } else {
    record('Transfers: FHIR export', 'locate', 'at least one transfer row', 'NOT FOUND (no transfers in ledger)', 'info');
  }
  await genericSweep(['Take a tour', 'Refresh', 'FHIR']);

  // ============ 9. Assistant ============
  await goto('/assistant', 'Assistant');
  await shot('assistant-initial');
  try {
    const stateSel = page.locator('#assistant-header select');
    const vals = await stateSel.locator('option').evaluateAll((o) => o.map((x) => x.value));
    if (vals.length > 1) { await stateSel.selectOption(vals[1]); await page.waitForTimeout(300); }
    record('Assistant: state filter select', 'change', 'changes without error', 'OK', 'ok');
  } catch (e) { record('Assistant: state filter select', 'change', 'works', `EXCEPTION: ${e.message}`, 'warn'); }
  await page.fill('#assistant-input', 'Which medicines are critical right now?').catch((e) => record('Assistant: input', 'fill', 'fills text', `EXCEPTION: ${e.message}`, 'warn'));
  const sendBtn = page.getByRole('button', { name: /^send$/i });
  await tryClick(sendBtn, 'Assistant: Send', { waitAfter: 3000 });
  await shot('assistant-after-send');
  const micBtn = page.locator('#assistant-mic');
  if (await micBtn.count()) {
    await tryClick(micBtn, 'Assistant: Mic button', { waitAfter: 500 });
  } else {
    record('Assistant: Mic button', 'locate', 'renders if SpeechRecognition supported', 'NOT RENDERED (SpeechRecognition unsupported in this browser/env)', 'info');
  }

  // ============ 10. Public portal ============
  await goto('/public', 'PublicPortal');
  await shot('publicportal-initial');
  await tryClick(page.getByRole('button', { name: /explore.*map|view.*map/i }).first(), 'PublicPortal: scroll-to-map CTA', { waitAfter: 800 });
  const consoleLink = page.getByRole('link', { name: /officer console|console/i }).first();
  if (await consoleLink.count()) {
    const before = page.url();
    await consoleLink.click().catch(() => {});
    await page.waitForTimeout(500);
    record('PublicPortal: "Officer console" link', 'click', 'navigates to / (console)', page.url() !== before ? `OK -> ${page.url()}` : 'URL unchanged', page.url() !== before ? 'ok' : 'warn');
    await page.goBack(); await page.waitForTimeout(400);
  }
  const mapMarker = page.locator('#public-map').locator('path, circle, .leaflet-marker-icon').first();
  if (await mapMarker.count()) {
    await tryClick(mapMarker, 'PublicPortal: map state marker', { waitAfter: 800 });
    if (page.url().includes('/public/states/')) { await page.goBack(); await page.waitForTimeout(400); }
  } else {
    record('PublicPortal map marker', 'locate', 'at least one clickable marker', 'NOT FOUND with generic selector', 'info');
  }
  await genericSweep(['Take a tour', 'Officer console']);

  // ============ 11. PublicStateDetail ============
  await goto(`/public/states/${encodeURIComponent(STATE)}`, 'PublicStateDetail');
  await shot('publicstatedetail-initial');
  await genericSweep(['Take a tour']);
  await tryClick(page.getByRole('link', { name: /back/i }).first(), 'PublicStateDetail: back link');

  // ============ 12. 404 / bad dynamic-route param probes ============
  curPage = 'Bad-route-probes';
  for (const [url, label] of [
    [`/states/${encodeURIComponent('Nonexistent State')}`, 'StateView with bogus state'],
    ['/phcs/PHC-DOES-NOT-EXIST', 'PHCDetail with bogus id'],
    [`/medicines/${encodeURIComponent('Nonexistent Medicine')}/states/${encodeURIComponent(STATE)}`, 'MedicineStateDetail with bogus medicine'],
    [`/public/states/${encodeURIComponent('Nonexistent State')}`, 'PublicStateDetail with bogus state'],
    ['/this-route-does-not-exist', 'Unknown top-level route'],
  ]) {
    const before = issues.length;
    await goto(url, label);
    await shot(label);
    const ni = issues.slice(before);
    record(label, 'goto', 'graceful empty/error state, no crash', ni.length ? JSON.stringify(ni) : 'OK - no console errors, page rendered', ni.length ? 'warn' : 'ok');
  }

  await browser.close();
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ findings, issues, downloads }, null, 2));
  console.log('\n\n=== DONE ===');
  console.log('findings:', findings.length, ' issues:', issues.length, ' downloads:', downloads.length);
})().catch((e) => {
  console.error('FATAL', e);
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ findings, issues, downloads, fatal: String(e) }, null, 2));
  process.exit(1);
});
