import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
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
  await base.close(); installTerminalSettlementCompositionSchema(db);
  const chat = `web:bundle:${crypto.randomUUID()}`;
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
    manifest: [{ chatJid: chat, branchId: "main", conversationId: base.root.id }], sessions: new Map([[chat, "preserved-session"]]),
    offlineInitialize: true, answers,
    runtime: { incarnation: "application-test", sessionId: "preserved-session", lane: "main", generation: 1, now: () => new Date().toISOString(),
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
  const opening = createApplicationBootstrapBundle(options, context);
  // Mutation after entry must not widen the captured admission/session scope.
  options.sessions.set(unbound, "late-extra-session");
  const bundle = await opening;
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
