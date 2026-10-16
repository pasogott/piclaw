import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { Harness, LiveDoc, type Tx } from "@earendil-works/pi-durable";
import { HostConversationRuntime, type AcceptedInput, type RuntimeOptions } from "./src/host-runtime.js";
import { BunSqliteDatabase } from "./src/bun-sqlite.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";

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
  return { dir, db, base, options, runtime, accept, drain, work, terminal, path, hooks, stats: () => ({ opens, releases, authorizations }), setOwner: (v: boolean) => { acquired = v; }, grantKnown: () => { allowKnown = true; }, loseCancellationAck: () => { loseCancellationAck = true; } };
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
    expect((await reopened.reconcile(input)).answer).toBe("synthetic answer");
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
    expect(state.answer).toBe("synthetic answer");
    expect(f.base.host.modelCalls).toBe(1);
  } finally { await reopened.close(); }
}));
