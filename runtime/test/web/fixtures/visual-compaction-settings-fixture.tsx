import { render } from "preact";
import { useState } from "preact/hooks";

import { CompactionSection } from "../../../web/static/visual/frontend/src/panels/settings/CompactionSection";
import type { SettingsData } from "../../../web/static/visual/frontend/src/panels/settings/types";

const settings: SettingsData = {
  autoCompactionEnabled: true,
  compactionPolicy: "pi-durable",
  localLitePromptProfileEnabled: false,
  progressWatchdogEnabled: false,
  progressWatchdogTimeoutSec: 300,
  toolResultCompactionEnabled: true,
  toolResultCompactionTools: ["read", "bash"],
  toolResultSemanticSummaryEnabled: true,
  toolResultSemanticSummaryMaxInputChars: 12_000,
  toolResultSemanticSummaryMaxTokens: 320,
  toolResultSemanticSummaryTimeoutSec: 12,
  progressWatchdogPhases: [],
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
  if (url.pathname === "/agent/settings/compaction" && init?.method === "POST") Object.assign(settings, JSON.parse(String(init.body || "{}")));
  if (url.pathname.startsWith("/agent/settings/")) return Response.json({ ok: true, settings });
  return originalFetch(input, init);
};

function Fixture() {
  const [data, setData] = useState(settings);
  return <CompactionSection data={data} onSaveCompaction={async (field,value) => {
    const response = await fetch("/agent/settings/compaction",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({[field]:value})});
    setData((await response.json()).settings);
  }} />;
}

render(
  <div className="settings-panel settings-compaction-fixture">
    <div className="settings-panel__content">
      <Fixture />
    </div>
  </div>,
  document.getElementById("visual-compaction-settings-fixture-root")!,
);
