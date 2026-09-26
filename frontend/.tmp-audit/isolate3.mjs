import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('crash', () => console.log('PAGE CRASHED (event)'));
  page.on('dialog', async d => { console.log('dialog:', d.message()); await d.dismiss().catch(()=>{}); });
  page.on('console', m => { if (m.type()==='error') console.log('console-error:', m.text().slice(0,150)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch { console.log('networkidle timed out (ok, continuing)'); }
  await page.waitForTimeout(5000);
  const sel = 'button:visible, [role="button"]:visible';
  const count = await page.locator(sel).count();
  console.log('total buttons:', count);
  for (let i = 0; i < count; i++) {
    if (page.isClosed()) { console.log('PAGE ALREADY CLOSED before index', i); break; }
    const loc = page.locator(sel).nth(i);
    let text = '';
    try { text = (await loc.innerText({timeout:500})).trim().slice(0,40); } catch {}
    try {
      await loc.scrollIntoViewIfNeeded({timeout:2000}).catch(()=>{});
      await loc.click({ timeout: 4000 });
      console.log(i, JSON.stringify(text), '-> ok');
    } catch (e) {
      console.log(i, JSON.stringify(text), '-> FAILED:', e.message.split('\n')[0]);
      if (page.isClosed()) { console.log('*** PAGE CLOSED after index', i, 'control:', JSON.stringify(text), '***'); break; }
    }
    await page.waitForTimeout(300);
  }
  console.log('LOOP DONE, closed?', page.isClosed());
  await browser.close().catch(()=>{});
})().catch(e => console.log('ERR', e.message));
