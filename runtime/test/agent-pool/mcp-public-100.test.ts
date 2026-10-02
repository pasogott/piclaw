import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTempWorkspace } from "../helpers.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMcpPublic100, matchNegativeDiagnostics, missingSeams } from "../../../scripts/check-earendil-mcp-public-100.js";
const root = resolve(import.meta.dir, "../../..");
const receiptPath = resolve(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-100-mcp-public.json");

test("exact 1.0.0 public MCP types compile and every missing seam still rejects", () => {
  const measured = checkMcpPublic100(root);
  const archived = JSON.parse(readFileSync(receiptPath, "utf8"));
  expect(measured).toEqual(archived.compile);
  expect(measured.nativeParity).toBe("not_qualified"); expect(measured.productionActivation).toBe(false);
  expect(measured.negative).toHaveLength(10);
}, 70_000);

test("missing, changed and duplicate public-seam diagnostics cannot pass", () => {
  const diagnostic = (symbol: string, code: string) => `negative.ts(1,1): error ${code}: synthetic diagnostic for ${symbol}`;
  const baseline = missingSeams.map(row => diagnostic(row.symbol, row.code));
  expect(matchNegativeDiagnostics(baseline.join("\n"))).toEqual(missingSeams.map(row => ({ ...row })));
  expect(() => matchNegativeDiagnostics(baseline.slice(1).join("\n"))).toThrow("exactly 10");
  expect(() => matchNegativeDiagnostics([...baseline, baseline[0]].join("\n"))).toThrow("exactly 10");
  expect(() => matchNegativeDiagnostics(baseline.map((row, index) => index === 0 ? baseline[1] : row).join("\n"))).toThrow();
  expect(() => matchNegativeDiagnostics(baseline.join("\n").replace("TS2740", "TS2307"))).toThrow();
});

for (const exposure of ["deferred", "codemode"]) {
  test(`real public SDK MCP discovery, codemode, policy and reload: ${exposure}`, async () => {
    const fixture = fileURLToPath(new URL("fixtures/mcp-public-runtime-100.ts", import.meta.url));
    const workspace = createTempWorkspace("mcp-public-host-");
    const child = Bun.spawn([process.execPath, "--no-env-file", fixture, exposure], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", MCP_PUBLIC_FIXTURE_ROOT: workspace.workspace }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err || out).toBe(0); expect(err).toBe("");
      const result = JSON.parse(out);
      const archived = JSON.parse(readFileSync(receiptPath, "utf8"));
      expect(result).toEqual(archived.runtime.find((row: { exposure: string }) => row.exposure === exposure));
      expect(result).toMatchObject({ version: "1.0.0", runtime: `Bun ${Bun.version}`, exposure, networkAttempts: 0, scriptedResponses: 14,
        deferredDiscovered: true, hiddenExcluded: true, codemodeSearchAndCall: true, nestedPolicyAndParentId: true, missingRequiredArgumentBlocked: true,
        numericStringCoercionObserved: true, hiddenInvocationBlocked: true, restoredAfterReload: true, postReloadCallUsesNewTransport: true, sessionAndHistoryPreserved: true,
        transportsClosed: true, productionAdoption: false, externalInference: "not_invoked", topLevelToolHooks: "scripted_provider_real_session_pipeline" });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; workspace.cleanup(); }
  }, 25_000);
}
