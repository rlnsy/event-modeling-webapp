const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
const browser=await chromium.launch();
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.ROUTING_TEST_URL || 'http://127.0.0.1:8082');
await page.locator('#paneToggle').click();
const model=JSON.parse(fs.readFileSync(path.join(__dirname, '../prototype/crowded.json'),'utf8'));
await page.locator('#input').fill(JSON.stringify(model));
async function check(label, count = 11) {
 await page.waitForFunction(count=>document.querySelectorAll('.flow-line').length===count,count,{timeout:20000});
 assert.equal(await page.locator('#routingStats, .routing-stats').count(),0);
 const result=await page.evaluate(()=>{
 const row=document.querySelector('.preview-row'), origin=row.getBoundingClientRect();
 const boxes=[...row.querySelectorAll('[data-el-id]')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x-origin.x,y:r.y-origin.y,w:r.width,h:r.height};});
 const paths=[...row.querySelectorAll('.flow-line')].map(p=>[...p.getAttribute('d').matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m=>({x:+m[1],y:+m[2]})));
 return {paths,boxes,conflicts:paths.flatMap((p,i)=>paths.slice(i+1).filter(q=>ConnectorRouting.conflicts(p,q))).length,
 intersections:paths.flatMap(p=>p.slice(1).flatMap((b,i)=>boxes.filter(box=>ConnectorRouting.intersects(p[i],b,box)))).length,
 markers:[...row.querySelectorAll('.flow-line')].every(p=>p.getAttribute('marker-end')==='url(#flow-tip)')};
 });
 assert.equal(result.paths.length,count);assert.equal(result.conflicts,0);assert.equal(result.intersections,0);assert.ok(result.markers);
 for(const p of result.paths) assert.ok(Math.hypot(p.at(-1).x-p.at(-2).x,p.at(-1).y-p.at(-2).y)>=16);
 console.log(label,result.paths.length+' routed connections');
 return result;
}
await check('crowded');

await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(200);await check('resize');
model.slices[0].events[1].fields.push(...Array.from({length:10},(_,i)=>({name:'extra'+i,type:'String',generated:true})));
await page.locator('#input').fill(JSON.stringify(model));await page.waitForTimeout(250);await check('card growth');

// A compressed layout must recover by expanding global lane spacing.
await page.evaluate(() => {
 const row=document.querySelector('.preview-row');
 row.dataset.routingLevel='0';row.style.setProperty('--routing-lane-gap','0px');
 window.dispatchEvent(new Event('resize'));
});
await page.waitForFunction(()=>Number(document.querySelector('.preview-row').dataset.routingLevel)>0);
await check('global spacing recovery');
// Prevent expansion to exercise explicit omissions while preserving valid lines.
await page.addStyleTag({content: '.slice-column { gap: 0px !important; }'});
await page.waitForFunction(()=>Number(document.querySelector('.preview-row').dataset.routingLevel)===2 && document.querySelector('svg.flow-lines') && document.querySelectorAll('.flow-line').length<11);
await check('infeasible layout', await page.locator('.flow-line').count());
await page.locator('#input').fill(JSON.stringify({slices:[]}));await page.waitForTimeout(300);
assert.equal(await page.locator('.flow-line').count(),0);assert.equal(await page.locator('#routingStats, .routing-stats').count(),0);
assert.deepEqual(errors,[]);console.log('empty model clears routes; no browser errors');
}finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
