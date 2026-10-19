import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledGoal, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { installGoalFixture } from "./goal-fixture.ts";

for (const mode of ["approved", "tamper", "shadow", "execute", "command", "command-handler", "event", "extra-tool"] as const) test(`actual installed Goal source qualification remains startup denied: ${mode}`, async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-goal-"));
  const pkg = installGoalFixture(dir);
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    if (mode === "tamper") writeFileSync(join(pkg, "index.ts"), readFileSync(join(pkg, "index.ts"), "utf8") + "\n// changed\n");
    if (mode === "shadow") writeFileSync(join(pkg, "deadline-checkpoint.js"), "throw Error('unapproved shadow');\n");
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    const qualified = await qualifyInstalledGoal(catalog, dir);
    if (mode === "tamper" || mode === "shadow") {
      expect(qualified).toBeUndefined();
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow();
      return;
    }
    expect(qualified).toBeDefined();
    expect(qualified!.extension.tools.size).toBe(5);
    expect(qualified!.extension.commands.size).toBe(1);
    expect(qualified!.extension.handlers.size).toBe(6);
    expect(typeof qualified!.addon.goalInputIdentity).toBe("function");
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("no operation-owned host effect port");
    const extension = qualified!.extension;
    if (mode === "execute") extension.tools.get("goal_stop")!.definition.execute = async () => { throw Error("substituted"); };
    if (mode === "command") extension.commands.delete("goal");
    if (mode === "command-handler") extension.commands.get("goal")!.handler = async () => undefined;
    if (mode === "event") extension.handlers.get("agent_end")!.push(() => undefined);
    if (mode === "extra-tool") extension.tools.set("foreign", extension.tools.get("get_goal")!);
    if (mode !== "approved") expect(() => qualified!.assertCurrent()).toThrow("capabilities");
    else {
      qualified!.assertCurrent();
      writeFileSync(join(pkg, "compat/chat-context.ts"), "// replaced\n");
      expect(() => qualified!.assertCurrent()).toThrow("Installed Goal source changed");
    }
  } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
});
