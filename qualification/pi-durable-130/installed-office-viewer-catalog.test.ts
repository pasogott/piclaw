import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledOfficeViewer, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { installOfficeViewerFixture } from "./office-viewer-fixture.ts";

for (const mode of ["approved", "tamper", "shadow", "execute", "schema"] as const) test(`actual installed Office qualification: ${mode}`, async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-office-"));
  const pkg = installOfficeViewerFixture(dir);
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    if (mode === "tamper") writeFileSync(join(pkg, "index.ts"), readFileSync(join(pkg, "index.ts"), "utf8") + "\n// changed\n");
    if (mode === "shadow") writeFileSync(join(pkg, "index.js"), "export default function() {}\n");
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    const qualified = qualifyInstalledOfficeViewer(catalog, dir);
    if (mode === "tamper" || mode === "shadow") {
      expect(qualified).toBeUndefined();
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow();
      return;
    }
    expect(qualified).toBeDefined();
    expect(qualified!.extension.handlers.size).toBe(0);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("open_office_viewer");
    assertApplicationExtensionCatalogSupported(catalog, undefined, undefined, undefined, undefined, qualified);
    if (mode === "execute") qualified!.definition.execute = async () => { throw Error("substituted"); };
    if (mode === "schema") qualified!.definition.parameters = { ...qualified!.definition.parameters, description: "changed" };
    if (mode !== "approved") expect(() => qualified!.assertCurrent()).toThrow("capabilities");
    else qualified!.assertCurrent();
  } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
});
