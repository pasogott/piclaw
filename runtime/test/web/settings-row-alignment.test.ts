import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const classicComponent = readFileSync(join(repoRoot, "runtime/web/src/components/settings/compaction.ts"), "utf8");
const classicCss = readFileSync(join(repoRoot, "runtime/web/static/classic/css/settings.css"), "utf8");
const visualComponent = readFileSync(join(repoRoot, "runtime/web/static/visual/frontend/src/panels/settings/CompactionSection.tsx"), "utf8");
const visualCss = readFileSync(join(repoRoot, "runtime/web/static/visual/css/shell.css"), "utf8");

test("Classic Compaction opts into dense rows without changing shared Settings rows", () => {
  expect(classicComponent).toContain('class="settings-section settings-dense-form"');
  // Count rows, not modifier-class occurrences. Native auto plus the eight
  // independent local-lite/tool/semantic/watchdog controls remain editable.
  expect(classicComponent.match(/class="settings-row settings-dense-row[ "]/g)).toHaveLength(9);
  expect(classicComponent).toContain("settings.compaction.enableAutomatic");
  expect(classicComponent).not.toContain("compaction-model-picker");
  expect(classicComponent).not.toContain("smartCompactionMethod");
  expect(classicComponent).not.toContain("compactionModel");
  expect(classicCss).toContain(".settings-dense-row {");
  expect(classicCss).toContain("grid-template-columns: var(--settings-dense-label-width) var(--settings-dense-control-width) minmax(0, 1fr)");
  expect(classicCss).toContain(".settings-dense-row-compound");
  expect(classicCss).toContain(".settings-row {\n    display: flex;");
});

test("Visual Compaction uses a Visual-specific dense row primitive", () => {
  expect(visualComponent).toContain('className="settings-panel__section settings-panel__dense-form"');
  // Visual also exposes the independent compacted-tools allowlist.
  expect(visualComponent.match(/className="settings-panel__field settings-panel__dense-row[ "]/g)).toHaveLength(10);
  expect(visualComponent).toContain('id="autoCompactionEnabled"');
  expect(visualComponent).not.toContain("compaction-model-picker");
  expect(visualComponent).not.toContain("smartCompactionMethod");
  expect(visualComponent).not.toContain("compactionModel");
  expect(visualCss).toContain(".settings-panel__dense-row {");
  expect(visualCss).toContain("--settings-panel-dense-label-width: 180px");
  expect(visualCss).toContain("--settings-panel-dense-control-width: 200px");
  expect(visualCss).toContain(".settings-panel__dense-row--compound");
  expect(visualCss).toContain(".settings-panel__field { display: flex;");
});
