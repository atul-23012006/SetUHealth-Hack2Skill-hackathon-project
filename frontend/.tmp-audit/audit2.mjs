import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5173';
const SHOT_DIR = path.join(__dirname, 'shots');
const REPORT_PATH = path.join(__dirname, 'report2.json');
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

  // A control that opens a full-screen modal (CommandPalette, etc.) correctly
  // blocks the rest of the page underneath it — but a blind sweep that doesn't
  // know to close it first will then time out on every remaining control,
  // one by one. Closing any open modal after every click keeps the sweep
  // moving and turns "stuck behind a modal" into one clear, fast finding.
  async function blockingOverlayVisible() {
    const modal = page.locator('[role="dialog"][aria-modal="true"], .react-joyride__overlay, [class*="joyride"]');
    return modal.first().isVisible({ timeout: 300 }).catch(() => false);
  }

  // Unconditional Escape after every click: harmless if nothing is open, and
  // it's the one thing that closes both the ARIA modal (CommandPalette) and
  // the non-ARIA Joyride tour overlay, which don't share a selector.
  async function closeAnyModal(label) {
    if (!(await blockingOverlayVisible())) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    if (await blockingOverlayVisible()) {
      const skipBtn = page.getByRole('button', { name: /skip/i }).first();
      if (await skipBtn.count()) await skipBtn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    const stillOpen = await blockingOverlayVisible();
    record(label, 'auto-close overlay opened by this control', 'Escape (or Skip) closes it', stillOpen ? 'STILL OPEN after Escape+Skip' : 'OK - closed', stillOpen ? 'warn' : 'info');
  }

  async function tryClick(locator, label, { waitAfter = 500 } = {}) {
    const before = issues.length;
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await locator.click({ timeout: 2500 });
    } catch (e) {
      record(label, 'click', 'clicks without throwing', `EXCEPTION: ${String(e.message).split('\n')[0]}`, 'warn');
      return false;
    }
    await page.waitForTimeout(waitAfter);
    await closeAnyModal(label);
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

  // (Dashboard header-chrome + body controls already verified in the prior run; see report.json from that run.)
  // Retry just the Dashboard generic sweep that crashed the browser last time, now with hardened launch flags.
  await goto('/', 'Dashboard (generic sweep, retry)');
  await genericSweep(['Simulate Outbreak', 'Reset Simulation', 'Reset', 'Run Demo', 'Why?', 'Execute', 'Explain', 'Take the tour', 'Check now', 'Mark all', 'Sign out']);

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
  await genericSweep(['Take the tour']);

  // ============ 4. PHCDetail ============
  await goto(`/phcs/${PHC_ID}`, 'PHCDetail');
  await shot('phcdetail-initial');
  await genericSweep(['Take the tour']); // exercises the medicine <select> too
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
  await genericSweep(['Take the tour']);

  // ============ 7. Federated ============
  await goto('/federated', 'Federated');
  await shot('federated-initial');
  await tryClick(page.getByRole('button', { name: /show raw data/i }), 'Federated: Show Raw Data toggle', { waitAfter: 500 });
  await shot('federated-raw-mode');
  await tryClick(page.getByRole('button', { name: /aggregated only/i }), 'Federated: Aggregated Only toggle', { waitAfter: 500 });
  await genericSweep(['Take the tour', 'Aggregated Only', 'Show Raw Data']);

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
  await genericSweep(['Take the tour', 'Refresh', 'FHIR']);

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
  await genericSweep(['Take the tour', 'Officer console']);

  // ============ 11. PublicStateDetail ============
  await goto(`/public/states/${encodeURIComponent(STATE)}`, 'PublicStateDetail');
  await shot('publicstatedetail-initial');
  await genericSweep(['Take the tour']);
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
