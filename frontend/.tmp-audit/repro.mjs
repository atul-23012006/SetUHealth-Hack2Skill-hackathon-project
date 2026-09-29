import { chromium } from '@playwright/test';
for (const mode of ['direct-load','via-nav-click','direct-load-again']) {
  const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const p=await b.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  if(mode==='via-nav-click'){await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);await p.locator('a[href="/insights"]').first().click();}
  else await p.goto('http://localhost:5173/insights',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  const btn=p.getByRole('button',{name:/show states/i}).first();
  let clicked='n/a'; try{await btn.click({timeout:4000});clicked='ok'}catch(e){clicked='FAILED'}
  await p.waitForTimeout(2500);
  console.log(mode,'| first-click:',clicked,'| pageerrors:',JSON.stringify(errs),'| main text:',JSON.stringify((await p.locator('main').innerText().catch(()=>'')).slice(0,60)));
  await b.close();
}
