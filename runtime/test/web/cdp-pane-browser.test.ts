import { test, expect } from 'bun:test';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const binary = process.env.PICLAW_TEST_CHROMIUM;
(binary ? test : test.skip)('shared pane scales frames, maps input and fits tablet/light/dark layouts', async () => {
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../../web/src/panes/cdp-pane.ts')], target: 'browser', format: 'esm' });
  expect(built.success).toBe(true);
  const script = await built.outputs[0].text();
  const received: any[] = [];
  const server = Bun.serve({ port: 0, fetch(req, server) {
    const path = new URL(req.url).pathname;
    if (path === '/cdp-view/ws') { if (server.upgrade(req)) return; }
    if (path === '/skin.css') {
      const skin = new URL(req.url).searchParams.get('skin') === 'modern' ? 'visual' : 'classic';
      return new Response(readFileSync(resolve(import.meta.dir, `../../web/static/${skin}/dist/app.bundle.css`)), { headers: { 'Content-Type': 'text/css' } });
    }
    if (path === '/pane.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    return new Response('<html><head><link rel="stylesheet" href="/skin.css?skin='+new URL(req.url).searchParams.get('skin')+'"></head><body style="margin:0"><div id="host" style="height:100vh"></div><script type="module">import {cdpPaneExtension} from "/pane.js";window.pane=cdpPaneExtension.mount(document.querySelector("#host"),{path:"piclaw://cdp-view",mode:"view"});</script></body></html>', { headers: { 'Content-Type': 'text/html' } });
  }, websocket: { open(ws) { ws.send(JSON.stringify({ type: 'tabs', sources: [{ id: 'fixture', label: 'Fixture', tabs: [{ id: 'tab', title: 'Test', url: 'about:blank' }] }] })); }, message(ws, raw) {
    const msg = JSON.parse(String(raw)); received.push(msg);
    if (msg.type === 'control') ws.send(JSON.stringify({ type: 'control', enabled: msg.enabled }));
    if (msg.type === 'attach') ws.send(JSON.stringify({ type: 'status', state: 'connected' }));
  } } });
  const browser = await chromium.launch({ executablePath: binary!, headless: true, args: ['--no-sandbox'] });
  try {
    for (const skin of ['classic', 'modern']) for (const [width, height, scheme] of [[1200, 800, 'light'], [1200, 800, 'dark'], [768, 1024, 'light'], [768, 1024, 'dark']] as const) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, hasTouch: width === 768 });
      await page.goto(`http://127.0.0.1:${server.port}/?skin=${skin}`);
      await page.evaluate(light => { document.documentElement.classList.toggle('light', light); document.body.classList.toggle('light', light); }, scheme === 'light');
      await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent === 'Live — scale to fit');
      await page.evaluate(() => { const pane = (window as any).pane; pane.image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="blue"/></svg>'); pane.viewport = { width: 1600, height: 900 }; });
      await page.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).naturalWidth === 1600);
      const area = await page.locator('[data-area]').boundingBox(); expect(area).toBeTruthy();
      await page.mouse.click(area!.x + area!.width / 2, area!.y + area!.height / 2);
      expect(received.filter(m => m.type === 'input')).toHaveLength(0);
      await page.getByRole('button', { name: 'Take control' }).click();
      await page.getByRole('button', { name: 'Release control' }).waitFor();
      await page.mouse.click(area!.x + area!.width / 2, area!.y + area!.height / 2);
      await page.waitForTimeout(50);
      const mouse = received.filter(m => m.type === 'input' && m.kind === 'mouse').at(-1); expect(mouse.x).toBeCloseTo(800, 0); expect(mouse.y).toBeCloseTo(450, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 768) {
        await page.touchscreen.tap(area!.x + area!.width / 2, area!.y + area!.height / 2);
        await page.waitForTimeout(30);
        expect(received.some(m => m.kind === 'touch' && m.event === 'touchEnd')).toBe(true);
      }
      page.once('dialog', dialog => dialog.accept());
      await page.getByLabel('Resize browser to pane').check();
      await page.waitForTimeout(250);
      expect(received.some(m => m.type === 'resize' && m.enabled === true)).toBe(true);
      await page.getByLabel('Resize browser to pane').uncheck();
      expect(received.some(m => m.type === 'resize' && m.enabled === false)).toBe(true);
      await page.keyboard.down('Shift');
      await page.getByRole('textbox', { name: 'Type into browser' }).click();
      await page.waitForTimeout(30);
      expect(received.some(m => m.type === 'release-input')).toBe(true);
      await page.keyboard.up('Shift');
      if (process.env.PICLAW_CDP_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PICLAW_CDP_SCREENSHOT_DIR}/cdp-${skin}-${width}-${scheme}.png` });
      await page.evaluate(() => (window as any).pane.dispose()); await page.close(); received.length = 0;
    }
  } finally { await browser.close(); server.stop(true); }
}, 30000);
