import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const root = join(import.meta.dir, "../..");
let server: ReturnType<typeof Bun.serve>,
  base = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/shared-themes-fixture.ts")],
    target: "browser",
    format: "esm",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!build.success) throw new Error(String(build.logs));
  const bundle = await build.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/fixture.js")
        return new Response(bundle, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/")
        return new Response(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${url.searchParams.get("skin") === "visual" ? "visual" : "classic"}/css/styles.css"><style>body{overflow:auto}#app{height:auto;min-height:100vh}.settings-content,.settings-panel__content{max-width:100%;padding:16px}.settings-theme-table{max-width:100%}#theme-probes{padding:16px}#theme-probes pre{background:var(--bg-code);color:var(--text-code);padding:12px}#theme-prose{color:var(--text-primary)}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const f = Bun.file(join(root, "web/static", url.pathname.slice(8)));
        if (await f.exists()) return new Response(f);
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
});
async function open(engine: string, skin: string, width = 1280) {
  const page = await browsers[engine].newPage({
    viewport: { width, height: 850 },
    colorScheme: "dark",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?skin=${skin}`);
  await page.waitForFunction(
    () =>
      !!(window as any).themeFixture &&
      !!document.getElementById("theme-probes"),
  );
  await page.waitForLoadState("networkidle");
  return { page, errors };
}
async function select(page: Page, skin: string, name: string) {
  if (skin === "classic")
    await page.getByRole("radio", { name, exact: true }).check();
  else {
    await page.locator("#appearance-theme").click();
    await page
      .getByRole("option", {
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`),
      })
      .click();
  }
}
for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic", "visual"]) {
    browserTest(
      `${engine} ${skin}: all palettes share mode, foreground and terminal roles`,
      async () => {
        const { page, errors } = await open(engine, skin);
        try {
          const results = await page.evaluate(() => {
            const f = (window as any).themeFixture;
            return f.presets.map((preset: any) => {
              f.selectLocalTheme(preset.id);
              const s = getComputedStyle(document.documentElement);
              return {
                id: preset.id,
                mode: document.documentElement.dataset.theme,
                expected: preset.mode === "auto" ? "dark" : preset.mode,
                colorScheme: s.colorScheme,
                bg: s.getPropertyValue("--bg").trim(),
                bgAlias: s.getPropertyValue("--bg-primary").trim(),
                text: s.getPropertyValue("--text").trim(),
                textAlias: s.getPropertyValue("--text-primary").trim(),
                accent: s.getPropertyValue("--accent").trim(),
                accentAlias: s.getPropertyValue("--accent-color").trim(),
                code: s.getPropertyValue("--bg-code").trim(),
                term: f.terminalThemeFromCss(),
              };
            });
          });
          expect(results.length).toBe(56);
          for (const r of results) {
            expect(r.mode).toBe(r.expected);
            expect(r.colorScheme).toBe(r.mode);
            expect(r.bg).toBe(r.bgAlias);
            expect(r.text).toBe(r.textAlias);
            expect(r.accent).toBe(r.accentAlias);
            expect(r.term.background).toBe(r.code);
            expect(r.term.foreground).toBe(r.text);
          }
          await page.evaluate(() => {
            const f = (window as any).themeFixture;
            f.selectLocalTheme("default");
            f.setThemeModePreference("light");
          });
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "light",
          );
          await page.evaluate(() =>
            (window as any).themeFixture.setThemeModePreference("auto"),
          );
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
          );
          await page.evaluate(() =>
            (window as any).themeFixture.selectLocalTheme("solarized-dark"),
          );
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "dark",
          );
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
    browserTest(
      `${engine} ${skin}: actual Appearance selects Monokais and intrinsic SynthWave glow`,
      async () => {
        const { page, errors } = await open(engine, skin, 390);
        try {
          await select(page, skin, "Monokai Original");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai");
          expect(
            await page
              .locator("html")
              .evaluate((e) =>
                getComputedStyle(e).getPropertyValue("--accent-color").trim(),
              ),
          ).toBe("#f92672");
          await select(page, skin, "Monokai Pro");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai-pro");
          expect(
            await page
              .locator("html")
              .evaluate((e) =>
                getComputedStyle(e).getPropertyValue("--accent-color").trim(),
              ),
          ).toBe("#ff6188");
          // Legacy local opt-out must never suppress intrinsic SynthWave glow.
          await page.evaluate(() =>
            localStorage.setItem("piclaw_synthwave_glow", "off"),
          );
          await select(page, skin, "SynthWave ’84");
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-real-code .tok-keyword")
              .first()
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-prose")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page
              .getByRole("checkbox", { name: /SynthWave glow/i })
              .count(),
          ).toBe(0);
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          await page.emulateMedia({ forcedColors: "active" });
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          await page.emulateMedia({ forcedColors: "none" });
          await page.locator("#theme-probes").scrollIntoViewIfNeeded();
          await mkdir(join(root, "../.artifacts/shared-themes"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/shared-themes/${engine}-${skin}-synthwave-glow-390.png`,
            ),
            fullPage: true,
          });
          await select(page, skin, "Paper");
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "light",
          );
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBeLessThanOrEqual(1);
          await mkdir(join(root, "../.artifacts/shared-themes"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/shared-themes/${engine}-${skin}-paper-390.png`,
            ),
            fullPage: true,
          });
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
  }
for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine} Visual: import preview/cancel, reload and reset are coherent`,
    async () => {
      const { page, errors } = await open(engine, "visual");
      try {
        await select(page, "visual", "Monokai Pro");
        const themeFile = {
          name: "Light fixture",
          type: "light",
          colors: {
            "editor.background": "#faf4ed",
            "editor.foreground": "#34303b",
            "sideBar.background": "#f2e9e1",
            focusBorder: "#8b355b",
          },
        };
        await page.locator('input[type=file][accept=".json"]').setInputFiles({
          name: "fixture.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(themeFile)),
        });
        await page.waitForFunction(
          () => document.documentElement.dataset.customTheme === "true",
        );
        expect(await page.locator("html").getAttribute("data-theme")).toBe(
          "light",
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(
          await page.locator("html").getAttribute("data-custom-theme"),
        ).toBe("false");
        expect(
          await page.locator("html").getAttribute("data-color-theme"),
        ).toBe("monokai-pro");
        await page.locator('input[type=file][accept=".json"]').setInputFiles({
          name: "fixture.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(themeFile)),
        });
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await page.reload();
        await page.waitForFunction(
          () => document.documentElement.dataset.customTheme === "true",
        );
        expect(await page.locator("html").getAttribute("data-theme")).toBe(
          "light",
        );
        expect(
          await page
            .locator("html")
            .evaluate((e) =>
              getComputedStyle(e).getPropertyValue("--bg-primary").trim(),
            ),
        ).toBe("#faf4ed");
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        expect(
          await page.locator("html").getAttribute("data-custom-theme"),
        ).toBe("false");
        expect(
          await page.locator("html").getAttribute("data-color-theme"),
        ).toBe("default");
        await page.evaluate(() =>
          (window as any).themeFixture.applyTheme({
            "--bg": "#ffffff",
            "--text": "#111111",
            "--accent": "#123456; } body { display:none",
          }),
        );
        expect(await page.locator("#app").isVisible()).toBe(true);
        expect(
          await page.evaluate(() =>
            (window as any).themeFixture.importVSCodeTheme({ name: "Empty" }),
          ),
        ).toEqual({});
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    30000,
  );

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: mounted Visual xterm repaints theme without reconnect or remote input`,
    async () => {
      const page = await browsers[engine].newPage({
        viewport: { width: 1280, height: 850 },
      });
      const connections: string[] = [],
        sent: string[] = [];
      await page.routeWebSocket("**/terminal/ws**", (socket) => {
        connections.push(socket.url());
        socket.onMessage((message) => sent.push(String(message)));
      });
      try {
        await page.goto(`${base}/?skin=visual&terminal=1`);
        await page.waitForSelector("#real-terminal .xterm-screen");
        await page.waitForFunction(
          () => !document.querySelector("#real-terminal .terminal__overlay"),
        );
        await page.evaluate(() =>
          (window as any).themeFixture.selectLocalTheme("paper"),
        );
        await page.waitForFunction(
          () =>
            getComputedStyle(
              document.querySelector(
                "#real-terminal .xterm-scrollable-element",
              )!,
            ).backgroundColor === "rgb(239, 238, 232)",
          undefined,
          { timeout: 5000 },
        );
        await page.evaluate(() =>
          (window as any).themeFixture.selectLocalTheme("synthwave-84"),
        );
        await page.waitForFunction(
          () =>
            getComputedStyle(
              document.querySelector(
                "#real-terminal .xterm-scrollable-element",
              )!,
            ).backgroundColor === "rgb(36, 27, 47)",
          undefined,
          { timeout: 5000 },
        );
        expect(connections).toHaveLength(1);
        expect(
          sent.map((s) => JSON.parse(s)).some((p) => p.type === "input"),
        ).toBe(false);
      } finally {
        await page.close();
      }
    },
    20000,
  );

for (const engine of ["chromium", "webkit"])
  for (const width of [1366, 820, 520, 390]) {
    browserTest(
      `${engine}: real Classic Appearance dialog has aligned compact theme columns at ${width}px`,
      async () => {
        const page = await browsers[engine].newPage({
          viewport: { width, height: 900 },
          colorScheme: "dark",
        });
        try {
          await page.goto(`${base}/?skin=classic&host=dialog`);
          await page
            .locator(".settings-theme-table tbody tr")
            .first()
            .waitFor();
          const geometry = await page.evaluate(() => {
            const content = document.querySelector(
              ".settings-content",
            ) as HTMLElement;
            const table = document.querySelector(
              ".settings-theme-table",
            ) as HTMLElement;
            const root = content.getBoundingClientRect();
            const rows = [...table.querySelectorAll("tr")].map((row) =>
              [...row.children].map((cell) => {
                const r = cell.getBoundingClientRect();
                return { left: r.left, right: r.right, width: r.width };
              }),
            );
            const first = rows[0];
            const drift = rows.flatMap((row) =>
              row.map((cell, i) => Math.abs(cell.left - first[i].left)),
            );
            const swatches = [
              ...table.querySelectorAll(".settings-theme-palette"),
            ].map((el) => ({
              width: el.getBoundingClientRect().width,
              visible: getComputedStyle(el).display !== "none",
              colours: el.children.length,
            }));
            const select = document
              .querySelector("#appearance-mode")!
              .getBoundingClientRect();
            const label = document
              .querySelector('label[for="appearance-mode"]')!
              .getBoundingClientRect();
            return {
              columns: first.length,
              drift: Math.max(...drift),
              overflow: content.scrollWidth - content.clientWidth,
              tableWidth: table.getBoundingClientRect().width,
              contentWidth: content.clientWidth,
              swatches,
              modeOutside: select.left < root.left || select.right > root.right,
              labelWidth: label.width,
              nameWidths: rows.slice(1).map((r) => r[1].width),
            };
          });
          expect(geometry.columns).toBe(4);
          expect(geometry.drift).toBeLessThanOrEqual(1);
          expect(geometry.overflow).toBeLessThanOrEqual(1);
          expect(geometry.tableWidth).toBeLessThanOrEqual(
            geometry.contentWidth,
          );
          expect(Math.min(...geometry.nameWidths)).toBeGreaterThanOrEqual(
            width <= 390 ? 115 : 140,
          );
          expect(geometry.modeOutside).toBe(false);
          expect(geometry.labelWidth).toBeGreaterThanOrEqual(170);
          expect(geometry.swatches.length).toBe(55);
          expect(
            geometry.swatches.every(
              (s) => s.visible && s.width >= 75 && s.colours === 8,
            ),
          ).toBe(true);
          expect(
            await page.getByRole("columnheader").allTextContents(),
          ).toEqual(["Selected", "Theme", "Mode", "Palette"]);
          expect(
            await page
              .getByRole("checkbox", { name: /SynthWave glow/i })
              .count(),
          ).toBe(0);
          await page
            .getByRole("radio", { name: "Monokai Pro", exact: true })
            .check();
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai-pro");
          await page.locator(".settings-content").evaluate((e) => {
            e.scrollTop = 0;
          });
          await mkdir(join(root, "../.artifacts/appearance-correction"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/appearance-correction/${engine}-classic-${width}.png`,
            ),
          });
        } finally {
          await page.close();
        }
      },
      20000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic", "visual"]) {
    browserTest(
      `${engine} ${skin}: Full has strong animated neon, Normal stays static, accessibility and visibility stop motion`,
      async () => {
        const { page, errors } = await open(engine, skin, 820);
        try {
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await select(page, skin, "SynthWave ’84");
          const keyword = page.locator("#theme-real-code .tok-keyword").first();
          const normal = await keyword.evaluate((e) => ({
            shadow: getComputedStyle(e).textShadow,
            color: getComputedStyle(e).color,
            animation: getComputedStyle(e).animationName,
          }));
          expect(normal.animation).toBe("none");
          expect(normal.shadow).not.toBe("none");
          await select(page, skin, "SynthWave ’84 Full");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("synthwave-84-full");
          const full = await keyword.evaluate((e) => ({
            shadow: getComputedStyle(e).textShadow,
            color: getComputedStyle(e).color,
            animation: getComputedStyle(e).animationName,
            duration: getComputedStyle(e).animationDuration,
          }));
          expect(full.color).toBe("rgb(244, 238, 228)");
          expect(full.shadow).not.toBe(normal.shadow);
          expect(full.animation).toBe("synthwave-full-neon");
          expect(full.duration).toBe("5.5s");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").animationName),
          ).toBe("synthwave-full-accent");
          expect(
            await page.locator("#theme-prose").evaluate((e) => ({
              shadow: getComputedStyle(e).textShadow,
              animation: getComputedStyle(e).animationName,
            })),
          ).toEqual({ shadow: "none", animation: "none" });
          const before = await keyword.evaluate(
            (e) => e.getAnimations()[0]?.currentTime as number,
          );
          await page.waitForTimeout(180);
          const after = await keyword.evaluate(
            (e) => e.getAnimations()[0]?.currentTime as number,
          );
          expect(after).toBeGreaterThan(before);
          // Explicit visibility-handler test; headless execution is not evidence of a native hidden tab.
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              get: () => true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          expect(
            await page.locator("html").getAttribute("data-theme-motion"),
          ).toBe("paused");
          expect(
            await keyword.evaluate(
              (e) => getComputedStyle(e).animationPlayState,
            ),
          ).toBe("paused");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate(
                (e) => getComputedStyle(e, "::after").animationPlayState,
              ),
          ).toBe("paused");
          await page.evaluate(() => {
            delete (document as any).hidden;
            document.dispatchEvent(new Event("visibilitychange"));
          });
          expect(
            await keyword.evaluate(
              (e) => getComputedStyle(e).animationPlayState,
            ),
          ).toBe("running");
          await page.emulateMedia({ reducedMotion: "reduce" });
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").animationName),
          ).toBe("none");
          await page.emulateMedia({
            reducedMotion: "no-preference",
            forcedColors: "active",
          });
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").display),
          ).toBe("none");
          await page.emulateMedia({ forcedColors: "none" });
          await page.locator("#theme-probes").scrollIntoViewIfNeeded();
          await mkdir(join(root, "../.artifacts/synthwave-full"), {
            recursive: true,
          });
          await page.evaluate(() =>
            document.getAnimations().forEach((a) => {
              a.pause();
              a.currentTime = 2750;
            }),
          );
          await page.locator("#theme-probes").screenshot({
            path: join(
              root,
              `../.artifacts/synthwave-full/${engine}-${skin}-full.png`,
            ),
          });
          if (engine === "chromium" && skin === "classic") {
            const frames = join(root, "../.artifacts/synthwave-full/frames");
            await mkdir(frames, { recursive: true });
            for (let index = 0; index < 44; index++) {
              await page.evaluate(
                (time) =>
                  document.getAnimations().forEach((a) => {
                    a.pause();
                    a.currentTime = time;
                  }),
                index * 125,
              );
              await page.locator("#theme-probes").screenshot({
                path: join(frames, `${String(index).padStart(3, "0")}.png`),
              });
            }
          }
          await select(page, skin, "SynthWave ’84");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(await keyword.evaluate((e) => getComputedStyle(e).color)).toBe(
            normal.color,
          );
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").content),
          ).toBe("none");
          await page.locator("#theme-probes").screenshot({
            path: join(
              root,
              `../.artifacts/synthwave-full/${engine}-${skin}-normal.png`,
            ),
          });
          await select(page, skin, "Paper");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page.evaluate(
              () =>
                document
                  .getAnimations()
                  .filter((a) =>
                    (a as CSSAnimation).animationName?.startsWith(
                      "synthwave-full",
                    ),
                  ).length,
            ),
          ).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic", "visual"]) {
    browserTest(
      `${engine} ${skin}: requested catalogue themes are selectable with correct native mode`,
      async () => {
        const { page, errors } = await open(engine, skin, 1280);
        try {
          for (const [name, id, mode, bg] of [
            ["Turbo Pascal (Original)", "turbo-pascal", "dark", "#000088"],
            ["Tokyo Night", "tokyo", "dark", "#1a1b26"],
            ["Tokyo Night Storm", "tokyo-night-storm", "dark", "#24283b"],
            ["Tokyo Night Light", "tokyo-night-light", "light", "#e6e7ed"],
            ["Noctis", "noctis", "dark", "#052529"],
            ["Noctis Lux", "noctis-lux", "light", "#fef8ec"],
            ["Bearded Arc", "bearded-arc", "dark", "#1c2433"],
            ["Catppuccin Frappé", "catppuccin-frappe", "dark", "#303446"],
            ["Catppuccin Macchiato", "catppuccin-macchiato", "dark", "#24273a"],
            ["Nord", "nord", "dark", "#2e3440"],
            ["AS/400 Green Screen (5250)", "as400", "dark", "#000000"],
            ["Lumon", "lumon", "dark", "#1b2d40"],
          ]) {
            await select(page, skin, name);
            expect(
              await page.locator("html").getAttribute("data-color-theme"),
            ).toBe(id);
            expect(await page.locator("html").getAttribute("data-theme")).toBe(
              mode,
            );
            expect(
              await page
                .locator("html")
                .evaluate((e) =>
                  getComputedStyle(e).getPropertyValue("--bg-primary").trim(),
                ),
            ).toBe(bg);
            expect(
              await page
                .locator("#theme-real-code .tok-keyword")
                .first()
                .evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("none");
            if (engine === "chromium") {
              await mkdir(join(root, "../.artifacts/requested-themes"), {
                recursive: true,
              });
              await page.locator("#theme-probes").scrollIntoViewIfNeeded();
              await page
                .locator("#theme-probes")
                .screenshot({
                  path: join(
                    root,
                    `../.artifacts/requested-themes/${skin}-${id}.png`,
                  ),
                });
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60000,
    );
  }
