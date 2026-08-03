import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const vendorDir = join(repoRoot, "runtime/web/static/common/js/vendor");
const xtermDir = join(vendorDir, "xterm");

test("core terminal vendors xterm assets", () => {
  expect(existsSync(join(xtermDir, "xterm.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "xterm.css"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-fit.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-image.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-serialize.mjs"))).toBe(true);

  const pane = readFileSync(join(repoRoot, "runtime/web/src/panes/terminal-pane.ts"), "utf8");
  expect(pane).toContain("/static/common/js/vendor/xterm");
  expect(pane).toContain('importAddon("image")');
  expect(pane).toContain("translateKittyGraphicsOutput");
  expect(pane).not.toContain("ghostty-web.js");
  expect(pane).not.toContain("ghostty-vt.wasm");
});

test("core no longer ships Ghostty browser assets or vendor manifest", () => {
  expect(existsSync(join(vendorDir, "ghostty-web.js"))).toBe(false);
  expect(existsSync(join(vendorDir, "ghostty-vt.wasm"))).toBe(false);
  expect(existsSync(join(vendorDir, "ghostty-web.meta.json"))).toBe(false);
  expect(existsSync(join(repoRoot, "runtime/vendor-manifests/ghostty-web.json"))).toBe(false);

  const vendorNames = readdirSync(vendorDir);
  expect(vendorNames.filter((name) => name.toLowerCase().includes("ghostty"))).toEqual([]);
});

test("package scripts, lockfile, and built web bundle do not fetch Ghostty into core", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  expect(pkg.dependencies?.["ghostty-web"]).toBeUndefined();
  expect(pkg.scripts?.["build:vendor:ghostty-web"]).toBeUndefined();
  expect(String(pkg.scripts?.["build:vendor"] || "")).not.toContain("ghostty");

  const lockfile = readFileSync(join(repoRoot, "bun.lock"), "utf8");
  expect(lockfile).not.toContain("ghostty-web");

  const appBundle = readFileSync(join(repoRoot, "runtime/web/static/classic/dist/app.bundle.js"), "utf8");
  expect(appBundle).not.toContain("ghostty-web.js");
  expect(appBundle).not.toContain("ghostty-vt.wasm");
});
