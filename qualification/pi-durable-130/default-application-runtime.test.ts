import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { SessionManager, SettingsManager, ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { RuntimeStartupCleanupError } from "../../runtime/src/runtime/startup-cleanup-error.js";
import { main } from "../../runtime/src/runtime.js";
import { createDefaultRuntimeBootstrapDeps } from "../../runtime/src/runtime/bootstrap.js";
import { storeMessage } from "../../runtime/src/db.js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";

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
  });
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

factoryTest("public-conversations", "default factory prepares and reopens real startup-known public conversations; refuses legacy before models", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false });
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  let calls = 0;
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requested: string[] = [];
  const modelB = { ...model, id: "approved-b" };
  const stream = (physical: typeof model) => {
    requested.push(physical.id);
    calls++; const stream = createAssistantMessageEventStream();
    const message = { role: "assistant" as const, api: "openai-completions" as const, provider: physical.provider, model: physical.id,
      content: [{ type: "text" as const, text: "factory synthetic reply" }], stopReason: "stop" as const, timestamp: Date.now(),
      usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: "done", reason: "stop", message }); stream.end(message); return stream;
  };
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    credentials: { read: async provider => provider === model.provider ? { type: "api_key", key: "synthetic-only" } : undefined,
      list: async () => [{ providerId: model.provider, type: "api_key" }], modify: async () => undefined, delete: async () => {} },
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
  expect(backend.sessionOptions.durableSessions?.has("web:default")).toBe(true);
  const first = backend.sessionOptions.durableSessions?.get("web:default");
  expect(first).toBeDefined(); expect(calls).toBe(0);
  const bound = backend.bind({ queue: {}, agentPool: {} } as Parameters<typeof backend.bind>[0]);
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
  const originalDoc = root.query("SELECT content FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='\"app.application-conversations\"') ORDER BY seq DESC LIMIT 1").get() as { content: string };
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
  settings.setDefaultModelAndProvider(modelB.provider, modelB.id);
  await settings.flush();
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(backend.sessionOptions.durableSessions?.has("web:default")).toBe(true);
  expect(backend.sessionOptions.durableSessions?.get("web:default")?.sessionId).toBe(first?.sessionId);
  const rebound = backend.bind({ queue: {}, agentPool: {} } as Parameters<typeof backend.bind>[0]);
  const next = { ...message, id: "factory-input-after-default-change", content: "continue A" };
  const nextRow = root.transaction(() => {
    const rowId = storeMessage(next);
    rebound.getInputSourceAdmission!(next.chat_jid)({ message: next, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(next.chat_jid, next.id, nextRow!)!()).toBe("settled");
  expect(requested).toEqual([model.id, model.id]);
  backend.stop(); await backend.close();
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
