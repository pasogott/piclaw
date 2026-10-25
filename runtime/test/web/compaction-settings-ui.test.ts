import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeRoot = join(import.meta.dir, "../..");

function source(path: string): string {
  return readFileSync(join(runtimeRoot, path), "utf8");
}

const classic = source("web/src/components/settings/compaction.ts");
const visual = source("web/static/visual/frontend/src/panels/settings/CompactionSection.tsx");
const types = source("web/static/visual/frontend/src/panels/settings/types.ts");
const retiredFields = [
  "smartCompactionMethod", "compactionModel", "compactionLatencyEstimate",
  "remoteCompactionEnabled", "remoteCompactionTimeoutSec", "remoteCompactionSupportedProviders",
  "compactionThresholdPercent", "compactionTimeoutSec", "compactionBackoffBaseMin",
  "compactionBackoffMaxMin", "compactionBackoffDecayFactor", "compactionBackoffs",
];
const supportedFields = [
  "autoCompactionEnabled", "localLitePromptProfileEnabled", "toolResultCompactionEnabled",
  "toolResultSemanticSummaryEnabled", "toolResultSemanticSummaryMaxInputChars",
  "toolResultSemanticSummaryMaxTokens", "toolResultSemanticSummaryTimeoutSec",
  "progressWatchdogEnabled", "progressWatchdogTimeoutSec",
];

for (const [skin, component] of [["classic", classic], ["visual", visual]] as const) {
  test(`${skin} exposes native compaction without retired controls or writes`, () => {
    for (const field of retiredFields) expect(component).not.toContain(field);
    for (const obsolete of [
      "Pipelined", "Selective", "processingMethod", "compaction-model-picker",
      "compaction-latency-estimate", "/compaction/probe", "/compaction/reset-backoff",
      "normaliseModelCatalogue", "getAgentModels", "/agent/models", "probeBusy", "modelPayload",
    ]) expect(component).not.toContain(obsolete);
    expect(component).not.toContain("<select");
    expect(component).not.toContain("compactionPolicy"); // Read-only API metadata, never saved.
    expect(component).toContain("active conversation model and SDK thresholds");
    expect(component).toContain("next compaction decision");
    expect(component).toContain("already accepted maintenance is not cancelled");
    expect(component).not.toContain("auto-compactor stays suppressed");
    expect(component).toContain("localLitePromptProfileEnabled ?? false");
    expect(component).toContain("Local-lite prompt and tools");
    for (const field of supportedFields) expect(component).toContain(field);
    expect(component).toContain("progressWatchdogPhases");
  });
}

test("classic incoming and outgoing autosave snapshots contain only supported writable fields", () => {
  // Inspect both explicit object literals, so even unchanged retired fields cannot leak into POSTs.
  const incoming = classic.match(/savedSnapshotRef\.current = JSON\.stringify\(\{([\s\S]*?)\}\);/);
  const outgoing = classic.match(/const currentSnapshot = useMemo\(\(\) => JSON\.stringify\(\{([\s\S]*?)\}\),/);
  expect(incoming).not.toBeNull();
  expect(outgoing).not.toBeNull();
  const incomingKeys = incoming![1].split("\n").map(line => line.trim().split(":")[0]).filter(Boolean);
  const outgoingKeys = outgoing![1].split(",").map(key => key.trim()).filter(Boolean);
  expect(incomingKeys.sort()).toEqual([...supportedFields].sort());
  expect(outgoingKeys.sort()).toEqual([...supportedFields].sort());
  expect(classic).toContain("body: currentSnapshot");
  expect(classic).toContain("currentSnapshot === savedSnapshotRef.current");
  expect(classic).toContain("mergeSettingsData?.(payload.settings)");
  expect(classic).toContain("applyIncoming({ ...(settingsData || {}), ...(payload.settings || {}) })");
  expect(classic).toContain("}, 800)");
  expect(classic).toContain('role="status" aria-live="polite"');
});

test("visual save callbacks retain only native auto plus independent controls", () => {
  const fields = [...visual.matchAll(/onSaveCompaction\(\s*"([^"]+)"/g)].map(match => match[1]);
  expect([...new Set(fields)].sort()).toEqual([...supportedFields, "toolResultCompactionTools"].sort());
  expect(visual).toContain('saveSetting("compaction", field, value)');
  expect(visual).toContain("onBlur={saveToolsFromInput}");
  expect(visual).toContain("<NumberStepper");
});

test("visual settings types and fixtures use the pi-durable GET contract", () => {
  expect(types).toContain('compactionPolicy?: "pi-durable"');
  expect(types).not.toContain("CompactionBackoff");
  const fixtures = [
    source("test/web/fixtures/visual-compaction-settings-fixture.tsx"),
    source("web/src/dev/settings-widget-fixture.ts"),
  ];
  for (const field of retiredFields) {
    expect(types).not.toContain(field);
    for (const fixture of fixtures) expect(fixture).not.toContain(field);
  }
  for (const fixture of fixtures) expect(fixture).toContain("pi-durable");
});
