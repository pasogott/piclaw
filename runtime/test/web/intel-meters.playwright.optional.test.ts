import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const root = resolve(import.meta.dir, '../..');
const run = enabled ? test : test.skip;
run('Intel meters hide absent GPUs and expose accessible details on desktop/tablet', async () => {
 const tmp = await mkdtemp(join(tmpdir(),'intel-meter-browser-'));
 let browser;let server;
 try {
  const vendor=resolve(root,'web/src/vendor/preact-htm.js');
  const component=resolve(root,'web/src/components/system-meters-hud.ts');
  const entry=join(tmp,'entry.ts');
  await Bun.write(entry,`import {html,render} from ${JSON.stringify(vendor)};import {SystemMetersHud} from ${JSON.stringify(component)};localStorage.setItem('piclaw_system_meters_enabled','true');render(html\`<\${SystemMetersHud}/>\`,document.getElementById('root'));`);
  const build=await Bun.build({entrypoints:[entry],outdir:tmp,target:'browser',format:'esm'});expect(build.success).toBe(true);
  const gpu={id:'0000:00:02.0',name:'Intel Iris Xe',provider:'intel-drm-fdinfo',driver:'i915',status:'partial',sample_time_ms:Date.now(),busy_percent:63,engines:[{name:'render',capacity:1,busy_percent:63},{name:'video',capacity:2,busy_percent:0}],memory:{resident_bytes:677*1024**2,total_bytes:800*1024**2,shared_bytes:null},coverage:{clients:3,scanned_processes:90,unreadable_processes:1,unreadable_clients:0,truncated:false},history:[{timestamp_ms:Date.now()-2000,busy_percent:null,resident_bytes:null},{timestamp_ms:Date.now(),busy_percent:63,resident_bytes:677*1024**2}]};
  let devices:any[]=[];
  const base={cpu_percent:24,ram_percent:46,cpu_series:[20,24],ram_series:[40,46],swap_percent:null,swap_total_bytes:0};
  const css=await Bun.file(resolve(root,'web/static/classic/css/shell.css')).text();
  server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const p=new URL(req.url).pathname;if(p==='/agent/system-metrics')return Response.json({...base,gpus:devices});if(p==='/agent/ui-state')return Response.json({});if(p==='/entry.js')return new Response(Bun.file(join(tmp,'entry.js')),{headers:{'content-type':'text/javascript'}});return new Response(`<html><head><style>:root{--bg-primary:#111720;--text-primary:#edf3fc;--text-secondary:#a9b5c7;--border-color:#364254;--accent-color:#71a8ff;--success-color:#58c7a5}body{background:#111720;color:white;font:14px sans-serif;margin:0} ${css}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`,{headers:{'content-type':'text/html'}})}});
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1100,height:850}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('piclaw_system_meters_enabled','true');localStorage.setItem('piclaw_system_meters_collapsed','false');});
  await page.goto(server.url.toString());
  // Set the authoritative storage keys from the real UI module through the fixture if necessary.
  await page.waitForTimeout(100);
  expect(await page.locator('.intel-gpu').count()).toBe(0);expect(await page.locator('.system-meters-gpu-trigger').count()).toBe(0);
  devices=[gpu];await page.reload();
  await page.locator('.system-meters-row.intel-gpu').waitFor({timeout:8000});
  expect(await page.locator('.system-meters-row.intel-gpu').innerText()).toContain('63%');
  await page.locator('.system-meters-row.intel-gpu').click();await page.getByRole('dialog').waitFor();
  expect(await page.getByRole('dialog').innerText()).toContain('best-effort');expect(await page.getByRole('dialog').innerText()).toContain('677');
  expect(await page.locator('button button').count()).toBe(0);
  await page.keyboard.press('Escape');expect(await page.getByRole('dialog').count()).toBe(0);
  await page.setViewportSize({width:390,height:850});
  await page.getByRole('button',{name:'GPU* details',exact:true}).click();await page.getByRole('dialog').waitFor();
  const rect=await page.getByRole('dialog').boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  devices=[{...gpu,busy_percent:null,status:'unavailable',memory:{resident_bytes:null},coverage:{clients:0},engines:[]}];await page.reload();
  await page.getByRole('button',{name:'GPU* details',exact:true}).waitFor();expect(await page.locator('.system-meters-compact-summary').innerText()).toContain('GPU* —');
  expect(errors).toEqual([]);
 } finally {await browser?.close();server?.stop(true);await rm(tmp,{recursive:true,force:true})}
},30000);
