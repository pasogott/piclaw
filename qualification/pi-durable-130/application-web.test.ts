import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { prepareCopiedApplicationUpgrade } from "../../runtime/durable-engine/src/copied-upgrade.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { AgentQueue } from "../../runtime/src/queue.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { createAgentPoolModelOptions } from "../../runtime/test/model-services-fixture.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { openFixture, context, barrier } from "./src/fixture.js";
import { resetRateLimiterStateForTests } from "../../runtime/src/channels/web/http/rate-limit.js";
import { upgradeApplication } from "../../runtime/durable-engine/src/application-upgrade.js";
import { HostCutoverController, initializeCutoverManifest } from "../../runtime/durable-engine/src/host-cutover.js";

// The runtime acquires the actual strict lock BEFORE root/SDK initialization. No TestOwner.
for (const failWait of [false, true]) test(`application bundle binds real pool/channel; lost wait ACK=${failWait}`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "application-bundle-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "runtime.lock"), strictOwnership: true, disabled: false });
  const ownership = applicationOwnership(lock);
  const borrowed = ownership.borrow(); borrowed.release();
  expect(() => borrowed.assertCurrentOwner()).toThrow("sealed"); lock.assertCurrentOwner();
  process.env.PICLAW_DB_IN_MEMORY = "0";
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  lock.assertCurrentOwner(); initDatabase();
  const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
  const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
  const storage = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(storage));
  const chat = `web:bundle:${crypto.randomUUID()}`;
  const incarnation = `application-${crypto.randomUUID()}`;
  const manager = SessionManager.inMemory(dir, { id: "preserved-session" });
  manager.appendMessage({ role: "system", content: "original baseline", timestamp: 1 });
  const leaf = manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never",
    content: [{ type: "text", text: "original answer" }], stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const source = Buffer.from([manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join("\n") + "\n");
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const manifest = Buffer.from(JSON.stringify({ version: 1, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
    hostBranchBindings: { [leaf]: { chatJid: chat, chatIncarnation: incarnation, branchId: "main", hostBaseline: "original baseline" } } }));
  const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const upgrade = prepareCopiedApplicationUpgrade(source, manifest, { sourceSHA256: sha(source), manifestSHA256: sha(manifest) }, (entries, leaf) => ({
    messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
    projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })),
  }));
  const importedRoot = await base.harness.createConversation({ ownership: { kind: "ownerless" },
    agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  await upgrade.importCopied(importedRoot, () => lock.assertCurrentOwner(), context);
  const importedBindings = await upgrade.verifyBindings(base.harness, importedRoot.id, context);
  expect(importedBindings.manifest).toEqual([{ chatJid: chat, branchId: "main", conversationId: importedRoot.id }]);
  await base.close(); installTerminalSettlementCompositionSchema(db);
  const unbound = `${chat}:unbound`;
  storeChatMetadata(chat, new Date().toISOString());
  storeChatMetadata(unbound, new Date().toISOString());
  // Disposable durable application payload port: real bytes on disk, not InMemory fixture.
  const payloadPath = (ref: string) => join(dir, createHash("sha256").update(ref).digest("hex"));
  const answers = { put(ref: string, text: string) { lock.assertCurrentOwner(); writeFileSync(payloadPath(ref), text); },
    resolver: { async resolve(ref: string) {
      lock.assertCurrentOwner(); const bytes = new Uint8Array(readFileSync(payloadPath(ref)));
      return { ref, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
    } } };
  const failed = barrier();
  const options = { root: db, path, ownership,
    wrapWait: failWait ? wait => async (...args) => { await wait(...args); failed.release(); throw Error("lost wait ACK"); } : undefined,
    ...importedBindings, sessions: new Map(importedBindings.sessions),
    offlineInitialize: true, answers,
    runtime: { incarnation, sessionId: "preserved-session", lane: "main", generation: 1, now: () => new Date().toISOString(),
      harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } } },
  } satisfies Parameters<typeof createApplicationBootstrapBundle>[0];
  if (!failWait) {
    let published = 0;
    const invalidScopes = [
      { sessions: new Map([[chat, "preserved-session"], [unbound, "extra-session"]]) },
      { sessions: new Map<string, string>() },
      { sessions: new Map([[unbound, "wrong-key"]]) },
      { sessions: new Map([[chat, " "]]) },
      { sessions: new Map([[chat, 123 as unknown as string]]) },
      { manifest: [{ ...options.manifest[0], chatJid: 123 as unknown as string }], sessions: new Map([[123 as unknown as string, "session"]]) },
      { manifest: [{ ...options.manifest[0], chatJid: ` ${chat}` }], sessions: new Map([[` ${chat}`, "session"]]) },
      { manifest: [options.manifest[0], options.manifest[0]] },
      { manifest: [{ ...options.manifest[0], branchId: "other" }] },
    ];
    for (const invalid of invalidScopes) {
      await expect(createApplicationBootstrapBundle({ ...options, ...invalid }, context).then(bundle => {
        published++; return bundle.close();
      })).rejects.toThrow("Exact main-branch application manifest required");
      expect(published).toBe(0);
      expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid IN (?,?)").get(chat, unbound)).toEqual({ n: 0 });
      expect(db.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid IN (?,?)").get(chat, unbound)).toEqual({ n: 0 });
      lock.assertCurrentOwner();
      expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    }
    const wrongPath = join(dir, "wrong.db");
    const wrong = new Database(wrongPath); wrong.close();
    await expect(createApplicationBootstrapBundle({ ...options, path: wrongPath }, context)).rejects.toThrow("Shared database identity required");
    const disabled = acquireRuntimeLock({ lockPath: join(dir, "disabled.lock"), disabled: true });
    expect(() => applicationOwnership(disabled)).toThrow("Strict application ownership required");
    const stale = acquireRuntimeLock({ lockPath: join(dir, "stale.lock"), strictOwnership: true, disabled: false });
    const staleOwnership = applicationOwnership(stale); stale.release();
    await expect(createApplicationBootstrapBundle({ ...options, ownership: staleOwnership }, context)).rejects.toThrow("ownership lost");
    await expect(createApplicationBootstrapBundle({ ...options,
      manifest: [{ chatJid: chat, branchId: "main", conversationId: 999999 as typeof base.root.id }] }, context)).rejects.toThrow();
    expect(base.host.modelCalls).toBe(0);
    expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(chat)).toEqual({ n: 0 });
    lock.assertCurrentOwner();
    expect(db.inTransaction).toBe(false);
    await rm(wrongPath);
  }
  initializeCutoverManifest(db, () => lock.assertCurrentOwner());
  const identity = { domain: incarnation, incarnation, ownerGeneration: 7,
    sourceEngineId: "legacy", candidateStoreRef: "candidate" };
  const cutover = new HostCutoverController(db, identity, {
    assertOwner(actual) { lock.assertCurrentOwner(); expect(actual).toEqual(identity); },
    assertCurrentWriter(writer) {
      const row = db.query("SELECT manifest FROM qualification_cutover_v1 WHERE domain=?").get(identity.domain) as { manifest: string } | null;
      expect(writer).toBe(row ? JSON.parse(row.manifest).writer : "legacy");
    },
    checkDrained() { return { sourceDigest: sha(source), pending: 0, inflight: 0 }; },
  });
  const { manifest: _manifest, sessions: _sessions, ...application } = options;
  async function importer() {
    lock.assertCurrentOwner();
    const database = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
    const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(database));
    const conversation = (await fixture.harness.conversation(importedRoot.id, context))!;
    return { database, harness: fixture.harness, conversation, close: fixture.close };
  }
  if (!failWait) {
    for (const runtime of [{ ...application.runtime, incarnation: "wrong-domain" },
      { ...application.runtime, sessionId: "invented-session" }]) {
      await expect(upgradeApplication({ plan: upgrade, cutover, application: { ...application, runtime },
        importer: await importer() }, context)).rejects.toThrow("Copied application identity conflict");
      expect(cutover.inspect()).toBeNull(); lock.assertCurrentOwner();
    }
    const importerCloseFailure = Error("importer close failed");
    const closingImporter = await importer();
    let importerCloseCalls = 0;
    const realImporterClose = closingImporter.close;
    closingImporter.close = async () => { importerCloseCalls++; await realImporterClose(); throw importerCloseFailure; };
    await expect(upgradeApplication({ plan: upgrade, cutover, application, importer: closingImporter }, context))
      .rejects.toBe(importerCloseFailure);
    expect(importerCloseCalls).toBe(1);
    expect(cutover.inspect()?.phase).toBe("verified");
    const cleanupImporter = await importer();
    let cleanupCloseCalls = 0;
    const realCleanupClose = cleanupImporter.close;
    cleanupImporter.close = async () => { cleanupCloseCalls++; await realCleanupClose(); throw importerCloseFailure; };
    let cleanupError: unknown;
    try {
      await upgradeApplication({ plan: upgrade, cutover,
        application: { ...application, runtime: { ...application.runtime, incarnation: "wrong-domain" } },
        importer: cleanupImporter }, context);
    } catch (error) { cleanupError = error; }
    expect(cleanupError).toBeInstanceOf(AggregateError);
    const cleanupErrors = (cleanupError as AggregateError).errors;
    expect(cleanupErrors).toHaveLength(2);
    expect(cleanupErrors[0].message).toBe("Copied application identity conflict");
    expect(cleanupErrors[1]).toBe(importerCloseFailure);
    expect(cleanupCloseCalls).toBe(1);
    const wrongPath = join(dir, "bootstrap-failure.db");
    new Database(wrongPath).close();
    let escaped = 0;
    await expect(upgradeApplication({ plan: upgrade, cutover, application: { ...application, path: wrongPath },
      importer: await importer() }, context).then(async result => { escaped++; await result.close(); })).rejects.toThrow("Shared database identity required");
    expect(escaped).toBe(0);
    expect(cutover.inspect()?.phase).toBe("verified");
    expect(cutover.inspect()?.writer).toBe("legacy");
    lock.assertCurrentOwner(); expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    await rm(wrongPath);
    const open = SqliteStorage.open.bind(SqliteStorage);
    const opened: unknown[] = [];
    const openSpy = spyOn(SqliteStorage, "open").mockImplementation(async (...args) => {
      const result = await open(...args); opened.push(result); return result;
    });
    const commit = cutover.commitWriter.bind(cutover);
    const close = BunSqliteDatabase.prototype.close;
    const closed: BunSqliteDatabase[] = [];
    const primaryFailure = Error("lost writer commit ACK");
    const bundleCloseFailure = Error("candidate bundle close failed");
    let committed: ReturnType<typeof cutover.inspect> = null;
    let failedCandidate: BunSqliteDatabase | undefined;
    const closeSpy = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(async function (this: BunSqliteDatabase) {
      if (committed && !failedCandidate) {
        failedCandidate = this;
        // Fail BEFORE the actual close so teardown proves the real resource is released.
        throw bundleCloseFailure;
      }
      await close.call(this); closed.push(this);
    });
    const commitSpy = spyOn(cutover, "commitWriter").mockImplementation(revision => {
      // Two actual SDK opens: importer, then unpublished paused application.
      expect(opened).toHaveLength(2); expect(closed).toHaveLength(1);
      const active = commit(revision); expect(active.writer).toBe("candidate");
      committed = cutover.inspect();
      throw primaryFailure;
    });
    try {
      let failure: unknown;
      try {
        await upgradeApplication({ plan: upgrade, cutover, application, importer: await importer() }, context)
          .then(async result => { escaped++; await result.close(); });
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(2);
      expect((failure as AggregateError).errors[0]).toBe(primaryFailure);
      expect((failure as AggregateError).errors[1]).toBe(bundleCloseFailure);
      expect(escaped).toBe(0); expect(closed).toHaveLength(1);
      expect(failedCandidate).toBeDefined();
      expect(cutover.inspect()).toEqual(committed);
      lock.assertCurrentOwner();
      expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
      expect(cutover.inspect()?.phase).toBe("active");
      expect(cutover.inspect()?.writer).toBe("candidate");
      expect(base.host.modelCalls).toBe(0);
    } finally {
      commitSpy.mockRestore(); openSpy.mockRestore(); closeSpy.mockRestore();
      if (failedCandidate) await close.call(failedCandidate);
    }
  }
  const beforeRetry = cutover.inspect();
  if (!failWait) {
    const alteredManifest = Buffer.from(manifest.toString() + "\n");
    const other = prepareCopiedApplicationUpgrade(source, alteredManifest,
      { sourceSHA256: sha(source), manifestSHA256: sha(alteredManifest) }, (entries, leaf) => ({
        messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
        projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })),
      }));
    await expect(upgradeApplication({ plan: other, cutover, application, importer: await importer() }, context)).rejects.toThrow("Cutover rejected");
    expect(cutover.inspect()).toEqual(beforeRetry);
  }
  const begin = spyOn(cutover, "begin");
  const bundle = await upgradeApplication({ plan: upgrade, cutover, application, importer: await importer() }, context);
  if (!failWait) { expect(begin).not.toHaveBeenCalled(); expect(cutover.inspect()).toEqual(beforeRetry); }
  else expect(begin).toHaveBeenCalledTimes(1);
  begin.mockRestore();
  expect(cutover.inspect()?.phase).toBe("active");
  lock.assertCurrentOwner();
  expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(chat)).toEqual({ n: 0 });
  const spies = (["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); }));
  const queue = new AgentQueue();
  const pool = new AgentPool({ ...createAgentPoolModelOptions(), ...bundle.sessionOptions,
    createSession: async () => { throw Error("Legacy forbidden"); } });
  try {
    const ports = bundle.bind({ queue, agentPool: pool });
    const channel = new WebChannel(ports); channel.broadcastEvent = () => {};
    // Actual pool/channel composition must leave B on the ordinary legacy path,
    // BEFORE any throwing legacy factory runs: no durable admission or claim.
    expect(channel.getInputSourceAdmission?.(unbound)).toBeUndefined();
    expect(bundle.sessionOptions.durableSessions.has(unbound)).toBe(false);
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(unbound)).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid=?").get(unbound)).toEqual({ n: 0 });
    expect(() => bundle.bind({ queue, agentPool: pool })).toThrow("already bound");
    const hold = barrier(); base.host.modelHold = hold;
    const entered = barrier(); base.host.onModelEnter = () => entered.release();
    const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "normal application input" }),
    }));
    expect(response.status).toBe(201);
    await entered.promise;
    const row = db.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? AND is_bot_message=0").get(chat) as { rowid: number; id: string; content: string };
    expect(row.content).toBe("normal application input");
    expect(db.query("SELECT payload_ref FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get(chat, row.id)).toEqual({ payload_ref: `message-row:${row.rowid}` });
    expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
    hold.release();
    if (failWait) {
      await failed.promise; await Bun.sleep(20);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
      expect(db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual({ inflight_message_id: row.id });
      expect(db.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toHaveLength(0);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([]);
    } else {
      for (let n = 0; n < 500 && queue.isLaneBusy(`chat:${chat}`); n++) await Bun.sleep(5);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(false);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([{ content: "synthetic answer" }]);
      expect(db.query("SELECT operation_id FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toEqual([{ operation_id: `message:${row.rowid}:1` }]);
    }
    expect(await pool.getCurrentModelLabel(chat)).toBe("qualification/synthetic");
    expect(pool.getSessionGenerationForChat(chat)).toBe("preserved-session");
    expect(await pool.saveSessionPosition(chat)).not.toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(base.host.modelCalls).toBe(1); expect(base.host.credentialLookups).toBe(0);
    const files = readdirSync(process.env.PICLAW_WORKSPACE!, { recursive: true }).map(String);
    expect(files.filter(p => /\.jsonl$/i.test(p))).toEqual([]);
    expect(files.filter(p => /\.(db|sqlite)$/i.test(p))).toEqual([".piclaw/store/messages.db"]);
  } finally {
    const stopping = queue.shutdown(); const closing = bundle.close();
    await stopping; await pool.shutdown(); await closing;
    lock.assertCurrentOwner(); // Other application components are still live.
    expect(() => bundle.bind({ queue, agentPool: pool })).toThrow("sealed");
    expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    closeDatabase(); lock.release();
    for (const spy of spies) spy.mockRestore(); resetRateLimiterStateForTests();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
