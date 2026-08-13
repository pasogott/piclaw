import {
	Result,
	type Result as ResultValue,
} from "@earendil-works/pi-agent-core";
import type {
	EffectCertainty,
	NormalisedTraceInput,
} from "../../contracts/common.js";
import type {
	ClaimOutboxRequest,
	CleanupTerminalOutboxRequest,
	CompleteOutboxRequest,
	EnqueueOutboxRequest,
	FailOutboxRequest,
	ListUnknownOutboxRequest,
	ListUnknownOutboxResult,
	MarkOutboxUnknownRequest,
	OutboxClaimDecision,
	OutboxCleanupDecision,
	OutboxEnqueueDecision,
	OutboxLease,
	OutboxMutationDecision,
	OutboxRecord,
	OutboxStoreError,
	OutboxStoreErrorTag,
	ReclaimOutboxRequest,
	ResolveUnknownOutboxRequest,
	ServiceOutboxStore,
} from "../../contracts/service-outbox-store.js";
import type { ContractTestContext } from "../contract-suite.js";
import { EffectTraceRecorder } from "../trace-recorder.js";
import {
	type FakeOutboxMutationMethod,
	hashFakeOutboxRequest,
	normaliseFakeOutboxId,
	normaliseFakeOutboxList,
	normaliseFakeOutboxMutation,
} from "./fake-service-outbox-request-normalizer.js";

type Decision = {
	method: string;
	hash: string;
	value: unknown;
	outboxId: string | null;
	token: string | null;
};
interface State {
	records: Record<string, OutboxRecord>;
	decisions: Record<string, Decision>;
}
export class FakeServiceOutboxStore implements ServiceOutboxStore {
	readonly trace = new EffectTraceRecorder();
	#state: State = { records: {}, decisions: {} };
	#serial = Promise.resolve();
	#faults = new Map<string, Set<number>>();
	#counts = new Map<string, number>();
	constructor(
		private readonly context: ContractTestContext,
		private readonly observer: (input: NormalisedTraceInput) => void = () =>
			undefined,
	) {}
	planFault(
		method: string,
		point: "before_effect" | "effect_then_lost_acknowledgement",
		occurrence = 1,
	) {
		const k = `${method}:${point}`,
			n = this.#counts.get(k) ?? 0;
		this.#faults.set(k, new Set([n + occurrence]));
	}
	snapshot(): State {
		return structuredClone(this.#state);
	}
	restore(snapshot: State) {
		this.#state = structuredClone(snapshot);
		this.#faults.clear();
		this.#counts.clear();
	}
	inspectState() {
		return structuredClone(this.#state);
	}
	enqueue(
		input: EnqueueOutboxRequest,
	): Promise<ResultValue<OutboxEnqueueDecision, OutboxStoreError>> {
		return this.mutate<OutboxEnqueueDecision>("enqueue", input, (q) => {
			const r = q as EnqueueOutboxRequest,
				k = `enqueue:${r.kind}:${r.effect.idempotencyKey}`,
				known = this.#state.decisions[k];
			if (known)
				return known.method === "enqueue" && known.hash === r.effect.requestHash
					? Result.ok(replay(known.value))
					: Result.err(err("idempotency_conflict"));
			if (this.#state.records[r.outboxId])
				return Result.err(err("idempotency_conflict"));
			const record = freeze({
				outboxId: r.outboxId,
				kind: r.kind,
				state: "pending",
				idempotencyKey: r.effect.idempotencyKey,
				requestHash: r.effect.requestHash,
				operationId: r.effect.operationId,
				sourceSeq: r.effect.sourceSeq,
				provenanceRef: r.effect.provenanceRef,
				redactionClass: r.effect.redactionClass,
				payloadRef: r.payloadRef,
				destinationRef: r.destinationRef,
				availableAt: r.availableAt,
				enqueuedAt: r.enqueuedAt,
				stateChangedAt: r.enqueuedAt,
				repeatability: r.repeatability,
				attempt: 0,
				workerId: null,
				claimedAt: null,
				leaseToken: null,
				leaseExpiresAt: null,
				certainty: "not_applied",
				retryAt: null,
				receiptRef: null,
				lastErrorTag: null,
				resultAt: null,
				reconciliationRef: null,
				reconciledAt: null,
				cancellationReasonTag: null,
			} as OutboxRecord);
			this.#state.records[r.outboxId] = record;
			const value = freeze({ decision: "applied" as const, record });
			this.decision(
				k,
				"enqueue",
				r.effect.requestHash,
				value,
				r.outboxId,
				null,
			);
			return Result.ok(value);
		});
	}
	claimNext(
		input: ClaimOutboxRequest,
	): Promise<ResultValue<OutboxClaimDecision, OutboxStoreError>> {
		return this.mutate<OutboxClaimDecision>("claimNext", input, (q) => {
			const r = q as ClaimOutboxRequest,
				h = hashFakeOutboxRequest(r),
				k = `claim:${r.leaseToken}`,
				known = this.#state.decisions[k];
			if (known)
				return known.method === "claimNext" && known.hash === h
					? Result.ok(replay(known.value))
					: Result.err(err("idempotency_conflict"));
			if (this.tokenUsed(r.leaseToken))
				return Result.err(err("idempotency_conflict"));
			const row = Object.values(this.#state.records)
				.filter(
					(x) =>
						r.kinds.includes(x.kind) &&
						((x.state === "pending" && x.availableAt <= r.now) ||
							(x.state === "failed" &&
								x.retryAt !== null &&
								x.retryAt <= r.now)),
				)
				.sort(
					(a, b) =>
						effective(a).localeCompare(effective(b)) ||
						a.outboxId.localeCompare(b.outboxId),
				)[0];
			let value: OutboxClaimDecision,
				outboxId: string | null = null;
			if (!row) value = freeze({ decision: "empty", lease: null });
			else {
				outboxId = row.outboxId;
				const record = this.replace(row, {
					state: "started",
					stateChangedAt: r.now,
					attempt: row.attempt + 1,
					workerId: r.workerId,
					claimedAt: r.now,
					leaseToken: r.leaseToken,
					leaseExpiresAt: r.leaseExpiresAt,
					certainty: null,
					retryAt: null,
					receiptRef: null,
					lastErrorTag: null,
					resultAt: null,
					reconciledAt: null,
					cancellationReasonTag: null,
				});
				value = freeze({
					decision: "applied",
					lease: freeze({
						record: record as OutboxLease["record"],
						workerId: r.workerId,
					}),
				});
			}
			this.decision(k, "claimNext", h, value, outboxId, r.leaseToken);
			return Result.ok(value);
		});
	}
	reclaim(
		input: ReclaimOutboxRequest,
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.mutate<OutboxMutationDecision>("reclaim", input, (q) => {
			const r = q as ReclaimOutboxRequest,
				h = hashFakeOutboxRequest(r),
				k = `reclaim:${r.outboxId}:${r.expectedAttempt}`,
				known = this.#state.decisions[k];
			if (known)
				return known.method === "reclaim" && known.hash === h
					? Result.ok(replay(known.value))
					: Result.err(err("idempotency_conflict"));
			if (this.tokenUsed(r.leaseToken))
				return Result.err(err("idempotency_conflict"));
			const row = this.#state.records[r.outboxId];
			if (!row) return Result.err(err("not_found"));
			const ok =
				row.state === "started" &&
				row.attempt === r.expectedAttempt &&
				!!row.leaseExpiresAt &&
				row.leaseExpiresAt <= r.now &&
				((r.authority.kind === "repeatable" &&
					row.repeatability === "repeatable") ||
					r.authority.kind === "reconciled_absent");
			const value = ok
				? applied(
						this.replace(row, {
							stateChangedAt: r.now,
							attempt: row.attempt + 1,
							workerId: r.workerId,
							claimedAt: r.now,
							leaseToken: r.leaseToken,
							leaseExpiresAt: r.leaseExpiresAt,
							reconciliationRef:
								r.authority.kind === "reconciled_absent"
									? r.authority.reconciliationRef
									: row.reconciliationRef,
						}),
					)
				: stale();
			this.decision(k, "reclaim", h, value, r.outboxId, r.leaseToken);
			return Result.ok(value);
		});
	}
	complete(
		input: CompleteOutboxRequest,
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.worker("complete", input, (r) => ({
			state: "completed",
			certainty: "applied",
			at: r.completedAt,
			receiptRef: r.receiptRef,
			errorTag: null,
			retryAt: null,
		}));
	}
	fail(
		input: FailOutboxRequest,
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.worker("fail", input, (r) => ({
			state: "failed",
			certainty: "not_applied",
			at: r.failedAt,
			receiptRef: null,
			errorTag: r.errorTag,
			retryAt: r.retryAt,
		}));
	}
	markUnknown(
		input: MarkOutboxUnknownRequest,
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.worker("markUnknown", input, (r) => ({
			state: "unknown",
			certainty: "unknown",
			at: r.observedAt,
			receiptRef: null,
			errorTag: r.errorTag,
			retryAt: null,
		}));
	}
	resolveUnknown(
		input: ResolveUnknownOutboxRequest,
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.mutate<OutboxMutationDecision>("resolveUnknown", input, (q) => {
			const r = q as ResolveUnknownOutboxRequest,
				h = hashFakeOutboxRequest(r),
				k = `resolve:${r.outboxId}:${r.expectedAttempt}`,
				known = this.#state.decisions[k];
			if (known)
				return known.method === "resolveUnknown" && known.hash === h
					? Result.ok(replay(known.value))
					: Result.err(err("idempotency_conflict"));
			const row = this.#state.records[r.outboxId];
			if (!row) return Result.err(err("not_found"));
			let value: OutboxMutationDecision;
			if (row.state !== "unknown" || row.attempt !== r.expectedAttempt)
				value = stale();
			else if (r.resolution.kind === "applied")
				value = applied(
					this.replace(row, {
						state: "completed",
						stateChangedAt: r.reconciledAt,
						certainty: "applied",
						receiptRef: r.resolution.receiptRef,
						lastErrorTag: null,
						retryAt: null,
						resultAt: r.reconciledAt,
						reconciliationRef: r.reconciliationRef,
						reconciledAt: r.reconciledAt,
						cancellationReasonTag: null,
					}),
				);
			else if (r.resolution.kind === "not_applied")
				value = applied(
					this.replace(row, {
						state: "failed",
						stateChangedAt: r.reconciledAt,
						certainty: "not_applied",
						receiptRef: null,
						lastErrorTag: r.resolution.errorTag,
						retryAt: r.resolution.retryAt,
						resultAt: r.reconciledAt,
						reconciliationRef: r.reconciliationRef,
						reconciledAt: r.reconciledAt,
						cancellationReasonTag: null,
					}),
				);
			else
				value = applied(
					this.replace(row, {
						state: "cancelled",
						stateChangedAt: r.reconciledAt,
						certainty: "not_applied",
						receiptRef: null,
						lastErrorTag: null,
						retryAt: null,
						resultAt: r.reconciledAt,
						reconciliationRef: r.reconciliationRef,
						reconciledAt: r.reconciledAt,
						cancellationReasonTag: r.resolution.reasonTag,
					}),
				);
			this.decision(k, "resolveUnknown", h, value, r.outboxId, null);
			return Result.ok(value);
		});
	}
	async get(
		input: string,
	): Promise<ResultValue<OutboxRecord | null, OutboxStoreError>> {
		const id = normaliseFakeOutboxId(input);
		return id
			? Result.ok(this.#state.records[id] ?? null)
			: Result.err(err("invalid_request"));
	}
	async listUnknown(
		input: ListUnknownOutboxRequest,
	): Promise<ResultValue<ListUnknownOutboxResult, OutboxStoreError>> {
		const r = normaliseFakeOutboxList(input);
		if (!r) return Result.err(err("invalid_request"));
		const rows = Object.values(this.#state.records)
				.filter(
					(x) =>
						x.state === "unknown" &&
						r.kinds.includes(x.kind) &&
						(!r.after ||
							x.stateChangedAt > r.after.stateChangedAt ||
							(x.stateChangedAt === r.after.stateChangedAt &&
								x.outboxId > r.after.outboxId)),
				)
				.sort(order)
				.slice(0, r.limit),
			last = rows.length === r.limit ? (rows.at(-1) ?? null) : null;
		return Result.ok(
			freeze({
				records: Object.freeze(rows),
				nextCursor: last
					? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
					: null,
			}),
		);
	}
	cleanupTerminal(
		input: CleanupTerminalOutboxRequest,
	): Promise<ResultValue<OutboxCleanupDecision, OutboxStoreError>> {
		return this.mutate<OutboxCleanupDecision>("cleanupTerminal", input, (q) => {
			const r = q as CleanupTerminalOutboxRequest,
				h = hashFakeOutboxRequest(r),
				k = `cleanup:${r.cleanupId}`,
				known = this.#state.decisions[k];
			if (known)
				return known.method === "cleanupTerminal" && known.hash === h
					? Result.ok(replay(known.value))
					: Result.err(err("idempotency_conflict"));
			const rows = Object.values(this.#state.records)
				.filter(
					(x) =>
						x.stateChangedAt < r.before &&
						(x.state === "cancelled" ||
							(x.state === "failed" &&
								x.certainty === "not_applied" &&
								x.retryAt === null)) &&
						(!r.after ||
							x.stateChangedAt > r.after.stateChangedAt ||
							(x.stateChangedAt === r.after.stateChangedAt &&
								x.outboxId > r.after.outboxId)),
				)
				.sort(order)
				.slice(0, r.limit);
			for (const row of rows) {
				delete this.#state.records[row.outboxId];
				for (const [key, d] of Object.entries(this.#state.decisions))
					if (d.outboxId === row.outboxId) delete this.#state.decisions[key];
			}
			const last = rows.length === r.limit ? (rows.at(-1) ?? null) : null,
				result = freeze({
					deletedIds: Object.freeze(rows.map((x) => x.outboxId)),
					deletedCount: rows.length,
					nextCursor: last
						? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
						: null,
				}),
				value = freeze({ decision: "applied" as const, result });
			this.decision(k, "cleanupTerminal", h, value, null, null);
			return Result.ok(value);
		});
	}
	private worker<
		T extends
			| CompleteOutboxRequest
			| FailOutboxRequest
			| MarkOutboxUnknownRequest,
	>(
		method: "complete" | "fail" | "markUnknown",
		input: T,
		map: (r: T) => {
			state: "completed" | "failed" | "unknown";
			certainty: EffectCertainty;
			at: string;
			receiptRef: string | null;
			errorTag: string | null;
			retryAt: string | null;
		},
	): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
		return this.mutate<OutboxMutationDecision>(method, input, (q) => {
			const r = q as T,
				h = hashFakeOutboxRequest(r),
				k = `outcome:${r.outboxId}:${r.expectedAttempt}`,
				known = this.#state.decisions[k];
			if (known) {
				if (known.method === method && known.hash === h)
					return Result.ok(replay(known.value));
				if ((known.value as { decision?: unknown }).decision !== "stale")
					return Result.ok(stale());
			}
			const row = this.#state.records[r.outboxId];
			if (!row) return Result.err(err("not_found"));
			const o = map(r),
				ok =
					row.state === "started" &&
					row.workerId === r.workerId &&
					row.attempt === r.expectedAttempt &&
					row.leaseToken === r.leaseToken &&
					!!row.leaseExpiresAt &&
					o.at < row.leaseExpiresAt,
				value = ok
					? applied(
							this.replace(row, {
								state: o.state,
								stateChangedAt: o.at,
								workerId: null,
								claimedAt: null,
								leaseToken: null,
								leaseExpiresAt: null,
								certainty: o.certainty,
								retryAt: o.retryAt,
								receiptRef: o.receiptRef,
								lastErrorTag: o.errorTag,
								resultAt: o.at,
								reconciledAt: null,
								cancellationReasonTag: null,
							}),
						)
					: stale();
			this.decision(k, method, h, value, r.outboxId, null);
			return Result.ok(value);
		});
	}
	private async mutate<T>(
		method: FakeOutboxMutationMethod,
		input: unknown,
		apply: (q: unknown) => ResultValue<T, OutboxStoreError>,
	): Promise<ResultValue<T, OutboxStoreError>> {
		const q = normaliseFakeOutboxMutation(method, input),
			before = this.#serial;
		let release!: () => void;
		this.#serial = new Promise((r) => (release = r));
		await before;
		try {
			this.observe(method, q, "call", null);
			if (!q) return this.finish(method, Result.err(err("invalid_request")));
			const snapshot = structuredClone(this.#state),
				value = apply(q);
			if (!value.ok) return this.finish(method, value);
			const pre = this.fault(method, "before_effect");
			if (!pre.ok) {
				this.#state = snapshot;
				return this.finish(method, Result.err(pre.error));
			}
			if (pre.injected) {
				this.#state = snapshot;
				return this.finish(
					method,
					Result.err(err("storage_unavailable", "not_applied", true)),
				);
			}
			const lost = this.fault(method, "effect_then_lost_acknowledgement");
			if (!lost.ok) return this.finish(method, Result.err(lost.error));
			if (lost.injected)
				return this.finish(
					method,
					Result.err(err("storage_unavailable", "unknown", true)),
				);
			return this.finish(method, value);
		} finally {
			release();
		}
	}
	private replace(row: OutboxRecord, patch: Partial<OutboxRecord>) {
		const next = freeze({ ...row, ...patch });
		this.#state.records[row.outboxId] = next;
		return next;
	}
	private decision(
		key: string,
		method: string,
		hash: string,
		value: unknown,
		outboxId: string | null,
		token: string | null,
	) {
		this.#state.decisions[key] = {
			method,
			hash,
			value: structuredClone(value),
			outboxId,
			token,
		};
	}
	private tokenUsed(token: string) {
		return Object.values(this.#state.decisions).some((d) => d.token === token);
	}
	private fault(
		method: string,
		point: "before_effect" | "effect_then_lost_acknowledgement",
	): { ok: true; injected: boolean } | { ok: false; error: OutboxStoreError } {
		try {
			const k = `${method}:${point}`,
				n = (this.#counts.get(k) ?? 0) + 1;
			this.#counts.set(k, n);
			const planned = this.#faults.get(k);
			const v = planned ? planned.has(n) : this.context.faults.hit(point);
			return typeof v === "boolean"
				? { ok: true, injected: v }
				: { ok: false, error: err("storage_unavailable", "not_applied", true) };
		} catch {
			return {
				ok: false,
				error: err("storage_unavailable", "not_applied", true),
			};
		}
	}
	private observe(
		method: string,
		q: unknown,
		resultTag: string,
		certainty: EffectCertainty | null,
	) {
		try {
			const r = q as {
				outboxId?: string;
				effect?: { operationId?: string | null; sourceSeq?: number | null };
				expectedAttempt?: number;
			};
			const input = {
				contract: "EF-S05",
				method,
				effectId: r?.outboxId ?? "invalid",
				operationId: r?.effect?.operationId ?? null,
				sourceSeq: r?.effect?.sourceSeq ?? null,
				version: r?.expectedAttempt ?? null,
				certainty,
				resultTag,
			};
			if (resultTag === "call") this.trace.recordCall(input);
			else this.trace.recordResult(input);
			this.observer(input);
		} catch {}
	}
	private finish<T>(method: string, r: ResultValue<T, OutboxStoreError>) {
		this.observe(
			method,
			null,
			r.ok ? tag(r.value) : r.error._tag,
			r.ok ? certainty(r.value) : r.error.certainty,
		);
		return r;
	}
}
function effective(r: OutboxRecord) {
	if (r.state === "pending") return r.availableAt;
	if (r.retryAt === null)
		throw new TypeError("Retryable row requires retryAt.");
	return r.retryAt;
}
function order(a: OutboxRecord, b: OutboxRecord) {
	return (
		a.stateChangedAt.localeCompare(b.stateChangedAt) ||
		a.outboxId.localeCompare(b.outboxId)
	);
}
function err(
	_tag: OutboxStoreErrorTag,
	certainty: EffectCertainty = "not_applied",
	retryable = false,
): OutboxStoreError {
	return freeze({ _tag, certainty, retryable });
}
function applied(record: OutboxRecord): OutboxMutationDecision {
	return freeze({ decision: "applied", record });
}
function stale(): OutboxMutationDecision {
	return freeze({ decision: "stale", record: null });
}
function replay<T>(input: unknown): T {
	const v = structuredClone(input) as Record<string, unknown>;
	if (v.decision === "applied" || v.decision === "empty")
		v.decision = "replayed";
	return freeze(v) as T;
}
function freeze<T>(v: T): T {
	if (v && typeof v === "object") {
		for (const x of Object.values(v)) freeze(x);
		Object.freeze(v);
	}
	return v;
}
function tag(v: unknown) {
	try {
		return typeof (v as { decision?: unknown })?.decision === "string"
			? (v as { decision: string }).decision
			: "ok";
	} catch {
		return "ok";
	}
}
function certainty(v: unknown): EffectCertainty | null {
	try {
		const x = v as { record?: OutboxRecord; lease?: OutboxLease };
		return (x.record ?? x.lease?.record)?.certainty ?? null;
	} catch {
		return null;
	}
}
