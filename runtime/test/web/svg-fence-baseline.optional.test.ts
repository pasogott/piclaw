import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit, type Browser } from "playwright";

// Temporary source-only baseline for #1324, not desired SVG acceptance.
// #1325 must replace these expectations when the image renderer is implemented.
// This harness uses about:blank and aborts page-initiated network requests.
// It is source-only baseline evidence, not full Classic/Visual acceptance.
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const repo = resolve(import.meta.dir, "../../..");
let browser: Browser | null = null;
let bundle = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  const built = await Bun.build({
    entrypoints: [resolve(repo, "runtime/web/src/components/post.ts")],
    target: "browser",
    format: "iife",
    plugins: [{
      name: "svg-baseline-test-exports",
      setup(build) {
        build.onResolve({ filter: /^#editor-vendor\/codemirror$/ }, () => ({
          path: resolve(repo, "runtime/extensions/viewers/editor/vendor/codemirror.js"),
        }));
        build.onLoad({ filter: /\/web\/src\/components\/post\.ts$/ }, (args) => ({
          loader: "ts",
          // Expose the actual production functions only in this in-memory test bundle.
          contents: readFileSync(args.path, "utf8")
            + "\nObject.assign(window, { svgBaseline: { renderMarkdown, enhanceCodeBlocks } });",
        }));
      },
    }],
  });
  expect(built.success).toBe(true);
  if (!built.success) throw new Error(built.logs.join("\n"));
  bundle = await built.outputs[0].text();
  const engine = process.env.PICLAW_OPTIONAL_BROWSER === "webkit" ? webkit : chromium;
  browser = await engine.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

browserTest("70d33bc93 baseline: SVG fences stay inert and the normal copy action preserves source", async () => {
  const page = await browser!.newPage();
  const requests: string[] = [];
  const dialogs: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  try {
    await page.setContent('<!doctype html><html><body><main id="post"></main></body></html>');
    await page.addScriptTag({ content: readFileSync(resolve(repo, "node_modules/marked/lib/marked.umd.js"), "utf8") });
    await page.addScriptTag({ content: bundle });
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" onload="alert(1)"><title>Diagram</title><rect width="20" height="20"/><image href="https://blocked.invalid/pixel"/></svg>';
    const rendered = await page.evaluate((svg) => {
      const scope = window as unknown as {
        svgBaseline: { renderMarkdown(text: string, cb: null): string; enhanceCodeBlocks(el: Element): () => void };
        baselineCleanup?: () => void;
        copied?: string;
      };
      const root = document.querySelector('#post')!;
      root.innerHTML = scope.svgBaseline.renderMarkdown('```svg\n' + svg + '\n```', null);
      // Check the complete message before trusted copy-button SVG icons are added.
      const modelSvgCount = root.querySelectorAll('svg').length;
      scope.baselineCleanup = scope.svgBaseline.enhanceCodeBlocks(root);
      // Spy only at the platform clipboard boundary; use the real button handler.
      document.execCommand = (command: string) => {
        if (command !== 'copy') return false;
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        scope.copied = data.getData('text/plain');
        return true;
      };
      return { code: root.querySelector('pre code')?.textContent, modelSvgCount, images: root.querySelectorAll('img').length };
    }, source);
    expect(rendered.code?.trim()).toBe(source);
    expect(rendered.modelSvgCount).toBe(0);
    expect(rendered.images).toBe(0);
    await page.locator('.post-code-copy-btn').click();
    await page.waitForFunction(() => (window as unknown as { copied?: string }).copied !== undefined);
    expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied?.trim())).toBe(source);
    expect(dialogs).toEqual([]);
    expect(requests).toEqual([]);
    expect(page.url()).toBe('about:blank');
    await page.evaluate(() => (window as unknown as { baselineCleanup?: () => void }).baselineCleanup?.());

    // Unfenced markup remains escaped; trusted static UI icons are a separate path.
    const raw = await page.evaluate((svg) => {
      const scope = window as unknown as { svgBaseline: { renderMarkdown(text: string, cb: null): string } };
      const root = document.querySelector('#post')!;
      root.innerHTML = scope.svgBaseline.renderMarkdown(svg, null);
      return { text: root.textContent, svgCount: root.querySelectorAll('svg').length };
    }, source);
    expect(raw.text).toContain('<svg');
    expect(raw.svgCount).toBe(0);
    expect(dialogs).toEqual([]);
    expect(requests).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
