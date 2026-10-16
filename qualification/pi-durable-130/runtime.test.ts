import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { Harness, LiveDoc, AssistantEntry, UserEntry, type Tx } from "../../runtime/durable-engine/qualification/durable.ts";
import type { AssistantMessage } from "../../runtime/durable-engine/qualification/ai.ts";
import { HostConversationRuntime, type AcceptedInput, type RuntimeOptions, type SettledAnswer } from "../../runtime/durable-engine/src/index.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";

// Same known-row fixture as terminal-settlement-test-support.seedSqliteMedia, against
// this test's copied root DB. Image bytes/metadata are stored in the existing media table.
function insertMedia(db: Database, operationId: string, mediaId: number) {
  const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64");
  db.transaction(() => {
    db.query("INSERT INTO media(id,filename,content_type,data) VALUES (?,?,?,?)").run(mediaId, "generated.png", "image/png", data);
    db.query(`INSERT INTO service_effect_media_uploads
      (idempotency_key,request_hash,upload_id,media_id,sha256,byte_length,data_ref,thumbnail_ref,metadata_ref,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`upload:${mediaId}`, "c".repeat(64), `upload:${mediaId}`, mediaId,
        new Bun.CryptoHasher("sha256").update(data).digest("hex"), data.length, `media:${mediaId}`, null, null, at);
    db.query(`INSERT INTO service_effect_operation_media
      (idempotency_key,request_hash,operation_id,media_id,role,bound_at) VALUES (?,?,?,?,?,?)`)
      .run(`bind:${mediaId}`, "e".repeat(64), operationId, mediaId, "terminal", at);
  }).immediate();
}
const imageBlock = { type: "image", name: "generated.png", filename: "generated.png", mime_type: "image/png", size: 68 };
// Negative API contract: pi-ai 1.3 does NOT support generated images in assistant content.
// Images are tool/host-owned media, not a newly invented assistant wire variant.
// @ts-expect-error ImageContent is not an AssistantMessage content variant.
const unsupportedAssistantImage: AssistantMessage["content"][number] = { type: "image", data: "AA==", mimeType: "image/png" };

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>, busy = false) {
  const f = await setup(busy);
  try { await run(f); } finally { f.base.host.modelHold?.release(); await f.runtime.close(); f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
}
async function setup(busy = false) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "runtime-"));
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase(); getDb().query("VACUUM INTO ?").run(join(dir, "host.sqlite")); closeDatabase();
  const db = new Database(join(dir, "host.sqlite"), { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); installTerminalSettlementCompositionSchema(db);
  // Explicit qualification-only host correlation schema. Never installed by runtime.open().
  db.exec(`CREATE TABLE runtime_bindings (operation_id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, binding TEXT NOT NULL);
    CREATE TABLE runtime_payloads (ref TEXT PRIMARY KEY, content TEXT NOT NULL)`);
  const path = join(dir, "candidate.sqlite");
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
  const id = base.root.id;
  if (busy) {
    base.host.modelHold = barrier();
    await base.submit("known-seed", "held seed");
  }
  await base.close();
  let acquired = true, releases = 0, opens = 0, authorizations = 0, allowKnown = false;
  const assert = () => { if (!acquired) throw new Error("Host owner lost"); };
  let loseCancellationAck = false;
  const hooks = { authorize: undefined as (() => void | Promise<void>) | undefined,
    cancellation: undefined as (() => void | Promise<void>) | undefined }; 
  const work = value(createCurrentPiclawServiceWorkStore(db, {
    hitFault(point, method) {
      if (loseCancellationAck && method === "acceptCancellation" && point === "effect_then_lost_acknowledgement") {
        loseCancellationAck = false; return true;
      }
      return false;
    }, recordTrace() {},
  }));
  const payloads = new InMemoryEffectPayloadResolver();
  const terminal = value(createCurrentPiclawTerminalSettlementStore(db, payloads, {
    hitFault: () => false, recordTrace() {}, validateOwnership: () => { assert(); expect(db.inTransaction).toBe(true); return true; },
  }));
  const options: RuntimeOptions = {
    incarnation: "copy-A", owner: { assert, release() { releases++; acquired = false; } },
    openStorage: () => { assert(); opens++; return SqliteStorage.open(new BunSqliteDatabase(path)); },
    harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
    work: { acceptSource: work.acceptSource.bind(work), claimNext: work.claimNext.bind(work), appendIntent: work.appendIntent.bind(work),
      bindHarness: work.bindHarness.bind(work), recordQueuedInput: work.recordQueuedInput.bind(work), getOperation: work.getOperation.bind(work),
      getChatFrontier: work.getChatFrontier.bind(work), listOpenOperations: work.listOpenOperations.bind(work),
      async acceptCancellation(request) { await hooks.cancellation?.(); return work.acceptCancellation(request); } }, terminal, existingConversationIds: [id], conversationFor: (chat, branch) => {
      if (chat !== "web:runtime" || branch !== "existing-main") throw new Error("Unknown host branch"); return id;
    },
    bindings: { async getOrBind(input) {
      assert();
      return db.transaction(() => {
        const source = db.query("SELECT source_id,payload_ref,state FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?").get(input.chatJid, input.sourceSeq) as { source_id: string; payload_ref: string; state: string } | null;
        if (!source || source.source_id !== input.sourceId || source.payload_ref !== input.payloadRef || !["claimed", "consumed"].includes(source.state)) throw new Error("Unverified host source");
        const payload = db.query("SELECT content FROM runtime_payloads WHERE ref=?").get(input.payloadRef) as { content: string } | null;
        if (!payload || hashCanonicalRequest({ type: "input", requestId: input.requestId, content: payload.content }) !== input.requestHash) throw new Error("Host payload hash conflict");
        db.query("INSERT OR IGNORE INTO runtime_bindings VALUES (?,?,?)").run(input.operationId, input.requestId, JSON.stringify(input));
        const prior = db.query("SELECT binding FROM runtime_bindings WHERE operation_id=?").get(input.operationId) as { binding: string } | null;
        if (prior?.binding !== JSON.stringify(input)) throw new Error("Immutable intent binding conflict");
        return payload;
      })();
    } },
    async authorizeScheduling(inspection) {
      authorizations++;
      await hooks.authorize?.();
      // Fail closed: this fixture grants progress only when there is no recovered live work.
      if (!busy && !allowKnown && (inspection.tasks.length || inspection.submissions.length)) throw new Error("Recovered authority requires explicit host review");
      if ((busy || allowKnown) && inspection.submissions.some(s => s.conversationId !== id || !["request-1", ...(busy ? ["known-seed"] : [])].includes(s.requestId!))) throw new Error("Unknown recovered submission");
    },
    putAnswer: (ref, text) => { payloads.putText(ref, text); }, sessionId: "existing-host-session", lane: "main", generation: 1, now: () => at,
  };
  const runtime = await HostConversationRuntime.open(options, context);
  async function accept(requestId = "request-1", content = "hello"): Promise<AcceptedInput> {
    const source = value(await work.acceptSource(sealed({ effect: effect(`accept:${requestId}`), chatJid: "web:runtime", sourceId: requestId,
      kind: "message" as const, payloadRef: `input:${requestId}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const claimed = value(await work.claimNext(sealed({ effect: effect(`claim:${requestId}`), chatJid: source.chatJid,
      expectedFrontier: source.sourceSeq - 1, newOperationId: `operation:${requestId}`, claimedAt: at })))!;
    db.query("INSERT INTO runtime_payloads VALUES (?,?)").run(source.payloadRef, content);
    return { incarnation: "copy-A", conversationId: id, chatJid: source.chatJid, branchId: "existing-main", operationId: claimed.operation.operationId,
      sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId,
      requestHash: hashCanonicalRequest({ type: "input", requestId, content }) };
  }
  // Explicit test driver only; runtime reconciliation never waits or enables scheduling.
  async function drain() {
    await runtime.close(); acquired = true;
    const storage = await options.openStorage(); const harness = await Harness.open(storage, options.harnessOptions, context);
    try { await harness.waitForIdle(context); } finally { await harness.close(context); }
    return HostConversationRuntime.open(options, context);
  }
  return { dir, db, base, options, runtime, accept, drain, work, terminal, payloads, path, hooks, stats: () => ({ opens, releases, authorizations }), setOwner: (v: boolean) => { acquired = v; }, grantKnown: () => { allowKnown = true; }, loseCancellationAck: () => { loseCancellationAck = true; } };
}

test("runtime: public transaction reads exact run ownership but cannot atomically mark its abort; queued successor survives", async () => {
  // Qualification of the installed PUBLIC contract, not a private Transaction cast or task-schema write.
  // Fail typecheck if an upstream transactional abort becomes available so this gap is revisited.
  const transactionalAbortUnavailable: "abortTask" extends keyof Tx ? false : true = true;
  expect(transactionalAbortUnavailable).toBe(true);
  const f = await openFixture({ acquired: true });
  f.host.modelHold = barrier();
  try {
    const original = await f.submit("exact-running-A", "held original");
    const successor = await f.submit("exact-queued-B", "unrelated successor");
    const run = await f.root.commit(async tx => {
      const submission = await tx.submissionByRequest(f.root.id, "exact-running-A");
      const live = await tx.doc(LiveDoc, f.root.id);
      expect(submission?.id).toBe(original.id);
      expect(submission?.conversationId).toBe(f.root.id);
      expect(submission?.status).toBe("placed");
      expect(live.run?.inputs).toEqual([original.id]);
      const task = await tx.task(live.run!.taskId);
      expect(task?.conversationId).toBe(f.root.id);
      expect(task?.abortRequested).toBe(false);
      // Only detached contract values leave this commit; never retain a Draft.
      return { taskId: live.run!.taskId };
    }, context);
    expect((await successor.status(context)).status).toBe("queued");
    expect(await f.harness.abortSubmission(original.id, context, f.root.id)).toBe("already_placed");
    expect(await f.harness.abortSubmission(original.id, context, f.root.id)).toBe("already_placed");
    expect((await f.harness.getTask(run.taskId, context))?.abortRequested).toBe(false);
    expect((await successor.status(context)).status).toBe("queued");
    expect((await original.status(context)).status).toBe("placed");
    expect(f.host.modelCalls).toBe(0);
    f.host.modelHold.release();
    await f.harness.waitForIdle(context);
    expect((await original.status(context)).status).toBe("done");
    expect((await successor.status(context)).status).toBe("done");
    expect(f.host.modelCalls).toBe(2);
    expect(f.host.credentialLookups).toBe(0);
  } finally {
    f.host.modelHold.release();
    await f.close();
  }
});

test("runtime: caller mutation during authorization cannot admit an unbound request", () => fixture(async f => {
  const input = await f.accept(), original = { ...input }, entered = barrier(), hold = barrier();
  f.hooks.authorize = async () => { entered.release(); await hold.promise; };
  const pending = f.runtime.submit(input);
  await entered.promise;
  Object.assign(input, { requestId: "rogue-B", requestHash: "0".repeat(64), sourceId: "rogue-source", operationId: "rogue-operation" });
  hold.release(); const submission = await pending;
  const binding = f.db.query("SELECT binding FROM runtime_bindings").get() as { binding: string };
  expect(JSON.parse(binding.binding)).toEqual(original);
  const storage = await f.options.openStorage();
  try {
    expect((await storage.submissionByRequest(original.conversationId, original.requestId, context))?.id).toBe(submission);
    expect(await storage.submissionByRequest(original.conversationId, "rogue-B", context)).toBeUndefined();
  } finally { await storage.close(context); }
}));

test("runtime: cancellation snapshots nested decision before both host and scheduling awaits", () => fixture(async f => {
  const input = await f.accept(), originalInput = { ...input };
  const submission = await f.runtime.submit(input);
  const operation = value(await f.work.getOperation(input.operationId))!;
  const source = value(await f.work.acceptSource(sealed({ effect: effect("snapshot-source"), chatJid: input.chatJid,
    sourceId: "snapshot-cancel", kind: "cancellation" as const, payloadRef: "cancel:snapshot", targetOperationId: input.operationId,
    parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const request = sealed({ effect: effect("snapshot-cancel", input.operationId, source.sourceSeq), expectedVersion: operation.version,
    sourceId: source.sourceId, sourceSeq: source.sourceSeq, cause: "user", requestedAt: at });
  const original = { ...request, effect: { ...request.effect } }, entered = barrier(), hold = barrier();
  f.hooks.cancellation = async () => { entered.release(); await hold.promise; };
  f.grantKnown();
  const pending = f.runtime.cancel(input, submission, request);
  await entered.promise;
  Object.assign(input, { requestId: "rogue", conversationId: 999999, sourceId: "rogue" });
  Object.assign(request, { sourceId: "rogue", sourceSeq: 999999, expectedVersion: 999999 });
  Object.assign(request.effect, { requestHash: "0".repeat(64), operationId: "rogue", sourceSeq: 999999 });
  hold.release();
  expect(await pending).toBe("already_placed");
  const accepted = value(await f.work.getOperation(originalInput.operationId))!;
  expect(accepted.cancellation?.sourceSeq).toBe(source.sourceSeq);
  expect(await f.runtime.cancel(originalInput, submission, original)).toBe("already_placed");
  expect(value(await f.work.getOperation(originalInput.operationId))!.version).toBe(accepted.version);
  expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
}));

test("runtime: open captures identity, manifest and bound ports before storage factory await", () => fixture(async f => {
  await f.runtime.close(); f.setOwner(true);
  const entered = barrier(), hold = barrier(), storageFactory = f.options.openStorage;
  const ids = [...f.options.existingConversationIds];
  let released = 0;
  const owner = { assert() { expect(this).toBe(owner); f.options.owner.assert(); },
    release() { expect(this).toBe(owner); released++; } };
  const options = { ...f.options, owner, existingConversationIds: ids,
    harnessOptions: { ...f.options.harnessOptions }, work: { ...f.options.work },
    terminal: { getTerminal: f.options.terminal.getTerminal.bind(f.options.terminal), commitTerminal: f.options.terminal.commitTerminal.bind(f.options.terminal), getTerminalByKey: f.options.terminal.getTerminalByKey.bind(f.options.terminal) },
    bindings: { ...f.options.bindings },
    async openStorage() { entered.release(); await hold.promise; return storageFactory(); } };
  const pending = HostConversationRuntime.open(options, context);
  await entered.promise;
  const fail = () => { throw new Error("replacement must not run"); };
  Object.assign(options, { incarnation: "copy-B", generation: 90, conversationFor: fail, authorizeScheduling: fail, putAnswer: fail, now: fail, openStorage: fail });
  ids.splice(0); Object.assign(options.owner, { assert: fail, release: fail });
  Object.assign(options.work, { getOperation: fail, acceptCancellation: fail, bindHarness: fail });
  Object.assign(options.terminal, { getTerminal: fail, commitTerminal: fail }); Object.assign(options.bindings, { getOrBind: fail });
  Object.assign(options.harnessOptions, { models: null, registry: null });
  hold.release(); const runtime = await pending;
  try {
    const input = await f.accept();
    expect(await runtime.submit(input)).toBeGreaterThan(0);
    expect((await runtime.reconcile(input)).submissionId).not.toBeNull();
  } finally { await runtime.close(); }
  expect(released).toBe(1);
}));

test("runtime: explicit owner fence before storage; no default root or automatic scheduling", () => fixture(async f => {
  const before = f.stats(); f.setOwner(false);
  await expect(HostConversationRuntime.open(f.options, context)).rejects.toThrow("owner lost");
  expect(f.stats().opens).toBe(before.opens); f.setOwner(true);
  expect(f.base.host.modelCalls).toBe(0);
  expect(f.stats().authorizations).toBe(0);
}));

test("runtime: real accepted input, immutable source/hash; acknowledgement repair and passive committed-answer reconciliation; EF-S02 once", () => fixture(async f => {
  const input = await f.accept();
  await expect(f.runtime.submit({ ...input, sourceId: "forged" })).rejects.toThrow("Unverified host source");
  await expect(f.runtime.submit({ ...input, requestHash: "0".repeat(64) })).rejects.toThrow("hash conflict");
  await expect(f.runtime.submit({ ...input, operationId: "not-accepted" })).rejects.toThrow("Unaccepted");
  const submission = await f.runtime.submit(input);
  expect(await f.runtime.submit(input)).toBe(submission);
  const reopened = await f.drain();
  try {
    const calls = f.base.host.modelCalls, grants = f.stats().authorizations;
    expect(await reopened.submit(input)).toBe(submission);
    expect((await reopened.reconcile(input)).answer?.text).toBe("synthetic answer");
    expect(f.stats().authorizations).toBe(grants); expect(f.base.host.modelCalls).toBe(calls);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
    expect((await reopened.settle(input))?.disposition).toBe("completed");
    expect((await reopened.settle(input))?.disposition).toBe("completed");
    expect(f.db.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
  } finally { await reopened.close(); }
}));

test("runtime: exact cancellation rejects wrong submission before accepting host cancellation", () => fixture(async f => {
  f.base.host.modelHold = barrier();
  const input = await f.accept(); const submission = await f.runtime.submit(input);
  const operation = value(await f.work.getOperation(input.operationId))!;
  const cancel = value(await f.work.acceptSource(sealed({ effect: effect("cancel-source"), chatJid: input.chatJid, sourceId: "cancel-1",
    kind: "cancellation" as const, payloadRef: "cancel:1", targetOperationId: input.operationId, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const request = sealed({ effect: effect("cancel-operation", input.operationId, cancel.sourceSeq), expectedVersion: operation.version,
    sourceId: cancel.sourceId, sourceSeq: cancel.sourceSeq, cause: "user", requestedAt: at });
  await expect(f.runtime.cancel(input, 999999 as typeof submission, request)).rejects.toThrow("Exact cancellation");
  await expect(f.runtime.cancel(input, submission, sealed({ ...request,
    effect: { ...request.effect, operationId: "foreign-operation" } }))).rejects.toThrow("Exact cancellation");
  await expect(f.runtime.cancel(input, submission, sealed({ ...request,
    effect: { ...request.effect, sourceSeq: null } }))).rejects.toThrow("Exact cancellation");
  expect(value(await f.work.getOperation(input.operationId))!.cancellation).toBeNull();
  // This host explicitly grants the known single operation's abort scheduling.
  f.grantKnown();
  expect(await f.runtime.cancel(input, submission, request)).toBe("already_placed");
  const accepted = value(await f.work.getOperation(input.operationId))!;
  expect(accepted.cancellation?.sourceSeq).toBe(cancel.sourceSeq);
  // An accepted host decision is durable, but is NOT evidence that the running provider was aborted.
  expect(await f.runtime.cancel(input, submission, request)).toBe("already_placed");
  expect(value(await f.work.getOperation(input.operationId))!.version).toBe(accepted.version);
  expect((await f.runtime.reconcile(input)).status?.status).toBe("placed");
  expect(await f.runtime.settle(input)).toBeNull();
  expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
  f.base.host.modelHold.release();
  const reopened = await f.drain();
  try {
    expect((await reopened.reconcile(input)).status?.status).toBe("done");
    expect((await reopened.settle(input))?.disposition).toBe("cancelled");
    expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
  } finally { await reopened.close(); }
}));

for (const failure of ["authorization", "lost-ack", "queued-lost-ack"] as const) {
  test(`runtime: cancellation ${failure} retries the SAME sealed decision across reopen without publication`, () => fixture(async f => {
    f.base.host.modelHold ??= barrier();
    const input = await f.accept(), submission = await f.runtime.submit(input);
    const before = value(await f.work.getOperation(input.operationId))!;
    const operation = value(await f.work.appendIntent(sealed({ effect: effect(`intent:${failure}`, input.operationId, input.sourceSeq),
      expectedVersion: before.version, intentId: `intent:${failure}`, kind: "abort" as const, payloadRef: "cancel:intent", createdAt: at })));
    const source = value(await f.work.acceptSource(sealed({ effect: effect(`source:${failure}`), chatJid: input.chatJid,
      sourceId: `cancel:${failure}`, kind: "cancellation" as const, payloadRef: "cancel:retry", targetOperationId: input.operationId,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const request = sealed({ effect: effect(`cancel:${failure}`, input.operationId, source.sourceSeq), expectedVersion: operation.version,
      sourceId: source.sourceId, sourceSeq: source.sourceSeq, cause: "user", requestedAt: at });
    const stale = sealed({ ...request, expectedVersion: operation.version - 1,
      effect: { ...request.effect, idempotencyKey: `new-key:${failure}` } });
    await expect(f.runtime.cancel(input, submission, stale)).rejects.toThrow("version_mismatch");
    expect(value(await f.work.getOperation(input.operationId))!.version).toBe(operation.version);
    Object.freeze(request.effect); Object.freeze(request);
    const original = JSON.stringify(request);
    const binding = f.db.query("SELECT * FROM runtime_bindings").all();
    const authorize = f.options.authorizeScheduling;
    // Only public ports: actual EF-S01 commit, then fail the scheduling handoff or lose its acknowledgement.
    const options = { ...f.options, authorizeScheduling: authorize };
    if (failure === "authorization") {
      // Captured callback, live host policy state (not caller method replacement).
      f.hooks.authorize = () => { throw new Error("authorization unavailable"); };
    } else f.loseCancellationAck();
    await expect(f.runtime.cancel(input, submission, request)).rejects.toThrow(failure === "authorization" ? "authorization unavailable" : "storage_unavailable");
    const accepted = value(await f.work.getOperation(input.operationId))!;
    expect(accepted.version).toBe(operation.version + 1);
    expect(accepted.cancellation?.sourceSeq).toBe(source.sourceSeq);
    f.hooks.authorize = undefined; f.grantKnown();
    const result = await f.runtime.cancel(input, submission, request);
    expect(result).toBe(failure === "queued-lost-ack" ? "aborted" : "already_placed");
    expect(value(await f.work.getOperation(input.operationId))!.version).toBe(accepted.version);
    await f.runtime.close(); f.setOwner(true);
    const reopened = await HostConversationRuntime.open(options, context);
    try {
      expect((await reopened.reconcile(input)).submissionId).toBe(submission);
      expect(await reopened.cancel(input, submission, request)).toBe(failure === "queued-lost-ack" ? "settled" : "already_placed");
      expect(JSON.stringify(request)).toBe(original);
      expect(f.db.query("SELECT * FROM runtime_bindings").all()).toEqual(binding);
    } finally { await reopened.close(); }
    f.base.host.modelHold.release();
    const settled = await f.drain();
    try {
      expect((await settled.reconcile(input)).status?.status).toBe(failure === "queued-lost-ack" ? "unanswered" : "done");
      expect((await settled.settle(input))?.disposition).toBe("cancelled");
      expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
    } finally { await settled.close(); }
  }, failure === "queued-lost-ack"));
}

test("runtime: close/reopen preserves pending unknown work, passive reconcile never grants progress", () => fixture(async f => {
  f.base.host.modelHold = barrier(); const input = await f.accept();
  const submission = await f.runtime.submit(input);
  await f.runtime.close(); expect(f.stats().releases).toBe(1); f.setOwner(true);
  const reopened = await HostConversationRuntime.open(f.options, context);
  try {
    const before = f.stats().authorizations;
    expect((await reopened.reconcile(input)).submissionId).toBe(submission);
    expect(await reopened.submit(input)).toBe(submission);
    expect(f.stats().authorizations).toBe(before); expect(f.base.host.modelCalls).toBe(0);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
    await expect(reopened.resume(input, submission)).rejects.toThrow("Recovered authority");
    f.base.host.modelHold.release(); f.base.host.modelHold = undefined;
    f.grantKnown(); await reopened.resume(input, submission);
    let state = await reopened.reconcile(input);
    for (let n = 0; state.answer === null && n < 100; n++) {
      await Bun.sleep(10); state = await reopened.reconcile(input);
    }
    expect(state.answer?.text).toBe("synthetic answer");
    expect(f.base.host.modelCalls).toBe(1);
  } finally { await reopened.close(); }
}));

test("runtime: reasoning stays in immutable host-private final evidence, never in default visible text", () => fixture(async f => {
  f.base.host.finalContent = [{ type: "thinking", thinking: "private reasoning", thinkingSignature: "private-signature" },
    { type: "text", text: "Visible " }, { type: "text", text: "answer" }];
  const input = await f.accept(); await f.runtime.submit(input);
  const reopened = await f.drain();
  try {
    const state = await reopened.reconcile(input);
    expect(state.answer?.text).toBe("Visible answer");
    expect(state.answer?.message.content).toEqual(f.base.host.finalContent);
    expect(state.answer?.message.usage).toBeDefined();
    expect(Object.isFrozen(state.answer?.message.content[0])).toBe(true);
    expect((await reopened.settle(input))?.disposition).toBe("completed");
    expect(f.db.query("SELECT content,content_blocks FROM messages WHERE is_bot_message=1").all())
      .toEqual([{ content: "Visible answer", content_blocks: null }]);
    expect(JSON.stringify(f.db.query("SELECT * FROM service_effect_s02_commits").all())).not.toContain("private reasoning");
  } finally { await reopened.close(); }
}));

test("runtime: host materializes tool-owned image and blocks through real EF-S02 payload/media verification exactly once", () => fixture(async f => {
  f.base.host.finalContent = [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Generated image" }];
  const input = await f.accept("request-1", "use-tool");
  insertMedia(f.db, input.operationId, 51);
  let calls = 0;
  Object.assign(f.options, { async materializeAnswer(ref: string, answer: SettledAnswer,
    operation: import("../../runtime/src/service-effects/contracts/service-work-store.js").OperationSnapshot) {
    calls++;
    expect(operation.operationId).toBe(input.operationId);
    expect(operation.chatJid).toBe(input.chatJid);
    expect(Object.isFrozen(operation.harness)).toBe(true);
    expect(answer.message.content).toEqual(f.base.host.finalContent!);
    expect(answer.text).toBe("Generated image");
    f.payloads.putText(ref, answer.text); f.payloads.putJson(`${ref}:blocks`, [imageBlock]);
    return { contentRef: ref, contentBlocksRef: `${ref}:blocks`, mediaIds: [51] };
  } });
  await f.runtime.submit(input); const reopened = await f.drain();
  try {
    const grants = f.stats().authorizations, modelCalls = f.base.host.modelCalls;
    expect(f.base.host.effects).toBe(1);
    await reopened.reconcile(input); expect(calls).toBe(0);
    const terminal = await reopened.settle(input);
    expect(terminal?.disposition).toBe("completed");
    expect(await reopened.settle(input)).toEqual(terminal); expect(calls).toBe(1);
    expect(f.stats().authorizations).toBe(grants); expect(f.base.host.modelCalls).toBe(modelCalls);
    const row = f.db.query("SELECT rowid,content,content_blocks FROM messages WHERE is_bot_message=1").get() as { rowid: number; content: string; content_blocks: string };
    expect(row.content).toBe("Generated image"); expect(JSON.parse(row.content_blocks)).toEqual([imageBlock]);
    expect(f.db.query("SELECT media_id FROM message_media WHERE message_rowid=?").all(row.rowid)).toEqual([{ media_id: 51 }]);
    expect(f.db.query("SELECT content_type,length(data) AS bytes FROM media WHERE id=51").get()).toEqual({ content_type: "image/png", bytes: 68 });
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
  } finally { await reopened.close(); }
}));

for (const invalid of ["duplicate", "zero", "fraction", "missing", "foreign", "forbidden-block", "wrong-redaction", "wrong-type", "corrupt-bytes", "throws"] as const) {
  test(`runtime: materializer ${invalid} fails closed without terminal publication or private errors`, () => fixture(async f => {
    const input = await f.accept();
    if (invalid === "foreign") {
      const foreign = value(await f.work.acceptSource(sealed({ effect: effect("foreign-source"), chatJid: "web:foreign",
        sourceId: "foreign", kind: "message" as const, payloadRef: "input:foreign", targetOperationId: null,
        parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      const claimed = value(await f.work.claimNext(sealed({ effect: effect("foreign-claim"), chatJid: foreign.chatJid,
        expectedFrontier: 0, newOperationId: "operation:foreign", claimedAt: at })))!;
      insertMedia(f.db, claimed.operation.operationId, 51);
    }
    Object.assign(f.options, { async materializeAnswer(ref: string) {
      if (invalid === "throws") throw new Error("credential=DO-NOT-EXPOSE");
      f.payloads.putText(ref, "Visible");
      f.payloads.putJson(`${ref}:blocks`, invalid === "forbidden-block" ? [{ type: "control_intent" }] : [imageBlock]);
      if (invalid === "wrong-redaction") f.payloads.putBytes(`${ref}:bad`, new TextEncoder().encode("Visible"), "text/plain", "secret");
      if (invalid === "wrong-type") f.payloads.putJson(`${ref}:bad`, "Visible");
      if (invalid === "corrupt-bytes") {
        const resolve = f.payloads.resolve.bind(f.payloads);
        f.payloads.resolve = async ref => { const payload = await resolve(ref); return payload ? { ...payload, bytes: new Uint8Array([0]) } : null; };
      }
      return { contentRef: ["wrong-redaction", "wrong-type"].includes(invalid) ? `${ref}:bad` : ref,
        contentBlocksRef: `${ref}:blocks`, mediaIds: invalid === "duplicate" ? [51, 51] : invalid === "zero" ? [0] : invalid === "fraction" ? [1.5]
          : ["missing", "foreign"].includes(invalid) ? [51] : [] };
    } });
    await f.runtime.submit(input); const reopened = await f.drain();
    try {
      let error: unknown; try { await reopened.settle(input); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("DO-NOT-EXPOSE");
      if (invalid === "throws") expect(String(error)).toBe("Error: Host answer materialization failed");
      expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
    } finally { await reopened.close(); }
  }));
}

for (const race of ["cancellation", "owner", "version", "sql-owner", "sql-cancellation"] as const) {
  test(`runtime: ${race} while materializing prevents stale completion and publication`, () => fixture(async f => {
    const input = await f.accept(), entered = barrier(), hold = barrier();
    let calls = 0;
    Object.assign(f.options, { async materializeAnswer(ref: string, answer: SettledAnswer) {
      calls++; f.payloads.putText(ref, answer.text); entered.release(); await hold.promise;
      return { contentRef: ref, contentBlocksRef: null, mediaIds: [] };
    } });
    await f.runtime.submit(input); const reopened = await f.drain();
    try {
      const pending = reopened.settle(input); void pending.catch(() => {}); await entered.promise;
      const operation = value(await f.work.getOperation(input.operationId))!;
      let releasePayload: (() => void) | undefined;
      if (race === "sql-owner" || race === "sql-cancellation") {
        const ref = `runtime-answer:copy-A:${(await reopened.reconcile(input)).submissionId}`;
        releasePayload = f.payloads.hold(ref);
        hold.release(); await f.payloads.waitUntilHeld(ref);
      }
      if (race === "cancellation" || race === "sql-cancellation") {
        const source = value(await f.work.acceptSource(sealed({ effect: effect("materialize-cancel-source"), chatJid: input.chatJid,
          sourceId: "materialize-cancel", kind: "cancellation" as const, payloadRef: "cancel:materialize", targetOperationId: input.operationId,
          parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
        value(await f.work.acceptCancellation(sealed({ effect: effect("materialize-cancel", input.operationId, source.sourceSeq),
          expectedVersion: operation.version, sourceId: source.sourceId, sourceSeq: source.sourceSeq, cause: "user", requestedAt: at })));
      } else if (race === "version") {
        value(await f.work.appendIntent(sealed({ effect: effect("materialize-intent", input.operationId, input.sourceSeq),
          expectedVersion: operation.version, intentId: "materialize-intent", kind: "abort" as const, payloadRef: "cancel:intent", createdAt: at })));
      } else if (race === "owner") f.setOwner(false);
      else f.setOwner(false);
      releasePayload?.(); hold.release(); await expect(pending).rejects.toThrow(); f.setOwner(true);
      expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
      if (race === "cancellation" || race === "sql-cancellation") {
        expect((await reopened.settle(input))?.disposition).toBe("cancelled"); expect(calls).toBe(1);
        expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      }
    } finally { hold.release(); f.setOwner(true); await reopened.close(); }
  }));
}

for (const unsupported of ["image", "toolCall"] as const) {
  test(`runtime: committed ${unsupported} final is explicitly rejected, never flattened or materialized`, () => fixture(async f => {
    const input = await f.accept();
    await f.runtime.reconcile(input); // Establish the real accepted host binding without scheduling.
    await f.runtime.close(); f.setOwner(true);
    const storage = await f.options.openStorage(), harness = await Harness.open(storage, f.options.harnessOptions, context);
    try {
      // Synthetic malformed/imported final evidence through PUBLIC transaction APIs only.
      // No invented provider image API and no private candidate SQL/schema writes.
      await harness.commit(async tx => {
        const entry = await tx.appendEntry(UserEntry, input.conversationId, { model: [{ role: "user", content: "hello", timestamp: 1 }] });
        const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "qualification", model: "synthetic",
          content: unsupported === "image" ? [unsupportedAssistantImage] : [{ type: "toolCall", id: "unfinished", name: "host_effect", arguments: {} }],
          stopReason: "stop", timestamp: 1,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        const answer = await tx.appendEntry(AssistantEntry, input.conversationId, { model: [message] });
        const submission = await tx.createSubmission({ type: "input", status: "placed", conversationId: input.conversationId, requestId: input.requestId, entry: entry.id });
        tx.settleSubmission(submission.id, { status: "done", answer: answer.id });
      }, context);
    } finally { await harness.close(context); }
    let materializations = 0;
    Object.assign(f.options, { async materializeAnswer() { materializations++; throw new Error("must not run"); } });
    const reopened = await HostConversationRuntime.open(f.options, context);
    try {
      await expect(reopened.reconcile(input)).rejects.toThrow("Unsupported final assistant content");
      await expect(reopened.settle(input)).rejects.toThrow("Unsupported final assistant content");
      expect(materializations).toBe(0); expect(f.base.host.modelCalls).toBe(0);
      expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
    } finally { await reopened.close(); }
  }));
}

test("runtime: materializer callback captured before open await and returned media refs detached before EF resolution await", () => fixture(async f => {
  const input = await f.accept(); insertMedia(f.db, input.operationId, 51);
  await f.runtime.submit(input); const drained = await f.drain(); await drained.close(); f.setOwner(true);
  const entered = barrier(), hold = barrier(), storageFactory = f.options.openStorage;
  const result = { contentRef: "answer:snapshot", contentBlocksRef: "blocks:snapshot", mediaIds: [51] };
  f.payloads.putText(result.contentRef, "Authorized"); f.payloads.putJson(result.contentBlocksRef, [imageBlock]);
  const options = { ...f.options, async materializeAnswer() { return result; },
    async openStorage() { entered.release(); await hold.promise; return storageFactory(); } };
  const pendingOpen = HostConversationRuntime.open(options, context); await entered.promise;
  options.materializeAnswer = async () => { throw new Error("replacement must not run"); };
  hold.release(); const reopened = await pendingOpen;
  const releasePayload = f.payloads.hold(result.contentRef);
  try {
    const pending = reopened.settle(input); await f.payloads.waitUntilHeld(result.contentRef);
    result.mediaIds.splice(0, 1, 999); result.contentBlocksRef = "blocks:rogue"; result.contentRef = "answer:rogue";
    releasePayload(); expect((await pending)?.disposition).toBe("completed");
    expect(f.db.query("SELECT media_id FROM message_media").all()).toEqual([{ media_id: 51 }]);
    expect(f.db.query("SELECT content,content_blocks FROM messages WHERE is_bot_message=1").get())
      .toEqual({ content: "Authorized", content_blocks: JSON.stringify([imageBlock]) });
  } finally { releasePayload(); await reopened.close(); }
}));
