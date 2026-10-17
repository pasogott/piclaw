import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
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
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";
import { Harness, AgentDoc, InboxDoc, configure, createRegistry, defineTask, defineExtension, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostModels } from "../../runtime/durable-engine/src/host-models.js";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.js";

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

for (const scenario of ["public-conversations", "custom-subset", "pending-host"] as const) factoryTest(scenario, scenario === "custom-subset"
  ? "default factory preserves persisted custom read subset and all metadata/history/identity on reopen"
  : scenario === "pending-host"
    ? "default factory rejects genuine old bash default with pending host source without SQL mutation"
    : "default factory prepares and reopens real startup-known public conversations; refuses legacy before models", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false });
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  let calls = 0;
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requested: string[] = [];
  let toolSequence: { name: string; arguments: Record<string, unknown> }[] | undefined;
  const modelB = { ...model, id: "approved-b" };
  const observedResults = new Map<string, { toolName: string; isError?: boolean; content: unknown }>();
  const stream = (physical: typeof model, input: { messages: { role: string; toolCallId?: string; toolName?: string; isError?: boolean; content: unknown }[] }) => {
    for (const result of input.messages) if (result.role === "toolResult" && result.toolCallId && result.toolName)
      observedResults.set(result.toolCallId, { toolName: result.toolName, isError: result.isError, content: result.content });
    requested.push(physical.id);
    calls++; const stream = createAssistantMessageEventStream();
    const step = toolSequence?.shift();
    const message = { role: "assistant" as const, api: "openai-completions" as const, provider: physical.provider, model: physical.id,
      content: step ? [{ type: "toolCall" as const, id: `factory-tool-${calls}`, name: step.name, arguments: step.arguments }]
        : [{ type: "text" as const, text: "factory synthetic reply" }], stopReason: step ? "toolUse" as const : "stop" as const, timestamp: Date.now(),
      usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
  };
  const credentialStore: RuntimeModelServices["credentialStore"] = { read: async provider => provider === model.provider ? { type: "api_key", key: "synthetic-only" } : undefined,
    list: async () => [{ providerId: model.provider, type: "api_key" }], modify: async () => undefined, delete: async () => {} };
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    credentials: credentialStore,
    allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model, modelB] as any,
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }), resolve: async () => ({ auth: { apiKey: "synthetic-only" }, source: "synthetic" }) } },
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
  let backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(!!backend.sessionOptions.getDurableSession?.("web:default")).toBe(true);
  const first = backend.sessionOptions.getDurableSession?.("web:default");
  expect(first).toBeDefined(); expect(calls).toBe(0);
  const base = createRuntimeBaseServices({ dataDir: workspace });
  const pool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
  const bound = backend.bind({ queue: base.queue, agentPool: pool });
  const channel = new WebChannel(bound);
  channel.broadcastEvent = () => {};
  expect(() => bound.getInputSourceAdmission!("web:newcomer")).toThrow("Unbound");
  const message = { id: "factory-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "hello factory", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
  const rowId = root.transaction(() => {
    const rowId = storeMessage(message);
    bound.getInputSourceAdmission!("web:default")({ message, rowId, database: root });
    return rowId;
  })();
  const dispatch = bound.dispatchAcceptedInput!("web:default", message.id, rowId!);
  expect(dispatch).toBeDefined(); expect(await dispatch!()).toBe("settled"); expect(calls).toBe(1);
  // Tiny history is correctly below the public compaction policy's retained window.
  expect(await first!.compact!("Summarize")).toEqual({ compacted: false });
  expect(calls).toBe(1);
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
  const newRow = root.transaction(() => { const rowId = storeMessage(newMessage); bound.getInputSourceAdmission!(newcomer)({ message: newMessage, rowId, database: root }); return rowId; })();
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
      bound.getInputSourceAdmission!(pending.chat_jid)({ message: pending, rowId, database: root });
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
          if (seed) await configure(tx, id as ConversationId, { tools: createHostBuiltinTools({ cwd: workspace, names: scenario === "custom-subset" ? ["read"] : ["bash"], authority: { assertAllowed() { owner.assertCurrentOwner(); } } }),
            thinkingLevel: "low", instructions: "preserve these instructions", extensions: [defineExtension({ name: "app.host-builtins" })] });
          states.set(id, JSON.parse(JSON.stringify(await tx.doc(AgentDoc, id as ConversationId))));
        }
        return states;
      }, context);
    } finally { await harness.close(context); }
  };
  const seeded = await inspectStored(true);
  for (const state of seeded.values()) expect(state).toMatchObject({ tools: [scenario === "custom-subset" ? "read" : "bash"], model: { provider: model.provider, modelId: model.id },
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
  if (scenario === "custom-subset") {
    expect(backend.sessionOptions.getDurableSession!("web:default")?.sessionId).toBe(first?.sessionId);
    expect(backend.sessionOptions.getDurableSession!(newcomer)).toMatchObject({ sessionId: newPort.sessionId, branchId: newPort.branchId });
    backend.stop(); await backend.close();
    expect(await inspectStored(false)).toEqual(seeded); // Includes tools/model/thinking/instructions/extensions, not just tool count.
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
    rebound.getInputSourceAdmission!(next.chat_jid)({ message: next, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(next.chat_jid, next.id, nextRow!)!()).toBe("settled");
  expect(requested).toEqual([model.id, model.id, model.id, model.id, model.id]);
  // Normal accepted input through the actual default factory, not a standalone
  // tool harness: the synthetic provider requests existing host builtin calls.
  writeFileSync(join(workspace, "factory-tool-input.txt"), "before");
  toolSequence = [
    { name: "read", arguments: { path: "factory-tool-input.txt" } },
    { name: "edit", arguments: { path: "factory-tool-input.txt", edits: [{ oldText: "before", newText: "after" }] } },
    { name: "write", arguments: { path: "factory-tool-output.txt", content: "written by host tool" } },
    { name: "find", arguments: { pattern: "factory-tool-*.txt" } },
    { name: "ls", arguments: { path: "." } },
    { name: "bash", arguments: { command: "printf factory-tool-bash" } },
  ];
  const toolInput = { ...message, id: "factory-tool-input", content: "Run the synthetic host tool sequence" };
  const toolRow = root.transaction(() => {
    const rowId = storeMessage(toolInput);
    rebound.getInputSourceAdmission!(toolInput.chat_jid)({ message: toolInput, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(toolInput.chat_jid, toolInput.id, toolRow!)!()).toBe("settled");
  expect(toolSequence).toEqual([]); toolSequence = undefined;
  expect(readFileSync(join(workspace, "factory-tool-input.txt"), "utf8")).toBe("after");
  expect(readFileSync(join(workspace, "factory-tool-output.txt"), "utf8")).toBe("written by host tool");
  const toolEntries = JSON.stringify(root.query("SELECT * FROM entries").all());
  expect(toolEntries).toContain("factory-tool-bash");
  expect(toolEntries).toContain("Successfully wrote");
  expect(toolEntries).toContain("factory-tool-output.txt");
  // Inspect results delivered back to the actual public model adapter: merely
  // draining the call queue would also succeed when a requested tool is absent.
  for (const name of ["read", "edit", "write", "find", "ls", "bash"]) {
    const result = [...observedResults.values()].find(result => result.toolName === name);
    expect(result).toBeDefined(); expect(result!.isError).not.toBe(true);
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
  const fault = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementation(async function (this: BunSqliteDatabase, ...args) {
    const result = await actualTransaction.apply(this, args);
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
  for (const [id, state] of seeded) expect(upgraded.get(id)).toEqual({ ...(state as object), tools: ["read", "bash", "edit", "write", "find", "ls"] });
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
    const gate = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementationOnce(function (this: BunSqliteDatabase, callback) {
      return actualTransaction.call(this, async tx => { entered(); await hold; return callback(tx); });
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
