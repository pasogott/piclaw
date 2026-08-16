import { createHash } from "node:crypto";

import { hashCanonicalRequest, type CanonicalJsonValue } from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ScheduledRunLease,
  ScheduledRunReclaimAuthority,
  ScheduledRunStore,
  ScheduledTaskAuthority,
  ScheduledTaskAuthorityInput,
} from "../../contracts/scheduled-run-store.js";
import {
  runParameterisedContractSuite,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../contract-suite.js";

export interface ScheduledRunInspection {
  readonly occurrences: number;
  readonly runLogs: number;
  readonly nextDecisions: number;
  readonly outboxRows: number;
  readonly tombstones: number;
}
export type ScheduledRunMutationMethod = "claimDue" | "renew" | "bindAcceptedSource" | "complete" | "abandon" | "cleanupTerminal";
export interface ScheduledRunContractSubject {
  readonly store: ScheduledRunStore;
  readonly authority: ScheduledTaskAuthority;
  peerStore(): ScheduledRunStore;
  acceptAgentSource(input: { runId: string; chatJid: string; sourceSeq: number; operationId: string }): void;
  markOutboxUnknown(outboxId: string): Promise<void>;
  outboxState(outboxId: string): Promise<string | null>;
  poisonTraceObserver(): void;
  inspect(): ScheduledRunInspection;
  planFault?(method: ScheduledRunMutationMethod, point: "before_effect" | "effect_then_lost_acknowledgement", occurrence: number): void;
  dispose?(): void | Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function hashed<T extends { effect: { requestHash: string } }>(request: T): T {
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}
function task(id: string, overrides: Partial<ScheduledTaskAuthorityInput> = {}): ScheduledTaskAuthorityInput {
  return {
    taskId: id, chatJid: "web:s07", kind: "shell", payloadRef: `payload:${id}`, modelLabel: null,
    scheduleType: "interval", scheduleValue: "60000", timezone: "UTC", notifyOnComplete: true,
    muted: false, cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private",
    executionRepeatability: "repeatable", nextRunAt: "2026-08-16T01:00:00.000Z", authoredAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}
function claim(prefix: string, now = "2026-08-16T01:00:00.000Z"): ClaimDueRunsRequest {
  return { now, limit: 10, workerId: `worker:${prefix}`, leaseTokenPrefix: `prefix:${prefix}`, leaseDurationMs: 60000, reclaimAuthorities: [] };
}
function bind(lease: ScheduledRunLease, id: string, sourceSeq: number, operationId: string): BindScheduledSourceRequest {
  return hashed({ effect: { idempotencyKey: `bind:${id}`, requestHash: "", operationId, sourceSeq, provenanceRef: `provenance:${id}`, redactionClass: "private" }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:05.000Z", sourceSeq, operationId, boundAt: "2026-08-16T01:00:05.000Z" });
}
function complete(lease: ScheduledRunLease, id: string, outboxIntents: readonly EnqueueOutboxRequest[] = []): CompleteScheduledRunRequest {
  const request: CompleteScheduledRunRequest = {
    effect: { idempotencyKey: `complete:${id}`, requestHash: "", operationId: lease.record.operationId, sourceSeq: lease.record.acceptedSourceSeq, provenanceRef: `provenance:${id}`, redactionClass: "private" },
    runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt,
    expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z",
    status: "success", durationMs: 10000, resultRef: `result:${id}`, errorCode: null,
    completedAt: "2026-08-16T01:00:10.000Z", outboxIntents,
  };
  return hashed(request);
}
function errorComplete(lease: ScheduledRunLease, id: string): CompleteScheduledRunRequest {
  const request = complete(lease, id);
  return hashed({ ...request, effect: { ...request.effect, requestHash: "" }, status: "error", resultRef: null, errorCode: `error:${id}` });
}
function outbox(id: string, operationId: string | null = null, sourceSeq: number | null = null, kind: EnqueueOutboxRequest["kind"] = "channel_delivery"): EnqueueOutboxRequest {
  const request: EnqueueOutboxRequest = {
    effect: { idempotencyKey: `outbox:${id}`, requestHash: "", operationId, sourceSeq, provenanceRef: `provenance:${id}`, redactionClass: "private" },
    outboxId: `outbox:${id}`, kind, payloadRef: `payload:outbox:${id}`, destinationRef: "destination:web:s07",
    availableAt: "2026-08-16T01:00:10.000Z", enqueuedAt: "2026-08-16T01:00:10.000Z", repeatability: "reconciliation_required",
  };
  return hashed(request);
}

const cases: readonly ParameterisedContractCase<ScheduledRunContractSubject>[] = [
  {
    name: "EF-S07-C01 two scheduler instances claim one occurrence",
    async run({ subject }) {
      subject.authority.create(task("task:c01"));
      const [left, right] = await Promise.all([subject.store.claimDue(claim("c01-left")), subject.peerStore().claimDue(claim("c01-right"))]);
      assert(left.ok && right.ok, "both claims must be typed successes");
      assert(left.value.length + right.value.length === 1, "exactly one scheduler must lease the occurrence");
      assert(subject.inspect().occurrences === 1, "one occurrence must exist");
    },
  },
  {
    name: "EF-S07-C02 pause or delete before claim prevents a run",
    async run({ subject }) {
      subject.authority.create(task("task:c02-paused")); subject.authority.pause("task:c02-paused");
      subject.authority.create(task("task:c02-deleted")); subject.authority.delete("task:c02-deleted");
      const result = await subject.store.claimDue(claim("c02"));
      assert(result.ok && result.value.length === 0, "inactive heads must not be claimed");
      assert(subject.inspect().occurrences === 0, "inactive heads must create no occurrence");
    },
  },
  {
    name: "EF-S07-C03 lease renewal and expiry reject stale workers",
    async run({ subject }) {
      subject.authority.create(task("task:c03"));
      const claimed = await subject.store.claimDue(claim("c03")); assert(claimed.ok && claimed.value.length === 1, "claim must return one lease");
      const lease = claimed.value[0];
      const renewed: RenewScheduledRunRequest = { runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z" };
      const ok = await subject.store.renew(renewed); assert(ok.ok && ok.value.record.leaseExpiresAt === renewed.leaseExpiresAt, "renew must extend the lease");
      const stale = await subject.store.renew({ ...renewed, workerId: "worker:stale", leaseExpiresAt: "2026-08-16T01:03:00.000Z" });
      assert(!stale.ok && stale.error._tag === "lease_conflict", "stale owner must be fenced");
      const expired = await subject.store.renew({ ...renewed, now: "2026-08-16T01:02:00.000Z", leaseExpiresAt: "2026-08-16T01:03:00.000Z" });
      assert(!expired.ok && expired.error._tag === "lease_expired", "expiry boundary must reject renewal");
    },
  },
  {
    name: "EF-S07-C04 source binding is idempotent and owner fenced",
    async run({ subject }) {
      subject.authority.create(task("task:c04", { kind: "agent", executionRepeatability: "agent_source" }));
      const claimed = await subject.store.claimDue(claim("c04")); assert(claimed.ok && claimed.value.length === 1, "agent claim required");
      const lease = claimed.value[0], operationId = "operation:c04";
      subject.acceptAgentSource({ runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq: 1, operationId });
      const request: BindScheduledSourceRequest = hashed({ effect: { idempotencyKey: "bind:c04", requestHash: "", operationId, sourceSeq: 1, provenanceRef: "provenance:c04", redactionClass: "private" }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:05.000Z", sourceSeq: 1, operationId, boundAt: "2026-08-16T01:00:05.000Z" });
      const first = await subject.store.bindAcceptedSource(request), replay = await subject.store.bindAcceptedSource(request);
      assert(first.ok && replay.ok && replay.value.operationId === operationId, "equal binding must replay");
      const stale = await subject.store.bindAcceptedSource(hashed({ ...request, effect: { ...request.effect, idempotencyKey: "bind:c04-stale", requestHash: "" }, workerId: "worker:stale" }));
      assert(!stale.ok && stale.error._tag === "lease_conflict", "changed owner must be fenced");
    },
  },
  {
    name: "EF-S07-C05 one-shot and recurring completion persist next occurrence correctly",
    async run({ subject }) {
      subject.authority.create(task("task:c05-once", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      subject.authority.create(task("task:c05-recurring"));
      const claimed = await subject.store.claimDue(claim("c05")); assert(claimed.ok && claimed.value.length === 2, "both due tasks must claim");
      for (const lease of claimed.value) {
        const result = await subject.store.complete(complete(lease, lease.record.taskId)); assert(result.ok, "completion must succeed");
        if (lease.record.taskId.endsWith("once")) assert(result.value.nextRunAt === null, "one-shot must close");
        else assert(result.value.nextRunAt === "2026-08-16T01:01:10.000Z", "interval must anchor at completion");
      }
      assert(subject.inspect().runLogs === 2 && subject.inspect().nextDecisions === 2, "one immutable log and next decision per run required");
    },
  },
  {
    name: "EF-S07-C06 agent shell and internal result shapes remain distinct",
    async run({ subject }) {
      subject.authority.create(task("task:c06-shell"));
      subject.authority.create(task("task:c06-internal", { kind: "internal", internalTask: { discriminator: "dream", reference: "internal:dream" }, executionRepeatability: "repeatable" }));
      const claimed = await subject.store.claimDue(claim("c06")); assert(claimed.ok && claimed.value.length === 2, "non-agent kinds must claim");
      for (const lease of claimed.value) { const result = await subject.store.complete(complete(lease, lease.record.taskId)); assert(result.ok && result.value.operationId === null, "service-owned results must not bind Earendil source"); }
    },
  },
  {
    name: "EF-S07-C07 muted notification creates no delivery intent",
    async run({ subject }) {
      subject.authority.create(task("task:c07", { notifyOnComplete: false, muted: true }));
      const claimed = await subject.store.claimDue(claim("c07")); assert(claimed.ok && claimed.value.length === 1, "muted task must still claim");
      const rejected = await subject.store.complete(complete(claimed.value[0], "c07", [outbox("c07", null, null, "notification")]));
      assert(!rejected.ok && rejected.error._tag === "invalid_request", "muted notification intent must be rejected");
      assert(subject.inspect().outboxRows === 0 && subject.inspect().runLogs === 0, "rejection must roll back completion");
    },
  },
  {
    name: "EF-S07-C08 unknown delivery does not rerun the task",
    async run({ subject, crashAndRestore }) {
      subject.authority.create(task("task:c08", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const originalClaim = claim("c08");
      const claimed = await subject.store.claimDue(originalClaim); assert(claimed.ok && claimed.value.length === 1, "one-shot claim required");
      const done = await subject.store.complete(complete(claimed.value[0], "c08", [outbox("c08")])); assert(done.ok && done.value.state === "completed", "completion must be terminal before delivery");
      await subject.markOutboxUnknown("outbox:c08");
      assert(await subject.outboxState("outbox:c08") === "unknown", "composed delivery must durably reach unknown");
      const restored = await crashAndRestore();
      const claimReplay = await restored.store.claimDue(originalClaim);
      assert(!claimReplay.ok && claimReplay.error._tag === "invalid_transition", `terminal claim replay must not fabricate an executable lease (${claimReplay.ok ? "ok" : claimReplay.error._tag})`);
      const next = await restored.store.claimDue(claim("c08-next", "2026-08-16T02:00:00.000Z")); assert(next.ok && next.value.length === 0, "unknown delivery cannot reclaim terminal run");
      assert(restored.inspect().occurrences === 1 && restored.inspect().outboxRows === 1, "run and intent must remain singular");
    },
  },
  {
    name: "EF-S07-S01 hostile accessors are rejected and returned snapshots are immutable",
    async run({ subject }) {
      let reads = 0;
      const request = { ...claim("s01") } as Record<string, unknown>;
      Object.defineProperty(request, "workerId", { enumerable: true, get() { reads += 1; return "worker:hostile"; } });
      const rejected = await subject.store.claimDue(request as unknown as ClaimDueRunsRequest);
      assert(!rejected.ok && rejected.error._tag === "invalid_request", "accessor-bearing input must be rejected");
      assert(reads === 0, "normalisation must inspect descriptors without invoking getters");
      subject.authority.create(task("task:s01"));
      const claimed = await subject.store.claimDue(claim("s01-clean"));
      assert(claimed.ok && Object.isFrozen(claimed.value) && Object.isFrozen(claimed.value[0].record) && Object.isFrozen(claimed.value[0].task), "returned lease graph must be immutable");
    },
  },
  {
    name: "EF-S07-S02 independent closed normalisation rejects extra keys malformed IDs sparse arrays and mismatched once authority",
    async run({ subject }) {
      const extra = await subject.store.claimDue({ ...claim("s02-extra"), extra: true } as unknown as ClaimDueRunsRequest);
      assert(!extra.ok && extra.error._tag === "invalid_request", "extra claim keys must be rejected");
      const symbolic = claim("s02-symbol") as ClaimDueRunsRequest & Record<symbol, unknown>; symbolic[Symbol("extra")] = true;
      const symbolicResult = await subject.store.claimDue(symbolic); assert(!symbolicResult.ok && symbolicResult.error._tag === "invalid_request", "symbol-keyed extras must be rejected");
      const sparse = claim("s02-sparse");
      const authorities = new Array(1) as ClaimDueRunsRequest["reclaimAuthorities"];
      const sparseResult = await subject.store.claimDue({ ...sparse, reclaimAuthorities: authorities });
      assert(!sparseResult.ok && sparseResult.error._tag === "invalid_request", "sparse reclaim arrays must be rejected");
      const malformed = await subject.store.get("run:not-scheduled");
      assert(!malformed.ok && malformed.error._tag === "invalid_request", "generic IDs must not pass as run IDs");
      const cursor = await subject.store.listRuns({ afterScheduledFor: "2026-08-16T01:00:00.000Z", afterRunId: "not-a-run" });
      assert(!cursor.ok && cursor.error._tag === "invalid_request", "cursor run IDs must be canonical");
      let onceRejected = false;
      try { subject.authority.create(task("task:s02-once", { scheduleType: "once", scheduleValue: "2026-08-16T02:00:00.000Z" })); } catch { onceRejected = true; }
      assert(onceRejected, "one-shot head must equal its frozen schedule value");
      subject.authority.create(task("task:s02-closed"));
      const claimed = await subject.store.claimDue(claim("s02-closed")); assert(claimed.ok && claimed.value.length === 1, "closed-shape claim required");
      const lease = claimed.value[0];
      const renewExtra = await subject.store.renew({ runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:01.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z", extra: true } as unknown as RenewScheduledRunRequest);
      assert(!renewExtra.ok && renewExtra.error._tag === "invalid_request", "extra fence keys must be rejected");
      const extraAuthority = await subject.store.claimDue({ ...claim("s02-authority"), reclaimAuthorities: [{ runId: lease.record.runId, expectedAttempt: 1, kind: "repeatable", reconciliationRef: null, extra: true } as unknown as ScheduledRunReclaimAuthority] });
      assert(!extraAuthority.ok && extraAuthority.error._tag === "invalid_request", "extra reclaim-authority keys must be rejected");
      const listExtra = await subject.store.listRuns({ limit: 1, extra: true } as unknown as ListScheduledRunsRequest);
      assert(!listExtra.ok && listExtra.error._tag === "invalid_request", "extra list-filter keys must be rejected");
      let taskExtraRejected = false;
      try { subject.authority.create({ ...task("task:s02-extra-task"), extra: true } as unknown as ScheduledTaskAuthorityInput); } catch { taskExtraRejected = true; }
      assert(taskExtraRejected, "extra task-authority keys must be rejected");
      const intent = outbox("s02-extra-intent") as EnqueueOutboxRequest & { extra?: boolean }; intent.extra = true;
      const nested = complete(lease, "s02-nested", [intent]);
      const nestedResult = await subject.store.complete(nested); assert(!nestedResult.ok && nestedResult.error._tag === "invalid_request", "extra nested outbox keys must be rejected");
      const badKindBase = outbox("s02-kind"), badKind = hashed({ ...badKindBase, effect: { ...badKindBase.effect, requestHash: "" }, kind: "raw_socket" }) as unknown as EnqueueOutboxRequest;
      const badKindResult = await subject.store.complete(complete(lease, "s02-kind", [badKind])); assert(!badKindResult.ok && badKindResult.error._tag === "invalid_request", "unknown outbox kinds must be rejected");
      const badTimeBase = outbox("s02-time"), badTime = hashed({ ...badTimeBase, effect: { ...badTimeBase.effect, requestHash: "" }, availableAt: "2026-08-16T01:00:10Z" }) as unknown as EnqueueOutboxRequest;
      const badTimeResult = await subject.store.complete(complete(lease, "s02-time", [badTime])); assert(!badTimeResult.ok && badTimeResult.error._tag === "invalid_request", "noncanonical nested timestamps must be rejected");
      const badRepeatBase = outbox("s02-repeat"), badRepeat = hashed({ ...badRepeatBase, effect: { ...badRepeatBase.effect, requestHash: "" }, repeatability: "maybe" }) as unknown as EnqueueOutboxRequest;
      const badRepeatResult = await subject.store.complete(complete(lease, "s02-repeat", [badRepeat])); assert(!badRepeatResult.ok && badRepeatResult.error._tag === "invalid_request", "unknown outbox repeatability must be rejected");
      const effectExtraBase = complete(lease, "s02-effect-extra"), effectExtra = hashed({ ...effectExtraBase, effect: { ...effectExtraBase.effect, requestHash: "", extra: true } });
      const effectExtraResult = await subject.store.complete(effectExtra as unknown as CompleteScheduledRunRequest); assert(!effectExtraResult.ok && effectExtraResult.error._tag === "invalid_request", "extra nested effect keys must be rejected");
      const duplicateIntent = outbox("s02-duplicate"), duplicate = complete(lease, "s02-duplicate", [duplicateIntent, duplicateIntent]);
      const duplicateResult = await subject.store.complete(duplicate); assert(!duplicateResult.ok && duplicateResult.error._tag === "invalid_request", "duplicate outbox arrays must be rejected");
      const sparseIntents = new Array(1) as EnqueueOutboxRequest[], sparseCompletionBase = complete(lease, "s02-sparse-outbox");
      const sparseCompletion = hashed({ ...sparseCompletionBase, effect: { ...sparseCompletionBase.effect, requestHash: "" }, outboxIntents: sparseIntents });
      const sparseCompletionResult = await subject.store.complete(sparseCompletion); assert(!sparseCompletionResult.ok && sparseCompletionResult.error._tag === "invalid_request", "sparse outbox arrays must be rejected");
    },
  },
  {
    name: "EF-S07-S03 renew and cleanup replay exactly after fresh restore",
    async run({ subject, crashAndRestore }) {
      subject.authority.create(task("task:s03", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const claimed = await subject.store.claimDue(claim("s03")); assert(claimed.ok && claimed.value.length === 1, "claim required");
      const lease = claimed.value[0];
      const renewal: RenewScheduledRunRequest = { runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z" };
      const renewed = await subject.store.renew(renewal); assert(renewed.ok, "renew must apply");
      let restored = await crashAndRestore();
      const renewalReplay = await restored.store.renew(renewal); assert(renewalReplay.ok && renewalReplay.value.record.leaseExpiresAt === renewed.value.record.leaseExpiresAt, "renew must replay exact durable result");
      const terminalRequest = complete({ ...renewalReplay.value, record: renewalReplay.value.record }, "s03");
      const done = await restored.store.complete(terminalRequest); assert(done.ok, "completion after renewal required");
      const cleanup = { settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 };
      const cleaned = await restored.store.cleanupTerminal(cleanup); assert(cleaned.ok && cleaned.value.removed === 1, "cleanup must apply");
      restored = await crashAndRestore();
      const cleanupReplay = await restored.store.cleanupTerminal(cleanup);
      assert(cleanupReplay.ok && cleanupReplay.value.removed === 1 && cleanupReplay.value.runIds[0] === lease.record.runId, "cleanup must replay original result after restore");
    },
  },
  {
    name: "EF-S07-S04 agent source and ordered outbox composition is atomic and identity closed",
    async run({ subject, crashAndRestore }) {
      subject.authority.create(task("task:s04", { kind: "agent", executionRepeatability: "agent_source" }));
      const claimed = await subject.store.claimDue(claim("s04")); assert(claimed.ok && claimed.value.length === 1, "agent claim required");
      const lease = claimed.value[0], operationId = "operation:s04", sourceSeq = 1;
      subject.acceptAgentSource({ runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
      const binding = bind(lease, "s04", sourceSeq, operationId);
      const bound = await subject.store.bindAcceptedSource(binding); assert(bound.ok && bound.value.state === "source_bound", "stable S01 binding required");
      const changedBinding = hashed({ ...binding, effect: { ...binding.effect, requestHash: "", operationId: "operation:changed", sourceSeq: 2 }, operationId: "operation:changed", sourceSeq: 2 });
      const bindingConflict = await subject.store.bindAcceptedSource(changedBinding);
      assert(!bindingConflict.ok && bindingConflict.error._tag === "idempotency_conflict", "changed binding under one key must conflict");
      const badIntent = outbox("s04-bad");
      const badComplete = await subject.store.complete(complete({ ...lease, record: bound.value as ScheduledRunLease["record"] }, "s04-bad", [badIntent]));
      assert(!badComplete.ok && badComplete.error._tag === "invalid_request", "agent outbox identity must match accepted source");
      const intents = [outbox("s04-a", operationId, sourceSeq), outbox("s04-b", operationId, sourceSeq, "timeline_broadcast")];
      const request = complete({ ...lease, record: bound.value as ScheduledRunLease["record"] }, "s04", intents);
      const done = await subject.store.complete(request); assert(done.ok && done.value.outboxIds.join(",") === "outbox:s04-a,outbox:s04-b", "ordered S05 composition required");
      const changedRequest = hashed({ ...request, effect: { ...request.effect, requestHash: "" }, outboxIntents: [outbox("s04-changed", operationId, sourceSeq)] });
      const changedOutbox = await subject.store.complete(changedRequest); assert(!changedOutbox.ok && changedOutbox.error._tag === "idempotency_conflict", "changed outbox identity under one completion key must conflict");
      assert(subject.inspect().runLogs === 1 && subject.inspect().nextDecisions === 1 && subject.inspect().outboxRows === 2, "one terminal composition required");
      const restored = await crashAndRestore();
      const replay = await restored.store.complete(request);
      assert(replay.ok && replay.value.outboxIds.join(",") === done.value.outboxIds.join(",") && restored.inspect().outboxRows === 2, "fresh replay must not duplicate composition");
    },
  },
  {
    name: "EF-S07-S05 pagination filters retention limits and tombstone replay are stable",
    async run({ subject }) {
      subject.authority.create(task("task:s05-a", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      subject.authority.create(task("task:s05-b", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      subject.authority.create(task("task:s05-live", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const claimed = await subject.store.claimDue(claim("s05")); assert(claimed.ok && claimed.value.length === 3, "three claims required");
      const terminal = claimed.value.filter((lease) => !lease.record.taskId.endsWith("live"));
      const requests = terminal.map((lease) => complete(lease, lease.record.taskId));
      for (const request of requests) { const done = await subject.store.complete(request); assert(done.ok, "terminal setup required"); }
      const first = await subject.store.listRuns({ limit: 1 }); assert(first.ok && first.value.length === 1, "first page required");
      const second = await subject.store.listRuns({ limit: 2, afterScheduledFor: first.value[0].scheduledFor, afterRunId: first.value[0].runId });
      assert(second.ok && second.value.length === 2 && second.value.every((row) => row.runId > first.value[0].runId), "cursor ordering must be stable by tuple");
      const completed = await subject.store.listRuns({ state: "completed", limit: 10 }); assert(completed.ok && completed.value.length === 2, "state filter required");
      const filtered = await subject.store.listRuns({ taskId: terminal[0].record.taskId, limit: 10 }); assert(filtered.ok && filtered.value.length === 1, "task filter required");
      const cleanup = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 }); assert(cleanup.ok && cleanup.value.removed === 1, "cleanup limit must be exact");
      const live = await subject.store.get(claimed.value.find((lease) => lease.record.taskId.endsWith("live"))!.record.runId); assert(live.ok && live.value?.state === "claimed", "cleanup must preserve nonterminal runs");
      const mixed = await subject.store.listRuns({ limit: 10 }); assert(mixed.ok && mixed.value.length === 3 && Object.isFrozen(mixed.value) && mixed.value.every(Object.isFrozen), "mixed live/tombstone summaries must remain closed and immutable");
      assert(mixed.value.filter((row) => row.retained).length === 1 && mixed.value.map((row) => row.runId).join(",") === [...mixed.value].map((row) => row.runId).sort().join(","), "tombstones and detailed runs must share stable tuple ordering");
      const purgedRequest = requests.find((request) => request.runId === cleanup.value.runIds[0])!;
      const replay = await subject.store.complete(purgedRequest); assert(replay.ok && replay.value.retained, "terminal replay after purge must return retained summary");
      const recreation = await subject.store.claimDue(claim("s05-recreate", "2026-08-16T01:00:30.000Z")); assert(recreation.ok && recreation.value.length === 0, "tombstoned occurrence cannot be recreated");
    },
  },
  {
    name: "EF-S07-S06 agent shell internal success error and notification evidence is kind closed",
    async run({ subject }) {
      for (const suffix of ["success", "error"]) subject.authority.create(task(`task:s06-agent-${suffix}`, { chatJid: `chat:s06-agent-${suffix}`, kind: "agent", executionRepeatability: "agent_source" }));
      for (const suffix of ["success", "error"]) subject.authority.create(task(`task:s06-shell-${suffix}`));
      for (const suffix of ["success", "error"]) subject.authority.create(task(`task:s06-internal-${suffix}`, { kind: "internal", internalTask: { discriminator: "dream", reference: `internal:${suffix}` } }));
      const claimed = await subject.store.claimDue(claim("s06")); assert(claimed.ok && claimed.value.length === 6, "full kind/result matrix claims required");
      const pick = (kind: string, suffix: string) => claimed.value.find((lease) => lease.task.kind === kind && lease.record.taskId.endsWith(suffix))!;
      const agent = pick("agent", "success"), agentError = pick("agent", "error"), shell = pick("shell", "success"), shellError = pick("shell", "error"), internal = pick("internal", "error"), internalSuccess = pick("internal", "success");
      const unbound = await subject.store.complete(complete(agent, "s06-unbound")); assert(!unbound.ok && unbound.error._tag === "invalid_transition", "agent success requires source authority");
      const noResultBase = complete(shell, "s06-no-result"), noResult = hashed({ ...noResultBase, effect: { ...noResultBase.effect, requestHash: "" }, resultRef: null });
      const noResultResult = await subject.store.complete(noResult); assert(!noResultResult.ok && noResultResult.error._tag === "invalid_request", "success requires an opaque result reference");
      const rawResultBase = complete(shell, "s06-raw-result"), rawResult = hashed({ ...rawResultBase, effect: { ...rawResultBase.effect, requestHash: "" }, resultRef: "raw output is forbidden" });
      const rawResultResult = await subject.store.complete(rawResult); assert(!rawResultResult.ok && rawResultResult.error._tag === "invalid_request", "raw result bodies must be rejected");
      const badErrorBase = errorComplete(shell, "s06-bad-error"), badError = hashed({ ...badErrorBase, effect: { ...badErrorBase.effect, requestHash: "" }, resultRef: "result:forbidden" });
      const badErrorResult = await subject.store.complete(badError); assert(!badErrorResult.ok && badErrorResult.error._tag === "invalid_request", "error forbids a success result reference");
      const rawErrorBase = errorComplete(shell, "s06-raw-error"), rawError = hashed({ ...rawErrorBase, effect: { ...rawErrorBase.effect, requestHash: "" }, errorCode: "x".repeat(129) });
      const rawErrorResult = await subject.store.complete(rawError); assert(!rawErrorResult.ok && rawErrorResult.error._tag === "invalid_request", "unbounded error bodies must be rejected");
      const badOwnerBase = complete(shell, "s06-owner"), badOwner = hashed({ ...badOwnerBase, effect: { ...badOwnerBase.effect, requestHash: "", operationId: "operation:forbidden", sourceSeq: 9 } });
      const badOwnerResult = await subject.store.complete(badOwner); assert(!badOwnerResult.ok && badOwnerResult.error._tag === "invalid_request", "service-owned kinds forbid S01 identity");
      const shellDone = await subject.store.complete(complete(shell, "s06-shell", [outbox("s06-shell-notify", null, null, "notification")])); assert(shellDone.ok && shellDone.value.status === "success", "shell success and opted-in notification required");
      const shellErrorDone = await subject.store.complete(errorComplete(shellError, "s06-shell-error")); assert(shellErrorDone.ok && shellErrorDone.value.status === "error", "shell error evidence required");
      const internalNotice = await subject.store.complete(complete(internal, "s06-internal-notice", [outbox("s06-internal-notify", null, null, "notification")])); assert(!internalNotice.ok && internalNotice.error._tag === "invalid_request", "internal tasks forbid notifications");
      const internalDone = await subject.store.complete(errorComplete(internal, "s06-internal")); assert(internalDone.ok && internalDone.value.status === "error" && internalDone.value.resultRef === null, "internal error evidence required");
      const internalSuccessDone = await subject.store.complete(complete(internalSuccess, "s06-internal-success")); assert(internalSuccessDone.ok && internalSuccessDone.value.status === "success", "internal success evidence required");
      for (const [lease, suffix, status] of [[agent, "success", "success"], [agentError, "error", "error"]] as const) {
        const operationId = `operation:s06-agent-${suffix}`, sourceSeq = suffix === "success" ? 1 : 2;
        subject.acceptAgentSource({ runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
        const binding = await subject.store.bindAcceptedSource(bind(lease, `s06-agent-${suffix}`, sourceSeq, operationId)); assert(binding.ok, "agent binding required");
        const boundLease = { ...lease, record: binding.value as ScheduledRunLease["record"] };
        if (status === "success") {
          const wrongBase = complete(boundLease, "s06-agent-wrong"), wrong = hashed({ ...wrongBase, effect: { ...wrongBase.effect, requestHash: "", operationId: "operation:wrong", sourceSeq: 99 } });
          const wrongResult = await subject.store.complete(wrong); assert(!wrongResult.ok && wrongResult.error._tag === "invalid_request", "agent completion identity must equal binding");
        }
        const result = status === "success" ? await subject.store.complete(complete(boundLease, "s06-agent", [outbox("s06-agent-notify", operationId, sourceSeq, "notification")])) : await subject.store.complete(errorComplete(boundLease, "s06-agent-error"));
        assert(result.ok && result.value.status === status && result.value.operationId === operationId, `agent ${status} must preserve S01 identity`);
      }
    },
  },
  {
    name: "EF-S07-S07 canonical instant arithmetic overflow is bounded",
    async run({ subject }) {
      const overflowClaim = await subject.store.claimDue({ ...claim("s07-overflow", "9999-12-31T23:59:59.999Z"), leaseDurationMs: 1 });
      assert(!overflowClaim.ok && overflowClaim.error._tag === "invalid_request", "claim expiry overflow must be invalid_request");
      subject.authority.create(task("task:s07-overflow", { nextRunAt: "9999-12-31T23:59:50.000Z" }));
      const claimed = await subject.store.claimDue({ ...claim("s07-overflow-run", "9999-12-31T23:59:50.000Z"), leaseDurationMs: 5000 });
      assert(claimed.ok && claimed.value.length === 1, "near-limit occurrence must claim safely");
      const base = complete(claimed.value[0], "s07-overflow"), request = hashed({ ...base, effect: { ...base.effect, requestHash: "" }, now: "9999-12-31T23:59:54.000Z", completedAt: "9999-12-31T23:59:54.000Z" });
      const result = await subject.store.complete(request);
      assert(!result.ok && result.error._tag === "corrupt_state", "interval successor overflow must be corrupt_state, not storage failure");
    },
  },
  {
    name: "EF-S07-S08 reclaim fences stale attempt and owner across restore",
    async run({ subject, crashAndRestore }) {
      subject.authority.create(task("task:s08"));
      const firstClaim = await subject.store.claimDue({ ...claim("s08-first"), leaseDurationMs: 1000 }); assert(firstClaim.ok && firstClaim.value.length === 1, "first claim required");
      const first = firstClaim.value[0];
      const reclaimed = await subject.store.claimDue({ ...claim("s08-second", "2026-08-16T01:00:02.000Z"), reclaimAuthorities: [{ runId: first.record.runId, expectedAttempt: 1, kind: "repeatable", reconciliationRef: null }] });
      assert(reclaimed.ok && reclaimed.value[0].record.attempt === 2, "second attempt required");
      const restored = await crashAndRestore();
      const staleComplete = await restored.store.complete(complete(first, "s08-stale")); assert(!staleComplete.ok && staleComplete.error._tag === "lease_conflict", "stale attempt must remain fenced after restore");
      const staleRenew = await restored.store.renew({ runId: first.record.runId, workerId: first.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: first.leaseToken, now: "2026-08-16T01:00:02.000Z", leaseExpiresAt: "2026-08-16T01:03:00.000Z" });
      assert(!staleRenew.ok && staleRenew.error._tag === "lease_conflict", "stale owner renewal must remain fenced");
    },
  },
  {
    name: "EF-S07-S09 traces are redacted reads are silent and malformed observers cannot own outcomes",
    async run({ subject, inspectTrace }) {
      const protectedValues = ["prefix:protected-s09", "payload:protected-s09", "model:protected-s09", "cwd:protected-s09", "provenance:protected-s09", "result:protected-s09", "destination:protected-s09", "internal:protected-s09", "payload:protected-internal-s09"];
      subject.authority.create(task("task:s09", { payloadRef: protectedValues[1], modelLabel: protectedValues[2], cwd: protectedValues[3] }));
      subject.authority.create(task("task:s09-internal", { kind: "internal", payloadRef: protectedValues[8], internalTask: { discriminator: "dream", reference: protectedValues[7] } }));
      const claimRequest = { ...claim("protected-s09"), leaseTokenPrefix: protectedValues[0] };
      const claimed = await subject.store.claimDue(claimRequest); assert(claimed.ok && claimed.value.length === 2, "trace fixture claims required");
      const lease = claimed.value.find((entry) => entry.task.kind === "shell")!, intent = outbox("s09");
      const customIntent = hashed({ ...intent, effect: { ...intent.effect, requestHash: "", provenanceRef: protectedValues[4] }, destinationRef: protectedValues[6] });
      const base = complete(lease, "s09", [customIntent]), request = hashed({ ...base, effect: { ...base.effect, requestHash: "", provenanceRef: protectedValues[4] }, resultRef: protectedValues[5] });
      subject.poisonTraceObserver();
      const done = await subject.store.complete(request); assert(done.ok, "malformed trace observer must not change outcome");
      const beforeReads = inspectTrace().length;
      await subject.store.get(lease.record.runId); await subject.store.listRuns({ limit: 10 });
      assert(inspectTrace().length === beforeReads, "reads must remain untraced");
      const serialised = JSON.stringify(inspectTrace());
      const tokenDigest = createHash("sha256").update(lease.leaseToken, "utf8").digest("hex"), prefixDigest = createHash("sha256").update(protectedValues[0], "utf8").digest("hex");
      for (const protectedValue of [...protectedValues, lease.leaseToken, tokenDigest, prefixDigest]) assert(!serialised.includes(protectedValue), `trace leaked ${protectedValue}`);
      assert(!/[0-9a-f]{64}/u.test(serialised) && !serialised.includes("requestHash") && !serialised.includes("leaseToken"), "traces must expose no request/token hash fields");
    },
  },
  {
    name: "EF-S07-R02 fresh restore preserves claim binding abandonment and retention authorities",
    async run({ subject, crashAndRestore }) {
      subject.authority.create(task("task:r02-claim"));
      const claimRequest = claim("r02-claim"), claimed = await subject.store.claimDue(claimRequest); assert(claimed.ok && claimed.value.length === 1, "claim setup required");
      let restored = await crashAndRestore();
      const claimReplay = await restored.store.claimDue(claimRequest); assert(claimReplay.ok && claimReplay.value[0].record.runId === claimed.value[0].record.runId, "active claim must replay after restore");
      restored.authority.create(task("task:r02-bind", { kind: "agent", executionRepeatability: "agent_source" }));
      const agentClaim = await restored.store.claimDue(claim("r02-bind")); assert(agentClaim.ok && agentClaim.value.length === 1, "agent claim setup required");
      const agent = agentClaim.value[0], operationId = "operation:r02", sourceSeq = 1;
      restored.acceptAgentSource({ runId: agent.record.runId, chatJid: agent.task.chatJid, sourceSeq, operationId });
      const bindingRequest = bind(agent, "r02", sourceSeq, operationId), binding = await restored.store.bindAcceptedSource(bindingRequest); assert(binding.ok, "binding setup required");
      restored = await crashAndRestore();
      const bindingReplay = await restored.store.bindAcceptedSource(bindingRequest); assert(bindingReplay.ok && bindingReplay.value.state === "source_bound", "binding must replay after restore");
      restored.authority.create(task("task:r02-abandon", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const abandonClaim = await restored.store.claimDue(claim("r02-abandon")); assert(abandonClaim.ok && abandonClaim.value.length === 1, "abandon setup required");
      const abandonLease = abandonClaim.value[0], abandonRequest: AbandonScheduledRunRequest = hashed({ effect: { idempotencyKey: "abandon:r02", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:r02", redactionClass: "private" }, runId: abandonLease.record.runId, workerId: abandonLease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: abandonLease.leaseToken, now: "2026-08-16T01:00:10.000Z", reasonTag: "restore", abandonedAt: "2026-08-16T01:00:10.000Z", retryAt: null });
      const abandoned = await restored.store.abandon(abandonRequest); assert(abandoned.ok, "abandon setup required");
      restored = await crashAndRestore();
      const abandonReplay = await restored.store.abandon(abandonRequest); assert(abandonReplay.ok && abandonReplay.value.state === "abandoned", "abandon must replay after restore");
      const cleanupRequest = { settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 }, cleanup = await restored.store.cleanupTerminal(cleanupRequest); assert(cleanup.ok && cleanup.value.removed === 1, "retention setup required");
      restored = await crashAndRestore();
      const retained = await restored.store.get(cleanup.value.runIds[0]); assert(retained.ok && retained.value?.retained, "retained authority must survive restore");
      const cleanupReplay = await restored.store.cleanupTerminal(cleanupRequest); assert(cleanupReplay.ok && cleanupReplay.value.removed === cleanup.value.removed, "retention decision must replay after restore");
    },
  },
  {
    name: "EF-S07-R01 postcommit lost acknowledgement restores exact replay",
    async run({ subject, crashAndRestore }) {
      if (!subject.planFault) return;
      subject.authority.create(task("task:r01"));
      const claimed = await subject.store.claimDue(claim("r01")); assert(claimed.ok && claimed.value.length === 1, "claim required");
      const request = complete(claimed.value[0], "r01");
      subject.planFault("complete", "effect_then_lost_acknowledgement", 1);
      const unknown = await subject.store.complete(request); assert(!unknown.ok && unknown.error.certainty === "unknown", "lost acknowledgement must be unknown");
      const restored = await crashAndRestore();
      const replay = await restored.store.complete(request); assert(replay.ok && replay.value.state === "completed", "fresh restore must replay terminal record");
      assert(restored.inspect().runLogs === 1, "replay must not duplicate run log");
    },
  },
];

export function defineScheduledRunStoreContract(
  factory: ContractSubjectFactory<ScheduledRunContractSubject>,
  createContext: () => ContractTestContext,
) {
  return runParameterisedContractSuite(factory, cases, createContext, (subject) => subject.dispose?.());
}

export const SCHEDULED_RUN_CONTRACT_CASE_NAMES = Object.freeze(cases.map((entry) => entry.name));
