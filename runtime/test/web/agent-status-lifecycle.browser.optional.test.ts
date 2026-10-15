import { afterAll, beforeAll, expect, test } from 'bun:test';
import { build } from 'esbuild';
import { chromium, webkit, type Browser } from 'playwright';
import { manualCompactionBackend } from './fixtures/manual-compaction-backend.js';
import { join } from 'node:path';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
let backend = manualCompactionBackend();
beforeAll(async () => {
  if (!enabled) return;
  const baseline = process.env.PICLAW_STATUS_BASELINE;
  const plugins = baseline ? [{ name: 'status-baseline', setup(builder: any) {
    builder.onLoad({ filter: /\/web\/src\/ui\/(agent-ui-snapshot|app-agent-status-lifecycle|app-agent-status-orchestration|app-connection-lifecycle)\.ts$/ }, async (args: any) => {
      const relative = args.path.slice(join(import.meta.dir, '../..').length + 1);
      const result = Bun.spawnSync(['git', 'show', `${baseline}:runtime/${relative}`], { cwd: join(import.meta.dir, '../../..') });
      if (result.exitCode !== 0) throw Error(result.stderr.toString());
      return { contents: result.stdout.toString(), loader: 'ts', resolveDir: join(args.path, '..') };
    });
  } }] : [];
  const built = await build({ plugins, entryPoints: [join(import.meta.dir, 'fixtures/agent-status-lifecycle-fixture.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const result = await backend.fetch(request);
    if (result) return result;
    if (new URL(request.url).pathname === '/fixture.js') return new Response(built.outputFiles[0].contents, { headers: { 'content-type': 'text/javascript' } });
    return new Response('<!doctype html><main id="app"></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  browser = await (process.env.PICLAW_STATUS_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); backend.cleanup(); });

browserTest('real status hook fences disconnect ABA and reconnect starts a separate fresh refresh', async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean((window as any).statusLifecycleFixture));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 1);
    await page.evaluate(() => (window as any).statusLifecycleFixture.connection('disconnected'));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    expect(await page.evaluate(() => (window as any).statusLifecycleFixture.count())).toBe(1);
    await page.evaluate(() => (window as any).statusLifecycleFixture.connection('connected'));
    // The old request is still unresolved. Joining it would prevent recovery.
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 2, undefined, { timeout: 2000 });
    await page.evaluate(() => (window as any).statusLifecycleFixture.release(0, {
      status: 'active', data: { type: 'thinking', turn_id: 'old' },
      draft: { text: 'stale draft', totalLines: 1 }, thought: { text: 'stale thought', totalLines: 1 },
    }));
    expect(JSON.parse((await page.locator('#state').textContent())!).status).toBeNull();
    expect(JSON.parse((await page.locator('#state').textContent())!).draft.text).toBe('');
    await page.evaluate(() => (window as any).statusLifecycleFixture.release(1, {
      status: 'active', data: { type: 'thinking', turn_id: 'fresh' },
      draft: { text: 'fresh draft', totalLines: 1 }, thought: { text: 'fresh thought', totalLines: 1 },
    }));
    await page.waitForFunction(() => document.querySelector('#state')!.textContent!.includes('fresh draft'));
    const state = JSON.parse((await page.locator('#state').textContent())!);
    expect(state.status.turn_id).toBe('fresh');
    expect(state.thought.text).toBe('fresh thought');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);

for (const terminal of ['success', 'error', 'cancelled']) {
  browserTest(`held manual compaction rejects pre-intent idle and retains ownership through command publication: ${terminal}`, async () => {
    backend.cleanup(); backend = manualCompactionBackend();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const deliver = async () => {
      const events = backend.events.splice(0);
      for (const event of events) await page.evaluate(({ type, data }) => (window as any).statusLifecycleFixture.event(type, data), event);
    };
    try {
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).statusLifecycleFixture));
      await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 1);
      await page.evaluate(() => { (window as any).manualDone = false; void (window as any).statusLifecycleFixture.manual().then(() => { (window as any).manualDone = true; }); });
      // The command is genuinely held server-side, not a status-only simulation.
      for (let i = 0; i < 100 && !backend.events.length; i++) await Bun.sleep(10);
      expect(backend.events.some(event => event.data?.intent_key === 'compaction')).toBe(true);
      await deliver();
      await page.waitForSelector('#stop');
      await page.evaluate(() => (window as any).statusLifecycleFixture.release(0, { status: 'idle', data: null }));
      await page.waitForTimeout(30);
      expect(await page.locator('#stop').count()).toBe(1);
      expect(JSON.parse((await page.locator('#state').textContent())!).status.intent_key).toBe('compaction');
      for (let i = 0; i < 3; i++) {
        const status = await (await page.request.get(`${origin}/status`)).json();
        expect(status.status).toBe('active');
        expect(status.data.intent_key).toBe('compaction');
      }
      expect(await page.evaluate(() => (window as any).manualDone)).toBe(false);
      if (terminal === 'cancelled') {
        await page.locator('#stop').click();
        for (let i = 0; i < 100 && backend.aborts === 0; i++) await Bun.sleep(10);
        expect(backend.aborts).toBe(1);
      } else backend.finish(terminal);
      for (let i = 0; i < 100 && !backend.events.some(event => event.type === 'agent_response'); i++) await Bun.sleep(10);
      expect(backend.events.some(event => event.type === 'agent_response')).toBe(true);
      await deliver();
      expect(await page.locator('#stop').count()).toBe(1);
      expect((await (await page.request.get(`${origin}/status`)).json()).status).toBe('active');
      backend.publish();
      await page.waitForFunction(() => (window as any).manualDone);
      await deliver();
      await page.waitForFunction(() => !document.querySelector('#stop'));
      expect((await (await page.request.get(`${origin}/status`)).json()).status).toBe('idle');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 15000);
}
