import type {
  CanonicalJsonValue,
  EffectIdentity,
} from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type {
  ClaimOutboxRequest,
  CompleteOutboxRequest,
  EnqueueOutboxRequest,
  OutboxKind,
  OutboxLease,
  ReclaimOutboxRequest,
  ServiceOutboxStore,
} from "../../contracts/service-outbox-store.js";
import {
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
  runParameterisedContractSuite,
} from "../contract-suite.js";

export type ServiceOutboxMutationMethod =
  | "enqueue"
  | "claimNext"
  | "reclaim"
  | "complete"
  | "fail"
  | "markUnknown"
  | "resolveUnknown"
  | "cleanupTerminal";
export interface ServiceOutboxContractSubject {
  readonly store: ServiceOutboxStore;
  planFault?(
    method: ServiceOutboxMutationMethod,
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence: number,
  ): void;
  inspectDurable?(): unknown;
  dispose?(): void | Promise<void>;
}
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
function effect(key: string): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId: "operation-1",
    sourceSeq: 1,
    provenanceRef: "opaque:provenance",
    redactionClass: "secret",
  };
}
function hashed<T extends { effect: EffectIdentity }>(request: T): T {
  const base = { ...request, effect: { ...request.effect, requestHash: "" } };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  } as T;
}
function enqueue(
  id: string,
  overrides: Partial<EnqueueOutboxRequest> = {},
): EnqueueOutboxRequest {
  return hashed({
    effect: effect(`key:${id}`),
    outboxId: id,
    kind: "maintenance",
    payloadRef: `opaque:payload:${id}`,
    destinationRef: "opaque:destination",
    availableAt: "2026-08-13T10:00:00.000Z",
    enqueuedAt: "2026-08-13T09:00:00.000Z",
    repeatability: "repeatable",
    ...overrides,
  });
}
function claim(
  token: string,
  overrides: Partial<ClaimOutboxRequest> = {},
): ClaimOutboxRequest {
  return {
    kinds: ["maintenance"],
    workerId: `worker:${token}`,
    leaseToken: `lease:${token}`,
    now: "2026-08-13T10:00:01.000Z",
    leaseExpiresAt: "2026-08-13T10:01:01.000Z",
    ...overrides,
  };
}
async function seedLease(
  store: ServiceOutboxStore,
  id: string,
  token = id,
  enqueueOverrides: Partial<EnqueueOutboxRequest> = {},
): Promise<OutboxLease> {
  const e = await store.enqueue(enqueue(id, enqueueOverrides));
  assert(e.ok, "enqueue");
  const c = await store.claimNext(claim(token));
  assert(c.ok && c.value.lease, "claim");
  return c.value.lease;
}
function complete(
  lease: OutboxLease,
  overrides: Partial<CompleteOutboxRequest> = {},
): CompleteOutboxRequest {
  return {
    outboxId: lease.record.outboxId,
    workerId: lease.workerId,
    expectedAttempt: lease.record.attempt,
    leaseToken: lease.record.leaseToken,
    receiptRef: "opaque:receipt",
    completedAt: "2026-08-13T10:00:30.000Z",
    ...overrides,
  };
}
function failRequest(
  lease: OutboxLease,
  overrides: Partial<Parameters<ServiceOutboxStore["fail"]>[0]> = {},
): Parameters<ServiceOutboxStore["fail"]>[0] {
  return {
    outboxId: lease.record.outboxId,
    workerId: lease.workerId,
    expectedAttempt: lease.record.attempt,
    leaseToken: lease.record.leaseToken,
    errorTag: "fatal",
    certainty: "not_applied",
    retryAt: null,
    failedAt: "2026-08-13T10:00:30.000Z",
    ...overrides,
  };
}
function unknownRequest(
  lease: OutboxLease,
  overrides: Partial<Parameters<ServiceOutboxStore["markUnknown"]>[0]> = {},
): Parameters<ServiceOutboxStore["markUnknown"]>[0] {
  return {
    outboxId: lease.record.outboxId,
    workerId: lease.workerId,
    expectedAttempt: lease.record.attempt,
    leaseToken: lease.record.leaseToken,
    errorTag: "ambiguous",
    certainty: "unknown",
    observedAt: "2026-08-13T10:00:30.000Z",
    ...overrides,
  };
}

const cases: readonly ParameterisedContractCase<ServiceOutboxContractSubject>[] =
  Object.freeze([
    {
      name: "EF-S05-C1 concurrent workers claim one lease owner",
      async run({ subject }) {
        await subject.store.enqueue(enqueue("c1"));
        const [a, b] = await Promise.all([
          subject.store.claimNext(claim("c1-a")),
          subject.store.claimNext(claim("c1-b")),
        ]);
        assert(a.ok && b.ok, "claims bounded");
        assert(
          Number(!!a.value.lease) + Number(!!b.value.lease) === 1,
          "one owner",
        );
      },
    },
    {
      name: "EF-S05-C2 every state edge is bounded",
      async run({ subject }) {
        const completed = await seedLease(subject.store, "c2-complete");
        assert(
          (await subject.store.complete(complete(completed))).ok,
          "complete",
        );
        const failed = await seedLease(subject.store, "c2-fail");
        const f = await subject.store.fail(failRequest(failed));
        assert(
          f.ok &&
            f.value.decision === "applied" &&
            f.value.record.state === "failed",
          "fail",
        );
        const unknown = await seedLease(subject.store, "c2-unknown");
        const u = await subject.store.markUnknown(unknownRequest(unknown));
        assert(
          u.ok &&
            u.value.decision === "applied" &&
            u.value.record.state === "unknown",
          "unknown",
        );
        const resolved = await subject.store.resolveUnknown({
          outboxId: "c2-unknown",
          expectedAttempt: 1,
          reconciliationRef: "opaque:reconciliation",
          reconciledAt: "2026-08-13T10:02:00.000Z",
          resolution: { kind: "cancelled", reasonTag: "operator" },
        });
        assert(
          resolved.ok &&
            resolved.value.decision === "applied" &&
            resolved.value.record.state === "cancelled",
          "cancelled",
        );
        const invalid = await subject.store.complete(
          complete(completed, { completedAt: "2026-08-13T10:00:31.000Z" }),
        );
        assert(
          invalid.ok && invalid.value.decision === "stale",
          "edge bounded",
        );
      },
    },
    {
      name: "EF-S05-C3 expired repeatable work can be reclaimed by policy",
      async run({ subject }) {
        const lease = await seedLease(subject.store, "c3");
        const request: ReclaimOutboxRequest = {
          outboxId: "c3",
          expectedAttempt: lease.record.attempt,
          workerId: "worker:new",
          leaseToken: "lease:new",
          now: "2026-08-13T10:02:00.000Z",
          leaseExpiresAt: "2026-08-13T10:03:00.000Z",
          authority: { kind: "repeatable" },
        };
        const reclaimed = await subject.store.reclaim(request);
        assert(
          reclaimed.ok &&
            reclaimed.value.decision === "applied" &&
            reclaimed.value.record.attempt === 2,
          "reclaimed",
        );
        const replay = await subject.store.reclaim(request);
        assert(replay.ok && replay.value.decision === "replayed", "replay");
      },
    },
    {
      name: "EF-S05-C4 stale completion and failure tokens are no-ops",
      async run({ subject }) {
        const lease = await seedLease(subject.store, "c4");
        const staleComplete = await subject.store.complete(
          complete(lease, { leaseToken: "lease:stale" }),
        );
        assert(
          staleComplete.ok && staleComplete.value.decision === "stale",
          "complete stale",
        );
        const staleFail = await subject.store.fail(
          failRequest(lease, { leaseToken: "lease:stale", errorTag: "error" }),
        );
        assert(
          staleFail.ok && staleFail.value.decision === "stale",
          "fail stale",
        );
        const row = await subject.store.get("c4");
        assert(row.ok && row.value?.state === "started", "unchanged");
      },
    },
    {
      name: "EF-S05-C5 duplicate equal intent replays and conflict errors",
      async run({ subject }) {
        const request = enqueue("c5");
        const first = await subject.store.enqueue(request),
          equal = await subject.store.enqueue(request);
        assert(
          first.ok && equal.ok && equal.value.decision === "replayed",
          "equal",
        );
        const conflict = await subject.store.enqueue(
          enqueue("other", { outboxId: "c5" }),
        );
        assert(
          !conflict.ok && conflict.error._tag === "idempotency_conflict",
          "conflict",
        );
      },
    },
    {
      name: "EF-S05-C6 crash before effect preserves pending intent",
      async run(fixture) {
        await fixture.subject.store.enqueue(enqueue("c6"));
        fixture.subject.planFault?.("claimNext", "before_effect", 1);
        const failed = await fixture.subject.store.claimNext(claim("c6"));
        assert(
          !failed.ok && failed.error.certainty === "not_applied",
          "rollback",
        );
        await fixture.crashAndRestore();
        const row = await fixture.subject.store.get("c6");
        assert(
          row.ok && row.value?.state === "pending" && row.value.attempt === 0,
          "pending",
        );
      },
    },
    {
      name: "EF-S05-C7 effect before acknowledgement becomes unknown until reconciliation",
      async run(fixture) {
        const lease = await seedLease(fixture.subject.store, "c7");
        fixture.subject.planFault?.(
          "markUnknown",
          "effect_then_lost_acknowledgement",
          1,
        );
        const request = unknownRequest(lease, { errorTag: "lost_ack" });
        const lost = await fixture.subject.store.markUnknown(request);
        assert(!lost.ok && lost.error.certainty === "unknown", "lost ack");
        await fixture.crashAndRestore();
        const row = await fixture.subject.store.get("c7");
        assert(row.ok && row.value?.state === "unknown", "unknown durable");
        const ordinary = await fixture.subject.store.claimNext(
          claim("c7-other", {
            now: "2026-08-13T10:05:00.000Z",
            leaseExpiresAt: "2026-08-13T10:06:00.000Z",
          }),
        );
        assert(ordinary.ok && !ordinary.value.lease, "not claimable");
        const replay = await fixture.subject.store.markUnknown(request);
        assert(
          replay.ok && replay.value.decision === "replayed",
          "result replay",
        );
      },
    },
    {
      name: "EF-S05-C8 poison payload fails without blocking bounded cleanup",
      async run({ subject }) {
        const lease = await seedLease(subject.store, "c8", undefined, {
          payloadRef: "opaque:poison",
        });
        await subject.store.fail(
          failRequest(lease, { errorTag: "invalid_payload" }),
        );
        const cleaned = await subject.store.cleanupTerminal({
          cleanupId: "cleanup:c8",
          before: "2026-08-13T11:00:00.000Z",
          after: null,
          limit: 1,
        });
        assert(
          cleaned.ok && cleaned.value.result.deletedCount === 1,
          "cleaned",
        );
        const gone = await subject.store.get("c8");
        assert(gone.ok && gone.value === null, "gone");
      },
    },
    {
      name: "EF-S05-R01 every durable mutation survives lost acknowledgement and fresh restore",
      async run(fixture) {
        const lostAndReplay = async (
          method: ServiceOutboxMutationMethod,
          invoke: () => ReturnType<
            ServiceOutboxStore[ServiceOutboxMutationMethod]
          >,
        ) => {
          assert(fixture.subject.planFault, "fault planning available");
          fixture.subject.planFault(
            method,
            "effect_then_lost_acknowledgement",
            1,
          );
          const lost = await invoke();
          assert(
            !lost.ok &&
              lost.error._tag === "storage_unavailable" &&
              lost.error.certainty === "unknown",
            `${method} lost acknowledgement`,
          );
          await fixture.crashAndRestore();
          const replay = await invoke();
          assert(
            replay.ok && replay.value.decision === "replayed",
            `${method} durable replay`,
          );
          return replay;
        };

        const enqueueRequest = enqueue("r01-enqueue");
        await lostAndReplay("enqueue", () =>
          fixture.subject.store.enqueue(enqueueRequest),
        );
        const enqueuedClaim = await fixture.subject.store.claimNext(
          claim("r01-enqueue-consume"),
        );
        assert(
          enqueuedClaim.ok && enqueuedClaim.value.lease,
          "enqueue consume",
        );
        await fixture.subject.store.fail(
          failRequest(enqueuedClaim.value.lease, {
            errorTag: "enqueue-covered",
          }),
        );

        const emptyRequest = claim("r01-empty", { kinds: ["notification"] });
        assert(fixture.subject.planFault, "fault planning available");
        fixture.subject.planFault(
          "claimNext",
          "effect_then_lost_acknowledgement",
          1,
        );
        const emptyLost = await fixture.subject.store.claimNext(emptyRequest);
        assert(
          (!emptyLost.ok && emptyLost.error._tag === "storage_unavailable") ||
            (emptyLost.ok && emptyLost.value.lease === null),
          "empty claim lost response is bounded",
        );
        await fixture.crashAndRestore();
        const emptyReplay = await fixture.subject.store.claimNext(emptyRequest);
        assert(
          emptyReplay.ok &&
            emptyReplay.value.decision === "replayed" &&
            emptyReplay.value.lease === null,
          "empty claim durable replay",
        );

        await fixture.subject.store.enqueue(enqueue("r01-claim"));
        const claimRequest = claim("r01-claim");
        const claimReplay = await lostAndReplay("claimNext", () =>
          fixture.subject.store.claimNext(claimRequest),
        );
        assert(
          claimReplay.ok &&
            "lease" in claimReplay.value &&
            claimReplay.value.lease?.record.state === "started",
          "nonempty claim replay state",
        );
        await fixture.subject.store.fail(
          failRequest(claimReplay.value.lease, { errorTag: "claim-covered" }),
        );

        const reclaimLease = await seedLease(
          fixture.subject.store,
          "r01-reclaim",
        );
        const reclaimRequest: ReclaimOutboxRequest = {
          outboxId: "r01-reclaim",
          expectedAttempt: reclaimLease.record.attempt,
          workerId: "worker:r01-reclaim",
          leaseToken: "lease:r01-reclaim-new",
          now: "2026-08-13T10:02:00.000Z",
          leaseExpiresAt: "2026-08-13T10:03:00.000Z",
          authority: { kind: "repeatable" },
        };
        await lostAndReplay("reclaim", () =>
          fixture.subject.store.reclaim(reclaimRequest),
        );

        const completedLease = await seedLease(
          fixture.subject.store,
          "r01-complete",
        );
        const completedRequest = complete(completedLease);
        await lostAndReplay("complete", () =>
          fixture.subject.store.complete(completedRequest),
        );

        for (const [id, retryAt] of [
          ["r01-retryable", "2026-08-13T10:02:00.000Z"],
          ["r01-fatal", null],
        ] as const) {
          const lease = await seedLease(fixture.subject.store, id);
          const request = failRequest(lease, { retryAt });
          await lostAndReplay("fail", () =>
            fixture.subject.store.fail(request),
          );
        }

        const unknownLease = await seedLease(
          fixture.subject.store,
          "r01-unknown",
          undefined,
          { repeatability: "reconciliation_required" },
        );
        const unknownRequestValue = unknownRequest(unknownLease, {
          errorTag: "external_ambiguous",
        });
        await lostAndReplay("markUnknown", () =>
          fixture.subject.store.markUnknown(unknownRequestValue),
        );

        for (const [id, resolution] of [
          [
            "r01-resolve-applied",
            { kind: "applied" as const, receiptRef: "receipt:r01" },
          ],
          [
            "r01-resolve-failed",
            {
              kind: "not_applied" as const,
              errorTag: "retryable",
              retryAt: "2026-08-13T10:03:00.000Z",
            },
          ],
          [
            "r01-resolve-cancelled",
            { kind: "cancelled" as const, reasonTag: "operator" },
          ],
        ] as const) {
          const lease = await seedLease(fixture.subject.store, id);
          await fixture.subject.store.markUnknown(unknownRequest(lease));
          const request = {
            outboxId: id,
            expectedAttempt: 1,
            reconciliationRef: `reconciliation:${id}`,
            reconciledAt: "2026-08-13T10:02:00.000Z",
            resolution,
          };
          await lostAndReplay("resolveUnknown", () =>
            fixture.subject.store.resolveUnknown(request),
          );
        }

        const cleanupLease = await seedLease(
          fixture.subject.store,
          "r01-cleanup",
        );
        await fixture.subject.store.fail(failRequest(cleanupLease));
        const cleanupRequest = {
          cleanupId: "cleanup:r01",
          before: "2026-08-13T11:00:00.000Z",
          after: null,
          limit: 10,
        };
        const cleanupReplay = await lostAndReplay("cleanupTerminal", () =>
          fixture.subject.store.cleanupTerminal(cleanupRequest),
        );
        assert(
          cleanupReplay.ok &&
            "result" in cleanupReplay.value &&
            cleanupReplay.value.result.deletedIds.includes("r01-cleanup"),
          "cleanup durable result",
        );
      },
    },
    {
      name: "EF-S05-S01 claim order uses effective instant then outbox ID",
      async run({ subject }) {
        await subject.store.enqueue(
          enqueue("z", { availableAt: "2026-08-13T09:30:00.000Z" }),
        );
        await subject.store.enqueue(
          enqueue("a", { availableAt: "2026-08-13T09:30:00.000Z" }),
        );
        const result = await subject.store.claimNext(
          claim("order", {
            kinds: ["maintenance", "maintenance"] as readonly OutboxKind[],
          }),
        );
        assert(
          result.ok && result.value.lease?.record.outboxId === "a",
          "ordered",
        );
      },
    },
    {
      name: "EF-S05-S02 retryable failure is claimable while fatal and unknown stay terminal",
      async run({ subject }) {
        const retryable = await seedLease(subject.store, "s2-retryable");
        const failed = await subject.store.fail(
          failRequest(retryable, {
            errorTag: "retryable",
            retryAt: "2026-08-13T10:02:00.000Z",
          }),
        );
        assert(
          failed.ok &&
            failed.value.decision === "applied" &&
            failed.value.record.state === "failed" &&
            failed.value.record.certainty === "not_applied" &&
            failed.value.record.retryAt === "2026-08-13T10:02:00.000Z",
          "retryable failed state",
        );
        const reclaimed = await subject.store.claimNext(
          claim("s2-retry", {
            now: "2026-08-13T10:02:00.000Z",
            leaseExpiresAt: "2026-08-13T10:03:00.000Z",
          }),
        );
        assert(
          reclaimed.ok &&
            reclaimed.value.lease?.record.outboxId === "s2-retryable" &&
            reclaimed.value.lease.record.attempt === 2,
          "retryable claimed",
        );

        const fatal = await seedLease(subject.store, "s2-fatal", "s2-fatal");
        await subject.store.fail(
          failRequest(fatal, {
            errorTag: "fatal",
            failedAt: "2026-08-13T10:04:30.000Z",
          }),
        );
        const unknown = await seedLease(
          subject.store,
          "s2-unknown",
          "s2-unknown",
        );
        await subject.store.markUnknown(
          unknownRequest(unknown, {
            observedAt: "2026-08-13T10:05:30.000Z",
          }),
        );
        const excluded = await subject.store.claimNext(
          claim("s2-excluded", {
            now: "2026-08-13T12:00:00.000Z",
            leaseExpiresAt: "2026-08-13T12:01:00.000Z",
          }),
        );
        assert(
          excluded.ok && excluded.value.lease === null,
          "terminal excluded",
        );
      },
    },
    {
      name: "EF-S05-S03 all unknown reconciliation outcomes preserve correlations",
      async run(fixture) {
        const scenarios = [
          {
            id: "s3-applied",
            resolution: { kind: "applied" as const, receiptRef: "receipt:s3" },
            state: "completed",
            certainty: "applied",
          },
          {
            id: "s3-retryable",
            resolution: {
              kind: "not_applied" as const,
              errorTag: "retryable",
              retryAt: "2026-08-13T10:03:00.000Z",
            },
            state: "failed",
            certainty: "not_applied",
          },
          {
            id: "s3-fatal",
            resolution: {
              kind: "not_applied" as const,
              errorTag: "fatal",
              retryAt: null,
            },
            state: "failed",
            certainty: "not_applied",
          },
          {
            id: "s3-cancelled",
            resolution: { kind: "cancelled" as const, reasonTag: "operator" },
            state: "cancelled",
            certainty: "not_applied",
          },
        ];
        for (const scenario of scenarios) {
          const lease = await seedLease(fixture.subject.store, scenario.id);
          await fixture.subject.store.markUnknown(unknownRequest(lease));
          const resolved = await fixture.subject.store.resolveUnknown({
            outboxId: scenario.id,
            expectedAttempt: 1,
            reconciliationRef: `reconciliation:${scenario.id}`,
            reconciledAt: "2026-08-13T10:02:00.000Z",
            resolution: scenario.resolution,
          });
          assert(
            resolved.ok &&
              resolved.value.decision === "applied" &&
              resolved.value.record.state === scenario.state &&
              resolved.value.record.certainty === scenario.certainty &&
              resolved.value.record.reconciledAt ===
                "2026-08-13T10:02:00.000Z" &&
              resolved.value.record.reconciliationRef ===
                `reconciliation:${scenario.id}`,
            "resolution correlation",
          );
        }
        await fixture.crashAndRestore();
        for (const scenario of scenarios) {
          const row = await fixture.subject.store.get(scenario.id);
          assert(
            row.ok &&
              row.value?.state === scenario.state &&
              row.value.certainty === scenario.certainty,
            "restored resolution",
          );
        }
      },
    },
    {
      name: "EF-S05-S04 unknown listing uses closed filtering and tuple pagination",
      async run({ subject }) {
        const specifications = [
          {
            id: "s4-a",
            kind: "maintenance" as const,
            observedAt: "2026-08-13T10:00:20.000Z",
          },
          {
            id: "s4-b",
            kind: "notification" as const,
            observedAt: "2026-08-13T10:00:20.000Z",
          },
          {
            id: "s4-c",
            kind: "maintenance" as const,
            observedAt: "2026-08-13T10:00:21.000Z",
          },
        ];
        for (const specification of specifications) {
          const inserted = await subject.store.enqueue(
            enqueue(specification.id, { kind: specification.kind }),
          );
          assert(inserted.ok, "list seed enqueue");
          const claimed = await subject.store.claimNext(
            claim(specification.id, { kinds: [specification.kind] }),
          );
          assert(claimed.ok && claimed.value.lease, "list seed claim");
          await subject.store.markUnknown(
            unknownRequest(claimed.value.lease, {
              observedAt: specification.observedAt,
            }),
          );
        }
        const first = await subject.store.listUnknown({
          kinds: ["maintenance", "notification"],
          after: null,
          limit: 2,
        });
        assert(first.ok, "first unknown page");
        assert(
          first.value.records.map((record) => record.outboxId).join(",") ===
            "s4-a,s4-b",
          "tuple order",
        );
        assert(
          first.value.nextCursor?.outboxId === "s4-b",
          "exact-page cursor",
        );
        const second = await subject.store.listUnknown({
          kinds: ["maintenance", "notification"],
          after: first.value.nextCursor,
          limit: 2,
        });
        assert(second.ok, "second unknown page");
        assert(
          second.value.records.map((record) => record.outboxId).join(",") ===
            "s4-c",
          "exclusive page",
        );
        assert(second.value.nextCursor === null, "final cursor");
        const filtered = await subject.store.listUnknown({
          kinds: ["notification"],
          after: null,
          limit: 10,
        });
        assert(
          filtered.ok &&
            filtered.value.records.length === 1 &&
            filtered.value.records[0]?.outboxId === "s4-b",
          "kind filter",
        );
        for (const malformed of [
          { kinds: [], after: null, limit: 1 },
          { kinds: ["maintenance"], after: null, limit: 0 },
          { kinds: ["maintenance"], after: null, limit: 101 },
          {
            kinds: ["maintenance"],
            after: { stateChangedAt: "bad", outboxId: "x" },
            limit: 1,
          },
        ]) {
          const result = await subject.store.listUnknown(
            malformed as Parameters<ServiceOutboxStore["listUnknown"]>[0],
          );
          assert(
            !result.ok && result.error._tag === "invalid_request",
            "hostile list rejected",
          );
        }
      },
    },
    {
      name: "EF-S05-S05 cleanup pages preserve cutoff cursor and replay",
      async run({ subject }) {
        for (const id of ["s5-a", "s5-b", "s5-c"]) {
          const lease = await seedLease(subject.store, id);
          await subject.store.fail(failRequest(lease));
        }
        const firstRequest = {
          cleanupId: "cleanup:s5:first",
          before: "2026-08-13T10:00:31.000Z",
          after: null,
          limit: 2,
        };
        const first = await subject.store.cleanupTerminal(firstRequest);
        assert(
          first.ok && first.value.result.deletedCount === 2,
          "first cleanup page",
        );
        assert(
          first.value.result.deletedIds.join(",") === "s5-a,s5-b",
          "cleanup ordering",
        );
        const second = await subject.store.cleanupTerminal({
          cleanupId: "cleanup:s5:second",
          before: "2026-08-13T10:00:31.000Z",
          after: first.value.result.nextCursor,
          limit: 2,
        });
        assert(
          second.ok && second.value.result.deletedIds.join(",") === "s5-c",
          "second cleanup page",
        );
        const replay = await subject.store.cleanupTerminal(firstRequest);
        assert(
          replay.ok && replay.value.decision === "replayed",
          "cleanup replay",
        );
        assert(
          replay.value.result.deletedIds.join(",") === "s5-a,s5-b",
          "cleanup replay result",
        );
      },
    },
    {
      name: "EF-S05-S06 reconciled-absent authority reclaims non-repeatable",
      async run({ subject }) {
        const lease = await seedLease(subject.store, "s2", undefined, {
          repeatability: "reconciliation_required",
        });
        const base = {
          outboxId: "s2",
          expectedAttempt: 1,
          workerId: "worker:s2",
          leaseToken: "lease:s2-new",
          now: "2026-08-13T10:02:00.000Z",
          leaseExpiresAt: "2026-08-13T10:03:00.000Z",
        };
        const accepted = await subject.store.reclaim({
          ...base,
          workerId: "worker:s2-reconciled",
          leaseToken: "lease:s2-reconciled",
          authority: {
            kind: "reconciled_absent",
            reconciliationRef: "opaque:absent",
          },
        });
        assert(
          accepted.ok &&
            accepted.value.decision === "applied" &&
            accepted.value.record.attempt === lease.record.attempt + 1,
          "accepted",
        );
      },
    },
  ]);
export const SERVICE_OUTBOX_STORE_CONTRACT_CASE_NAMES = Object.freeze(
  cases.map((entry) => entry.name),
);
export function defineServiceOutboxStoreContract(
  factory: ContractSubjectFactory<ServiceOutboxContractSubject>,
  context: () => ContractTestContext,
) {
  return runParameterisedContractSuite(factory, cases, context, (subject) =>
    subject.dispose?.(),
  );
}
