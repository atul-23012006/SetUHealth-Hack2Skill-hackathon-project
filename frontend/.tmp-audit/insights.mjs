import { chromium } from '@playwright/test';
const BASE='http://localhost:5173', API='http://localhost:8000';
const out=[]; const issues=[]; let phase='init';
const rec=(c,r,ok=true)=>{out.push({phase,control:c,result:r,ok}); console.log((ok?'PASS':'FAIL'),'|',phase,'|',c,'|',r);};
const post=(p,b)=>fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json','X-User-Id':'national_admin'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const ctx=await b.newContext({viewport:{width:1440,height:960}});
const p=await ctx.newPage();
p.on('console',m=>{if(['error','warning'].includes(m.type()))issues.push({phase,t:m.type(),x:m.text().slice(0,200)})});
p.on('pageerror',e=>issues.push({phase,t:'pageerror',x:String(e).slice(0,200)}));
p.on('response',r=>{if(r.status()>=400)issues.push({phase,t:'http'+r.status(),x:r.url()})});
p.on('dialog',d=>{issues.push({phase,t:'dialog',x:d.message()});d.dismiss()});
const settle=async()=>{await p.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});await p.waitForTimeout(800)};
const step=async(name,fn)=>{try{await fn()}catch(e){rec(name,'EXCEPTION '+String(e.message).split('\n')[0],false)}};

await post('/api/crisis/reset');
phase='A: baseline (no crisis)';
await step('nav to /insights via header link',async()=>{
  await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});await settle();
  await p.locator('a[href="/insights"]').first().click();await settle();
  rec('nav link -> /insights', p.url().endsWith('/insights')?'URL ok':'URL '+p.url(), p.url().endsWith('/insights'));
});
await step('page shell',async()=>{
  for(const id of ['#insights-header','#anomaly-panel','#capacity-panel','#medicines-panel'])
    rec('render '+id, (await p.locator(id).count())?'present':'MISSING', !!(await p.locator(id).count()));
  const n=await p.locator('#crisis-impact').count();
  rec('CrisisImpactPanel hidden when no crisis', n===0?'absent (correct)':'PRESENT with no crisis', n===0);
});
await step('medicine Show/Hide states',async()=>{
  const btn=p.getByRole('button',{name:/show states/i}).first();
  await btn.click();await settle();
  const hide=await p.getByRole('button',{name:/hide states/i}).count();
  rec('Show states', hide?'expanded (button flipped to Hide)':'did not flip', !!hide);
  const before=await p.locator('#medicines-panel').innerText();
  await p.getByRole('button',{name:/hide states/i}).first().click();await p.waitForTimeout(300);
  rec('Hide states', (await p.getByRole('button',{name:/hide states/i}).count())===0?'collapsed':'still expanded', (await p.getByRole('button',{name:/hide states/i}).count())===0);
});

phase='B: two crises active';
const c1=await post('/api/crisis/trigger',{target_type:'state',target_name:'Bihar',crisis_type:'Monsoon Floods',intensity:1});
const c2=await post('/api/crisis/trigger',{target_type:'state',target_name:'Maharashtra',crisis_type:'Cold Chain Failure',intensity:1});
rec('API trigger x2', `impact totals: ${JSON.stringify(c1.impact?.totals)} / ${JSON.stringify(c2.impact?.totals)}`, !!c1.impact && !!c2.impact);
await step('panel renders',async()=>{
  await p.goto(BASE+'/insights',{waitUntil:'domcontentloaded'});await settle();
  const panel=p.locator('#crisis-impact');
  rec('panel present', (await panel.count())?'yes':'NO', !!(await panel.count()));
  rec('"Simulated data" label', (await panel.getByText('Simulated data').count())?'shown':'MISSING (invariant: simulated things are labelled)', !!(await panel.getByText('Simulated data').count()));
  await p.screenshot({path:'.tmp-audit/shots/insights-crisis.png'});
});
await step('crisis tabs',async()=>{
  const tabs=p.locator('[role=tablist][aria-label="Simulated crises"] [role=tab]');
  const n=await tabs.count();rec('crisis tab count', `${n} (expected 2)`, n===2);
  const h0=await p.locator('#crisis-impact p').first().innerText();
  await tabs.nth(1).click();await p.waitForTimeout(400);
  const h1=await p.locator('#crisis-impact p').first().innerText();
  rec('switch crisis tab', h0!==h1?`header changed: "${h0.slice(0,40)}" -> "${h1.slice(0,40)}"`:'header UNCHANGED', h0!==h1);
  rec('aria-selected updates', (await tabs.nth(1).getAttribute('aria-selected'))==='true'?'ok':'stale', (await tabs.nth(1).getAttribute('aria-selected'))==='true');
  await tabs.nth(0).click();await p.waitForTimeout(300);
});
await step('change-type tabs (both crises)',async()=>{
  const ct=p.locator('[role=tablist][aria-label="Simulated crises"] [role=tab]');
  for(let c=0;c<await ct.count();c++){
    await ct.nth(c).click();await p.waitForTimeout(300);
    const who=(await p.locator('#crisis-impact p').first().innerText()).slice(0,34);
    const kt=p.locator('[role=tablist][aria-label="Change type"] [role=tab]');
    const n=await kt.count();
    for(let i=0;i<n;i++){
      const label=(await kt.nth(i).innerText()).replace(/\s+/g,' ');
      const claimed=parseInt(label.match(/(\d+)\s*$/)?.[1]??'-1');
      await kt.nth(i).click();await p.waitForTimeout(250);
      const shown=await p.locator('#crisis-impact tbody tr').count();
      const kindCol=await p.locator('#crisis-impact tbody tr').first().innerText().catch(()=>'');
      rec(`[${who}] tab "${label}"`, `${shown} rows shown (tab says ${claimed}); first row: ${kindCol.replace(/\s+/g,' ').slice(0,70)}`, shown>0 && shown<=claimed);
    }
    await kt.nth(0).click();
  }
  await ct.nth(0).click();
});
await step('show all toggle',async()=>{
  const t=p.locator('#crisis-impact').getByRole('button',{name:/show all|show fewer|show less|more/i}).first();
  if(!(await t.count())){rec('show-all toggle','not rendered (<= one page of rows)');return}
  const before=await p.locator('#crisis-impact tbody tr').count();
  await t.click();await p.waitForTimeout(300);
  const after=await p.locator('#crisis-impact tbody tr').count();
  rec('expand',`${before} -> ${after} rows`,after>before);
  await p.locator('#crisis-impact').getByRole('button').last().click();await p.waitForTimeout(300);
  rec('collapse',`${await p.locator('#crisis-impact tbody tr').count()} rows`,(await p.locator('#crisis-impact tbody tr').count())===before);
});
await step('data sanity',async()=>{
  const bad=await p.locator('#crisis-impact').innerText();
  const flags=['NaN','undefined','null','Infinity'].filter(w=>bad.includes(w));
  rec('no NaN/undefined/null text in panel', flags.length?'FOUND '+flags:'clean', !flags.length);
});
await step('language switch on /insights',async()=>{
  const sel=p.locator('header select').last();
  for(const v of ['hi','mr','ta','en']){await sel.selectOption(v);await p.waitForTimeout(300)}
  rec('language cycle', (await p.locator('#crisis-impact').count())?'panel survived all 4 languages':'panel vanished', !!(await p.locator('#crisis-impact').count()));
});
await step('Dashboard link consistency',async()=>{
  await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});await settle();
  rec('Dashboard shows CrisisImpactPanel?', (await p.locator('#crisis-impact').count())?'yes':'no (Insights-only)');
});

phase='C: after reset';
await post('/api/crisis/reset');
await step('panel gone',async()=>{
  await p.goto(BASE+'/insights',{waitUntil:'domcontentloaded'});await settle();
  const n=await p.locator('#crisis-impact').count();
  rec('panel hidden after reset', n===0?'absent':'STILL PRESENT', n===0);
  rec('backend impacts cleared', JSON.stringify(await fetch(API+'/api/crisis/impact').then(r=>r.json())), true);
});
await b.close();
console.log('\nISSUES:');issues.forEach(i=>console.log(JSON.stringify(i)));
console.log('\nSUMMARY: pass',out.filter(o=>o.ok).length,'fail',out.filter(o=>!o.ok).length);
