import "./src/test-guard.js";
import { hydrateMcpKeychainCredentials } from "../../runtime/src/secure/mcp-keychain.js";
import { getConfigPath } from "../../runtime/src/core/config-context.js";
import { delegateImages } from "./delegate-image-fixtures.ts";
import { expect, test, spyOn } from "bun:test";
import { strict as assert } from "node:assert";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import type { Api, Model, JsonObject } from "../../node_modules/@earendil-works/pi-ai";
import type { SqliteExecutor } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { SessionManager, SettingsManager, ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { RuntimeStartupCleanupError } from "../../runtime/src/runtime/startup-cleanup-error.js";
import { main } from "../../runtime/src/runtime.js";
import { createDefaultRuntimeBootstrapDeps } from "../../runtime/src/runtime/bootstrap.js";
import { storeChatMetadata, storeMessage } from "../../runtime/src/db.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import * as hostFs from "node:fs";
import { extensionKvSet, extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";
import { Harness, AgentDoc, InboxDoc, configure, createRegistry, defineTask, defineExtension, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { awaitWithContext, withAbortSignal, BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { reserveHostRequest } from "../../runtime/durable-engine/src/host-request-accounting.ts";
import { withTaskModelRequestScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";
import { createHostModels } from "../../runtime/durable-engine/src/host-models.js";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.js";
import { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
import { createCurrentPiclawScheduledRunStore } from "../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js";
import { createTask } from "../../runtime/src/db/tasks.js";
import { saveBudgetCap, setBudgetCapEnabled } from "../../runtime/src/db/budget-limits.js";
import { pollScheduledRunsOnce, stopSchedulerLoop } from "../../runtime/src/task-scheduler.js";
import { createPlanKvAuthority } from "../../runtime/durable-engine/src/host-plan-tool.js";
import { installCodeReviewFixture } from "./code-review-fixture.ts";
import { installOfficeViewerFixture } from "./office-viewer-fixture.ts";
import { installEditableTableFixture } from "./editable-table-fixture.ts";
import { installDrawioFixture } from "./drawio-fixture.ts";
import { withAddonLocalDispatch, bindAddonLocalDispatchRequest, getAddonLocalDispatchBlock, verifyAddonLocalMessage } from "../../runtime/src/addons/local-dispatch.js";
import { admitAddonLocalRequest, withAddonLocalRequest } from "../../runtime/src/addons/local-context.js";

function factoryTest(scenario: string, name: string, body: () => Promise<void>) {
  const selected = process.env.PICLAW_DEFAULT_FACTORY_CASE;
  if (selected && selected !== scenario) return;
  test(name, async () => {
    if (selected) return body();
    // Each cold start owns its process-global registries and entire SDK root.
    // Never reset shared fixture history to manufacture an empty application.
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE;
    delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolation = ensureTestFilesystemIsolation(env);
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        cwd: import.meta.dir, env: { ...env, PICLAW_DEFAULT_FACTORY_CASE: scenario }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code !== 0) throw Error(`Isolated default factory ${scenario}:\n${out}\n${err}`);
      expect(code).toBe(0);
    } finally { isolation.cleanup(); }
  }, 30_000);
}

for (const uncertain of [false, true]) factoryTest(`cleanup-${uncertain}`, `actual preparation → bootstrap → main retains owner only for uncertain close=${uncertain}`, async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const workspace = process.env.PICLAW_WORKSPACE!;
  const acquire = () => acquireRuntimeLock({ lockPath: join(workspace, "preparation-owner.lock"), strictOwnership: true, disabled: false });
  const owner = acquire();
  const primary = Error("storage initialization failed"), cleanup = Error("application close failed before close");
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const services = { modelRuntime: { getPhysicalModel: () => model }, modelRegistry: { getAvailable: () => [model] } } as unknown as RuntimeModelServices;
  const originalClose = BunSqliteDatabase.prototype.close;
  let captured: BunSqliteDatabase | undefined;
  const close = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(function (this: BunSqliteDatabase) {
    captured = this;
    return uncertain ? Promise.reject(cleanup) : originalClose.call(this);
  });
  const transaction = spyOn(BunSqliteDatabase.prototype, "transaction").mockRejectedValue(primary);
  const deps = createDefaultRuntimeBootstrapDeps({ queue: {}, state: {} } as any,
    actual => createDefaultApplicationRuntime(actual, async () => services));
  deps.initializeRuntimeEnvironment = () => {};
  const pool = spyOn(deps, "createAgentPool").mockRejectedValue(Error("must not construct pool"));
  try {
    let thrown: unknown;
    try { await main({ acquireLock: () => owner, createBootstrapDeps: () => deps }); } catch (error) { thrown = error; }
    expect(captured).toBeDefined();
    expect(pool).not.toHaveBeenCalled();
    if (uncertain) {
      expect(thrown).toBeInstanceOf(RuntimeStartupCleanupError);
      expect((thrown as AggregateError).errors).toEqual([primary, cleanup]);
      expect((thrown as AggregateError).errors[0]).toBe(primary);
      expect((thrown as AggregateError).errors[1]).toBe(cleanup);
      owner.assertCurrentOwner(); expect(acquire).toThrow("refuses existing lock");
    } else {
      expect(thrown).toBe(primary);
      acquire().release();
    }
  } finally {
    transaction.mockRestore(); close.mockRestore(); pool.mockRestore();
    if (captured) await originalClose.call(captured);
    owner.release(); closeDatabase();
  }
});

const explicitDelegateCases: Record<string, { id: string; model: string | number; denied?: boolean; exclude?: "model" | "provider" }> = {
  "native-delegate-explicit": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini" },
  "native-delegate-explicit-parent": { id: "gpt-5-mini", model: "synthetic/gpt-6.1-sol" },
  "native-delegate-explicit-slash": { id: "openai/gpt-6-astra", model: "synthetic/openai/gpt-6-astra" },
  "native-delegate-explicit-higher": { id: "gpt-5-pro", model: "synthetic/gpt-5-pro" },
  "native-delegate-explicit-unavailable": { id: "gpt-5-mini", model: "synthetic/gpt-5-pro", denied: true },
  "native-delegate-explicit-unclassified": { id: "approved-b", model: "synthetic/approved-b", denied: true },
  "native-delegate-explicit-excluded-model": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini", denied: true, exclude: "model" },
  "native-delegate-explicit-excluded-provider": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini", denied: true, exclude: "provider" },
  "native-delegate-explicit-short": { id: "gpt-5-mini", model: "gpt-5-mini", denied: true },
  "native-delegate-explicit-empty": { id: "gpt-5-mini", model: "synthetic/", denied: true },
  "native-delegate-explicit-type": { id: "gpt-5-mini", model: 42, denied: true },
  "native-delegate-explicit-fuzzy": { id: "gpt-5-mini", model: "synthetic/GPT-5-mini", denied: true },
  "native-delegate-explicit-virtual": { id: "gpt-5-mini", model: "synthetic/virtual", denied: true },
};
for (const scenario of ["native-compaction-accounting-close-fail", "native-compaction-accounting-recover", "native-compaction-accounting-side-provenance", "native-compaction-accounting-side-dispatch", "native-compaction-accounting-unknown", "native-compaction-accounting", "native-scheduler-accounting-unknown", "native-scheduler-accounting", "native-delegate-accounting-unknown", "native-delegate-accounting", "native-parent-accounting-two-turns", "native-parent-accounting-close-work-fail", "native-parent-accounting-storage-fail", "native-parent-accounting-rotate", "native-parent-accounting-auth-deny", "native-parent-accounting-unknown", "native-parent-accounting", "public-shim-compaction", "source-filter-subset", "public-admission-row-mismatch", "public-admission-chat-mismatch", "public-archived-admission", "public-thinking-reasoning", "native-mcp-cleanup-fail", "native-mcp-disconnect", "native-mcp-catalog-change", "native-mcp-error", "native-parent-budget-cap", "native-parent-budget-auth-cap", "native-mcp-concurrent", "native-mcp-config-change", "native-mcp-codemode", "native-mcp-codemode-cancel", "native-mcp-http-deny", "native-codemode-drawio", "native-codemode-drawio-cancel", "native-codemode-editable-table", "native-codemode-editable-table-cancel", "native-codemode-office-viewer", "native-codemode-office-viewer-cancel", "native-codemode-plan", "native-codemode-plan-cancel", "native-codemode-reopen", "native-codemode-cancel", "native-codemode-harness", "native-drawio", "native-drawio-cancel", "native-drawio-missing-opener", "native-drawio-prepare-held", "public-conversations", "custom-subset", "pending-host", "native-office-viewer", "native-office-viewer-cancel", "native-editable-table", "native-editable-table-missing-publisher", "native-editable-table-revoked", "native-editable-table-closed-publisher", "native-editable-table-nonweb", "native-editable-table-branch", "native-editable-table-archived", "native-editable-table-harness-generation", "native-code-review", "native-codemode-code-review", "native-codemode-code-review-cancel", "native-plan", "native-scheduler", "native-delegate", "native-delegate-standard", "native-delegate-readonly-deny", "native-delegate-standard-revoke", "native-delegate-files", "native-delegate-images", "native-delegate-timeout", "native-delegate-denied", "native-delegate-revoke-cap", "native-delegate-revoke-provider", ...Object.keys(explicitDelegateCases)] as const) factoryTest(scenario, scenario.startsWith("native-mcp-") ? `configured default factory: ${scenario}` : scenario === "custom-subset"
  ? "default factory preserves persisted custom read subset and all metadata/history/identity on reopen"
  : scenario === "pending-host"
    ? "default factory rejects genuine old bash default with pending host source without SQL mutation"
    : "default factory prepares and reopens real startup-known public conversations; refuses legacy before models", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false });
  initDatabase();
  let root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  let calls = 0;
  let onProviderResponse: (() => void) | undefined;
  let onCredentialResolve: (() => Promise<void>) | undefined;
  const customSubset = scenario === "custom-subset" || scenario === "source-filter-subset";
  const sourceFilter = scenario === "source-filter-subset";
  const reasoningThinking = scenario === "public-thinking-reasoning";
  const delegateAccounting = scenario.startsWith("native-delegate-accounting");
  const delegateAccountingUnknown = scenario === "native-delegate-accounting-unknown";
  const scheduledAccounting = scenario.startsWith("native-scheduler-accounting");
  const scheduledAccountingUnknown = scenario === "native-scheduler-accounting-unknown";
  const nativeScheduler = scenario === "native-scheduler" || scheduledAccounting;
  const compactionAccounting = scenario.startsWith("native-compaction-accounting");
  const compactionAccountingUnknown = scenario === "native-compaction-accounting-unknown";
  const compactionCloseFailure = scenario === "native-compaction-accounting-close-fail";
  let inManualSummary = false;
  let checkpointHold: { entered(): void; signal?: AbortSignal } | undefined;
  const parentAccounting = scenario.startsWith("native-parent-accounting") || delegateAccounting || scheduledAccounting || compactionAccounting;
  const accountingTwoTurns = scenario === "native-parent-accounting-two-turns";
  const accountingAuthDenied = scenario === "native-parent-accounting-auth-deny";
  const accountingRotate = scenario === "native-parent-accounting-rotate";
  const accountingCloseFailure = scenario === "native-parent-accounting-close-work-fail";
  const accountingStorageFailure = scenario === "native-parent-accounting-storage-fail";
  const accountingUnknown = scenario === "native-parent-accounting-unknown";
  const model = { provider: parentAccounting ? "openai-codex" : "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: reasoningThinking, contextWindow: 10000, maxTokens: 1000, cost: { input: parentAccounting ? 1 : 0, output: parentAccounting ? 1 : 0, cacheRead: 0, cacheWrite: 0 } };
  if (parentAccounting) {
    mkdirSync(getPiclawAgentDir(), { recursive: true });
    writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", accountId: "synthetic-account", expires: Date.now() + 60000 } }), { mode: 0o600 });
    onCredentialResolve = async () => {
      if (delegateAccounting || scheduledAccounting || compactionAccounting) expect((root.query("SELECT COUNT(*) AS n FROM budget_request_reservations WHERE state='reserved'").get() as { n: number }).n).toBeGreaterThan(0);
      else expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([...(accountingTwoTurns && calls > 0 ? [{ state: "settled" }] : []), { state: "reserved" }]);
      if (accountingAuthDenied) throw Error("Synthetic auth denial");
      if (accountingCloseFailure) root.exec("CREATE TRIGGER accounting_work_close_fail BEFORE UPDATE ON budget_work WHEN OLD.parent_work_id IS NULL AND NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'synthetic operation work close failure'); END");
      if (accountingStorageFailure) root.exec("CREATE TRIGGER accounting_usage_fail BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT, 'synthetic usage write failure'); END");
      if (accountingRotate) writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "rotated-access", refresh: "rotated-refresh", accountId: "rotated-account", expires: Date.now() + 60000 } }), { mode: 0o600 });
    };
  }
  const requested: string[] = [];
  const planRequests: string[] = [];
  let toolSequence: { name: string; arguments: JsonObject | (() => JsonObject) }[] | undefined;
  if (accountingTwoTurns) toolSequence = [{ name: "read", arguments: { path: "accounting-two-turns.txt" } }];
  if (accountingTwoTurns) writeFileSync(join(workspace, "accounting-two-turns.txt"), "accounted tool turn");
  const nativeMcp = scenario.startsWith("native-mcp-");
  const mcpDisconnected = scenario === "native-mcp-disconnect";
  const mcpCatalogChanged = scenario === "native-mcp-catalog-change";
  const mcpError = scenario === "native-mcp-error";
  const mcpCancelled = scenario === "native-mcp-codemode-cancel";
  const mcpConcurrent = scenario === "native-mcp-concurrent";
  const mcpConfigChanged = scenario === "native-mcp-config-change";
  const mcpMarker = join(workspace, "mcp-calls"), mcpPid = join(workspace, "mcp-pid");
  if (nativeMcp) {
    mkdirSync(join(workspace, ".pi"), { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: "native", codemode: "on" } } }), { mode: 0o600 });
    writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: scenario === "native-mcp-http-deny" ? { url: "https://invalid.invalid/mcp" } : { command: process.execPath, args: [join(import.meta.dir, "mcp-stdio-fixture.ts"), mcpMarker, mcpPid] } } }));
    await hydrateMcpKeychainCredentials(workspace, async () => { throw Error("No keychain access allowed"); });
    toolSequence = [{ name: "codemode", arguments: { code: mcpDisconnected
      ? 'try { await tools.mcp__fixture__echo({message:"MCP_DISCONNECT"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : mcpCatalogChanged
      ? 'try { await tools.mcp__fixture__echo({message:"MCP_CATALOG_CHANGED"}); } catch {} try { await tools.mcp__fixture__echo({message:"FORBIDDEN_AFTER_CHANGE"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : mcpError
      ? 'const result = await tools.mcp__fixture__echo({message:"MCP_ERROR_SENTINEL"}); if (result.isError !== true) throw Error("MCP error flag lost"); console.log(result);'
      : mcpConcurrent
      ? 'const results = await Promise.all([tools.mcp__fixture__echo({message:"MCP_FIRST"}), tools.mcp__fixture__echo({message:"MCP_SECOND"})]); if (!JSON.stringify(results[0]).includes("MCP_FIRST") || !JSON.stringify(results[1]).includes("MCP_SECOND")) throw Error("MCP response correlation lost"); return results;'
      : mcpCancelled || mcpConfigChanged
      ? 'try { await tools.mcp__fixture__echo({message:"FORBIDDEN"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : 'console.log(await tools.mcp__fixture__echo({message:"OWNED_MCP_SENTINEL"}));' } }];
  }
  const codemodeReview = scenario === "native-codemode-code-review" || scenario === "native-codemode-code-review-cancel";
  const codemodeReviewCancelled = scenario === "native-codemode-code-review-cancel";
  const nativeReview = scenario === "native-code-review" || codemodeReview;
  const reviewPackage = nativeReview ? installCodeReviewFixture(workspace) : undefined;
  if ((scenario === "native-codemode-cancel" || scenario === "native-codemode-harness")) toolSequence = [{ name: "codemode", arguments: {
    code: 'try { await tools.write({path:"codemode-forbidden.txt",content:"FORBIDDEN"}); } catch {} store("revoked-sentinel", {secret:"MUST_NOT_PERSIST"}); console.log("done");',
  } }];
  const codemodeReadPath = join(workspace, "codemode-reopen-read.txt");
  const codemodeMarker = join(workspace, "codemode-reopen-entered");
  const codemodePid = join(workspace, "codemode-reopen-pid");
  if (scenario === "native-codemode-reopen") {
    writeFileSync(codemodeReadPath, "NATIVE_CODEMODE_FIRST_READ");
    toolSequence = [{ name: "codemode", arguments: { code: `const first = await tools.read({path:${JSON.stringify(codemodeReadPath)}}); try { await tools.bash({command:${JSON.stringify(`printf x >> '${codemodeMarker}'; printf '%s' $$ > '${codemodePid}'; exec sleep 1000`)}}); } catch {} console.log(first);` } }];
  }
  const codemodeDrawio = scenario === "native-codemode-drawio" || scenario === "native-codemode-drawio-cancel";
  const nativeDrawio = scenario.startsWith("native-drawio") || codemodeDrawio;
  const drawioCancelled = scenario === "native-drawio-cancel" || scenario === "native-codemode-drawio-cancel";
  const drawioPath = codemodeDrawio ? "codemode-diagrams/new.drawio" : "nested/new.drawio";
  let drawioNestedCaptures = 0, drawioCreates = 0;
  let drawioDefaultXml: string | undefined;
  const drawioRequests: string[] = [];
  const drawioMissingOpener = scenario === "native-drawio-missing-opener";
  if (nativeDrawio) {
    const drawioPackage = await installDrawioFixture(workspace);
    if (codemodeDrawio) drawioDefaultXml = (await import(join(drawioPackage, "tool.ts"))).DEFAULT_DRAWIO_XML;
    writeFileSync(join(workspace, "existing.drawio"), "PRESERVED_DRAWIO");
    toolSequence = codemodeDrawio ? [{ name: "codemode", arguments: { code: drawioCancelled
      ? `try { await tools.open_drawio_editor({path:'codemode-diagrams/new.drawio'}); } catch {} store('revoked-drawio','MUST_NOT_PERSIST'); console.log('done');`
      : `const result=await tools.open_drawio_editor({path:'codemode-diagrams/new.drawio'}); if(typeof result!=="string") throw Error("Expected native tool output string"); console.log(result); const existing=await tools.open_drawio_editor({path:'existing.drawio'}); if(typeof existing!=="string") throw Error("Expected native tool output string"); console.log(existing);` } }]
      : [{ name: "open_drawio_editor", arguments: { path: "nested/new.drawio" } }, { name: "open_drawio_editor", arguments: { path: "existing.drawio" } }];
  }
  const codemodeOffice = scenario === "native-codemode-office-viewer" || scenario === "native-codemode-office-viewer-cancel";
  const nativeOffice = scenario.startsWith("native-office-viewer") || codemodeOffice;
  const officeCancelled = scenario === "native-office-viewer-cancel" || scenario === "native-codemode-office-viewer-cancel";
  const officePath = codemodeOffice ? "office-fixture.csv" : "office.csv";
  let officeNestedCaptures = 0;
  if (nativeOffice) {
    installOfficeViewerFixture(workspace);
    writeFileSync(join(workspace, officePath), "name,value\nfixture,1650\n");
    writeFileSync(join(workspace, "office.txt"), "unsupported");
    toolSequence = codemodeOffice ? [{ name: "codemode", arguments: () => ({ code: officeCancelled
      ? `try { await tools.open_office_viewer(${JSON.stringify({ path: officePath })}); } catch {} store("revoked-office", "MUST_NOT_PERSIST"); console.log("done");`
      : `const result = await tools.open_office_viewer(${JSON.stringify({ path: officePath })}); if (typeof result !== "string") throw Error("Expected native tool output string"); console.log(result);` }) }]
      : [{ name: "open_office_viewer", arguments: { path: "@office.csv" } },
        ...["office.txt", "missing.docx", "/tmp/outside-office.csv"].map(path => ({ name: "open_office_viewer", arguments: { path } }))];
  }
  const codemodeTable = scenario === "native-codemode-editable-table" || scenario === "native-codemode-editable-table-cancel";
  const codemodeTableCancelled = scenario === "native-codemode-editable-table-cancel";
  const nativeTable = scenario.startsWith("native-editable-table") || codemodeTable;
  let tableNestedCaptures = 0;
  if (nativeTable) {
    installEditableTableFixture(workspace);
    const tableArgs: JsonObject = { markdown: "Name | Role\n--- | ---\nRui | User", title: codemodeTable ? " Nested table " : " People " };
    toolSequence = codemodeTable ? [{ name: "codemode", arguments: { code: codemodeTableCancelled
      ? `try { await tools.editable_table(${JSON.stringify(tableArgs)}); } catch {} store('revoked-table','MUST_NOT_PERSIST'); console.log('done');`
      : `const output=await tools.editable_table(${JSON.stringify(tableArgs)});console.log(output);` } }]
      : [{ name: "editable_table", arguments: tableArgs }];
  }
  const codemodePlan = scenario.startsWith("native-codemode-plan");
  const codemodePlanCancelled = scenario === "native-codemode-plan-cancel";
  const nativePlan = scenario === "native-plan" || codemodePlan;
  const planStep = codemodePlan ? "CODEMODE_PLAN_OWNED" : "NATIVE_PLAN_NEW";
  if (nativePlan) {
    const source = process.env.DURABLE_ADDONS_ROOT;
    if (!source) throw Error("DURABLE_ADDONS_ROOT required");
    const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const [file, hash] of Object.entries({
      "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
      "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
      "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
    })) {
      const path = join(source, "addons/plan-sidebar", file);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      copyFileSync(path, join(pkg, file));
    }
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } }));
    extensionKvSet("plan-sidebar", "plan", { chat_jid: "web:default", markdown: "- [ ] NATIVE_PLAN_OLD", updated_at: "2026-01-01" }, "chat", "web:default");
    toolSequence = codemodePlan ? [{ name: "codemode", arguments: { code: codemodePlanCancelled
      ? 'try { await tools.plan({action:"update",plan:[{step:"CODEMODE_PLAN_OWNED",status:"in_progress"}]}); } catch {} store("revoked-sentinel", {secret:"MUST_NOT_PERSIST"}); console.log("done");'
      : 'const r=await tools.plan({action:"update",plan:[{step:"CODEMODE_PLAN_OWNED",status:"in_progress"}]});console.log(r)' } }]
      : [{ name: "plan", arguments: { action: "update", plan: [{ step: planStep, status: "in_progress" }] } }];
  }
  const standardDelegate = scenario === "native-delegate-standard" || scenario === "native-delegate-standard-revoke";
  const readonlyDeny = scenario === "native-delegate-readonly-deny";
  const writeDelegate = standardDelegate || readonlyDeny;
  const revokeDelegate = scenario === "native-delegate-revoke-cap" || scenario === "native-delegate-revoke-provider" || scenario === "native-delegate-standard-revoke";
  const timeoutDelegate = scenario === "native-delegate-timeout";
  const explicitDelegate = explicitDelegateCases[scenario];
  const delegateImagesCase = scenario === "native-delegate-images";
  const delegateFiles = scenario === "native-delegate-files" || delegateImagesCase;
  if (delegateFiles) writeFileSync(join(workspace, "delegate-task"), delegateImagesCase ? Buffer.from(delegateImages.png, "base64") : "NATIVE_FILE_BYTES\r\n\t");
  const nativeDelegate = delegateAccounting || writeDelegate || delegateFiles || scenario === "native-delegate" || scenario === "native-delegate-denied" || revokeDelegate || timeoutDelegate || !!explicitDelegate;
  const delegateAllowed = writeDelegate || delegateFiles || scenario === "native-delegate" || timeoutDelegate || (!!explicitDelegate && !explicitDelegate.denied);
  const realTimer = globalThis.setTimeout;
  let expireDelegate: (() => void) | undefined;
  let deadlineRegistered!: () => void;
  const deadlineRegistration = new Promise<void>(resolve => { deadlineRegistered = resolve; });
  let timeoutProviderAborted = false;
  const deadlineSpy = timeoutDelegate ? spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== undefined && ms >= 9000 && ms <= 10000) { expireDelegate = callback; deadlineRegistered(); return realTimer(() => {}, 60_000); }
    return realTimer(callback, ms, ...args);
  }) as typeof setTimeout) : undefined;
  const sentinel = "PRIVATE_NATIVE_DELEGATE_READ_SENTINEL";
  const childReadPath = join(workspace, "delegate-private-read.txt");
  if (revokeDelegate) writeFileSync(childReadPath, sentinel);
  const childWritePath = (id: string) => join(workspace, `delegate-write-${id}.txt`);
  if (writeDelegate) for (const id of ["A", "B"]) writeFileSync(childWritePath(id), "OLD");
  if (nativeDelegate) {
    const source = process.env.DURABLE_ADDONS_ROOT;
    if (!source) throw Error("DURABLE_ADDONS_ROOT required");
    const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate");
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const [file, hash] of Object.entries({
      "index.ts": "73563d26795cbab5cd92e8d5f8dabe3d7477fa11dff35e0ed8b21d9ec3f5ab51",
      "delegate.ts": "5466936c43f79c4159d75179c9f6a3f1d8d3439000e388902b321d8e7de9c923",
      "compat/extension-kv.ts": "20408155132b8b86975100f0df7fe03a57ad74d2e4bb8d30f13e2a893441d651",
    })) {
      const path = join(source, "addons/delegate", file);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      copyFileSync(path, join(pkg, file));
    }
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
    const manifest = JSON.parse(readFileSync(join(source, "addons/delegate/package.json"), "utf8"));
    expect(manifest.name).toBe("@rcarmo/piclaw-addon-delegate"); expect(manifest.version).toBe("0.2.20");
    writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
    model.id = "gpt-6.1-sol";
    extensionKvSet("delegate", "config", { searchable_providers: scenario !== "native-delegate-denied" ? [model.provider] : [],
      excluded_providers: explicitDelegate?.exclude === "provider" ? [model.provider] : [],
      excluded_models: explicitDelegate?.exclude === "model" ? [String(explicitDelegate.model)] : [] }, "global");
  }
  let childRequests = 0;
  let releaseChildren!: () => void;
  const bothChildren = new Promise<void>(resolve => { releaseChildren = resolve; });
  // Leave room for the real built-in schemas and idle-model framing reserve.
  model.contextWindow = 100000;
  const modelB = { ...model, input: delegateImagesCase ? ["text", "image"] : model.input, id: delegateImagesCase ? "gpt-5-mini" : explicitDelegate?.id ?? (revokeDelegate ? "gpt-5-mini" : nativeScheduler ? "approved/b" : "approved-b"), contextWindow: 200000 };
  const childModels: string[] = [];
  const observedResults = new Map<string, { toolName: string; isError?: boolean; content: unknown }>();
  const stream = (physical: typeof model, input: { messages: { role: string; toolCallId?: string; toolName?: string; isError?: boolean; content: unknown }[] }, options?: { signal?: AbortSignal }) => {
    for (const result of input.messages) if (result.role === "toolResult" && result.toolCallId && result.toolName)
      observedResults.set(result.toolCallId, { toolName: result.toolName, isError: result.isError, content: result.content });
    requested.push(physical.id);
    planRequests.push(JSON.stringify(input));
    calls++; const stream = createAssistantMessageEventStream();
    if (checkpointHold) {
      checkpointHold.signal = options?.signal;
      checkpointHold.entered();
      void awaitWithContext(new Promise<void>(() => {}), withAbortSignal(options!.signal!, context)).catch(() => {
        const error = { role: "assistant" as const, content: [], api: physical.api, provider: physical.provider, model: physical.id,
          timestamp: 1, stopReason: "aborted" as const, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "error", reason: "aborted", error }); stream.end(error);
      });
      return stream;
    }
    if (parentAccounting && !delegateAccounting && !scheduledAccounting && !compactionAccounting) expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([...(accountingTwoTurns && calls > 1 ? [{ state: "settled" }] : []), { state: "dispatched" }]);
    const child = nativeDelegate && JSON.stringify(input.messages.findLast(message => message.role === "user")?.content).includes("NATIVE_DELEGATE_CHILD");
    if (delegateImagesCase && !child) expect(JSON.stringify(input)).not.toContain('"type":"image"');
    const firstDelegate = nativeDelegate && !child && !input.messages.some(message => message.role === "toolResult");
    if (child) {
      childRequests++;
      childModels.push(physical.id);
      if (delegateFiles) {
        const user = JSON.stringify(input.messages.findLast(message => message.role === "user")?.content);
        if (delegateImagesCase) {
          expect(user.includes('"type":"image"')).toBe(user.includes("CHILD_B"));
          expect(physical.id).toBe(user.includes("CHILD_B") ? modelB.id : model.id);
          if (user.includes("CHILD_B")) expect(user).toContain(delegateImages.png);
        } else expect(user.includes("NATIVE_FILE_BYTES")).toBe(user.includes("CHILD_B"));
        expect(user).not.toContain(join(workspace, "delegate-task"));
      }
      expect(JSON.stringify(input)).not.toContain("hello factory");
      expect(JSON.stringify(input)).not.toContain('"name":"delegate"');
      expect(JSON.stringify(input)).not.toContain('"name":"plan"');
      expect(JSON.stringify(input)).not.toContain('"name":"code_review"');
      if (childRequests === (revokeDelegate ? 1 : 2)) {
        releaseChildren();
        if (timeoutDelegate) void deadlineRegistration.then(() => { expireDelegate!(); });
      }
    }
    const childId = JSON.stringify(input.messages.findLast(message => message.role === "user")?.content).includes("CHILD_B") ? "B" : "A";
    const childWrite = child && writeDelegate && !input.messages.some(message => message.role === "toolResult");
    const step = childWrite ? { name: "write", arguments: { path: childWritePath(childId), content: `WRITTEN_${childId}` } } : toolSequence?.shift();
    const scheduledRequest = JSON.stringify(input.messages).includes("scheduled real consumer");
    const pricedResponse = parentAccounting && !accountingUnknown && !(delegateAccountingUnknown && child) && !(scheduledAccountingUnknown && scheduledRequest) && !(compactionAccountingUnknown && inManualSummary);
    const message = { role: "assistant" as const, api: "openai-completions" as const, provider: physical.provider, model: physical.id,
      content: firstDelegate ? (revokeDelegate ? ["A"] : ["A", "B"]).map(id => ({ type: "toolCall" as const, id, name: "delegate", arguments: { prompt: `NATIVE_DELEGATE_CHILD_${id}`, tools: standardDelegate ? "standard" : "read_only", task_category: "reason", ...(delegateImagesCase && id === "B" ? { model: `${modelB.provider}/${modelB.id}` } : {}), ...(explicitDelegate && (explicitDelegate.denied || id === "B") ? { model: explicitDelegate.model } : revokeDelegate ? { model: `${modelB.provider}/${modelB.id}` } : {}), ...(timeoutDelegate && id === "A" ? { timeout_sec: 10 } : {}), ...(delegateFiles && id === "B" ? { files: ["delegate-task"] } : {}) } })) : child && revokeDelegate && !writeDelegate && !input.messages.some(message => message.role === "toolResult") ? [{ type: "toolCall" as const, id: "child-private-read", name: "read", arguments: { path: childReadPath } }] : step ? [{ type: "toolCall" as const, id: `factory-tool-${calls}`, name: step.name, arguments: typeof step.arguments === "function" ? step.arguments() : step.arguments }]
        : [{ type: "text" as const, text: "factory synthetic reply" }], stopReason: step || firstDelegate || (child && revokeDelegate && !input.messages.some(message => message.role === "toolResult")) ? "toolUse" as const : "stop" as const, timestamp: Date.now(),
      usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: pricedResponse ? 0.000005 : 0, output: pricedResponse ? 0.000005 : 0, cacheRead: 0, cacheWrite: 0, total: pricedResponse ? 0.00001 : 0 } } };
    onProviderResponse?.();
    void (async () => {
      if (child) await bothChildren;
      if (child && timeoutDelegate && JSON.stringify(input.messages.findLast(m => m.role === "user")?.content).includes("CHILD_A")) {
        try {
          await awaitWithContext(new Promise<void>(() => {}), options?.signal ? withAbortSignal(options.signal, context) : context);
        } catch (error) {
          timeoutProviderAborted = true;
          const aborted = { ...message, content: [], stopReason: "aborted" as const, errorMessage: String(error) };
          stream.push({ type: "error", reason: "aborted", error: aborted }); stream.end(aborted); return;
        }
      }
      if (scenario === "native-compaction-accounting-side-dispatch") stream.push({ type: "text_delta", contentIndex: 0, delta: "factory synthetic reply", partial: message });
      stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
    })(); return stream;
  };
  const credentialStore = createTestCredentialStore({ [model.provider]: { type: "api_key", key: "synthetic-only" } });
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    credentials: credentialStore,
    allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model, modelB] as any,
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }), resolve: async () => { await onCredentialResolve?.(); return { auth: { apiKey: "synthetic-only" }, source: "synthetic" }; } } },
    stream: stream as any, streamSimple: stream as any });
  // Native registration starts an asynchronous refresh; finish it before
  // reading the synchronous authenticated catalog on a genuinely cold start.
  await runtime.refresh({ allowNetwork: false });
  const modelRegistry = new ModelRegistry(runtime);
  await runtime.getAvailable();
  const services = { modelRuntime: runtime, modelRegistry } as RuntimeModelServices;
  const settings = SettingsManager.create(workspace, getPiclawAgentDir());
  settings.setDefaultModelAndProvider(model.provider, model.id);
  await settings.flush();
  expect(settings.drainErrors()).toEqual([]);
  expect(modelRegistry.getAvailable().map(m => [m.provider, m.id])).toEqual([[model.provider, model.id], [modelB.provider, modelB.id]]);
  expect(SettingsManager.create(workspace, getPiclawAgentDir()).getDefaultModel()).toBe(model.id);
  const sdkSpies = [spyOn(SessionManager, "create"), spyOn(SessionManager, "open"), spyOn(SessionManager, "inMemory")];
  if (scenario === "native-parent-budget-auth-cap") onCredentialResolve = async () => {
    saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
  };
  let compactionPolicySpy: { mockRestore(): void } | undefined;
  if (scenario === "public-shim-compaction" || compactionAccounting) {
    const open = Harness.open;
    compactionPolicySpy = spyOn(Harness, "open").mockImplementation((storage, options, ctx) => open.call(Harness, storage, { ...options,
      settings: { ...options.settings, compaction: { enabled: false, keepRecentTokens: 1 } } }, ctx));
  }
  let realRunCaptures = 0, realToolCaptures = 0;
  const captureSpies: { mockRestore(): void }[] = [];
  if (nativePlan) {
    const captureRun = HostConversationRuntime.prototype.captureRunSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureRunSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureRun.apply(this, args);
      realRunCaptures++;
      expect(captured.operation.chatJid).toBe("web:default");
      const readonly = createPlanKvAuthority(root, captured, () => owner.assertCurrentOwner(), true);
      readonly.assertCurrent();
      expect(() => readonly.write(() => {})).toThrow("Read-only host operation authority");
      await expect(captureRun.call(this, args[0], -1 as never)).rejects.toThrow("Exact host tool run required");
      return captured;
    }));
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      realToolCaptures++;
      expect(captured.inputs[0]?.sourceId).toBe("factory-input");
      const authority = createPlanKvAuthority(root, captured, () => owner.assertCurrentOwner());
      authority.assertCurrent();
      const revoked = createPlanKvAuthority(root, captured, () => { throw Error("Owner lost"); });
      expect(() => revoked.write(() => {})).toThrow("Owner lost");
      const rollback = Error("rollback cancellation probe");
      expect(() => root.transaction(() => {
        root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
        expect(() => authority.write(() => {})).toThrow("Stale host operation authority");
        throw rollback;
      })()).toThrow(rollback);
      authority.assertCurrent();
      if (codemodePlan && args[2].includes("/")) {
        codemodeNestedCaptures++;
        if (codemodePlanCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      return captured;
    }));
  }
  if (codemodeDrawio) {
    const actualOpen = hostFs.openSync;
    captureSpies.push(spyOn(hostFs, "openSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === join(workspace, drawioPath)) drawioCreates++;
      return (actualOpen as Function)(path, ...args);
    }) as typeof hostFs.openSync));
  }
  let codemodeReads = 0;
  if (scenario === "native-codemode-reopen") {
    const actualRead = hostFs.readFileSync;
    captureSpies.push(spyOn(hostFs, "readFileSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === codemodeReadPath) codemodeReads++;
      return (actualRead as Function)(path, ...args);
    }) as typeof hostFs.readFileSync));
    expect(readFileSync(codemodeReadPath, "utf8")).toBe("NATIVE_CODEMODE_FIRST_READ");
    expect(codemodeReads).toBe(1); codemodeReads = 0;
  }
  let codemodeNestedCaptures = 0;
  if ((mcpCancelled || mcpConfigChanged || scenario === "native-codemode-cancel" || scenario === "native-codemode-harness")) {
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      if (args[2].includes("/")) {
        codemodeNestedCaptures++;
        if (mcpConfigChanged) writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: {} }));
        else if (scenario === "native-codemode-harness") root.query("UPDATE service_effect_s01_operations SET harness_watch_generation=harness_watch_generation+1 WHERE operation_id=?").run(captured.operation.operationId);
        else root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      return captured;
    }));
  }
  let childSourceCaptures = 0;
  let sentinelReads = 0;
  if (revokeDelegate) {
    const actualRead = hostFs.readFileSync;
    captureSpies.push(spyOn(hostFs, "readFileSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === childReadPath) sentinelReads++;
      return (actualRead as Function)(path, ...args);
    }) as typeof hostFs.readFileSync));
    // Prove the spy observes the same static fs binding used by host-builtins.
    expect(readFileSync(childReadPath, "utf8")).toBe(sentinel);
    expect(sentinelReads).toBe(1);
    sentinelReads = 0;
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      if (captured.delegateModel) {
        expect(args[2]).toBe(standardDelegate ? `factory-tool-${calls}` : "child-private-read");
        expect(captured.delegateModel).toMatchObject({ provider: modelB.provider, modelId: modelB.id });
        childSourceCaptures++;
        // The real capture has already admitted this model. Revoke across its
        // await boundary, before the default factory returns its effect guard.
        if (scenario === "native-delegate-revoke-cap" || standardDelegate) saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
        else extensionKvSet("delegate", "config", { searchable_providers: [], excluded_providers: [], excluded_models: [] }, "global");
      }
      return captured;
    }));
  }
  if (nativeTable || nativeOffice || nativeDrawio) {
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      realToolCaptures++;
      expect(captured.inputs[0]?.sourceId).toBe("factory-input");
      if (codemodeTable && args[2].includes("/")) {
        tableNestedCaptures++;
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        expect(captured.delegateModel).toBeUndefined();
        if (codemodeTableCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      if (codemodeOffice) {
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        if (args[2].includes("/")) officeNestedCaptures++;
      }
      if (codemodeDrawio && args[2].includes("/")) {
        drawioNestedCaptures++;
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        expect(captured.delegateModel).toBeUndefined();
      }
      if ((officeCancelled && (!codemodeOffice || args[2].includes("/"))) || (drawioCancelled && (!codemodeDrawio || args[2].includes("/")))) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      if (scenario === "native-editable-table-closed-publisher") backend.stop();
      if (scenario === "native-editable-table-revoked") root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      // Host-owned SQL changes the actual authority after capture, not a fake
      // source object or tool result. Neither stale generation may publish.
      if (scenario === "native-editable-table-archived") root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=? AND branch_id=?").run(new Date().toISOString(), captured.inputs[0]!.chatJid, captured.inputs[0]!.branchId);
      if (scenario === "native-editable-table-harness-generation") root.query("UPDATE service_effect_s01_operations SET harness_watch_generation=harness_watch_generation+1 WHERE operation_id=?").run(captured.operation.operationId);
      return captured;
    }));
  }
  if (scenario === "native-mcp-http-deny") {
    await expect(createDefaultApplicationRuntime(owner, async () => { throw Error("Must reject before models"); })).rejects.toThrow();
    expect(existsSync(mcpPid)).toBe(false);
    expect(existsSync(mcpMarker)).toBe(false);
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    owner.release(); closeDatabase(); return;
  }
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>>;
  if (scenario === "native-drawio-prepare-held") {
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const extract = Bun.Archive.prototype.extract;
    const gate = spyOn(Bun.Archive.prototype, "extract").mockImplementation(async function (this: Bun.Archive, ...args) {
      entered(); await hold; return extract.apply(this, args);
    });
    let modelCalls = 0, finished = false;
    const primary = Error("model construction failed after vendor preparation");
    const pending = createDefaultApplicationRuntime(owner, async () => { modelCalls++; throw primary; })
      .then(() => { finished = true; return undefined; }, error => { finished = true; return error; });
    try {
      await inside;
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(finished).toBe(false); expect(modelCalls).toBe(0); expect(calls).toBe(0);
      release(); expect(await pending).toBe(primary); expect(modelCalls).toBe(1);
      const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-drawio-editor/index.ts");
      const addon = await import(pkg);
      expect((await addon.handleRoute(new Request("http://fixture/drawio/index.html"), "/drawio/index.html")).status).toBe(503);
    } finally { release(); await pending; gate.mockRestore(); }
    backend = await createDefaultApplicationRuntime(owner, async () => { modelCalls++; return services; });
    expect(modelCalls).toBe(2);
  } else backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(!!backend.sessionOptions.getDurableSession?.("web:default")).toBe(true);
  const first = backend.sessionOptions.getDurableSession?.("web:default");
  expect(first).toBeDefined(); expect(calls).toBe(0);
  const base = createRuntimeBaseServices({ dataDir: workspace });
  const pool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
  const bound = backend.bind({ queue: base.queue, agentPool: pool });
  const channel = new WebChannel(bound);
  const widgetEvents: { event: string; data: unknown }[] = [];
  const broadcast = channel.broadcastEvent.bind(channel);
  channel.broadcastEvent = (event, data) => { if (event === "extension_ui_widget") widgetEvents.push({ event, data }); broadcast(event, data); };
  const tableChat = scenario === "native-editable-table-nonweb" ? "whatsapp:fixture" : scenario === "native-editable-table-branch" ? "web:table-branch" : "web:default";
  let sseText = "";
  let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let sseDrain: Promise<void> | undefined;
  if (nativeTable || nativeDrawio) {
    if (scenario !== "native-editable-table-missing-publisher") {
      const attached = drawioMissingOpener ? { broadcastEvent: channel.broadcastEvent.bind(channel) } : channel;
      backend.attachChannel!(attached);
      expect(() => backend.attachChannel!(attached)).toThrow("already attached");
    }
    const response = await channel.handleRequest(new Request(`http://fixture/sse/stream?chat_jid=${encodeURIComponent(tableChat)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    sseReader = response.body!.getReader();
    sseDrain = (async () => {
      const replied = new Set<string>();
      for (;;) {
        const chunk = await sseReader!.read(); if (chunk.done) return;
        sseText += new TextDecoder().decode(chunk.value);
        if (nativeDrawio) for (const line of sseText.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let payload: any; try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.kind !== "custom" || !payload.request_id || replied.has(payload.request_id)) continue;
          replied.add(payload.request_id);
          drawioRequests.push(payload.request_id);
          expect(payload).toMatchObject({ chat_jid: "web:default", options: { action: "open_workspace_file", target: "tab" } });
          const reply = await channel.handleRequest(new Request("http://fixture/agent/respond", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: payload.request_id, chat_jid: payload.chat_jid, outcome: { ok: true, opened: true, target: "tab" } }) }));
          expect(await reply.json()).toMatchObject({ status: "ok" });
        }
      }
    })();

  }
  if (nativeScheduler) {
    const prohibited = [spyOn(pool, "runAgent"), spyOn(pool, "saveSessionPosition"), spyOn(pool, "restoreSessionPosition"), spyOn(pool, "getCurrentModelLabel")];
    prohibited.forEach(spy => spy.mockImplementation(() => { throw Error("legacy scheduler path"); }));
    const delivered: string[] = [];
    const scheduledStore = createCurrentPiclawScheduledRunStore(root, { hitFault: () => false, recordTrace() {} });
    if (!scheduledStore.ok) throw Error("Scheduled store unavailable");
      if (scheduledAccountingUnknown) {
        const id = "native-schedule-unknown", due = new Date(0).toISOString();
        createTask({ id, chat_jid: "web:default", prompt: "scheduled real consumer", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        const before = calls;
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_jid, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(calls).toBe(before + 1);
        expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled'").all()).toEqual([{ state: "unresolved" }]);
        expect(root.query("SELECT status,scheduled_task_id FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled'").all()).toEqual([{ status: "active", scheduled_task_id: id }]);
        expect(root.query("SELECT t.invocation_id FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='scheduled'").all()).toHaveLength(0);
        expect(delivered.join(" ")).not.toContain("factory synthetic reply");
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
        closeDatabase(); initDatabase(); root = getDb();
        expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled'").all()).toEqual([{ state: "unresolved" }]);
        expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled'").all()).toEqual([{ status: "active" }]);
        for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
        closeDatabase(); owner.release(); return;
      }
    try {
      storeChatMetadata("web:scheduled-dynamic", new Date().toISOString());
      await bound.prepareInputSourceAdmission!("web:scheduled-dynamic");
      for (const [index, chat] of ["web:default", "web:scheduled-dynamic", "web:default"].entries()) {
        if (index === 2) {
          const message = { id: "scheduler-main-seed", chat_jid: chat, sender: "user", sender_name: "User", content: "main history", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
          const row = root.transaction(() => { const id = storeMessage(message); const admit = bound.getInputSourceAdmission!(chat); assert(admit); admit({ message, rowId: id, database: root }); return id; })();
          expect(await bound.dispatchAcceptedInput!(chat, message.id, row!)!()).toBe("settled");
        }
        const port = backend.sessionOptions.getDurableSession!(chat)!;
        const position = await port.readPosition();
        expect(await port.readModel!()).toBe(`${model.provider}/${model.id}`);
        const before = JSON.stringify(root.query("SELECT * FROM entries WHERE conversation_id=(SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE source_id='scheduler-main-seed') ORDER BY id").all());
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-schedule-${index}`;
        createTask({ id, chat_jid: chat, model: `${modelB.provider}/${modelB.id}`, prompt: "scheduled real consumer", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM service_effect_s07_occurrences WHERE task_id=? AND state='completed'").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT state FROM service_effect_s07_occurrences WHERE task_id=?").get(id)).toEqual({ state: "completed" });
        expect(await port.readPosition()).toBe(position);
        expect(await port.readModel!()).toBe(`${model.provider}/${model.id}`);
        expect(requested.at(-1)).toBe(modelB.id);
        expect(JSON.stringify(root.query("SELECT * FROM entries WHERE conversation_id=(SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE source_id='scheduler-main-seed') ORDER BY id").all())).toBe(before);
        if (!delivered.at(-1)) throw Error(JSON.stringify(root.query("SELECT * FROM task_run_logs WHERE task_id=?").all(id)));
        expect(delivered.at(-1)).toBe("factory synthetic reply");
      }
      expect(delivered).toHaveLength(3);
    if (scheduledAccounting) {
      expect(root.query("SELECT r.state, COUNT(*) AS n FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled' GROUP BY r.state").all()).toEqual([{ state: "settled", n: 3 }]);
      expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled' AND scheduled_task_id LIKE 'native-schedule-%' AND status='completed'").get()).toEqual({ n: 3 });
      expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NOT NULL AND execution_kind='scheduled' AND status='completed'").get()).toEqual({ n: 3 });
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE t.invocation_id IS NOT NULL AND w.execution_kind='scheduled'").get()).toEqual({ amount: 30 });
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
      expect(root.query("SELECT COUNT(*) AS n FROM task_run_logs WHERE task_id LIKE 'native-schedule-%' AND status='success'").get()).toEqual({ n: 3 });
      for (const [index, label] of ["unknown/model", "synthetic/", "synthetic", "/approved", "synthetic/virtual"].entries()) {
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-model-denied-${index}`;
        const beforeCalls = calls, beforeForks = root.query("SELECT COUNT(*) AS n FROM conversations").get();
        createTask({ id, chat_jid: "web:default", model: label, prompt: "must not dispatch", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async () => {} }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(id)).toEqual({ status: "error" });
        expect(calls).toBe(beforeCalls);
        expect(root.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual(beforeForks);
      }
      // Exercise the actual scheduler/AgentPool consumer, not a budget stub.
      // Even a positive allowance is unqualified without per-request binding.
      for (const [index, amount] of [0, 1_000_000].entries()) {
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-budget-denied-${index}`;
        const cap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount, scheduledTaskId: id }, root);
        const beforeCalls = calls, beforeForks = root.query("SELECT COUNT(*) AS n FROM conversations").get();
        createTask({ id, chat_jid: "web:default", prompt: "must not dispatch", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT status,error FROM task_run_logs WHERE task_id=?").get(id)).toEqual({ status: "error", error: "Native scheduled budget admission unavailable" });
        expect(calls).toBe(beforeCalls);
        expect(root.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual(beforeForks);
        expect(delivered).toHaveLength(3);
        setBudgetCapEnabled(cap.id, false, root);
      }
      // Enable a real cap after the first admitted provider effect. Neither the
      // returned write nor the next provider request may use the stale grant.
      const midrunId = "native-budget-midrun", target = join(workspace, "scheduled-budget-must-not-write.txt");
      const cap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount: 1_000_000, scheduledTaskId: midrunId }, root);
      setBudgetCapEnabled(cap.id, false, root);
      toolSequence = [{ name: "write", arguments: { path: target, content: "forbidden" } }];
      const beforeMidrun = calls;
      onProviderResponse = () => { onProviderResponse = undefined; setBudgetCapEnabled(cap.id, true, root); };
      const due = new Date(Date.now() - 1000).toISOString();
      createTask({ id: midrunId, chat_jid: "web:default", prompt: "write then reply", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
      await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
      const deadline = Date.now() + 5000;
      while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(midrunId) && Date.now() < deadline) await Bun.sleep(10);
      expect(calls).toBe(beforeMidrun + 1);
      expect(existsSync(target)).toBe(false);
      expect(delivered).toHaveLength(3);
      expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(midrunId)).toEqual({ status: "error" });
      setBudgetCapEnabled(cap.id, false, root);
      // Credential resolution awaits after source capture: the post-auth fence
      // must reject a newly enabled cap before the synthetic provider is called.
      const credentialId = "native-budget-credentials";
      const credentialCap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount: 1_000_000, scheduledTaskId: credentialId }, root);
      setBudgetCapEnabled(credentialCap.id, false, root);
      let credentialBarrierHit = false;
      onCredentialResolve = async () => {
        onCredentialResolve = undefined;
        await Bun.sleep(0);
        credentialBarrierHit = true;
        setBudgetCapEnabled(credentialCap.id, true, root);
      };
      const beforeCredentials = calls, credentialDue = new Date(Date.now() - 1000).toISOString();
      createTask({ id: credentialId, chat_jid: "web:default", prompt: "must not send after auth", schedule_type: "once", schedule_value: credentialDue, next_run: credentialDue, status: "active", notify_on_complete: false, created_at: credentialDue });
      await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
      const credentialDeadline = Date.now() + 5000;
      while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(credentialId) && Date.now() < credentialDeadline) await Bun.sleep(10);
      expect(credentialBarrierHit).toBe(true);
      expect(calls).toBe(beforeCredentials);
      expect(delivered).toHaveLength(3);
      expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(credentialId)).toEqual({ status: "error" });
      setBudgetCapEnabled(credentialCap.id, false, root);
      // Only the ordinary seed message publishes through EF-S02; scheduled delivery
      // belongs to EF-S07 and must not create a second timeline answer.
      expect(root.query("SELECT COUNT(*) AS n FROM messages WHERE is_bot_message=1").get()).toEqual({ n: 1 });
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
      const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
      const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
      try {
        const message = { id: "scheduler-after-reopen", chat_jid: "web:default", sender: "user", sender_name: "User", content: "ordinary message after scheduled forks", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
        const row = root.transaction(() => { const id = storeMessage(message); const admit = reopened.getInputSourceAdmission!(message.chat_jid); assert(admit); admit({ message, rowId: id, database: root }); return id; })();
        expect(await reopened.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe("settled");
        expect(root.query("SELECT COUNT(*) AS n FROM messages WHERE is_bot_message=1").get()).toEqual({ n: 2 });
        expect(requested.at(-1)).toBe(model.id);
        expect(await backend.sessionOptions.getDurableSession!("web:default")!.readModel!()).toBe(`${model.provider}/${model.id}`);
      } finally { await reopenedBase.queue.shutdown(); await reopenedPool.shutdown(); }
      prohibited.forEach(spy => expect(spy).not.toHaveBeenCalled());
      sdkSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    } finally {
      stopSchedulerLoop(); prohibited.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase();
    }
    return;
  }
  const assertContext = async (contextWindow: number) => {
    const before = calls;
    channel.setContextUsage("web:default", { tokens: 999, contextWindow: 10000, percent: 9.99, sessionGeneration: first!.sessionId });
    const response = await channel.handleRequest(new Request("http://fixture/agent/context?chat_jid=web%3Adefault"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tokens: null, contextWindow, percent: null, sessionGeneration: first!.sessionId });
    expect(calls).toBe(before);
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
  };
  await assertContext(100000);
  await expect(pool.getContextUsageForChat("web:unbound-context")).rejects.toThrow("Durable application does not construct legacy sessions");
  expect(() => bound.getInputSourceAdmission!("web:newcomer")).toThrow("Unbound");
  const message = { id: "factory-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "hello factory", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
  if (reviewPackage) {
    const api = await import(join(reviewPackage, "runtime.ts"));
    const service = api.reviewService();
    expect(service.database.db).toBe(root);
    const request = new Request("http://fixture/agent/addons/api/code-review/action", { method: "POST" });
    admitAddonLocalRequest(request, { userId: "default", mode: "single-user" } as any, () => true);
    let review: any, thread: any;
    writeFileSync(join(workspace, "review-source.ts"), "const saved = true;\n");
    await withAddonLocalRequest(request, async ctx => {
      expect(ctx!.ownerId).toBe("default");
      const invoke = async (body: unknown) => {
        const response = await api.handleReviewRequest(body, request, ctx);
        expect(response.ok).toBe(true); return response.result;
      };
      review = await invoke({ action: "create", path: "review-source.ts", title: "Native review", target: { chatId: "web:default" }, requestId: "review-create" });
      thread = await invoke({ action: "comment", reviewId: review.reviewId, fileId: review.files[0], side: "source", body: "NATIVE_SAVED_REVIEW_THREAD", requestId: "review-comment" });
    });
    const target = { chatId: "web:default", incarnation: first!.branchId, label: "Default" };
    const who = { ownerId: "default", actorId: "default", kind: "operator", workspaceId: createHash("sha256").update(workspace).digest("hex") };
    const submitted = service.submit(who, review.reviewId, { target, items: [{ threadId: thread.threadId, version: 1 }] }, { requestId: "review-send" });
    let row!: number;
    await service.deliver(who, submitted.dispatchId, { async enqueue(input: any) {
      message.content = input.content;
      await withAddonLocalDispatch({ chatJid: target.chatId, incarnation: target.incarnation }, input.content, input.reference, async () => {
        const req = new Request("http://fixture/internal"); bindAddonLocalDispatchRequest(req, target.chatId, input.content);
        const marked = { ...message, content_blocks: [getAddonLocalDispatchBlock(req, target.chatId, input.content)!] };
        expect(verifyAddonLocalMessage(target.chatId, marked)?.reference?.intentId).toBe(submitted.dispatchId);
        row = root.transaction(() => { const id = storeMessage(marked); const admit = bound.getInputSourceAdmission!(target.chatId); assert(admit); admit({ message: marked, rowId: id, database: root }); return id; })()!;
      });
      return { status: "accepted", rowId: row };
    } });
    storeChatMetadata("web:review-other", new Date().toISOString());
    await bound.prepareInputSourceAdmission!("web:review-other");
    const otherTarget = { chatId: "web:review-other", incarnation: backend.sessionOptions.getDurableSession!("web:review-other")!.branchId, label: "Other" };
    const secret = "SECRET_OTHER_CHAT_REVIEW";
    const otherReview = service.createFromCapture(who, { title: "Other review", focusPath: "other.ts", target: otherTarget }, {
      workspaceId: who.workspaceId, worktreeId: "other-tree", mode: "source", base: null, head: null, capturedAt: new Date().toISOString(),
      files: [{ oldPath: null, newPath: "other.ts", oldText: null, newText: secret, change: "source", fileIdentity: "other-inode" }],
    }, { requestId: "other-create" });
    const otherThread = service.createThread(who, otherReview.reviewId, { fileId: otherReview.files[0], side: "source", body: secret }, { requestId: "other-comment" });
    const otherDispatch = service.submit(who, otherReview.reviewId, { target: otherTarget, items: [{ threadId: otherThread.threadId, version: 1 }] }, { requestId: "other-send" });
    expect(service.inspectDispatch(who, otherDispatch.dispatchId)).toBeDefined();
    if (codemodeReview) {
      const beforeThread = service.getThread(who, thread.threadId);
      const beforeOther = service.getThread(who, otherThread.threadId);
      const beforeDispatch = service.inspectDispatch(who, submitted.dispatchId);
      const beforeKv = root.query("SELECT * FROM extension_kv").all();
      const captureTool = HostConversationRuntime.prototype.captureToolSource;
      captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
        const captured = await captureTool.apply(this, args);
        expect(captured.inputs[0]?.sourceId).toBe(message.id);
        expect(captured.operation.chatJid).toBe(target.chatId);
        expect(captured.operation.harness).toBeDefined();
        if (args[2].includes("/")) {
          codemodeNestedCaptures++;
          if (codemodeReviewCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
        }
        return captured;
      }));
      const reply: JsonObject = { action: "reply", threadId: thread.threadId, body: "NATIVE_CODEMODE_REPLY", requestId: "native-codemode-reply", expectedVersion: beforeThread.version, assignmentEpoch: beforeThread.assignment_epoch };
      const ownRead = JSON.stringify({ action: "thread", threadId: thread.threadId });
      const otherRead = JSON.stringify({ action: "thread", threadId: otherThread.threadId });
      toolSequence = [{ name: "codemode", arguments: { code: codemodeReviewCancelled
        ? `try { await tools.code_review(${JSON.stringify(reply)}); } catch {} store("revoked-review", {secret:"MUST_NOT_PERSIST"}); console.log("done");`
        : `const thread = await tools.code_review(${ownRead}); const reply = await tools.code_review(${JSON.stringify(reply)}); let denied = false; try { await tools.code_review(${otherRead}); } catch { denied = true; } console.log({thread:JSON.parse(thread).messages.map(m=>m.body),reply:JSON.parse(reply),denied});` } }];
      try {
        expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe(codemodeReviewCancelled ? "pending" : "settled");
        expect(calls).toBe(codemodeReviewCancelled ? 1 : 2);
        expect(toolSequence).toEqual([]);
        expect(codemodeNestedCaptures).toBe(codemodeReviewCancelled ? 1 : 3);
        expect(service.getThread(who, otherThread.threadId)).toEqual(beforeOther);
        expect(root.query("SELECT * FROM extension_kv").all()).toEqual(beforeKv);
        expect(readFileSync(join(workspace, "review-source.ts"), "utf8")).toBe("const saved = true;\n");
        expect(existsSync(join(workspace, "codemode-forbidden.txt"))).toBe(false);
        if (codemodeReviewCancelled) {
          expect(service.getThread(who, thread.threadId)).toEqual(beforeThread);
          expect(service.getThread(who, thread.threadId).messages).toHaveLength(1);
          expect(service.inspectDispatch(who, submitted.dispatchId)).toEqual(beforeDispatch);
          expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
          expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
          expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
          expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
          expect(observedResults.size).toBe(0);
        } else {
          const result = observedResults.get("factory-tool-1");
          expect(result).toMatchObject({ toolName: "codemode" });
          expect(result?.isError, JSON.stringify(result)).not.toBe(true);
          expect(JSON.stringify(result)).toContain("NATIVE_SAVED_REVIEW_THREAD");
          expect(JSON.stringify(result)).toContain('\\"version\\":2');
          expect(JSON.stringify(result)).toContain('\\"denied\\":true');
          expect(service.getThread(who, thread.threadId).messages).toHaveLength(2);
          expect(JSON.stringify(service.getThread(who, thread.threadId).messages)).toContain("NATIVE_CODEMODE_REPLY");
          expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
          expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
        }
        const storeRevisions = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(storeRevisions)).not.toContain("revoked-review");
        expect(JSON.stringify(storeRevisions)).not.toContain("MUST_NOT_PERSIST");
        for (const text of [JSON.stringify([...observedResults.values()]), JSON.stringify(root.query("SELECT * FROM entries").all()), planRequests.join("\n"), JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())]) expect(text).not.toContain(secret);
        expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      } finally {
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
        for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
        owner.release(); closeDatabase();
      }
      return;
    }
    const workBody = () => ({ action: "work", dispatchId: submitted.dispatchId, threadId: thread.threadId, state: "in_progress", itemVersion: service.inspectDispatch(who, submitted.dispatchId).items[0].version, threadVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch });
    toolSequence = [
      { name: "code_review", arguments: { action: "thread", threadId: thread.threadId } },
      { name: "code_review", arguments: { action: "thread", threadId: otherThread.threadId } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "NATIVE_REPLY", requestId: "native-reply", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "NATIVE_REPLY", requestId: "native-reply", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "STALE_MUST_NOT_WRITE", requestId: "native-stale", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: otherThread.threadId, body: "CROSS_CHAT_MUST_NOT_WRITE", requestId: "native-cross", expectedVersion: 1, assignmentEpoch: service.getThread(who, otherThread.threadId).assignment_epoch } },
      { name: "code_review", arguments: () => ({ action: "edit", messageId: service.getThread(who, thread.threadId).messages.at(-1).id, body: "NATIVE_EDIT", requestId: "native-edit", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ action: "deleteMessage", messageId: service.getThread(who, thread.threadId).messages.at(-1).id, confirm: true, requestId: "native-delete", expectedVersion: 2, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ ...workBody(), requestId: "native-progress" }) },
      { name: "code_review", arguments: () => {
        expect(service.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("in_progress");
        return { ...workBody(), itemVersion: 1, requestId: "native-work-stale" };
      } },
      { name: "code_review", arguments: () => ({ ...workBody(), dispatchId: otherDispatch.dispatchId, threadId: otherThread.threadId, requestId: "native-work-cross" }) },
      { name: "code_review", arguments: () => ({ action: "resolve", threadId: thread.threadId, fileId: review.files[0], explanation: "NATIVE_RESOLUTION", evidence: ["local test"], requestId: "native-resolve", expectedVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ action: "work", dispatchId: submitted.dispatchId, threadId: thread.threadId, state: "completed", itemVersion: service.inspectDispatch(who, submitted.dispatchId).items[0].version, threadVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch, requestId: "native-completed" }) },
    ];
    expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe("settled");
    expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "code_review" });
    expect(JSON.stringify(observedResults.get("factory-tool-1"))).toContain("NATIVE_SAVED_REVIEW_THREAD");
    expect(observedResults.get("factory-tool-2")).toMatchObject({ isError: true });
    expect(JSON.stringify(observedResults.get("factory-tool-2"))).not.toContain(secret);
    for (const id of [3, 4, 7, 8, 9, 12, 13]) expect(observedResults.get(`factory-tool-${id}`)?.isError).not.toBe(true);
    expect(observedResults.get("factory-tool-3")?.content).toEqual(observedResults.get("factory-tool-4")?.content);
    for (const id of [5, 6, 10, 11]) expect(observedResults.get(`factory-tool-${id}`)).toMatchObject({ isError: true });
    expect(service.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("completed");
    expect(JSON.stringify(observedResults.get("factory-tool-11"))).not.toContain(secret);
    expect(service.getThread(who, thread.threadId)).toMatchObject({ state: "resolved", version: 5 });
    expect(service.getThread(who, thread.threadId).messages).toHaveLength(3);
    expect(JSON.stringify(service.getThread(who, thread.threadId).messages)).not.toContain("MUST_NOT_WRITE");
    expect(service.getThread(who, otherThread.threadId).messages).toHaveLength(1);
    for (const text of [JSON.stringify(root.query("SELECT * FROM entries").all()), planRequests.join("\n"), JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())]) {
      expect(text).not.toContain(secret);
    }
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
    expect(() => service.database.get("SELECT 1")).toThrow("closed");
    const oldRoot = root;
    const pragmas = ["foreign_keys", "journal_mode"].map(name => root.query(`PRAGMA ${name}`).get());
    closeDatabase(); initDatabase(); root = getDb();
    expect(root).not.toBe(oldRoot);
    expect(() => oldRoot.query("SELECT 1").get()).toThrow();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const reopenedService = api.reviewService();
    expect(reopenedService).not.toBe(service);
    expect(reopenedService.database.db).toBe(root);
    expect(reopenedService.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("completed");
    expect(reopenedService.getThread(who, thread.threadId).messages).toHaveLength(3);
    expect(["foreign_keys", "journal_mode"].map(name => root.query(`PRAGMA ${name}`).get())).toEqual(pragmas);
    const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
    const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
    const reopenedChannel = new WebChannel(reopened); reopenedChannel.broadcastEvent = () => {};
    try {
      const freshReview = reopenedService.createFromCapture(who, { title: "Reopened review", focusPath: "fresh.ts", target }, {
        workspaceId: who.workspaceId, worktreeId: "fresh-tree", mode: "source", base: null, head: null, capturedAt: new Date().toISOString(),
        files: [{ oldPath: null, newPath: "fresh.ts", oldText: null, newText: "fresh saved\n", change: "source", fileIdentity: "fresh-inode" }],
      }, { requestId: "fresh-create" });
      const freshThread = reopenedService.createThread(who, freshReview.reviewId, { fileId: freshReview.files[0], side: "source", body: "NATIVE_REOPENED_THREAD" }, { requestId: "fresh-comment" });
      const freshDispatch = reopenedService.submit(who, freshReview.reviewId, { target, items: [{ threadId: freshThread.threadId, version: 1 }] }, { requestId: "fresh-send" });
      const freshMessage = { ...message, id: "factory-review-reopened" };
      let freshRow!: number;
      await reopenedService.deliver(who, freshDispatch.dispatchId, { async enqueue(input: any) {
        freshMessage.content = input.content;
        await withAddonLocalDispatch({ chatJid: target.chatId, incarnation: target.incarnation }, input.content, input.reference, async () => {
          const req = new Request("http://fixture/internal"); bindAddonLocalDispatchRequest(req, target.chatId, input.content);
          const marked = { ...freshMessage, content_blocks: [getAddonLocalDispatchBlock(req, target.chatId, input.content)!] };
          expect(verifyAddonLocalMessage(target.chatId, marked)?.reference?.intentId).toBe(freshDispatch.dispatchId);
          freshRow = root.transaction(() => { const id = storeMessage(marked); const admit = reopened.getInputSourceAdmission!(target.chatId); assert(admit); admit({ message: marked, rowId: id, database: root }); return id; })()!;
        });
        return { status: "accepted", rowId: freshRow };
      } });
      observedResults.clear();
      toolSequence = [{ name: "code_review", arguments: { action: "thread", threadId: freshThread.threadId } }];
      expect(await reopened.dispatchAcceptedInput!(target.chatId, freshMessage.id, freshRow)!()).toBe("settled");
      expect([...observedResults.values()].some(result => result.toolName === "code_review" && !result.isError && JSON.stringify(result.content).includes("NATIVE_REOPENED_THREAD"))).toBe(true);
      expect(reopenedService.getThread(who, thread.threadId).messages).toHaveLength(3);
      expect(Array.from(new Bun.Glob("**/reviews.db").scanSync({ cwd: workspace, dot: true, onlyFiles: true }))).toEqual([]);
    } finally {
      await reopenedChannel.stop(); await reopenedBase.queue.shutdown(); await reopenedPool.shutdown(); backend.stop(); await backend.close();
    }
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase(); return;
  }
  if (nativeTable && tableChat !== "web:default") {
    storeChatMetadata(tableChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(tableChat);
    if (scenario === "native-editable-table-branch") root.query("UPDATE chat_branches SET root_chat_jid='web:default', parent_branch_id=? WHERE chat_jid=?").run(first!.branchId, tableChat);
    message.chat_jid = tableChat;
  }
  if (scenario === "public-admission-row-mismatch") {
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    const bytes = root.serialize();
    for (const kind of ["other-message", "bot", "absent"] as const) {
      expect(() => root.transaction(() => {
        const rowId = kind === "absent" ? 999999 : storeMessage({ ...message, id: kind === "other-message" ? "other-row-id" : message.id, is_bot_message: kind === "bot" });
        admission({ message, rowId, database: root });
      })()).toThrow("Input admission message row mismatch");
      expect(root.serialize()).toEqual(bytes);
    }
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "public-admission-chat-mismatch") {
    const otherChat = "web:wrong-admission";
    storeChatMetadata(otherChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(otherChat);
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    const bytes = root.serialize();
    expect(() => root.transaction(() => {
      const wrong = { ...message, chat_jid: otherChat };
      const rowId = storeMessage(wrong);
      admission({ message: wrong, rowId, database: root });
    })()).toThrow("Input admission chat mismatch");
    expect(root.serialize()).toEqual(bytes);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "public-archived-admission") {
    const archivedChat = "web:archive-admission";
    storeChatMetadata(archivedChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(archivedChat);
    message.chat_jid = archivedChat;
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    expect(admission).toBeDefined();
    root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run(new Date().toISOString(), message.chat_jid);
    const bytes = root.serialize();
    expect(() => root.transaction(() => {
      const rowId = storeMessage(message);
      admission({ message, rowId, database: root });
    })()).toThrow("Unbound application conversation");
    expect(root.serialize()).toEqual(bytes);
    expect(() => bound.getInputSourceAdmission!(message.chat_jid)).toThrow("Unbound application conversation");
    expect(root.query("SELECT id FROM messages WHERE id=?").get(message.id)).toBeNull();
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  const rowId = root.transaction(() => {
    const rowId = storeMessage(message);
    const admit = bound.getInputSourceAdmission!(message.chat_jid); assert(admit);
    admit({ message, rowId, database: root });
    return rowId;
  })();
  const dispatch = bound.dispatchAcceptedInput!(message.chat_jid, message.id, rowId!);
  const tableCancelled = codemodeTableCancelled || scenario === "native-editable-table-revoked" || scenario === "native-editable-table-closed-publisher" || scenario === "native-editable-table-archived" || scenario === "native-editable-table-harness-generation";
  expect(dispatch).toBeDefined();
  if (scenario === "native-codemode-reopen") {
    let pending: Promise<unknown> | undefined;
    let childPid: number | undefined;
    let reopenedBase: ReturnType<typeof createRuntimeBaseServices> | undefined;
    let reopenedPool: AgentPool | undefined;
    try {
      pending = dispatch!();
      const deadline = Date.now() + 2000;
      while (!existsSync(codemodePid) && Date.now() < deadline) await Bun.sleep(5);
      expect(existsSync(codemodePid)).toBe(true);
      childPid = Number(readFileSync(codemodePid, "utf8"));
      expect(childPid).toBeGreaterThan(0);
      expect(codemodeReads).toBe(1);
      expect(readFileSync(codemodeMarker, "utf8")).toBe("x");
      const binding = root.query("SELECT * FROM piclaw_durable_bindings_v1").all();
      expect(binding).toHaveLength(1);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      backend.stop(); await backend.close();
      expect(await pending).toBe("pending");
      expect(() => process.kill(childPid!, 0)).toThrow();
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      const oldRoot = root;
      closeDatabase(); initDatabase(); root = getDb();
      expect(root).not.toBe(oldRoot);
      expect(() => oldRoot.query("SELECT 1").get()).toThrow();
      owner.assertCurrentOwner();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!("web:default")?.sessionId).toBe(first!.sessionId);
      reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
      reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
      const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
      // Recover the original accepted row/binding, never submit a fresh request.
      expect(await reopened.dispatchAcceptedInput!(message.chat_jid, message.id, rowId!)!()).toBe("settled");
      expect(root.query("SELECT * FROM piclaw_durable_bindings_v1").all()).toEqual(binding);
      expect(codemodeReads).toBe(1);
      expect(readFileSync(codemodeMarker, "utf8")).toBe("x");
      const result = [...observedResults.values()].find(result => result.toolName === "codemode");
      expect(result).toBeDefined(); expect(result!.isError).not.toBe(true);
      expect(JSON.stringify(result!.content)).toContain("NATIVE_CODEMODE_FIRST_READ");
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
      expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      backend.stop(); await backend.close(); await pending;
      if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch {} }
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      await reopenedBase?.queue.shutdown(); await reopenedPool?.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-parent-budget-cap") saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
  const dispatchOutcome = await dispatch!();
  if (delegateAccountingUnknown) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(4);
    expect(root.query("SELECT state, COUNT(*) AS n FROM budget_request_reservations GROUP BY state ORDER BY state").all()).toEqual([{ state: "settled", n: 2 }, { state: "unresolved", n: 2 }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 20 });
    for (const id of ["A", "B"]) expect(observedResults.get(id)).toMatchObject({ toolName: "delegate", isError: true });
    backend.stop(); await backend.close();
    closeDatabase(); initDatabase(); root = getDb();
    expect(root.query("SELECT state FROM budget_request_reservations WHERE state='unresolved'").all()).toHaveLength(2);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (delegateAccounting) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(4);
    expect(childRequests).toBe(2);
    expect(root.query("SELECT COUNT(*) AS n FROM budget_request_reservations WHERE state='settled'").get()).toEqual({ n: 4 });
    expect(root.query("SELECT execution_kind, COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NOT NULL GROUP BY execution_kind ORDER BY execution_kind").all()).toEqual([{ execution_kind: "delegate", n: 2 }, { execution_kind: "interactive", n: 2 }]);
    expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE status='completed'").get()).toEqual({ n: 5 });
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 40 });
    expect(observedResults.size).toBe(2);
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (accountingCloseFailure) {
    expect(calls).toBe(1);
    expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    expect(root.query("SELECT operation_id FROM service_effect_s02_commits").all()).toHaveLength(1);
    root.exec("DROP TRIGGER accounting_work_close_fail");
    backend.stop(); await backend.close();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "completed" }]);
    expect(root.query("SELECT api_equivalent_cost_microusd FROM token_usage WHERE invocation_id IS NOT NULL").all()).toEqual([{ api_equivalent_cost_microusd: 10 }]);
    expect(calls).toBe(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (parentAccounting && (accountingAuthDenied || accountingUnknown || accountingRotate || accountingStorageFailure)) {
    expect(dispatchOutcome).toBe("pending");
    expect(calls).toBe(accountingUnknown || accountingStorageFailure ? 1 : 0);
    expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: accountingUnknown || accountingStorageFailure ? "unresolved" : "released" }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE state='claimed'").all()).toHaveLength(1);
    if (accountingStorageFailure) expect(root.query("SELECT invocation_id FROM token_usage WHERE invocation_id IS NOT NULL").all()).toHaveLength(0);
    backend.stop(); await backend.close();
    if (accountingStorageFailure) {
      closeDatabase(); initDatabase(); root = getDb();
      expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
      expect(root.query("SELECT invocation_id FROM token_usage WHERE invocation_id IS NOT NULL").all()).toHaveLength(0);
    }
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (accountingTwoTurns) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(2);
    expect(root.query("SELECT COUNT(DISTINCT id) AS n, COUNT(DISTINCT work_id) AS works FROM budget_request_reservations WHERE state='settled'").get()).toEqual({ n: 2, works: 2 });
    expect(root.query("SELECT COUNT(DISTINCT parent_work_id) AS n FROM budget_work WHERE parent_work_id IS NOT NULL").get()).toEqual({ n: 1 });
    expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE status='completed'").get()).toEqual({ n: 3 });
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 20 });
    expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "read", isError: false });
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (parentAccounting && !compactionAccounting) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(1);
    expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
    expect(root.query("SELECT status, last_boundary FROM budget_work ORDER BY id").all()).toEqual([
      { status: "completed", last_boundary: "operation_settled" }, { status: "completed", last_boundary: "request_settled" },
    ]);
    expect(root.query("SELECT api_equivalent_cost_microusd FROM token_usage WHERE invocation_id IS NOT NULL").all()).toEqual([{ api_equivalent_cost_microusd: 10 }]);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "native-parent-budget-cap" || scenario === "native-parent-budget-auth-cap") {
    expect(dispatchOutcome).toBe("pending");
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
    expect(calls).toBe(0);
    expect(observedResults.size).toBe(0);
    expect(root.query("SELECT 1 FROM budget_caps WHERE enabled=1").get()).not.toBeNull();
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (codemodePlanCancelled || mcpCancelled || mcpConfigChanged || mcpCatalogChanged || mcpDisconnected || scenario === "native-codemode-cancel" || scenario === "native-codemode-harness") {
    if (mcpCancelled || mcpConfigChanged) expect(existsSync(mcpMarker)).toBe(false);
    expect(dispatchOutcome).toBe(mcpConfigChanged || mcpCatalogChanged || mcpDisconnected ? "settled" : "pending");
    expect(codemodeNestedCaptures).toBe(mcpCatalogChanged || mcpDisconnected ? 0 : 1);
    if (mcpCatalogChanged || mcpDisconnected) expect(readFileSync(mcpMarker, "utf8")).toBe("call\n");
    if (codemodePlanCancelled) {
      expect(calls).toBe(1);
      expect(realToolCaptures).toBe(2);
      expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: "- [ ] NATIVE_PLAN_OLD" });
      expect(root.query("SELECT scope_key FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual([{ scope_key: "web:default" }]);
      expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    expect(existsSync(join(workspace, "codemode-forbidden.txt"))).toBe(false);
    // Read-only SDK forensics: no base or delta may retain the revoked write.
    const storeRevisions = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
    expect(JSON.stringify(storeRevisions)).not.toContain("revoked-sentinel");
    expect(JSON.stringify(storeRevisions)).not.toContain("MUST_NOT_PERSIST");
    if (mcpConfigChanged || mcpCatalogChanged || mcpDisconnected) {
      // Configuration invalidation is a tool failure, not operation cancellation.
      expect(JSON.stringify([...observedResults.values()])).not.toContain("OWNED_MCP_SENTINEL");
      if (mcpCatalogChanged) expect(JSON.stringify([...observedResults.values()])).not.toContain("MCP_CATALOG_CHANGED");
    } else {
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
      expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: scenario === "native-codemode-harness" ? "executing" : "cancelling" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      expect(observedResults.size).toBe(0);
    }
    backend.stop(); await backend.close();
    if (mcpCancelled || mcpConfigChanged || mcpCatalogChanged || mcpDisconnected) expect(() => process.kill(Number(readFileSync(mcpPid, "utf8")), 0)).toThrow();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (nativeMcp) {
    expect(dispatchOutcome).toBe("settled");
    expect(readFileSync(mcpMarker, "utf8")).toBe(mcpConcurrent ? "call\ncall\n" : "call\n");
    const results = JSON.stringify([...observedResults.values()]);
    expect(results).toContain(mcpError ? "MCP_ERROR_SENTINEL" : mcpConcurrent ? "MCP_FIRST" : "OWNED_MCP_SENTINEL");
    if (mcpConcurrent) expect(results).toContain("MCP_SECOND");
    if (mcpError) {
      const records = root.query("SELECT record FROM entries").all().map(row => JSON.parse((row as { record: string }).record));
      const codemodeResult = records.filter(record => record.kind === "pi.tool-result").flatMap(record => record.model ?? []).find(message => message.toolName === "codemode");
      expect(codemodeResult).toBeDefined();
      expect(codemodeResult.details.calls).toMatchObject([{ name: "mcp__fixture__echo", status: "error" }]);
      // Schema-backed error data remains readable by scripts; the outer script succeeds.
      expect(codemodeResult.isError).toBe(false);
    }
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    if (scenario === "native-mcp-cleanup-fail") {
      const { McpClient } = await import("../../node_modules/@earendil-works/pi-mcp");
      const { CodemodeSandbox } = await import("../../runtime/durable-engine/node_modules/@earendil-works/pi-codemode");
      const mcpFault = Error("MCP_CLOSE_FAULT"), sandboxFault = Error("SANDBOX_CLOSE_FAULT");
      const clientClose = spyOn(McpClient.prototype, "close").mockRejectedValue(mcpFault);
      const sandboxClose = spyOn(CodemodeSandbox.prototype, "close").mockRejectedValue(sandboxFault);
      const runtimeClose = spyOn(HostConversationRuntime.prototype, "close");
      let failure: unknown;
      try { await backend.close(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toContain(sandboxFault);
      expect(((failure as AggregateError).errors[0] as AggregateError).errors).toContain(mcpFault);
      expect(clientClose).toHaveBeenCalledTimes(1);
      expect(sandboxClose).toHaveBeenCalledTimes(1);
      expect(runtimeClose).not.toHaveBeenCalled();
      expect(() => owner.assertCurrentOwner()).not.toThrow();
      clientClose.mockRestore(); sandboxClose.mockRestore(); runtimeClose.mockRestore();
      expect(() => process.kill(Number(readFileSync(mcpPid, "utf8")), 0)).toThrow();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    backend.stop(); await backend.close();
    const pid = Number(readFileSync(mcpPid, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (tableCancelled) expect(widgetEvents).toHaveLength(0);
  expect(dispatchOutcome).toBe(tableCancelled || officeCancelled || drawioCancelled || scenario === "native-delegate-revoke-cap" || scenario === "native-delegate-standard-revoke" ? "pending" : "settled");
  if (nativeDrawio) {
    expect(realToolCaptures).toBe(codemodeDrawio ? drawioCancelled ? 2 : 3 : drawioCancelled ? 1 : 2);
    if (codemodeDrawio) {
      expect(drawioNestedCaptures).toBe(drawioCancelled ? 1 : 2);
      expect(drawioCreates).toBe(drawioCancelled ? 0 : 1);
      expect(drawioRequests).toHaveLength(drawioCancelled ? 0 : 2);
      expect(calls).toBe(drawioCancelled ? 1 : 2);
      expect(toolSequence).toEqual([]);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    expect(readFileSync(join(workspace, "existing.drawio"), "utf8")).toBe("PRESERVED_DRAWIO");
    if (drawioCancelled) {
      expect(existsSync(join(workspace, drawioPath))).toBe(false);
      if (codemodeDrawio) {
        expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
        const stores = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(stores)).not.toContain("revoked-drawio");
        expect(JSON.stringify(stores)).not.toContain("MUST_NOT_PERSIST");
      }
      expect(observedResults.size).toBe(0);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
    } else {
      expect(readFileSync(join(workspace, drawioPath), "utf8")).toContain("<mxfile");
      expect(observedResults.get("factory-tool-1")?.isError).not.toBe(true);
      if (codemodeDrawio) {
        expect(readFileSync(join(workspace, drawioPath), "utf8")).toBe(drawioDefaultXml!);
        expect(observedResults.size).toBe(1);
        const result = observedResults.get("factory-tool-1")!;
        expect(result.toolName).toBe("codemode");
        const text = (result.content as { text: string }[]).map(block => block.text).join("\n");
        expect(text).toContain("Opened codemode-diagrams/new.drawio in the Draw.io editor pane.");
        expect(text).toContain("Opened existing.drawio in the Draw.io editor pane.");
        expect(text.length).toBeLessThan(4096);
        for (const hidden of ["editorUrl", "/drawio/edit", "<mxfile", "request_id", "open_workspace_file", ...drawioRequests]) {
          expect(text).not.toContain(hidden);
          expect(planRequests[1]).not.toContain(hidden);
        }
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
      }
    }
    if (drawioCancelled || drawioMissingOpener) expect(sseText).not.toContain("extension_ui_request");
    else expect(sseText).toContain("extension_ui_request");
    if (drawioMissingOpener) {
      const result = JSON.stringify(observedResults.get("factory-tool-1")?.content);
      expect(result).toContain("Fallback URL: /drawio/edit?path=nested%2Fnew.drawio");
      expect(result).toContain("Draw.io channel opener unavailable");
      expect(result).not.toContain("Opened nested/new.drawio");
    }
    const route = await channel.handleRequest(new Request("http://fixture/drawio/index.html"));
    expect(route.status).toBe(200); expect(await route.text()).toBe("DRAWIO_NATIVE_FIXTURE");
    await sseReader!.cancel(); await sseDrain;
    captureSpies.forEach(spy => spy.mockRestore());
    backend.stop();
    const sealed = await channel.handleRequest(new Request("http://fixture/drawio/index.html"));
    expect(sealed.status).toBe(503);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); await backend.close();
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase(); return;
  }
  if (nativeOffice) {
    expect(realToolCaptures).toBe(codemodeOffice ? 2 : officeCancelled ? 1 : 4);
    expect(readFileSync(join(workspace, officePath), "utf8")).toBe("name,value\nfixture,1650\n");
    if (codemodeOffice) {
      expect(officeNestedCaptures).toBe(1);
      expect(calls).toBe(officeCancelled ? 1 : 2);
      expect(toolSequence).toEqual([]);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    const records = JSON.stringify(root.query("SELECT * FROM entries").all());
    if (officeCancelled) {
      expect(observedResults.size).toBe(0);
      expect(records).not.toContain("Office viewer URL:");
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      if (codemodeOffice) {
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
        expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
        const stores = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(stores)).not.toContain("revoked-office");
        expect(JSON.stringify(stores)).not.toContain("MUST_NOT_PERSIST");
      }
    } else {
      const result = observedResults.get("factory-tool-1");
      expect(result?.isError).not.toBe(true);
      const text = (result!.content as { text: string }[]).map(block => block.text).join("\n");
      assert(text.includes("Office viewer URL: "), text);
      const viewer = new URL(codemodeOffice ? text.match(/Office viewer URL: (\S+)/)![1]! : text.split("\n")[0]!.replace("Office viewer URL: ", ""), "http://fixture");
      expect(viewer.pathname).toBe("/office-viewer/");
      const raw = new URL(viewer.searchParams.get("url")!, "http://fixture");
      expect(raw.pathname).toBe("/workspace/raw");
      expect(raw.searchParams.get("path")).toBe(join(workspace, officePath));
      const response = await channel.handleRequest(new Request(raw));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("name,value\nfixture,1650\n");
      if (!codemodeOffice) expect(records).toContain("viewerUrl");
      if (codemodeOffice) {
        expect(observedResults.size).toBe(1);
        expect(result?.toolName).toBe("codemode");
        expect(text.length).toBeLessThan(4096);
        for (const hidden of ["viewerUrl", "fileName", "fileType", "name,value", "fixture,1650"]) {
          expect(text).not.toContain(hidden);
          expect(planRequests[1]).not.toContain(hidden);
        }
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
      } else for (const id of [2, 3, 4]) {
        expect(observedResults.get(`factory-tool-${id}`)?.isError).toBe(true);
        expect(JSON.stringify(observedResults.get(`factory-tool-${id}`))).toContain("Host tool execution failed");
      }
    }
    captureSpies.forEach(spy => spy.mockRestore());
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativeDelegate) {
    if (writeDelegate) {
      for (const id of revokeDelegate ? ["A"] : ["A", "B"]) expect(readFileSync(childWritePath(id), "utf8")).toBe(standardDelegate && !revokeDelegate ? `WRITTEN_${id}` : "OLD");
      expect(childRequests).toBe(revokeDelegate ? 1 : 4);
      if (revokeDelegate) {
        expect(calls).toBe(2);
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
      }
      const writes = [...observedResults.values()].filter(result => result.toolName === "write");
      expect(writes).toHaveLength(revokeDelegate ? 0 : 2);
      expect(writes.every(result => !!result.isError === (readonlyDeny || revokeDelegate))).toBe(true);
      const childIds = root.query("SELECT id FROM conversations WHERE owner_task_id IS NOT NULL").all() as { id: number }[];
      expect(childIds).toHaveLength(revokeDelegate ? 1 : 2);
      for (const child of childIds) {
        const records = root.query("SELECT record FROM entries WHERE conversation_id=?").all(child.id) as { record: string }[];
        const exposed = records.flatMap(row => JSON.parse(row.record).model ?? []).flatMap((message: { toolsAdded?: { name: string }[] }) => message.toolsAdded ?? []).map((tool: { name: string }) => tool.name).sort();
        expect(exposed).toEqual((standardDelegate ? ["read", "bash", "edit", "write", "find", "ls", "grep"] : ["read", "grep", "find", "ls"]).sort());
      }
      if (revokeDelegate) expect(childSourceCaptures).toBe(1);
      captureSpies.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
      sdkSpies.forEach(spy => spy.mockRestore()); return;
    }
    if (revokeDelegate) {
      expect(childSourceCaptures).toBe(1);
      const capped = scenario === "native-delegate-revoke-cap";
      expect(childRequests).toBe(1);
      expect(calls).toBe(capped ? 2 : 3);
      expect(sentinelReads).toBe(0);
      expect(requested).toEqual(capped ? [model.id, modelB.id] : [model.id, modelB.id, model.id]);
      expect(root.query("SELECT id FROM conversations WHERE owner_task_id IS NOT NULL").all()).toHaveLength(1);
      const entries = JSON.stringify(root.query("SELECT * FROM entries").all());
      expect(entries).not.toContain(sentinel);
      expect(planRequests.join("\n")).not.toContain(sentinel);
      if (capped) {
        expect(observedResults.size).toBe(0);
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
        captureSpies.forEach(spy => spy.mockRestore());
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
        sdkSpies.forEach(spy => spy.mockRestore()); return;
      }
      // The revoked child cannot make a follow-up model request to observe its
      // tool result. Only the parent's Delegate policy failure is delivered.
      expect(observedResults.size).toBe(1);
      expect(observedResults.has("child-private-read")).toBe(false);
      expect(observedResults.get("A")).toMatchObject({ toolName: "delegate", isError: true });
      expect(JSON.stringify(observedResults.get("A"))).not.toContain(sentinel);
      expect(JSON.stringify(observedResults.get("A"))).toContain("Native Delegate model not approved");
      expect(JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())).not.toContain(sentinel);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      captureSpies.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
      sdkSpies.forEach(spy => spy.mockRestore());
      return;
    }
    expect(childRequests).toBe(delegateAllowed ? 2 : 0);
    expect(calls).toBe(delegateAllowed ? 4 : 2);
    const children = root.query("SELECT id, owner_task_id FROM conversations WHERE owner_task_id IS NOT NULL").all();
    expect(children).toHaveLength(delegateAllowed ? 2 : 0);
    if (explicitDelegate && delegateAllowed) {
      const explicitId = String(explicitDelegate.model).slice(model.provider.length + 1);
      expect(childModels.sort()).toEqual([model.id, explicitId].sort());
      expect(requested[0]).toBe(model.id); expect(requested.at(-1)).toBe(model.id);
      expect(await first!.readModel!()).toBe(`${model.provider}/${model.id}`);
    }
    expect(observedResults.size).toBe(2);
    if (delegateFiles) {
      expect(await first!.readModel!()).toBe(`${model.provider}/${model.id}`);
      expect(JSON.stringify(observedResults.get("A"))).not.toContain("NATIVE_FILE_BYTES");
      expect(JSON.stringify(observedResults.get("B"))).not.toContain("NATIVE_FILE_BYTES");
    }
    if (timeoutDelegate) {
      expect(timeoutProviderAborted).toBe(true);
      expect(observedResults.get("A")).toMatchObject({ toolName: "delegate", isError: true });
      expect(JSON.stringify(observedResults.get("A"))).toContain("timed out after 10s");
      expect(!!observedResults.get("B")?.isError).toBe(false);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      deadlineSpy!.mockRestore();
    } else for (const result of observedResults.values()) expect(!!result.isError).toBe(!delegateAllowed);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativeTable) {
    expect(calls).toBe(tableCancelled ? 1 : 2);
    const denied = codemodeTable ? codemodeTableCancelled : !["native-editable-table", "native-editable-table-branch"].includes(scenario);
    expect(realToolCaptures).toBe(codemodeTable ? 2 : 1);
    if (codemodeTable) {
      expect(tableNestedCaptures).toBe(1);
      expect(toolSequence).toEqual([]);
    }
    expect(widgetEvents).toHaveLength(denied ? 0 : 1);
    if (!denied) expect(widgetEvents[0]).toMatchObject({ event: "extension_ui_widget", data: { chat_jid: tableChat, content: ["| Name | Role |\n| --- | --- |\n| Rui | User |"], options: { extension: "editable-table", surface: "floating-widget", title: codemodeTable ? "Nested table" : "People", headers: ["Name", "Role"], rows: [["Rui", "User"]] } } });
    if (tableCancelled) {
      expect(observedResults.size).toBe(0);
      if (codemodeTableCancelled) {
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
        expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
        const stores = JSON.stringify(root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all());
        expect(stores).not.toContain("revoked-table");
        expect(stores).not.toContain("MUST_NOT_PERSIST");
      }
      expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=? AND terminal_disposition='completed'").all(tableChat)).toHaveLength(0);
      expect(root.query("SELECT id FROM messages WHERE chat_jid=? AND is_bot_message=1").all(tableChat)).toHaveLength(0);
    } else expect(!!observedResults.get("factory-tool-1")?.isError).toBe(denied);
    if (!denied) {
      if (codemodeTable) {
        expect(observedResults.size).toBe(1);
        expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "codemode" });
        const result = JSON.stringify(observedResults.get("factory-tool-1")?.content);
        expect(result.length).toBeLessThan(4096);
        expect(result).toContain("Opened the editable table widget.");
        expect(result).not.toContain("markdown_table");
        expect(result).not.toContain("floating-widget");
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
      }
      const editedMarkdown = "| Name | Role |\n| --- | --- |\n| Rui | Editor |";
      const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(tableChat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: editedMarkdown }),
      }));
      expect(response.status).toBe(201);
      for (let n = 0; n < 200 && !planRequests.at(-1)?.includes("Editor"); n++) await Bun.sleep(10);
      expect(planRequests.at(-1)).toContain(editedMarkdown.replaceAll("\n", "\\n"));
      expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND content=? AND is_bot_message=0").get(tableChat, editedMarkdown)).toBeDefined();
      const completed = () => (root.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid=? AND phase='terminal' AND terminal_disposition='completed'").get(tableChat) as { n: number }).n;
      for (let n = 0; n < 200 && completed() !== 2; n++) await Bun.sleep(10);
      expect(completed()).toBe(2);
      if (codemodeTable) {
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(2);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(tableChat)).toEqual([{ state: "consumed" }, { state: "consumed" }]);
        expect(calls).toBe(3);
      }
    }
    await sseReader!.cancel(); await sseDrain;
    expect(sseText.match(/event: extension_ui_widget\n/g) ?? []).toHaveLength(denied ? 0 : 1);
    if (!denied) {
      expect(sseText).toContain(`"chat_jid":"${tableChat}"`);
      if (codemodeTable) {
        const payloads = sseText.split("\n\n").filter(frame => frame.includes("event: extension_ui_widget\n")).map(frame => JSON.parse(frame.split("\n").find(line => line.startsWith("data: "))!.slice(6)));
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ chat_jid: tableChat, options: { title: "Nested table", headers: ["Name", "Role"], rows: [["Rui", "User"]] } });
      }
    }
    if (codemodeTable) expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    captureSpies.forEach(spy => spy.mockRestore());
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativePlan) {
    expect(calls).toBe(2);
    expect(realRunCaptures).toBe(4); expect(realToolCaptures).toBe(codemodePlan ? 2 : 1);
    if (codemodePlan) expect(codemodeNestedCaptures).toBe(1);
    captureSpies.forEach(spy => spy.mockRestore());
    expect(planRequests[0]).toContain("NATIVE_PLAN_OLD");
    expect(planRequests[1]).toContain(planStep);
    for (const request of planRequests) {
      expect(request.match(/Current Plan Sidebar checklist/g)).toHaveLength(1);
      expect(request.match(/## Plan Sidebar/g)).toHaveLength(1);
    }
    if (codemodePlan) {
      expect(observedResults.get("factory-tool-1")?.toolName).toBe("codemode");
      expect(observedResults.get("factory-tool-1")?.isError).not.toBe(true);
      expect(JSON.stringify(observedResults.get("factory-tool-1")?.content)).toContain("Plan updated.");
    } else expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "plan", content: [{ type: "text", text: "Plan updated." }] });
    expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: `- [-] ${planStep}` });
    expect(root.query("SELECT scope_key FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual([{ scope_key: "web:default" }]);
    expect(root.query("SELECT content FROM messages WHERE chat_jid='web:default' AND is_bot_message=1").all()).toEqual([{ content: "factory synthetic reply" }]);
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toEqual({ state: "consumed" });
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
    closeDatabase(); initDatabase();
    expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: `- [-] ${planStep}` });
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(backend.sessionOptions.getDurableSession!("web:default")).toBeDefined();
    backend.stop(); await backend.close();
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase();
    return;
  }
  expect(calls).toBe(1);
  const persistedModel = await first!.readModel!();
  expect((await pool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe(await first!.readThinkingLevel!());
  expect(await pool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ status: "success", thinking_level: await first!.readThinkingLevel!() });
  const thinkingDefault = settings.getDefaultThinkingLevel();
  const thinkingModel = await first!.readModel!();
  const thinkingIdentity = first!.sessionId;
  const reasoningHistory = root.query("SELECT * FROM entries ORDER BY id").all();
  expect(await pool.applyControlCommand("web:default", { type: "thinking", level: "high", raw: "/thinking high" })).toMatchObject({ status: reasoningThinking ? "success" : "error" });
  if (reasoningThinking) {
    expect(await first!.readThinkingLevel!()).toBe("high");
    expect((await pool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe("high");
    expect(await pool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ thinking_level: "high" });
    expect(await first!.readModel!()).toBe(thinkingModel);
    expect(first!.sessionId).toBe(thinkingIdentity);
    expect(settings.getDefaultThinkingLevel()).toBe(thinkingDefault);
    expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(reasoningHistory);
  }
  const thinkingHistory = root.query("SELECT * FROM entries ORDER BY id").all();
  expect(await pool.applyControlCommand("web:default", { type: "thinking", level: "off", raw: "/thinking off" })).toMatchObject({ status: "success", thinking_level: "off" });
  expect(await first!.readThinkingLevel!()).toBe("off");
  expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(thinkingHistory);
  const modelQuery = await pool.applyControlCommand("web:default", { type: "model", raw: "/model" });
  expect(modelQuery.status).toBe("success");
  expect(modelQuery.message).toContain(`${model.provider}/${model.id} (current)`);
  expect(modelQuery.message).toContain(`${modelB.provider}/${modelB.id}`);
  expect(await first!.readModel!()).toBe(persistedModel);
  expect(calls).toBe(1);
  if (scenario === "public-shim-compaction" || compactionAccounting) {
    const beforeCalls = calls;
    const beforeModel = await first!.readModel!();
    const identity = first!.sessionId;
    inManualSummary = true;
    if (scenario === "native-compaction-accounting-side-dispatch") {
      const historyBefore = root.query("SELECT * FROM entries ORDER BY id").all();
      const callsBefore = calls;
      const sideEvents: string[] = [], sideText: string[] = [];
      const result = await pool.runSidePrompt("web:default", "native isolated side prompt", {
        onEvent(event) { sideEvents.push(event.type); }, onTextDelta(delta) { sideText.push(delta); },
      });
      expect(result).toMatchObject({ status: "success", result: "factory synthetic reply", model: "openai-codex/approved" });
      expect(calls).toBe(callsBefore + 1);
      expect(sideEvents).toContain("done");
      expect(sideEvents).toContain("text_delta");
      expect(sideText.join("")).toBe("factory synthetic reply");
      expect(first!.sessionId).toBe(identity);
      expect(await first!.readModel!()).toBe(beforeModel);
      const sideSource = root.query("SELECT source_id FROM service_effect_s01_sources WHERE kind='internal'").get() as { source_id: string };
      expect(sideSource.source_id).toMatch(/^side-prompt:/);
      expect(root.query(`SELECT r.state,w.execution_kind FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'`).all()).toEqual([{ state: "settled", execution_kind: "side_prompt" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "completed" }]);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
      expect(root.query("SELECT message_row_id FROM service_effect_s02_commits WHERE operation_id IN (SELECT operation_id FROM service_effect_s01_operations WHERE primary_source_seq=(SELECT source_seq FROM service_effect_s01_sources WHERE source_id=?))").get(sideSource.source_id)).toEqual({ message_row_id: null });
      expect(root.query("SELECT * FROM entries WHERE id <= ? ORDER BY id").all((historyBefore.at(-1) as { id: number }).id)).toEqual(historyBefore);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      let mutationEvents = 0;
      const mutationText: string[] = [];
      const mutation = await pool.runSidePrompt("web:default", "mutating observer", { onEvent(event) {
        mutationEvents++;
        if (event.type === "done") { event.message.content = []; event.message.usage.cost.total = 999; }
        if (event.type === "text_delta") event.delta = "MUTATED";
      }, onTextDelta(delta) { mutationText.push(delta); } });
      expect(mutation.status).toBe("success");
      expect(mutation.result).toBe("factory synthetic reply");
      expect(mutationText.join("")).toBe("factory synthetic reply");
      const eventsBeforeFailure = mutationEvents;
      let throwingCalls = 0;
      const throwing = await pool.runSidePrompt("web:default", "throwing observer", { onEvent() { throwingCalls++; throw Error("private callback failure"); } });
      expect(throwing.status).toBe("success");
      expect(throwingCalls).toBe(1);
      expect(mutationEvents).toBe(eventsBeforeFailure);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 30 });
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "settled" }, { state: "settled" }, { state: "settled" }]);
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (scenario === "native-compaction-accounting-side-provenance") {
      backend.stop(); await backend.close();
      const { createCurrentPiclawServiceWorkStore } = await import("../../runtime/src/service-effects/current-piclaw/service-work-store.js");
      const { value, sealed, effect } = await import("./src/host-handoff.js");
      const { hashCanonicalRequest } = await import("../../runtime/src/service-effects/contracts/common.js");
      const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {} }));
      const id = `side-prompt:${crypto.randomUUID()}`, prompt = "side provenance fixture";
      const source = value(await work.acceptSource(sealed({ effect: effect(id), chatJid: "web:default", sourceId: id, kind: "internal" as const,
        payloadRef: id, targetOperationId: null, parentSourceSeq: null, acceptedAt: new Date().toISOString(), createWakeIntent: false })));
      const frontier = value(await work.getChatFrontier("web:default"));
      const claim = value(await work.claimNext(sealed({ effect: effect(`claim:${id}`), chatJid: "web:default",
        expectedFrontier: frontier.consumedThroughSourceSeq, newOperationId: crypto.randomUUID(), claimedAt: new Date().toISOString() })))!;
      const parentBinding = root.query("SELECT incarnation,conversation_id,branch_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as { incarnation: string; conversation_id: number; branch_id: string };
      const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
      const models = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
        signal: new AbortController().signal, async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
      });
      const h = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
        { models, registry: createRegistry() }, context);
      const parent = (await h.conversation(parentBinding.conversation_id as ConversationId, context))!;
      const head = await parent.commit(tx => tx.appendEntry(parent.id, { kind: "pi.user", model: [{ role: "user", content: "side provenance history", timestamp: 1 }] }), context);
      const fork = await h.commit(async tx => {
        const child = await tx.forkConversation(parent.id, head.id, { ownership: { kind: "ownerless" } });
        const original = await tx.doc(AgentDoc, parent.id), copied = await tx.doc(AgentDoc, child.id);
        Object.assign(copied, JSON.parse(JSON.stringify(original))); return child;
      }, context);
      await h.close(context);
      // Seed terminal correlation: execution/recovery are covered separately.
      root.transaction(() => {
        root.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)").run(parentBinding.incarnation, parentBinding.incarnation,
          fork.id, "web:default", parentBinding.branch_id, claim.operation.operationId, source.sourceSeq, id, id, id,
          hashCanonicalRequest({ type: "input", requestId: id, content: prompt }));
        root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id=?").run(id);
        root.query("UPDATE service_effect_s01_operations SET phase='terminal' WHERE operation_id=?").run(claim.operation.operationId);
        root.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL,consumed_through_source_seq=? WHERE chat_jid='web:default'").run(source.sourceSeq);
      }).immediate();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!("web:default")!.sessionId).toBe(identity);
      expect(calls).toBe(beforeCalls);
      backend.stop(); await backend.close();
      root.query("UPDATE piclaw_durable_bindings_v1 SET request_id='forged-side-request' WHERE source_id=?").run(id);
      await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Invalid durable application routing provenance");
      expect(calls).toBe(beforeCalls);
      compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (scenario === "native-compaction-accounting-recover") {
      // Seed a genuine paused SDK checkpoint, then reopen the actual application.
      // Host close joins maintenance, so this is not a host process-crash fixture.
      backend.stop(); await backend.close();
      const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
      const modelPort = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
        signal: new AbortController().signal, async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
      });
      const h = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
        { models: modelPort, registry: withTaskModelRequestScope(createRegistry()) }, context);
      const row = root.query("SELECT incarnation,conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as { incarnation: string; conversation_id: number };
      const conversation = (await h.conversation(row.conversation_id as ConversationId, context))!;
      await conversation.commit(async tx => {
        for (let i = 0; i < 4; i++) await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: `checkpoint history ${i}`, timestamp: i }] });
      }, context);
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      checkpointHold = { entered };
      const taskId = await conversation.compact("Retain the accepted decision", context);
      // Existing host ledger represents a dispatched attempt whose result was lost.
      const request = await reserveHostRequest({ database: root, operationId: "", chatJid: "web:default", authPath: join(getPiclawAgentDir(), "auth.json"), model: model as Model<Api>,
        executionKind: "side_prompt", maintenanceWorkId: `durable-maintenance:${row.incarnation}:${taskId}`,
        signal: new AbortController().signal, assertCurrent: () => owner.assertCurrentOwner() });
      expect(request).toBeDefined();
      h.resume();
      await Promise.race([ready, h.waitForTask(taskId, context).then(task => { throw Error(`Checkpoint did not request summary: ${JSON.stringify(task.state.outcome)}`); })]);
      await request!.dispatch();
      await h.close(context); await request!.abandon(); checkpointHold = undefined;
      expect(root.query("SELECT state FROM budget_request_reservations WHERE work_id LIKE 'durable-request:%' AND state='unresolved'").all()).toHaveLength(1);
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      let recovered = backend.sessionOptions.getDurableSession!("web:default")!;
      expect(recovered.sessionId).toBe(identity);
      expect(await recovered.readModel!()).toBe(beforeModel);
      const callsBeforeStop = calls;
      root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('web:pending-recovery',NULL)").run();
      root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='web:pending-recovery'").run();
      root.query("INSERT INTO service_effect_s01_sources VALUES ('web:pending-recovery',1,'pending-recovery',?,'message','pending','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
      await expect(recovered.reconcileMaintenance!()).rejects.toThrow("Host work is not idle");
      expect(calls).toBe(callsBeforeStop);
      backend.stop();
      expect(() => recovered.reconcileMaintenance!()).toThrow("Application closing");
      expect(calls).toBe(callsBeforeStop);
      await backend.close();
      root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id='pending-recovery'").run();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      recovered = backend.sessionOptions.getDurableSession!("web:default")!;
      const callsBeforeResume = calls;
      await recovered.reconcileMaintenance!();
      expect(calls).toBe(callsBeforeResume + 1);
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt' ORDER BY r.rowid").all()).toEqual([{ state: "unresolved" }, { state: "settled" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (compactionAccountingUnknown) {
      await expect(first!.compact!("Retain the accepted decision")).rejects.toThrow("did not complete");
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(0);
      expect(root.query("SELECT t.invocation_id FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").all()).toHaveLength(0);
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      closeDatabase(); initDatabase(); root = getDb();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(calls).toBe(beforeCalls + 1);
      backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (compactionCloseFailure) {
      root.exec("CREATE TRIGGER maintenance_close_fail BEFORE UPDATE ON budget_work WHEN OLD.parent_work_id IS NULL AND OLD.execution_kind='side_prompt' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'synthetic maintenance close fault'); END");
      const compacting = first!.compact!("Retain the accepted decision");
      const deadline = Date.now() + 2000;
      while (!root.query("SELECT 1 FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").get() && Date.now() < deadline) await Bun.sleep(10);
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      root.exec("DROP TRIGGER maintenance_close_fail");
      await first!.reconcileMaintenance!();
      expect(await compacting).toEqual({ compacted: true });
      // Simulate a process stopping after the SDK commit but before its work
      // closure acknowledgement. Startup must repair from the existing task.
      root.query("UPDATE budget_work SET status='active',closed_at=NULL,chat_jid='web:unrelated' WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").run();
      backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      backend.stop(); await backend.close();
      root.query("UPDATE budget_work SET chat_jid='web:default' WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").run();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "completed" }]);
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    const result = await first!.compact!("Retain the accepted decision");
    expect(result).toEqual({ compacted: true });
    expect(calls).toBe(beforeCalls + 1);
    expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
    expect(await first!.readModel!()).toBe(beforeModel);
    expect(first!.sessionId).toBe(identity);
    if (compactionAccounting) {
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "settled" }]);
      expect(root.query("SELECT status,last_boundary FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "completed", last_boundary: "maintenance_settled" }]);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
    }
    backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  // Tiny history is correctly below the public compaction policy's retained window.
  expect(await first!.compact!("Summarize")).toEqual({ compacted: false });
  expect(calls).toBe(1);
  await assertContext(100000);
  expect(await pool.applyControlCommand("web:default", { type: "model", provider: modelB.provider, modelId: modelB.id, raw: `/model ${modelB.provider}/${modelB.id}` })).toMatchObject({ status: "success" });
  await assertContext(200000);
  expect(await pool.applyControlCommand("web:default", { type: "model", provider: model.provider, modelId: model.id, raw: `/model ${model.provider}/${model.id}` })).toMatchObject({ status: "success" });
  await assertContext(100000);
  const newcomer = "web:newcomer";
  storeChatMetadata(newcomer, new Date().toISOString());
  storeChatMetadata("web:rejected", new Date().toISOString());
  const snapshot = root.serialize();
  const failedAdmission = spyOn(modelRegistry, "getAvailable").mockReturnValue([]);
  try { await expect(bound.prepareInputSourceAdmission!("web:rejected")).rejects.toThrow("Host model no longer available"); }
  finally { failedAdmission.mockRestore(); }
  expect(root.serialize()).toEqual(snapshot);
  expect(backend.sessionOptions.getDurableSession!("web:rejected")).toBeUndefined();
  const beforeRetry = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  await bound.prepareInputSourceAdmission!("web:rejected");
  const retried = backend.sessionOptions.getDurableSession!("web:rejected")!;
  expect(retried).toBeDefined();
  expect(await retried.readPosition()).toBeNull();
  await bound.prepareInputSourceAdmission!("web:rejected");
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeRetry + 1);
  const post = (chat: string, content: string) => channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content }),
  }));
  const httpChat = "web:actual-http";
  storeChatMetadata(httpChat, new Date().toISOString());
  const beforeHttp = root.serialize();
  expect((await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(httpChat)}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: "{",
  }))).status).toBe(400);
  expect((await post(httpChat, "")).status).toBe(400);
  expect((await post(httpChat, "/settings")).status).toBe(503);
  expect(root.serialize()).toEqual(beforeHttp);
  const auth = spyOn(channel.authGateway, "isAuthEnabled").mockReturnValue(true);
  const principal = spyOn(channel.authGateway, "getPrincipal").mockReturnValue(null);
  try { expect((await post(httpChat, "unauthorized")).status).toBeGreaterThanOrEqual(400); }
  finally { principal.mockRestore(); auth.mockRestore(); }
  expect(root.serialize()).toEqual(beforeHttp);
  const beforeConcurrent = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  const queueBefore = base.queue.getMetrics();
  const callsBeforeHttp = calls;
  const responses = await Promise.all([post(httpChat, "normal HTTP input one"), post(httpChat, "normal HTTP input two")]);
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  for (let i = 0; i < 500 && (base.queue.isLaneBusy(`chat:${httpChat}`) || base.queue.isLaneBusy(httpChat)); i++) await Bun.sleep(10);
  base.queue.assertLegacyCaptureDrained();
  expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(httpChat)).toEqual([{ content: "factory synthetic reply" }, { content: "factory synthetic reply" }]);
  const sources = root.query("SELECT source_id, state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(httpChat) as { source_id: string; state: string }[];
  expect(sources).toHaveLength(2);
  expect(new Set(sources.map(source => source.source_id)).size).toBe(2);
  expect(sources.map(source => source.state)).toEqual(["consumed", "consumed"]);
  expect(root.query("SELECT id FROM messages WHERE chat_jid=? AND is_bot_message=0 ORDER BY rowid").all(httpChat)).toEqual(sources.map(source => ({ id: source.source_id })));
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeConcurrent + 1);
  expect(calls - callsBeforeHttp).toBe(2);
  // The normal processChat finalizer also schedules one empty backlog drain.
  expect(base.queue.getMetrics().enqueued - queueBefore.enqueued).toBe(3);
  expect(base.queue.getMetrics().started - queueBefore.started).toBe(3);
  expect(base.queue.getMetrics().succeeded - queueBefore.succeeded).toBe(3);
  expect(base.queue.getMetrics().retriesScheduled - queueBefore.retriesScheduled).toBe(0);
  expect(backend.sessionOptions.getDurableSession!(httpChat)).toBeDefined();
  const before = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  await Promise.all([bound.prepareInputSourceAdmission!(newcomer), bound.prepareInputSourceAdmission!(newcomer)]);
  const newPort = backend.sessionOptions.getDurableSession!(newcomer)!;
  expect(newPort).toBeDefined();
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(before + 1);
  const newMessage = { ...message, id: "newcomer-first", chat_jid: newcomer };
  const newRow = root.transaction(() => { const rowId = storeMessage(newMessage); const admit = bound.getInputSourceAdmission!(newcomer); assert(admit); admit({ message: newMessage, rowId, database: root }); return rowId; })();
  expect(await bound.dispatchAcceptedInput!(newcomer, newMessage.id, newRow!)!()).toBe("settled");
  expect(await newPort.readPosition()).not.toBeNull();
  expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").get(newcomer)).toEqual({ content: "factory synthetic reply" });
  await expect(bound.prepareInputSourceAdmission!("web:missing-root")).rejects.toThrow("Existing root branch required");
  const originalDoc = root.query("SELECT content FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='\"app.application-conversations\"') ORDER BY seq DESC LIMIT 1").get() as { content: string };
  if (scenario === "pending-host") {
    // A real accepted host source, deliberately not dispatched or consumed.
    const pending = { ...message, id: "pending-tool-upgrade", content: "must remain pending" };
    root.transaction(() => {
      const rowId = storeMessage(pending);
      const admit = bound.getInputSourceAdmission!(pending.chat_jid); assert(admit);
      admit({ message: pending, rowId, database: root });
    })();
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(pending.id)).toEqual({ state: "pending" });
  }
  await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
  backend.stop(); await backend.close();
  // Successful SDK initialization followed by a failed close must also retain
  // main's owner while bootstrap still has no backend to clean up.
  const closeFault = Error("initialized harness close uncertain");
  const captured = new Set<BunSqliteDatabase>();
  const actualClose = BunSqliteDatabase.prototype.close;
  const closeSpy = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(function (this: BunSqliteDatabase) {
    captured.add(this); return Promise.reject(closeFault);
  });
  try {
    const deps = createDefaultRuntimeBootstrapDeps({ queue: {}, state: {} } as any,
      actual => createDefaultApplicationRuntime(actual, async () => services));
    deps.initializeRuntimeEnvironment = () => {};
    let failure: unknown;
    try { await main({ acquireLock: () => owner, createBootstrapDeps: () => deps }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RuntimeStartupCleanupError);
    expect((failure as AggregateError).errors).toEqual([closeFault]);
    expect((failure as AggregateError).errors[0]).toBe(closeFault);
    expect(captured.size).toBe(1);
    owner.assertCurrentOwner();
    expect(() => acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false })).toThrow("refuses existing lock");
  } finally {
    closeSpy.mockRestore();
    for (const resource of captured) await actualClose.call(resource);
  }
  // Seed the GENUINE old factory selection through public configure before
  // reopening the new factory. Merely closing/reopening a six-tool fixture
  // would not exercise persisted-tool convergence at all.
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
  const modelPort = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
    signal: new AbortController().signal,
    async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
  });
  const inspectStored = async (seed: boolean) => {
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
      { models: modelPort, registry: createRegistry() }, context);
    try {
      const app = await harness.root(context);
      return await app.commit(async tx => {
        const states = new Map<number, unknown>();
        for (const { id } of root.query("SELECT id FROM conversations ORDER BY id").all() as { id: number }[]) {
          if (seed) await configure(tx, id as ConversationId, { tools: createHostBuiltinTools({ cwd: workspace, names: customSubset ? ["read"] : ["bash"], authority: { assertAllowed() { owner.assertCurrentOwner(); } } }),
            thinkingLevel: "low", instructions: "preserve these instructions", extensions: sourceFilter ? { add: [defineExtension({ name: "app.host-builtins" })], remove: [defineExtension({ name: "app.host-scheduled-source" })] } : [defineExtension({ name: "app.host-builtins" })] });
          states.set(id, JSON.parse(JSON.stringify(await tx.doc(AgentDoc, id as ConversationId))));
        }
        return states;
      }, context);
    } finally { await harness.close(context); }
  };
  const seeded = await inspectStored(true);
  for (const state of seeded.values()) expect(state).toMatchObject({ tools: [customSubset ? "read" : "bash"], model: { provider: model.provider, modelId: model.id },
    thinkingLevel: "low", instructions: "preserve these instructions" });
  if (scenario === "pending-host") {
    // Preflight rejects BEFORE SDK open/configure: a complete SQL byte snapshot
    // is valid here (no SDK pending-document normalization has taken place).
    const bytes = root.serialize();
    const callsBeforeRejection = calls;
    const agentBytes = JSON.stringify(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"pi.agent"') ORDER BY document_id, seq`).all());
    const historyBytes = JSON.stringify(root.query("SELECT * FROM entries ORDER BY id").all());
    const transaction = spyOn(BunSqliteDatabase.prototype, "transaction");
    try {
      await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Host tool upgrade requires idle host work");
      expect(transaction).not.toHaveBeenCalled(); // No public configure commit.
      expect(root.serialize()).toEqual(bytes);
      expect(JSON.stringify(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"pi.agent"') ORDER BY document_id, seq`).all())).toBe(agentBytes);
      expect(JSON.stringify(root.query("SELECT * FROM entries ORDER BY id").all())).toBe(historyBytes);
      expect(calls).toBe(callsBeforeRejection);
    } finally { transaction.mockRestore(); }
    for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
    closeDatabase(); owner.release(); return;
  }
  const historyBeforeUpgrade = root.query("SELECT * FROM entries ORDER BY id").all();
  const identitiesBeforeUpgrade = root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all();
  const callsBeforeUpgrade = calls;
  settings.setDefaultModelAndProvider(modelB.provider, modelB.id);
  await settings.flush();
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(calls).toBe(callsBeforeUpgrade);
  expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(historyBeforeUpgrade);
  expect(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all()).toEqual(identitiesBeforeUpgrade);
  if (customSubset) {
    expect(await backend.sessionOptions.getDurableSession!("web:default")!.readThinkingLevel!()).toBe("low");
    const thinkingPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    expect((await thinkingPool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe("low");
    expect(await thinkingPool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ status: "success", thinking_level: "low" });
    await thinkingPool.shutdown();
    expect(backend.sessionOptions.getDurableSession!("web:default")?.sessionId).toBe(first?.sessionId);
    expect(backend.sessionOptions.getDurableSession!(newcomer)).toMatchObject({ sessionId: newPort.sessionId, branchId: newPort.branchId });
    backend.stop(); await backend.close();
    const preserved = await inspectStored(false);
    for (const [id, state] of seeded) expect(preserved.get(id)).toEqual(state); // Source authority no longer changes explicit extension selections.
    expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(historyBeforeUpgrade);
    expect(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all()).toEqual(identitiesBeforeUpgrade);
    expect(calls).toBe(callsBeforeUpgrade);
    for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
    closeDatabase(); owner.release(); return;
  }
  // Read public stored state only after the active controller is closed below;
  // model-visible success for all six tools is exercised through this backend.
  expect(!!backend.sessionOptions.getDurableSession?.("web:default")).toBe(true);
  expect(backend.sessionOptions.getDurableSession?.("web:default")?.sessionId).toBe(first?.sessionId);
  expect(backend.sessionOptions.getDurableSession!(newcomer)?.sessionId).toBe(newPort.sessionId);
  expect(backend.sessionOptions.getDurableSession!(newcomer)?.branchId).toBe(newPort.branchId);
  const rebound = backend.bind({ queue: {}, agentPool: {} } as Parameters<typeof backend.bind>[0]);
  const next = { ...message, id: "factory-input-after-default-change", content: "continue A" };
  const nextRow = root.transaction(() => {
    const rowId = storeMessage(next);
    const admit = rebound.getInputSourceAdmission!(next.chat_jid); assert(admit);
    admit({ message: next, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(next.chat_jid, next.id, nextRow!)!()).toBe("settled");
  expect(requested).toEqual([model.id, model.id, model.id, model.id, model.id]);
  // Normal accepted input through the actual default factory, not a standalone
  // tool harness: the synthetic provider requests existing host builtin calls.
  writeFileSync(join(workspace, "factory-tool-input.txt"), "before");
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://codemode-fetch.invalid/data");
    return Response.json({ value: "FETCH_USEFUL_SENTINEL" });
  }, { preconnect() {} }));
  toolSequence = [
    { name: "read", arguments: { path: "factory-tool-input.txt" } },
    { name: "edit", arguments: { path: "factory-tool-input.txt", edits: [{ oldText: "before", newText: "after" }] } },
    { name: "write", arguments: { path: "factory-tool-output.txt", content: "written by host tool" } },
    { name: "find", arguments: { pattern: "factory-tool-*.txt" } },
    { name: "ls", arguments: { path: "." } },
    { name: "grep", arguments: { pattern: "after", path: "factory-tool-input.txt" } },
    { name: "bash", arguments: { command: "printf factory-tool-bash" } },
    { name: "codemode", arguments: { code: `await tools.write({path:"codemode-useful.txt",content:"before"}); await tools.edit({path:"codemode-useful.txt",edits:[{oldText:"before",newText:"after"}]}); console.log(await tools.read({path:"codemode-useful.txt"})); console.log(await tools.find({pattern:"codemode-useful.txt"})); console.log(await tools.grep({pattern:"after",path:"codemode-useful.txt"})); const response = await tools.fetch({url:"https://codemode-fetch.invalid/data"}); console.log(JSON.parse(response.body).value); console.log("CAPABILITIES",typeof process,typeof fetch,typeof models);` } },
  ];
  const toolInput = { ...message, id: "factory-tool-input", content: "Run the synthetic host tool sequence" };
  const toolRow = root.transaction(() => {
    const rowId = storeMessage(toolInput);
    const admit = rebound.getInputSourceAdmission!(toolInput.chat_jid); assert(admit);
    admit({ message: toolInput, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(toolInput.chat_jid, toolInput.id, toolRow!)!()).toBe("settled");
  fetchSpy.mockRestore();
  expect(readFileSync(join(workspace, "codemode-useful.txt"), "utf8")).toBe("after");
  expect(toolSequence).toEqual([]); toolSequence = undefined;
  expect(readFileSync(join(workspace, "factory-tool-input.txt"), "utf8")).toBe("after");
  expect(readFileSync(join(workspace, "factory-tool-output.txt"), "utf8")).toBe("written by host tool");
  const toolEntries = JSON.stringify(root.query("SELECT * FROM entries").all());
  expect(toolEntries).toContain("factory-tool-bash");
  expect(toolEntries).toContain("Successfully wrote");
  expect(toolEntries).toContain("factory-tool-output.txt");
  // Inspect results delivered back to the actual public model adapter: merely
  // draining the call queue would also succeed when a requested tool is absent.
  for (const name of ["read", "edit", "write", "find", "ls", "bash", "grep", "codemode"]) {
    const result = [...observedResults.values()].find(result => result.toolName === name);
    expect(result).toBeDefined(); expect(result!.isError).not.toBe(true);
    if (name === "codemode") {
      expect(JSON.stringify(result!.content)).toContain("after");
      expect(JSON.stringify(result!.content)).toContain("CAPABILITIES undefined undefined undefined");
      expect(JSON.stringify(result!.content)).toContain("FETCH_USEFUL_SENTINEL");
    }
    if (name === "grep") expect(JSON.stringify(result!.content)).toContain("factory-tool-input.txt:1: after");
    if (name === "find" || name === "ls") expect(JSON.stringify(result!.content)).toContain("factory-tool-output.txt");
  }
  // Lose the provider acknowledgement AFTER the real public transaction commits.
  // No partial route is published and a retry cannot create another identity.
  const uncertainChat = "web:lost-create-ack";
  storeChatMetadata(uncertainChat, new Date().toISOString());
  const beforeUncertain = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  const actualTransaction = BunSqliteDatabase.prototype.transaction;
  const lostAck = Error("lost create commit acknowledgement");
  let lostAcknowledgements = 0;
  const fault = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementation(async function <T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    const result = await actualTransaction.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, callback);
    if ((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n > beforeUncertain) {
      lostAcknowledgements++; throw lostAck;
    }
    return result;
  });
  try {
    await expect(rebound.prepareInputSourceAdmission!(uncertainChat)).rejects.toThrow();
    await expect(rebound.prepareInputSourceAdmission!(uncertainChat)).rejects.toThrow();
    expect(lostAcknowledgements).toBe(1);
    expect(backend.sessionOptions.getDurableSession!(uncertainChat)).toBeUndefined();
    expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeUncertain + 1);
  } finally { fault.mockRestore(); }
  backend.stop(); await backend.close();
  const upgraded = await inspectStored(false);
  for (const [id, state] of seeded) expect(upgraded.get(id)).toEqual({ ...(state as object), tools: ["read", "bash", "edit", "write", "find", "ls", "grep", "fetch", "codemode"] });
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  const recoveredCreate = backend.sessionOptions.getDurableSession!(uncertainChat)!;
  expect(recoveredCreate).toBeDefined();
  const recoveredIdentity = { sessionId: recoveredCreate.sessionId, branchId: recoveredCreate.branchId };
  backend.stop(); await backend.close();
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(backend.sessionOptions.getDurableSession!(uncertainChat)).toMatchObject(recoveredIdentity);
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeUncertain + 1);
  backend.stop(); await backend.close();
  // Hold the real adapter's public SDK transaction callback, not a model lookup
  // (the latter is synchronous). Stop/close must fence it before it can publish.
  for (const shutdown of ["stop", "close"] as const) {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const raceChat = `web:prepare-${shutdown}`;
    storeChatMetadata(raceChat, new Date().toISOString());
    const raceBound = backend.bind({ queue: base.queue, agentPool: pool });
    const raceChannel = new WebChannel(raceBound);
    raceChannel.broadcastEvent = () => {};
    const beforeRace = root.serialize();
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const gate = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementationOnce(function <T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
      return actualTransaction.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, async tx => { entered(); await hold; return callback(tx); });
    });
    const pending = raceBound.prepareInputSourceAdmission!(raceChat).then(() => null, error => error);
    await inside;
    let closed = false;
    let closing: Promise<void> | undefined;
    if (shutdown === "stop") backend.stop();
    else closing = backend.close().then(() => { closed = true; });
    await Bun.sleep(0);
    expect(closed).toBe(false);
    expect(backend.sessionOptions.getDurableSession!(raceChat)).toBeUndefined();
    release();
    try {
      expect(await pending).toBeInstanceOf(Error);
      await (closing ?? backend.close());
    } finally { gate.mockRestore(); }
    expect(backend.sessionOptions.getDurableSession!(raceChat)).toBeUndefined();
    expect(root.serialize()).toEqual(beforeRace);
    const response = await raceChannel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(raceChat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "after shutdown" }),
    }));
    expect(response.status).toBe(503);
    expect(root.serialize()).toEqual(beforeRace);
    await raceChannel.stop();
  }
  const beforeUnapproved = root.serialize();
  const catalog = spyOn(modelRegistry, "getAvailable").mockReturnValue([modelB] as any);
  try {
    await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Persisted host model not approved");
    expect(root.serialize()).toEqual(beforeUnapproved);
    owner.assertCurrentOwner();
  } finally { catalog.mockRestore(); }
  const docId = (root.query("SELECT id FROM documents WHERE kind='\"app.application-conversations\"'").get() as { id: number }).id;
  const revision = root.query("SELECT seq, content FROM document_revisions WHERE document_id=? ORDER BY seq DESC LIMIT 1").get(docId) as { seq: number; content: string };
  for (const bad of ["", "wrong-domain"]) {
    const delta = JSON.parse(originalDoc.content); delta[0][2] = bad;
    root.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run(JSON.stringify(delta), docId, revision.seq);
    let realized = false;
    await expect(createDefaultApplicationRuntime(owner, async () => { realized = true; return services; })).rejects.toThrow();
    expect(realized).toBe(false);
  }
  root.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run(revision.content, docId, revision.seq);
  for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
  // Use canonical config path, not a fixture's guessed layout.
  const { SESSIONS_DIR } = await import("../../runtime/src/core/config.js");
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = join(SESSIONS_DIR, "legacy.jsonl"); writeFileSync(file, "preserve legacy bytes\n");
  let realized = false;
  await expect(createDefaultApplicationRuntime(owner, async () => { realized = true; return services; })).rejects.toThrow("migration");
  expect(realized).toBe(false); expect(readFileSync(file, "utf8")).toBe("preserve legacy bytes\n");
  closeDatabase(); owner.release();
});
