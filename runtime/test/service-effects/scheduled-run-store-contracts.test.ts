import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashCanonicalRequest, type CanonicalJsonValue, type NormalisedEffectTrace, type NormalisedTraceInput } from "../../src/service-effects/contracts/common.js";
import type { CompleteScheduledRunRequest, ScheduledRunLease, ScheduledTaskAuthorityInput } from "../../src/service-effects/contracts/scheduled-run-store.js";
import { computeNextRun } from "../../src/task-scheduler-utils.js";
import { createCurrentPiclawScheduledRunStore, type ScheduledRunAdapterRuntime, type ScheduledRunMutationMethod, type ScheduledRunStatement } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installScheduledRunCompositionSchema } from "../../src/service-effects/current-piclaw/scheduled-run-schema.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { defineScheduledRunStoreContract, type ScheduledRunContractSubject, type ScheduledRunInspection } from "../../src/service-effects/testing/contract-suites/scheduled-run-store-contract.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeScheduledRunBackend, FakeScheduledRunStore, createFakeScheduledTaskAuthority } from "../../src/service-effects/testing/fakes/fake-scheduled-run-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

function context(): ContractTestContext {
  return { clock: new ManualEffectClock("2026-08-16T00:00:00.000Z"), ids: new SequenceEffectIdSource("s07"), faults: new DeterministicFaultPlan() };
}

class Runtime implements ScheduledRunAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly planned = new Map<string, Set<number>>();
  readonly counts = new Map<string, number>();
  private statementFault: ScheduledRunStatement | null = null;
  constructor(trace: readonly NormalisedEffectTrace[] = []) { this.trace = EffectTraceRecorder.fromSnapshot(trace); }
  failAfterStatement(statement: ScheduledRunStatement): void { this.statementFault = statement; }
  afterStatement(statement: ScheduledRunStatement): void {
    if (this.statementFault === statement) { this.statementFault = null; throw new Error(`fault:${statement}`); }
  }
  plan(method: ScheduledRunMutationMethod, point: "before_effect" | "effect_then_lost_acknowledgement", occurrence: number) {
    const key = `${method}:${point}`, base = this.counts.get(key) ?? 0;
    this.planned.set(key, new Set([base + occurrence]));
  }
  hitFault(point: "before_effect" | "effect_then_lost_acknowledgement", method: ScheduledRunMutationMethod): boolean {
    const key = `${method}:${point}`, occurrence = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, occurrence);
    return this.planned.get(key)?.has(occurrence) ?? false;
  }
  recordTrace(input: NormalisedTraceInput): void {
    if (input.resultTag === "call") this.trace.recordCall(input); else this.trace.recordResult(input);
  }
}

function sqliteInspect(database: Database): ScheduledRunInspection {
  const count = (table: string) => (database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return { occurrences: count("service_effect_s07_occurrences"), runLogs: count("service_effect_s07_run_logs"), nextDecisions: count("service_effect_s07_next_decisions"), outboxRows: count("service_effect_s05_outbox"), tombstones: count("service_effect_s07_tombstones") };
}

function acceptSqliteSource(database: Database, input: { runId: string; chatJid: string; sourceSeq: number; operationId: string }): void {
  database.transaction(() => {
    database.query("INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,NULL)").run(input.chatJid);
    database.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,accepted_at,disposition_reason,provenance_ref,create_wake_intent) VALUES(?,?,?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','scheduled_agent','claimed','payload:scheduled',NULL,NULL,'2026-08-16T01:00:01.000Z',NULL,'provenance:scheduled',0)").run(input.chatJid, input.sourceSeq, input.runId);
    database.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',?)").run(input.operationId, input.chatJid, input.sourceSeq);
    database.query("INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,?)").run(input.chatJid, input.operationId, input.sourceSeq);
    database.query("UPDATE service_effect_s01_chats SET active_operation_id=? WHERE chat_jid=?").run(input.operationId, input.chatJid);
  }).immediate();
}

type SqliteSubject = ScheduledRunContractSubject & { database: Database; runtime: Runtime; root: string; path: string };
function openSqliteSubject(path: string, root: string, trace: readonly NormalisedEffectTrace[] = []): SqliteSubject {
  const database = new Database(path, { create: true });
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON");
  installScheduledRunCompositionSchema(database);
  const runtime = new Runtime(trace), built = createCurrentPiclawScheduledRunStore(database, runtime);
  if (!built.ok) throw new Error(`SQLite EF-S07 construction failed: ${built.error._tag}`);
  return {
    store: built.value,
    authority: createScheduledTaskAuthority(database),
    database, runtime, root, path,
    peerStore() { const peer = createCurrentPiclawScheduledRunStore(database, new Runtime()); if (!peer.ok) throw new Error("peer construction failed"); return peer.value; },
    acceptAgentSource(input) { acceptSqliteSource(database, input); },
    inspect() { return sqliteInspect(database); },
    planFault(method, point, occurrence) { runtime.plan(method, point, occurrence); },
    dispose() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

const sqliteFactory: ContractSubjectFactory<SqliteSubject> = {
  name: "isolated SQLite EF-S07 adapter",
  create() {
    const root = mkdtempSync(join(tmpdir(), "piclaw-s07-")), path = join(root, "store.sqlite");
    return openSqliteSubject(path, root);
  },
  crashAndRestore(subject) {
    const trace = subject.runtime.trace.snapshot();
    subject.database.close();
    return { subject: openSqliteSubject(subject.path, subject.root, trace) };
  },
  inspectTrace(subject) { return subject.runtime.trace.snapshot(); },
};

type FakeSubject = ScheduledRunContractSubject & { backend: FakeScheduledRunBackend; fake: FakeScheduledRunStore };
function fakeSubject(ctx: ContractTestContext, snapshot?: ReturnType<FakeScheduledRunStore["snapshot"]>): FakeSubject {
  const backend = new FakeScheduledRunBackend();
  if (snapshot) backend.restore(snapshot);
  const fake = new FakeScheduledRunStore(backend, ctx, snapshot?.trace);
  return {
    store: fake, authority: createFakeScheduledTaskAuthority(backend), backend, fake,
    peerStore() { return new FakeScheduledRunStore(backend, ctx); },
    acceptAgentSource(input) { backend.acceptScheduledAgentSource({ sourceId: input.runId, kind: "scheduled_agent", chatJid: input.chatJid, sourceSeq: input.sourceSeq, operationId: input.operationId, primary: true }); },
    inspect() { return { occurrences: backend.runs.size, runLogs: [...backend.runs.values()].filter((run) => run.record.state === "completed").length, nextDecisions: [...backend.runs.values()].filter((run) => run.record.state === "completed" || run.record.state === "abandoned").length, outboxRows: backend.outboxIds.size, tombstones: backend.tombstones.size }; },
    planFault(method, point, occurrence) { fake.planFault(method, point, occurrence); },
  };
}
const fakeFactory: ContractSubjectFactory<FakeSubject> = {
  name: "independent in-memory EF-S07 fake",
  create(ctx) { return fakeSubject(ctx); },
  crashAndRestore(subject, ctx) { return { subject: fakeSubject(ctx, subject.fake.snapshot()) }; },
  inspectTrace(subject) { return subject.fake.trace.snapshot(); },
};

describe("EF-S07 ScheduledRunStore shared contract", () => {
  test("independent fake", async () => { const results = await defineScheduledRunStoreContract(fakeFactory, context); expect(results.length).toBe(10); });
  test("isolated SQLite adapter", { timeout: 15000 }, async () => { const results = await defineScheduledRunStoreContract(sqliteFactory, context); expect(results.length).toBe(10); });
});

function authorityTask(taskId: string, overrides: Partial<ScheduledTaskAuthorityInput> = {}): ScheduledTaskAuthorityInput {
  return { taskId, chatJid: "web:hardening", kind: "shell", payloadRef: `payload:${taskId}`, modelLabel: null, scheduleType: "interval", scheduleValue: "60000", timezone: "UTC", notifyOnComplete: true, muted: false, cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private", executionRepeatability: "repeatable", nextRunAt: "2026-08-16T01:00:00.000Z", authoredAt: "2026-08-16T00:00:00.000Z", ...overrides };
}
function dueClaim(prefix: string, now = "2026-08-16T01:00:00.000Z") {
  return { now, limit: 10, workerId: `worker:${prefix}`, leaseTokenPrefix: `prefix:${prefix}`, leaseDurationMs: 60000, reclaimAuthorities: [] as const };
}
function deliveryIntent(id: string) {
  const intent = { effect: { idempotencyKey: `outbox:${id}`, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: `provenance:${id}`, redactionClass: "private" as const }, outboxId: `outbox:${id}`, kind: "channel_delivery" as const, payloadRef: `payload:${id}`, destinationRef: "destination:web", availableAt: "2026-08-16T01:00:10.000Z", enqueuedAt: "2026-08-16T01:00:10.000Z", repeatability: "reconciliation_required" as const };
  intent.effect.requestHash = hashCanonicalRequest(intent as unknown as CanonicalJsonValue);
  return intent;
}
function completion(lease: ScheduledRunLease, key: string, completedAt = "2026-08-16T01:00:10.000Z", intents: readonly ReturnType<typeof deliveryIntent>[] = []): CompleteScheduledRunRequest {
  const request: CompleteScheduledRunRequest = { effect: { idempotencyKey: key, requestHash: "", operationId: lease.record.operationId, sourceSeq: lease.record.acceptedSourceSeq, provenanceRef: `provenance:${key}`, redactionClass: "private" }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: completedAt, status: "success", durationMs: 10, resultRef: `result:${key}`, errorCode: null, completedAt, outboxIntents: intents };
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}

function isolated(): SqliteSubject {
  const root = mkdtempSync(join(tmpdir(), "piclaw-s07-hardening-"));
  return openSqliteSubject(join(root, "store.sqlite"), root);
}

describe("EF-S07 SQLite hardening", () => {
  test("post-claim pause, delete, and revision preserve the frozen occurrence authority", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:pause"));
      let claimed = await subject.store.claimDue(dueClaim("pause"));
      expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.pause("task:pause");
      const paused = await subject.store.complete(completion(claimed.value[0], "complete:pause"));
      expect(paused.ok && paused.value.headDisposition).toBe("paused");
      expect(paused.ok && paused.value.nextRunAt).toBe("2026-08-16T01:01:10.000Z");
      subject.authority.resume("task:pause");
      const resumed = await subject.store.claimDue(dueClaim("pause-resume", "2026-08-16T01:01:10.000Z"));
      expect(resumed.ok && resumed.value.length).toBe(1);

      subject.authority.create(authorityTask("task:delete"));
      claimed = await subject.store.claimDue(dueClaim("delete")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.delete("task:delete");
      const deleted = await subject.store.complete(completion(claimed.value[0], "complete:delete"));
      expect(deleted.ok && deleted.value.headDisposition).toBe("deleted");
      expect(deleted.ok && deleted.value.nextRunAt).toBeNull();

      subject.authority.create(authorityTask("task:revision"));
      claimed = await subject.store.claimDue(dueClaim("revision")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.update({ ...authorityTask("task:revision", { payloadRef: "payload:revision:v2", nextRunAt: "2026-08-16T02:00:00.000Z", authoredAt: "2026-08-16T01:00:05.000Z" }), expectedRevision: 1 });
      const superseded = await subject.store.complete(completion(claimed.value[0], "complete:revision"));
      expect(superseded.ok && superseded.value.headDisposition).toBe("superseded");
      expect(superseded.ok && superseded.value.nextRunAt).toBeNull();
    } finally { subject.dispose?.(); }
  });

  test("abandon writes no run log, retention tombstones identity, and exact replay remains stable", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:abandon", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const claimed = await subject.store.claimDue(dueClaim("abandon")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0];
      const request = { effect: { idempotencyKey: "abandon:key", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:abandon", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", reasonTag: "pre_effect_failure", abandonedAt: "2026-08-16T01:00:10.000Z", retryAt: "2026-08-16T01:05:00.000Z" };
      request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
      const abandoned = await subject.store.abandon(request);
      expect(abandoned.ok && abandoned.value.nextRunAt).toBe("2026-08-16T01:05:00.000Z");
      expect(subject.inspect().runLogs).toBe(0);
      const cleaned = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 10 });
      expect(cleaned.ok && cleaned.value.removed).toBe(1);
      const retained = await subject.store.get(lease.record.runId);
      expect(retained.ok && retained.value?.retained).toBe(true);
      expect(retained.ok && retained.value?.resultRef).toBeNull();
      const replay = await subject.store.abandon(request);
      expect(replay.ok && replay.value.retained).toBe(true);
      const later = await subject.store.claimDue(dueClaim("abandon-retry", "2026-08-16T01:05:00.000Z"));
      expect(later.ok && later.value.length).toBe(1);
    } finally { subject.dispose?.(); }
  });

  test("expired shell occurrences require explicit reclaim authority and preserve attempt fencing", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:reclaim"));
      const claimed = await subject.store.claimDue({ ...dueClaim("reclaim"), leaseDurationMs: 1000 }); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const first = claimed.value[0];
      const denied = await subject.store.claimDue(dueClaim("reclaim-denied", "2026-08-16T01:00:02.000Z"));
      expect(denied.ok && denied.value.length).toBe(0);
      const allowed = await subject.store.claimDue({ ...dueClaim("reclaim-allowed", "2026-08-16T01:00:02.000Z"), reclaimAuthorities: [{ runId: first.record.runId, expectedAttempt: 1, kind: "repeatable" as const, reconciliationRef: null }] });
      expect(allowed.ok && allowed.value[0].record.attempt).toBe(2);
      const stale = await subject.store.complete(completion(first, "complete:stale"));
      expect(!stale.ok && stale.error._tag).toBe("lease_conflict");
    } finally { subject.dispose?.(); }
  });

  test("every completion statement checkpoint rolls back and a clean retry commits once", async () => {
    const checkpoints: ScheduledRunStatement[] = ["next_decision_insert", "run_log_insert", "outbox_insert", "outbox_decision_insert", "outbox_link_insert", "task_head_update", "occurrence_terminal_update", "decision_insert"];
    for (const [index, checkpoint] of checkpoints.entries()) {
      const subject = isolated();
      try {
        const id = `rollback-${index}`;
        subject.authority.create(authorityTask(`task:${id}`));
        const claimed = await subject.store.claimDue(dueClaim(id)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const request = completion(claimed.value[0], `complete:${id}`, "2026-08-16T01:00:10.000Z", [deliveryIntent(id)]);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.complete(request);
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        expect(subject.inspect()).toMatchObject({ runLogs: 0, nextDecisions: 0, outboxRows: 0 });
        const retry = await subject.store.complete(request);
        expect(retry.ok).toBe(true);
        expect(subject.inspect()).toMatchObject({ runLogs: 1, nextDecisions: 1, outboxRows: 1 });
      } finally { subject.dispose?.(); }
    }
  });

  test("claim, bind, renew, abandon, and cleanup checkpoints are atomic", async () => {
    for (const [index, checkpoint] of (["occurrence_insert", "lease_insert", "decision_insert"] as ScheduledRunStatement[]).entries()) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:claim-fault-${index}`));
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.claimDue(dueClaim(`claim-fault-${index}`));
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        expect(subject.inspect().occurrences).toBe(0);
      } finally { subject.dispose?.(); }
    }

    for (const checkpoint of ["source_binding_insert", "source_binding_update", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        const task = authorityTask(`task:bind-fault-${checkpoint}`);
        subject.authority.create({ ...task, kind: "agent", payloadRef: `payload:agent:${checkpoint}`, executionRepeatability: "agent_source" });
        const claimed = await subject.store.claimDue(dueClaim(`bind-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], sourceSeq = 1, operationId = `operation:${checkpoint}`;
        acceptSqliteSource(subject.database, { runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
        const request = { effect: { idempotencyKey: `bind:${checkpoint}`, requestHash: "", operationId, sourceSeq, provenanceRef: "provenance:bind-fault", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", sourceSeq, operationId, boundAt: "2026-08-16T01:00:10.000Z" };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.bindAcceptedSource(request);
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.state).toBe("claimed");
        expect((subject.database.query("SELECT COUNT(*) AS count FROM service_effect_s07_source_bindings").get() as { count: number }).count).toBe(0);
      } finally { subject.dispose?.(); }
    }

    for (const checkpoint of ["lease_renew", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:renew-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`renew-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], expiry = lease.record.leaseExpiresAt;
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.renew({ runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z" });
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.leaseExpiresAt).toBe(expiry);
      } finally { subject.dispose?.(); }
    }

    for (const checkpoint of ["next_decision_insert", "abandonment_insert", "task_head_update", "occurrence_terminal_update", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:abandon-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`abandon-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], request = { effect: { idempotencyKey: `abandon:${checkpoint}`, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:abandon-fault", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", reasonTag: "fault", abandonedAt: "2026-08-16T01:00:10.000Z", retryAt: null };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.abandon(request);
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.state).toBe("claimed");
        expect(subject.inspect().nextDecisions).toBe(0);
      } finally { subject.dispose?.(); }
    }

    for (const checkpoint of ["tombstone_insert", "retention_delete", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:cleanup-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`cleanup-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const done = await subject.store.complete(completion(claimed.value[0], `complete:cleanup-fault-${checkpoint}`)); expect(done.ok).toBe(true);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 });
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(claimed.value[0].record.runId);
        expect(current.ok && current.value?.retained).toBe(false);
        expect(subject.inspect().tombstones).toBe(0);
      } finally { subject.dispose?.(); }
    }
  });

  test("two SQLite connections share one occurrence authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "piclaw-s07-two-connections-")), path = join(root, "store.sqlite");
    const leftDb = new Database(path, { create: true }), rightDb = new Database(path);
    try {
      for (const database of [leftDb, rightDb]) database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON");
      installScheduledRunCompositionSchema(leftDb);
      createScheduledTaskAuthority(leftDb).create(authorityTask("task:two-connections"));
      const left = createCurrentPiclawScheduledRunStore(leftDb, new Runtime()), right = createCurrentPiclawScheduledRunStore(rightDb, new Runtime());
      expect(left.ok && right.ok).toBe(true); if (!left.ok || !right.ok) return;
      const [a, b] = await Promise.all([left.value.claimDue(dueClaim("two-left")), right.value.claimDue(dueClaim("two-right"))]);
      expect(a.ok && b.ok).toBe(true);
      expect((a.ok ? a.value.length : 0) + (b.ok ? b.value.length : 0)).toBe(1);
      expect((leftDb.query("SELECT COUNT(*) AS count FROM service_effect_s07_occurrences").get() as { count: number }).count).toBe(1);
    } finally { rightDb.close(); leftDb.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test("composition installation is atomic and repeatable", () => {
    const database = new Database(":memory:"); database.exec("PRAGMA foreign_keys=ON");
    expect(() => installScheduledRunCompositionSchema(database, { afterBoundary(boundary) { if (boundary === "service_outbox") throw new Error("stop"); } })).toThrow();
    const partial = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_%'").all();
    expect(partial).toHaveLength(0);
    installScheduledRunCompositionSchema(database); installScheduledRunCompositionSchema(database);
    expect((database.query("SELECT COUNT(*) AS count FROM service_effect_s07_tasks").get() as { count: number }).count).toBe(0);
    database.close();
  });

  test("pre-existing equal EF-S05 rows are rejected before the first S07 completion", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:preexisting-outbox"));
      const claimed = await subject.store.claimDue(dueClaim("preexisting-outbox")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const intent = { effect: { idempotencyKey: "outbox:preexisting", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:preexisting", redactionClass: "private" as const }, outboxId: "outbox:preexisting", kind: "channel_delivery" as const, payloadRef: "payload:preexisting", destinationRef: "destination:web", availableAt: "2026-08-16T01:00:10.000Z", enqueuedAt: "2026-08-16T01:00:10.000Z", repeatability: "reconciliation_required" as const };
      intent.effect.requestHash = hashCanonicalRequest(intent as unknown as CanonicalJsonValue);
      const inserter = createServiceOutboxEnqueueInserter(subject.database); expect(inserter.ok).toBe(true); if (!inserter.ok) return;
      subject.database.transaction(() => { const inserted = inserter.value.insert(intent); expect(inserted.ok).toBe(true); }).immediate();
      const base = completion(claimed.value[0], "complete:preexisting");
      const request: CompleteScheduledRunRequest = { ...base, effect: { ...base.effect, requestHash: "" }, outboxIntents: [intent] };
      request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
      const result = await subject.store.complete(request);
      expect(!result.ok && result.error._tag).toBe("idempotency_conflict");
      expect(subject.inspect().runLogs).toBe(0);
    } finally { subject.dispose?.(); }
  });

  test("global effect keys conflict across terminal methods", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:global-key"));
      const claimed = await subject.store.claimDue(dueClaim("global-key")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0], completed = await subject.store.complete(completion(lease, "shared:effect-key"));
      expect(completed.ok).toBe(true);
      const abandon = { effect: { idempotencyKey: "shared:effect-key", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:collision", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:11.000Z", reasonTag: "collision", abandonedAt: "2026-08-16T01:00:11.000Z", retryAt: null };
      abandon.effect.requestHash = hashCanonicalRequest(abandon as unknown as CanonicalJsonValue);
      const conflict = await subject.store.abandon(abandon);
      expect(!conflict.ok && conflict.error._tag).toBe("idempotency_conflict");
    } finally { subject.dispose?.(); }
  });

  test("malformed durable occurrence identity is a bounded corrupt_state", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:corrupt"));
      const claimed = await subject.store.claimDue(dueClaim("corrupt")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.database.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
      subject.database.query("UPDATE service_effect_s07_occurrences SET task_id='task:tampered' WHERE run_id=?").run(claimed.value[0].record.runId);
      const result = await subject.store.get(claimed.value[0].record.runId);
      expect(!result.ok && result.error._tag).toBe("corrupt_state");
    } finally { subject.dispose?.(); }
  });

  test("current recurrence utility pins UTC and Lisbon DST vectors", () => {
    expect(computeNextRun("cron", "*/5 * * * *", { currentDate: "2024-01-01T00:00:00.000Z", timezone: "UTC" })).toBe("2024-01-01T00:05:00.000Z");
    expect(computeNextRun("cron", "30 1 * * *", { currentDate: "2024-03-30T01:30:00.000Z", timezone: "Europe/Lisbon" })).toBe("2024-03-31T01:30:00.000Z");
    expect(computeNextRun("cron", "30 1 * * *", { currentDate: "2024-10-27T00:30:00.000Z", timezone: "Europe/Lisbon" })).toBe("2024-10-28T01:30:00.000Z");
  });
});
