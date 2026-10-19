import "./src/test-guard.js";
import { test, expect, spyOn } from "bun:test";
import { cpSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";
import { SessionManager, SettingsManager, ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { extensionKvSet, storeChatMetadata, storeMessage } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { handleRegisteredAddonConfigApiRequest } from "../../runtime/src/channels/web/handlers/addon-config-api.js";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";

const slugs = ["code-review", "delegate", "goal", "observability", "plan-sidebar", "restic", "session-dashboard"];
test("all seven shipped consumers admit actual native startup and Restic effects without legacy sessions", async () => {
  if (!process.env.PICLAW_NATIVE_CORE_CHILD) {
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE; delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolated = ensureTestFilesystemIsolation(env);
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], { cwd: import.meta.dir, env: { ...env, PICLAW_NATIVE_CORE_CHILD: "1" }, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, out + err).toBe(0);
    } finally { isolated.cleanup(); }
    return;
  }
  const source = process.env.DURABLE_CORE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_CORE_ADDONS_ROOT must contain the approved native core add-ons");
  const workspace = process.env.PICLAW_WORKSPACE!;
  for (const slug of slugs) {
    const from = join(source, "addons", slug), to = join(workspace, ".pi/extensions/node_modules/@rcarmo", `piclaw-addon-${slug}`);
    cpSync(from, to, { recursive: true, filter: path => basename(path) !== "node_modules" });
    symlinkSync(join(import.meta.dir, slug === "observability" ? "node_modules" : "../../node_modules"), join(to, "node_modules"));
  }
  const loadAddon = (slug: string, file: string) => import(pathToFileURL(join(workspace, ".pi/extensions/node_modules/@rcarmo", `piclaw-addon-${slug}`, file)).href);
  const { ResticService } = await loadAddon("restic", "service.ts");
  const { resticRuntime } = await loadAddon("restic", "runtime-state.ts");
  const service = new ResticService({ paths: { sources: [{ name: "workspace", path: workspace }], stateDir: join(workspace, "backup-state"), stageDir: join(workspace, "backup-stage"), cacheDir: join(workspace, "backup-cache") },
    resolveSecret: async () => { throw Error("No secret retrieval"); }, run: async () => { throw Error("No backup subprocess"); } });
  const previousService = resticRuntime().service; resticRuntime().service = service;
  const saved = { ...service.configurationSnapshot().config, excludes: ["native-owned-config"] };
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "core-consumers.lock"), strictOwnership: true, disabled: false });
  initDatabase(); const root = getDb(); storeChatMetadata("web:default", new Date().toISOString());
  extensionKvSet("observability", "config", { instance_name: "native-persisted-instance", enabled: true, appinsights_enabled: false, graphite_enabled: false, appinsights_live_metrics: false }, "global");
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions" as const, baseUrl: "https://invalid.invalid", input: ["text" as const], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const sequence = [{ action: "get_config", config: null }, { action: "set_config", config: saved }, { action: "status", config: null }];
  let calls = 0;
  let expectedInstance = "native-persisted-instance";
  const credentials = createTestCredentialStore({ synthetic: { type: "api_key", key: "fixture-only" } });
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, credentials, allowModelNetwork: false, refreshOnCreate: false });
  const stream = (_physical: unknown, input: unknown) => {
    expect(JSON.stringify(input)).toContain("## Observability");
    expect(JSON.stringify(input)).toContain(expectedInstance);
    expect(JSON.stringify(input)).toContain("OTel tracing active");
    expect(JSON.stringify(input)).not.toContain("Live Metrics enabled.");
    const step = calls++, output = createAssistantMessageEventStream();
    const message = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: step < sequence.length ? [{ type: "toolCall" as const, id: `restic-${step}`, name: "restic", arguments: sequence[step]! }] : [{ type: "text" as const, text: "Native core consumers complete" }],
      stopReason: step < sequence.length ? "toolUse" as const : "stop" as const,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { output.push({ type: "done", reason: message.stopReason, message }); output.end(message); });
    return output;
  };
  runtime.registerNativeProvider({ id: "synthetic", name: "Synthetic", getModels: () => [model] as any,
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }), resolve: async () => ({ auth: { apiKey: "fixture-only" }, source: "synthetic" }) } }, stream: stream as any, streamSimple: stream as any });
  await runtime.refresh({ allowNetwork: false }); await runtime.getAvailable();
  const settings = SettingsManager.create(workspace, getPiclawAgentDir()); settings.setDefaultModelAndProvider("synthetic", "approved"); await settings.flush();
  const spies = [spyOn(SessionManager, "create"), spyOn(SessionManager, "open"), spyOn(SessionManager, "inMemory")];
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => ({ modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime) } as RuntimeModelServices));
    const configUrl = "http://fixture/agent/addons/api/observability/config";
    const respond = (body: unknown, status = 200) => Response.json(body, { status });
    const initialConfig = await handleRegisteredAddonConfigApiRequest(new Request(configUrl), "observability", "config", respond);
    expect(initialConfig!.status).toBe(200);
    expect(await initialConfig!.json()).toMatchObject({ enabled: true, instance_name: expectedInstance, appinsights_live_metrics: false });
    expectedInstance = "native-settings-instance";
    const updated = await handleRegisteredAddonConfigApiRequest(new Request(configUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance_name: expectedInstance }) }), "observability", "config", respond);
    expect(updated!.status).toBe(200);
    expect(await updated!.json()).toMatchObject({ ok: true, config: { instance_name: expectedInstance, enabled: true } });
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: credentials, modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime), ...backend.sessionOptions });
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const message = { id: "native-core-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "Inspect and configure the fixture backup service", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
    const row = root.transaction(() => { const rowId = storeMessage(message); bound.getInputSourceAdmission!(message.chat_jid)!({ message, rowId, database: root }); return rowId; })();
    expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe("settled");
    expect(calls).toBe(4);
    expect(service.configurationSnapshot().config.excludes).toEqual(["native-owned-config"]);
    expect(resticRuntime().service).toBe(service);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    backend?.stop(); await backend?.close();
    for (const spy of spies) spy.mockRestore();
    service.stop(); resticRuntime().service = previousService; closeDatabase(); owner.release();
  }
}, 30_000);
