import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { createTempWorkspace } from "../helpers";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const root = join(import.meta.dir, "../..");
const evidence = join(root, "../.artifacts/full-ui");
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
let workspace: ReturnType<typeof createTempWorkspace>;
beforeAll(async () => {
  if (!enabled) return;
  workspace = createTempWorkspace("theme-ui-");
  const built = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/theme-ui-effects-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
    external: ["#editor-vendor/codemirror"],
  });
  if (!built.success) throw new Error(String(built.logs));
  const script = await built.outputs[0].text();
  await mkdir(evidence, { recursive: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/fixture.js")
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/sse/stream")
        return new Response(": fixture\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      if (url.pathname === "/") {
        const skin =
          url.searchParams.get("skin") === "visual" ? "visual" : "classic";
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><style>html,body{margin:0;width:100%;height:100%;overflow:auto}#app{min-height:100%;padding:24px;box-sizing:border-box}#real-compose{height:480px;position:relative}#control-matrix{display:grid;gap:14px}#control-matrix label{display:grid;gap:4px}#control-matrix input{max-width:100%}.post-content{padding:16px}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/editor-vendor/codemirror.js")
        return new Response(
          Bun.file(
            join(root, "extensions/viewers/editor/vendor/codemirror.js"),
          ),
          { headers: { "content-type": "text/javascript" } },
        );
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const f = Bun.file(join(root, "web/static", url.pathname.slice(8)));
        if (await f.exists()) return new Response(f);
      }
      return new Response(null, { status: 404 });
    },
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
  workspace?.cleanup();
});
async function open(
  engine: string,
  skin: string,
  view: string,
  width = 820,
  extra = "",
) {
  const page = await browsers[engine].newPage({
    viewport: { width, height: 900 },
    reducedMotion: "no-preference",
    colorScheme: "dark",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(
    `${server.url}?skin=${skin}&view=${view}&picker=${view}&${extra}`,
  );
  await page.waitForFunction(() => Boolean((window as any).themeUi));
  return { page, errors };
}
async function themedFocus(page: Page, selector: string) {
  return page.locator(selector).evaluate((el: HTMLElement) => {
    el.focus();
    const s = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.style.color = "var(--focus-ring)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return {
      focused: document.activeElement === el,
      color: s.outlineColor,
      expected,
      style: s.outlineStyle,
      width: s.outlineWidth,
      shadow: s.boxShadow,
      text: s.textShadow,
    };
  });
}
for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic", "visual"]) {
    browserTest(
      `${engine} ${skin}: every input family has palette focus, caret, selection and native accents`,
      async () => {
        const { page, errors } = await open(engine, skin, "matrix");
        try {
          const result = await page.evaluate(() => {
            const failures: string[] = [];
            let checks = 0;
            const probe = document.createElement("span");
            document.body.append(probe);
            const color = (v: string) => {
              probe.style.color = v;
              return getComputedStyle(probe).color;
            };
            for (const preset of (window as any).themeUi.presets) {
              (window as any).themeUi.selectLocalTheme(preset.id);
              const ring = color("var(--focus-ring)"),
                accent = color("var(--accent-color)");
              for (const el of document.querySelectorAll<HTMLElement>(
                "[data-audit]",
              )) {
                el.focus();
                const s = getComputedStyle(el);
                checks++;
                if (
                  document.activeElement !== el ||
                  s.outlineStyle !== "solid" ||
                  s.outlineWidth !== "2px" ||
                  s.outlineColor !== ring
                )
                  failures.push(
                    `${preset.id}/${el.dataset.audit}: focus ${s.outlineColor} != ${ring}`,
                  );
                if (s.caretColor !== accent || s.accentColor !== accent)
                  failures.push(
                    `${preset.id}/${el.dataset.audit}: caret/accent`,
                  );
                // Engines do not expose input-internal selection pseudos consistently;
                // inspect the author's selection rule on the editable DOM surface.
              }
              const editable = document.querySelector(
                '[data-audit="editable"]',
              )!;
              const selection = getComputedStyle(editable, "::selection");
              if (selection.backgroundColor !== accent)
                failures.push(`${preset.id}: selection`);
            }
            probe.remove();
            return { failures, checks };
          });
          expect(result.failures).toEqual([]);
          expect(result.checks).toBe(56 * 55);
          await page.evaluate(() => {
            const f = (window as any).themeUi;
            f.applyTheme(
              f.importVSCodeTheme({
                type: "dark",
                colors: {
                  "editor.background": "#151515",
                  "editor.foreground": "#eeeeee",
                  focusBorder: "#ffaa44",
                },
              }),
            );
          });
          const imported = await themedFocus(page, '[data-audit="text"]');
          expect(imported.color).toBe(imported.expected);
          expect(imported.color).toBe("rgb(255, 170, 68)");
          expect(imported.text).toBe("none");
          await page.locator("#keyboard-target").focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          expect(
            await page
              .locator("#keyboard-target")
              .evaluate((e) => getComputedStyle(e).outlineStyle),
          ).toBe("solid");
          expect(await page.locator("#disabled-control").isDisabled()).toBe(
            true,
          );
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
    for (const view of ["model", "session", "settings"])
      browserTest(
        `${engine} ${skin}: actual ${view} input focus follows selected theme`,
        async () => {
          const { page, errors } = await open(
            engine,
            skin,
            view,
            390,
            "section=contract",
          );
          try {
            let selector: string;
            if (view === "settings") selector = "#contract-text";
            else if (view === "model")
              selector =
                skin === "classic"
                  ? ".compose-model-catalogue-search"
                  : ".model-picker__search";
            else if (skin === "classic") {
              await page.locator('[data-testid="session-switcher"]').click();
              selector = ".compose-session-search";
            } else {
              await page.locator(".session-pill").click();
              await page.getByRole("button", { name: "New root…" }).click();
              selector = ".modal-dialog__input";
            }
            await page.locator(selector).waitFor();
            for (const id of [
              "synthwave-84-full",
              "as400",
              "paper",
              "monokai-pro",
            ]) {
              await page.evaluate(
                (id) => (window as any).themeUi.selectLocalTheme(id),
                id,
              );
              const result = await themedFocus(page, selector);
              expect(result.focused).toBe(true);
              expect(result.color).toBe(result.expected);
              expect(result.style).toBe("solid");
              expect(result.width).toBe("2px");
              if (id === "synthwave-84-full") {
                expect(result.shadow).not.toBe("none");
                expect(result.text).not.toBe("none");
              } else expect(result.text).toBe("none");
            }
            if (view === "settings") {
              for (const control of await page
                .locator(
                  ".settings-addon-pane input:not(:disabled), .settings-addon-pane textarea, .settings-addon-pane select",
                )
                .all()) {
                await control.focus();
                expect(
                  await control.evaluate(
                    (e) => getComputedStyle(e).outlineStyle,
                  ),
                ).toBe("solid");
              }
            }
            await page.evaluate(() =>
              (window as any).themeUi.selectLocalTheme("synthwave-84-full"),
            );
            await page.locator(selector).focus();
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-${view}-390.png`),
            });
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
    for (const width of [390, 1280])
      browserTest(
        `${engine} ${skin}: Full neon reaches actual composer and UI at ${width}, and cleans up`,
        async () => {
          const { page, errors } = await open(engine, skin, "ui", width);
          try {
            const compose =
              skin === "classic"
                ? ".compose-input-wrapper"
                : ".chat__compose-container";
            const input = `${compose} textarea`;
            await page.locator(input).fill("Neon all the way. Ready to send.");
            await page.locator(input).focus();
            const snapshot = () =>
              page.evaluate(
                ({ compose, input }) => {
                  const body = getComputedStyle(document.body),
                    c = getComputedStyle(document.querySelector(compose)!),
                    i = getComputedStyle(document.querySelector(input)!),
                    prose = getComputedStyle(
                      document.querySelector("#neon-prose")!,
                    );
                  return {
                    text: prose.textShadow,
                    inputText: i.textShadow,
                    animation: body.animationName,
                    composeAnimation: c.animationName,
                    shadow: c.boxShadow,
                    background: c.backgroundImage,
                    paused: [body.animationPlayState, c.animationPlayState],
                    overflow: document.documentElement.scrollWidth - innerWidth,
                  };
                },
                { compose, input },
              );
            const full = await snapshot();
            expect(full.text).not.toBe("none");
            expect(full.inputText).not.toBe("none");
            expect(full.animation).toBe("synthwave-full-ui");
            expect(full.composeAnimation).toBe("synthwave-full-compose");
            expect(full.shadow).not.toBe("none");
            expect(full.background).toContain("gradient");
            expect(full.overflow).toBeLessThanOrEqual(1);
            const before = await page
              .locator("body")
              .evaluate((e) => e.getAnimations()[0]?.currentTime);
            await page.waitForTimeout(180);
            expect(
              await page
                .locator("body")
                .evaluate((e) => e.getAnimations()[0]?.currentTime),
            ).not.toBe(before);
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-full-${width}.png`),
            });
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect((await snapshot()).paused).toEqual(["paused", "paused"]);
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: false,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect((await snapshot()).paused).toEqual(["running", "running"]);
            await page.emulateMedia({ reducedMotion: "reduce" });
            const reduced = await snapshot();
            expect(reduced.animation).toBe("none");
            expect(reduced.composeAnimation).toBe("none");
            expect(reduced.text).not.toBe("none");
            if (engine === "chromium") {
              await page.emulateMedia({ forcedColors: "active" });
              const forced = await snapshot();
              expect(forced.text).toBe("none");
              expect(forced.inputText).toBe("none");
              expect(forced.shadow).toBe("none");
              expect(forced.background).toBe("none");
              expect((await themedFocus(page, input)).style).toBe("solid");
              await page.emulateMedia({ forcedColors: "none" });
            }
            await page.emulateMedia({ reducedMotion: "no-preference" });
            for (const id of ["synthwave-84", "as400", "paper", "default"]) {
              await page.evaluate(
                (id) => (window as any).themeUi.selectLocalTheme(id),
                id,
              );
              const other = await snapshot();
              expect(other.text).toBe("none");
              expect(other.inputText).toBe("none");
              expect(other.animation).toBe("none");
              expect(other.composeAnimation).toBe("none");
              expect(other.background).toBe("none");
            }
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
  }

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: actual Visual custom select keeps themed keyboard focus and dismissal`,
    async () => {
      const { page, errors } = await open(
        engine,
        "visual",
        "custom-select",
        390,
      );
      try {
        const trigger = page.locator(".custom-select__trigger");
        for (const theme of ["synthwave-84-full", "as400", "paper"]) {
          await page.evaluate(
            (id) => (window as any).themeUi.selectLocalTheme(id),
            theme,
          );
          await trigger.focus();
          await page.keyboard.press("Space");
          await page.getByRole("option", { name: "Two" }).click();
          expect(
            await trigger.evaluate((e) => e === document.activeElement),
          ).toBe(true);
          const focus = await themedFocus(page, ".custom-select__trigger");
          expect(focus.color).toBe(focus.expected);
          expect(focus.style).toBe("solid");
          await trigger.click();
          await page.keyboard.press("Escape");
          expect(await trigger.getAttribute("aria-expanded")).toBe("false");
          await page.keyboard.press("Space");
          // Options are buttons in the tab order; focus-out dismisses only
          // after keyboard focus has traversed both options.
          for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
          expect(await trigger.getAttribute("aria-expanded")).toBe("false");
          expect(
            await page
              .locator("#after-select")
              .evaluate((e) => e === document.activeElement),
          ).toBe(true);
        }
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    20000,
  );
