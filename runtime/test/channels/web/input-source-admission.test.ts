import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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
  const events: string[] = [], jobs: Array<{ key: string; lane?: string }> = [];
  let expectedSources = 0;
  let active = false, streaming = false;
  const channel = new WebChannel({
    queue: { enqueue(_task: unknown, key: string, lane?: string) {
      expect(db.inTransaction).toBe(false);
      expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(expectedSources);
      jobs.push({ key, lane });
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
  return { channel, db, accept, route, snapshot, events, jobs,
    expectSources(count: number) { expectedSources = count; },
    busy(value: boolean, stream = false) { active = value; streaming = stream; } };
}

test("HTTP default is off, including forged engine and callback fields", async () => {
  const f = fixture();
  expect(f.channel.getInputSourceAdmission).toBeUndefined();
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
