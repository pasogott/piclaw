import { hashCanonicalRequest, type CanonicalJsonValue } from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CompleteScheduledRunRequest,
  RenewScheduledRunRequest,
  ScheduledRunLease,
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
    async run({ subject }) {
      subject.authority.create(task("task:c08", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const originalClaim = claim("c08");
      const claimed = await subject.store.claimDue(originalClaim); assert(claimed.ok && claimed.value.length === 1, "one-shot claim required");
      const done = await subject.store.complete(complete(claimed.value[0], "c08", [outbox("c08")])); assert(done.ok && done.value.state === "completed", "completion must be terminal before delivery");
      const claimReplay = await subject.store.claimDue(originalClaim);
      assert(claimReplay.ok && claimReplay.value[0].record.state === "claimed" && claimReplay.value[0].leaseToken === claimed.value[0].leaseToken, "exact claim replay must reconstruct the original lease without persisting its raw token");
      const next = await subject.store.claimDue(claim("c08-next", "2026-08-16T02:00:00.000Z")); assert(next.ok && next.value.length === 0, "later delivery state cannot reclaim terminal run");
      assert(subject.inspect().occurrences === 1 && subject.inspect().outboxRows === 1, "run and intent must remain singular");
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
