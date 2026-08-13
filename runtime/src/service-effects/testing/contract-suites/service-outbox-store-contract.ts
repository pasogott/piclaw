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
			name: "EF-S05-R01 restore never auto-retries unknown work",
			async run(fixture) {
				const lease = await seedLease(fixture.subject.store, "r01", undefined, {
					repeatability: "reconciliation_required",
				});
				await fixture.subject.store.markUnknown(
					unknownRequest(lease, { errorTag: "external_ambiguous" }),
				);
				await fixture.crashAndRestore();
				const claimResult = await fixture.subject.store.claimNext(
					claim("r01-next", {
						now: "2026-08-13T12:00:00.000Z",
						leaseExpiresAt: "2026-08-13T12:01:00.000Z",
					}),
				);
				assert(
					claimResult.ok && claimResult.value.lease === null,
					"unknown blocked",
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
			name: "EF-S05-S02 reconciled-absent authority reclaims non-repeatable",
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
