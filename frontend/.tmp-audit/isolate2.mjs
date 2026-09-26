import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('crash', () => console.log('PAGE CRASHED'));
  page.on('dialog', async d => { console.log('dialog:', d.message()); await d.dismiss().catch(()=>{}); });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  const sel = 'button:visible, [role="button"]:visible';
  const count = await page.locator(sel).count();
  console.log('total buttons:', count);
  for (let i = 0; i < count; i++) {
    if (page.isClosed()) { console.log('PAGE ALREADY CLOSED before index', i); break; }
    const loc = page.locator(sel).nth(i);
    let text = '';
    try { text = (await loc.innerText({timeout:500})).trim().slice(0,40); } catch {}
    try {
      await loc.click({ timeout: 3000 });
      console.log(i, JSON.stringify(text), '-> clicked ok, page closed?', page.isClosed());
    } catch (e) {
      console.log(i, JSON.stringify(text), '-> CLICK FAILED:', e.message.split('\n')[0]);
      if (page.isClosed()) { console.log('PAGE CLOSED after index', i, 'control was', JSON.stringify(text)); break; }
    }
  }
  console.log('LOOP DONE, closed?', page.isClosed());
  await browser.close().catch(()=>{});
})().catch(e => console.log('ERR', e.message));
