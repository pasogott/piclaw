import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/visual-status-polling-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/fixture.js"
        ? new Response(script, {
            headers: { "content-type": "text/javascript" },
          })
        : new Response(
            '<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>',
            { headers: { "content-type": "text/html" } },
          ),
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
});
afterAll(async () => {
  for (const browser of Object.values(browsers)) await browser.close();
  server?.stop(true);
});
for (const engine of ["chromium", "webkit"])
  for (const scenario of [
    "cadence",
    "events",
    "late-body",
    "refresh-disposal",
    "model-during-body",
    "hybrid-budget",
  ])
    browserTest(
      `${engine}: shared Visual polling ${scenario}`,
      async () => {
        const page = await browsers[engine].newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        try {
          await page.clock.install();
          await page.goto(`${server.url}?chat_jid=web%3Atest`);
          await page.waitForSelector("#status-state");
          await page.clock.runFor(100);
          const calls = () =>
            page.evaluate(() =>
              (window as any).pollingFixture.calls.map((c: any) => c.path),
            );
          const reset = () =>
            page.evaluate(() => (window as any).pollingFixture.clear());
          const dispatch = (name: string, detail?: unknown) =>
            page.evaluate(
              ({ name, detail }) =>
                window.dispatchEvent(new CustomEvent(name, { detail })),
              { name, detail },
            );
          expect((await calls()).sort()).toEqual(["/agent/status"]);
          expect(
            await page.locator(".model-badge__name").allTextContents(),
          ).toEqual(["model", "model"]);
          expect(
            await page.evaluate(() =>
              (window as any).pollingFixture.calls
                .filter((c: any) => c.path !== "/agent/roster")
                .every((c: any) => c.jid === "web:test"),
            ),
          ).toBe(true);
          await reset();
          if (scenario === "hybrid-budget") {
            // Independent Classic callers join Visual's timer and shared reply.
            for (let i = 0; i < 12; i++) {
              await page.clock.runFor(5000);
              await page.evaluate(() =>
                (window as any).pollingFixture.classicRefresh(),
              );
            }
            expect(await calls()).toHaveLength(12);
            expect(
              (await calls()).every((path) => path === "/agent/status"),
            ).toBe(true);
          } else if (scenario === "cadence") {
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMobile(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMobile(true),
            );
            await page.clock.runFor(100);
            expect(await page.locator(".model-badge__name").count()).toBe(2);
            await page.evaluate(() =>
              (window as any).pollingFixture.setStatusCode(500),
            );
            await page.clock.runFor(35000);
            expect(
              JSON.parse(await page.locator("#status-state").innerText()).stale,
            ).toBe(true);
            await page.evaluate(() =>
              (window as any).pollingFixture.setStatusCode(200),
            );
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect(
              JSON.parse(await page.locator("#status-state").innerText()).stale,
            ).toBe(false);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(true),
            );
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
          } else if (scenario === "events") {
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:other",
              payload: { current: "fixture/wrong" },
            });
            await page.clock.runFor(100);
            expect(await calls()).toEqual([]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setModel("fixture/next"),
            );
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:test",
              payload: {
                current: "fixture/next",
                thinking_level: "high",
                model_options: [{ id: "fixture/next", context_window: 100000 }],
              },
            });
            expect(
              await page.locator(".model-badge__name").allTextContents(),
            ).toEqual(["next", "next"]);
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await dispatch("piclaw:agent-status", {
              type: "done",
              context_usage: {
                tokens: 4000,
                percent: 4,
                contextWindow: 100000,
              },
            });
            expect(
              JSON.parse(await page.locator("#status-state").innerText())
                .tokens,
            ).toBe(4000);
            await page.clock.runFor(600);
            expect(await calls()).toEqual(["/agent/status"]);
            await reset();
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
          } else if (scenario === "model-during-body") {
            await page.evaluate(() => (window as any).pollingFixture.block());
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            await page.evaluate(() =>
              (window as any).pollingFixture.setModel("fixture/latest"),
            );
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:test",
              payload: { current: "fixture/latest" },
            });
            await page.clock.runFor(100);
            await page.evaluate(() => (window as any).pollingFixture.release());
            await page.clock.runFor(100);
            expect(
              await page.locator(".model-badge__name").allTextContents(),
            ).toEqual(["latest", "latest"]);
            expect(await calls()).toEqual(["/agent/status", "/agent/status"]);
          } else if (scenario === "late-body") {
            await page.evaluate(() => (window as any).pollingFixture.block());
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            // Shared transport is not aborted by a single consumer unmount.
            await reset();
            await page.evaluate(() => (window as any).pollingFixture.release());
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            expect(await page.locator("#status-state").count()).toBe(0);
          } else {
            await dispatch("piclaw:agent-status", { type: "done" });
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect(await calls()).toEqual([]);
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      20000,
    );
