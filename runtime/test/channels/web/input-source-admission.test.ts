import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createDurableQueueDispatch } from "../../../src/agent-pool/durable-queue-dispatch.js";
import { createDurableConversationAdapter } from "../../../src/agent-pool/durable-runtime-adapter.js";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { WebChannel, type WebChannelOpts } from "../../../src/channels/web.js";
import type { WebUserMessageStoreOptions } from "../../../src/channels/web/messaging/message-store.js";
import { installServiceWorkSchema } from "../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../src/service-effects/contracts/common.js";
import type { AcceptSourceRequest } from "../../../src/service-effects/contracts/service-work-store.js";
import { resetRateLimiterStateForTests } from "../../../src/channels/web/http/rate-limit.js";

let cleanup = () => {};
afterEach(() => { closeDatabase(); cleanup(); resetRateLimiterStateForTests(); });
function fixture(select?: WebChannelOpts["getInputSourceAdmission"], validateAcceptance?: () => boolean) {
  const ws = createTempWorkspace("http-source-admission-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  cleanup = () => { restore(); ws.cleanup(); };
  mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
  writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  initDatabase();
  const db = getDb();
  installServiceWorkSchema(db); // Fixture-only, not production activation.
  db.query("INSERT INTO chats(jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default", "Fixture", "2026-08-13T00:00:00.000Z");
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance });
  if (!made.ok) throw Error("fixture construction");
  const events: string[] = [], jobs: Array<{ key: string; lane?: string; task: () => Promise<void> }> = [];
  let expectedSources = 0;
  let active = false, streaming = false;
  const channel = new WebChannel({
    queue: { enqueue(task: () => Promise<void>, key: string, lane?: string) {
      expect(db.inTransaction).toBe(false);
      expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(expectedSources);
      jobs.push({ key, lane, task });
    } } as any,
    agentPool: { setSessionBinder() {}, isStreaming: () => streaming, isActive: () => active } as any,
    ...(select ? { getInputSourceAdmission: select } : {}),
  });
  channel.broadcastEvent = type => {
    expect(db.inTransaction).toBe(false);
    expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(expectedSources);
    events.push(type);
  };
  const accept: NonNullable<WebUserMessageStoreOptions["acceptSource"]> = ({ message, rowId, database }) => {
    expect(database).toBe(db);
    expect(database.inTransaction).toBe(true);
    const input: AcceptSourceRequest = {
      effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
        provenanceRef: "engine:host-selected", redactionClass: "private" },
      chatJid: message.chat_jid, sourceId: message.id, kind: "message", payloadRef: `message-row:${rowId}`,
      targetOperationId: null, parentSourceSeq: null, acceptedAt: message.timestamp, createWakeIntent: false,
    };
    input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
    made.value.acceptSourceInTransaction(input, database);
  };
  const route = (body: Record<string, unknown> = { content: "ordinary input" }, signal?: AbortSignal) => channel.handleRequest(new Request(
    "http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify(body), signal }));
  const snapshot = () => ["messages", "chats", "media", "message_media", "sqlite_sequence", "service_effect_s01_chats",
    "service_effect_s01_sources", "service_effect_s01_decisions", "service_effect_s01_wake_intents"].map(table => db.query(`SELECT * FROM ${table}`).all());
  return { channel, db, work: made.value, accept, route, snapshot, events, jobs,
    expectSources(count: number) { expectedSources = count; },
    busy(value: boolean, stream = false) { active = value; streaming = stream; } };
}

test("HTTP default is off, including forged engine and callback fields", async () => {
  const f = fixture();
  expect(f.channel.getInputSourceAdmission).toBeUndefined();
  expect(f.channel.dispatchAcceptedInput).toBeUndefined();
  const response = await f.route({ content: "ordinary input", engine: "durable", acceptSource: "forged", getInputSourceAdmission: "forged" });
  expect(response.status).toBe(201);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(0);
  expect(f.jobs).toHaveLength(1);
  expect(f.jobs[0].lane).toBe("chat:web:default");
});

test("actual HTTP + prototype + storage wrapper commit source and timeline before publication/wake", async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const routes: string[] = [];
  const f = fixture(jid => { routes.push(jid); return callback; });
  callback = f.accept;
  f.expectSources(1);
  const response = await f.route({ content: "private input", engine: "untrusted-other-engine" });
  expect(response.status).toBe(201);
  expect(routes).toEqual(["web:default"]);
  const message = f.db.query("SELECT rowid, id, timestamp FROM messages").get() as any;
  const source = f.db.query("SELECT * FROM service_effect_s01_sources").get() as any;
  expect(source.source_id).toBe(message.id);
  expect(source.payload_ref).toBe(`message-row:${message.rowid}`);
  expect(source.accepted_at).toBe(message.timestamp);
  expect(source.provenance_ref).toBe("engine:host-selected");
  expect(f.db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toHaveLength(0);
  expect(f.events).toContain("new_post");
  expect(f.jobs).toHaveLength(1);
});

for (const failure of ["selection", "after-write", "async"] as const) test(`HTTP ${failure} failure exposes no private detail or accepted side effects`, async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const f = fixture(() => { if (failure === "selection") throw Error("private selector detail"); return callback; });
  callback = stored => { f.accept(stored); if (failure === "async") return Promise.reject(Error("private callback detail")) as never; throw Error("private callback detail"); };
  const before = f.snapshot();
  const response = await f.route();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
  expect(f.snapshot()).toEqual(before);
  expect(f.jobs).toEqual([]);
  expect(f.events).toEqual([]);
});

test("selection is captured before awaited HTTP body, even if coordinator is replaced", async () => {
  const f = fixture();
  let selected = 0;
  f.expectSources(1);
  f.channel.getInputSourceAdmission = () => { selected++; return f.accept; };
  let release!: () => void, reading!: () => void;
  const entered = new Promise<void>(resolve => { reading = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const req = new Request("http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
    body: new ReadableStream({ async pull(controller) { reading(); await gate; controller.enqueue(new TextEncoder().encode(JSON.stringify({ content: "delayed input", engine: "forged" }))); controller.close(); } }) });
  const pending = f.channel.handleRequest(req);
  await entered;
  // Wait until handler has pinned the callback, not merely until the stream prefetches.
  for (let n = 0; n < 100 && !selected; n++) await Bun.sleep(0);
  expect(selected).toBe(1);
  f.channel.getInputSourceAdmission = () => { throw Error("replacement must not be consulted"); };
  release();
  expect((await pending).status).toBe(201);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
});

for (const mutation of ["owner-before", "owner-after", "abort"] as const) test(`HTTP ${mutation} rejects atomically before acknowledgement`, async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"], checks = 0;
  const abort = new AbortController();
  const f = fixture(() => callback, () => ++checks !== (mutation === "owner-before" ? 1 : mutation === "owner-after" ? 2 : -1));
  callback = stored => {
    f.accept(stored);
    if (mutation === "abort") abort.abort();
  };
  const before = f.snapshot();
  const response = await f.route({ content: "fenced input" }, abort.signal);
  expect(response.status).toBe(mutation === "abort" ? 400 : 503);
  expect(f.snapshot()).toEqual(before);
  expect(f.events).toEqual([]);
  expect(f.jobs).toEqual([]);
});

test("HTTP SQL busy retry retains the selected callback and commits exactly once", async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"], selections = 0, attempts = 0;
  const f = fixture(() => { selections++; return callback; });
  callback = stored => {
    f.accept(stored);
    if (++attempts === 1) {
      f.channel.getInputSourceAdmission = () => { throw Error("must not reselect on retry"); };
      throw Object.assign(Error("retry"), { code: "SQLITE_BUSY" });
    }
  };
  f.expectSources(1);
  expect((await f.route()).status).toBe(201);
  expect(selections).toBe(1);
  expect(attempts).toBe(2);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(f.jobs).toHaveLength(1);
});

for (const duringAdmission of [false, true]) test(`HTTP queued input preserves order and skips ordinary source callback: race ${duringAdmission}`, async () => {
  let calls = 0;
  const f = fixture(() => () => { calls++; });
  if (duringAdmission) {
    const admit = f.channel.admitUserMessage!.bind(f.channel);
    f.channel.admitUserMessage = async (...args) => { f.busy(true); return admit(...args); };
  } else f.busy(true);
  expect((await f.route({ content: "first follow-up" })).status).toBe(201);
  expect((await f.route({ content: "second follow-up" })).status).toBe(201);
  expect(calls).toBe(0);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(0);
  expect(f.channel.getQueuedFollowupItems("web:default").map(item => item.queuedContent)).toEqual(["first follow-up", "second follow-up"]);
  expect(f.jobs).toEqual([]);
  expect(f.events).toEqual(["agent_followup_queued", "agent_followup_queued"]);
});

for (const failure of ["selection", "pending", "wait"] as const) test(`worker ${failure} retains lane and recovery marker without legacy`, async () => {
  const f = fixture();
  let legacy = 0;
  (f.channel.agentPool as any).runAgent = () => { legacy++; throw Error("legacy forbidden"); };
  const shutdown = new AbortController();
  const host = createDurableQueueDispatch({ work: f.work, adapter: { submit() {}, wait() {}, settle() {} } as any, branchId: "main",
    assertCurrentWriter() {}, shutdown: shutdown.signal,
    waitForReconciliation: (_identity, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) });
  f.channel.dispatchAcceptedInput = Object.assign(() => {
    if (failure === "selection") throw Error("owner lost");
    return async () => { if (failure === "wait") throw Error("wait failed"); return "pending" as const; };
  }, { waitForPending: host.waitForPending });
  expect((await f.route()).status).toBe(201);
  let released = false;
  const original = f.jobs[0]!.task().then(() => { released = true; });
  await Bun.sleep(10);
  expect(released).toBe(false);
  expect(legacy).toBe(0);
  expect(f.db.query("SELECT inflight_message_id FROM chat_cursors").get()).toEqual({
    inflight_message_id: (f.db.query("SELECT id FROM messages").get() as { id: string }).id,
  });
  const before = f.db.query("SELECT * FROM chat_cursors").get();
  shutdown.abort(); await original;
  expect(released).toBe(true);
  expect(f.db.query("SELECT * FROM chat_cursors").get()).toEqual(before);
  expect(legacy).toBe(0);
});

const hasEngine = existsSync(new URL("../../../durable-engine/node_modules/@earendil-works/pi-durable/package.json", import.meta.url));
test("required engine integration prerequisite cannot silently skip", () => {
  if (process.env.PICLAW_REQUIRE_DURABLE_ENGINE === "1") expect(hasEngine).toBe(true);
});
for (const pending of [false, true]) test.skipIf(!hasEngine)(`HTTP accepted ordinary message uses current worker and real engine exactly once; pending=${pending}`, async () => {
  const { HostConversationRuntime, BunSqliteDatabase, createHostDurableBindings, initializeHostDurableBindings } = await import("../../../durable-engine/src/index.js");
  const { SqliteStorage } = await import("../../../durable-engine/qualification/sqlite.ts");
  const { context, openFixture } = await import("../../../../qualification/pi-durable-130/src/fixture.js");
  const { installTerminalSettlementCompositionSchema } = await import("../../../src/service-effects/current-piclaw/terminal-settlement-schema.js");
  const { createCurrentPiclawTerminalSettlementStore } = await import("../../../src/service-effects/current-piclaw/terminal-settlement-store.js");
  const { InMemoryEffectPayloadResolver } = await import("../../../src/service-effects/testing/in-memory-payload-resolver.js");
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const f = fixture(() => callback);
  callback = f.accept;
  installTerminalSettlementCompositionSchema(f.db);
  const path = join(process.env.PICLAW_WORKSPACE!, "engine.sqlite");
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
  const conversationId = base.root.id;
  await base.close();
  let owner = true;
  const assert = () => { if (!owner) throw Error("owner lost"); };
  initializeHostDurableBindings(f.db, assert);
  const payloads = new InMemoryEffectPayloadResolver();
  const terminal = createCurrentPiclawTerminalSettlementStore(f.db, payloads, {
    hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return f.db.inTransaction; },
  });
  if (!terminal.ok) throw Error("terminal construction");
  const manifest = [{ chatJid: "web:default", branchId: "main", conversationId }];
  const runtime = await HostConversationRuntime.open({
    incarnation: "queue-test", owner: { assert, release() {} }, work: f.work, terminal: terminal.value,
    openStorage: () => SqliteStorage.open(new BunSqliteDatabase(path)),
    harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
    existingConversationIds: [conversationId], conversationFor(chat, branch) {
      if (chat !== "web:default" || branch !== "main") throw Error("binding conflict"); return conversationId;
    },
    bindings: createHostDurableBindings(f.db, { domain: "queue-test", incarnation: "queue-test", assertOwner: assert, manifest,
      async resolveContent(ref) {
        const row = f.db.query("SELECT content FROM messages WHERE rowid=?").get(Number(ref.split(":")[1])) as { content: string };
        return row.content;
      } }),
    authorizeScheduling() { assert(); }, putAnswer(ref, text) { payloads.putText(ref, text); },
    sessionId: "queue-test", lane: "main", generation: 1, now: () => new Date().toISOString(),
  }, context);
  const adapter = createDurableConversationAdapter({ incarnation: "queue-test", manifest, runtime });
  const shutdown = new AbortController();
  let reconcile!: () => void;
  const evidence = new Promise<void>(resolve => { reconcile = resolve; });
  const lifecycle = { shutdown: shutdown.signal, waitForReconciliation: async () => { await evidence; } };
  let accepted: Parameters<typeof adapter.settle>[0] | undefined;
  const selectedAdapter = pending ? { ...adapter, async wait(work: Parameters<typeof adapter.wait>[0], id: number) {
    await adapter.wait(work, id);
    if (!accepted) { accepted = work; throw Error("lost wait acknowledgement"); }
  } } : adapter;
  f.channel.dispatchAcceptedInput = createDurableQueueDispatch({ ...lifecycle, work: f.work, adapter: selectedAdapter, branchId: "main", assertCurrentWriter: assert });
  let legacyCalls = 0;
  (f.channel.agentPool as any).runAgent = () => { legacyCalls++; throw Error("legacy forbidden"); };
  f.channel.resumeChat = () => {};
  try {
    f.expectSources(1);
    expect((await f.route({ content: "ordinary input", engine: "forged" })).status).toBe(201);
    let releases = 0;
    const original = f.jobs[0]!.task().then(() => { releases++; });
    if (pending) {
      for (let n = 0; n < 200 && !accepted; n++) await Bun.sleep(1);
      expect(accepted).toBeDefined();
      expect(releases).toBe(0);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
      expect(await adapter.settle(accepted!)).not.toBeNull();
      reconcile();
    }
    await original;
    expect(releases).toBe(1);
    expect(base.host.modelCalls).toBe(1);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
    expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    await f.jobs[0]!.task();
    expect(base.host.modelCalls).toBe(1);
    expect(legacyCalls).toBe(0);
    const row = f.db.query("SELECT rowid, id FROM messages WHERE is_bot_message=0").get() as { rowid: number; id: string };
    const retry = f.channel.dispatchAcceptedInput("web:default", row.id, row.rowid)!;
    expect(await retry()).toBe("settled");
    expect(base.host.modelCalls).toBe(1);
    const failedWait = createDurableQueueDispatch({ ...lifecycle, work: f.work, branchId: "main", assertCurrentWriter: assert,
      adapter: { ...adapter, async wait() { throw Error("uncertain wait"); } } });
    expect(await failedWait("web:default", row.id, row.rowid)!()).toBe("pending");
    expect(legacyCalls).toBe(0);
    f.db.query("UPDATE service_effect_s01_sources SET kind='scheduled_agent'").run();
    expect(() => failedWait("web:default", row.id, row.rowid)).toThrow("identity conflict");
    f.db.query("UPDATE service_effect_s01_sources SET kind='message'").run();
    owner = false;
    expect(() => f.channel.dispatchAcceptedInput!("web:default", row.id, row.rowid)).toThrow("owner lost");
    expect(legacyCalls).toBe(0);
    owner = true;
  } finally { owner = true; await adapter.close(); }
}, 15000);
