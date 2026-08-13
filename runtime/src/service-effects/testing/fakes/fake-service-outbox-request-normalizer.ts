import {
	type CanonicalJsonValue,
	type EffectIdentity,
	hashCanonicalRequest,
} from "../../contracts/common.js";
import {
	type ClaimOutboxRequest,
	type CleanupTerminalOutboxRequest,
	type CompleteOutboxRequest,
	type EnqueueOutboxRequest,
	type FailOutboxRequest,
	type ListUnknownOutboxRequest,
	type MarkOutboxUnknownRequest,
	OUTBOX_KINDS,
	type OutboxCursor,
	type OutboxKind,
	type ReclaimOutboxRequest,
	type ResolveUnknownOutboxRequest,
} from "../../contracts/service-outbox-store.js";

export type FakeOutboxMutationMethod =
	| "enqueue"
	| "claimNext"
	| "reclaim"
	| "complete"
	| "fail"
	| "markUnknown"
	| "resolveUnknown"
	| "cleanupTerminal";
export type NormalisedFakeOutboxMutation =
	| EnqueueOutboxRequest
	| ClaimOutboxRequest
	| ReclaimOutboxRequest
	| CompleteOutboxRequest
	| FailOutboxRequest
	| MarkOutboxUnknownRequest
	| ResolveUnknownOutboxRequest
	| CleanupTerminalOutboxRequest;
const K = new Set<string>(OUTBOX_KINDS),
	R = new Set(["public", "private", "secret"]),
	H = /^[0-9a-f]{64}$/;

export function normaliseFakeOutboxMutation(
	method: FakeOutboxMutationMethod,
	input: unknown,
): NormalisedFakeOutboxMutation | null {
	try {
		const value = rec(input);
		if (!value || !tree(input)) return null;
		const parsers: Record<
			FakeOutboxMutationMethod,
			(input: Record<string, unknown>) => NormalisedFakeOutboxMutation | null
		> = {
			enqueue: enq,
			claimNext: claim,
			reclaim,
			complete,
			fail,
			markUnknown: unknown,
			resolveUnknown: resolve,
			cleanupTerminal: cleanup,
		};
		const request = parsers[method](value);
		return request ? deep(request) : null;
	} catch (error) {
		void error;
		return null;
	}
}
export function normaliseFakeOutboxList(
	input: unknown,
): ListUnknownOutboxRequest | null {
	try {
		const v = rec(input);
		if (!v || !tree(input) || !keys(v, ["kinds", "after", "limit"]))
			return null;
		return deep({
			kinds: kinds(v.kinds),
			after: cursor(v.after),
			limit: limit(v.limit),
		});
	} catch (error) {
		void error;
		return null;
	}
}
export function normaliseFakeOutboxId(input: unknown): string | null {
	try {
		return txt(input);
	} catch (error) {
		void error;
		return null;
	}
}
export function hashFakeOutboxRequest(
	request: Exclude<NormalisedFakeOutboxMutation, EnqueueOutboxRequest>,
): string {
	return hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}
function enq(v: Record<string, unknown>): EnqueueOutboxRequest | null {
	if (
		!keys(v, [
			"effect",
			"outboxId",
			"kind",
			"payloadRef",
			"destinationRef",
			"availableAt",
			"enqueuedAt",
			"repeatability",
		])
	)
		return null;
	const effect = effectOf(v.effect),
		kind = enm(v.kind, K),
		repeatability = enm(
			v.repeatability,
			new Set(["repeatable", "reconciliation_required"]),
		);
	if (!effect || !kind || !repeatability) return null;
	const q: EnqueueOutboxRequest = {
		effect,
		outboxId: bounded(v.outboxId, 512),
		kind: kind as OutboxKind,
		payloadRef: bounded(v.payloadRef, 2048),
		destinationRef: nullableBounded(v.destinationRef, 2048),
		availableAt: instant(v.availableAt),
		enqueuedAt: instant(v.enqueuedAt),
		repeatability: repeatability as EnqueueOutboxRequest["repeatability"],
	};
	return hashCanonicalRequest(q as unknown as CanonicalJsonValue) ===
		effect.requestHash
		? q
		: null;
}
function claim(v: Record<string, unknown>): ClaimOutboxRequest | null {
	if (!keys(v, ["kinds", "workerId", "leaseToken", "now", "leaseExpiresAt"]))
		return null;
	const now = instant(v.now),
		leaseExpiresAt = instant(v.leaseExpiresAt);
	if (leaseExpiresAt <= now) return null;
	return {
		kinds: kinds(v.kinds),
		workerId: bounded(v.workerId, 512),
		leaseToken: bounded(v.leaseToken, 2048),
		now,
		leaseExpiresAt,
	};
}
function reclaim(v: Record<string, unknown>): ReclaimOutboxRequest | null {
	if (
		!keys(v, [
			"outboxId",
			"expectedAttempt",
			"workerId",
			"leaseToken",
			"now",
			"leaseExpiresAt",
			"authority",
		])
	)
		return null;
	const a = rec(v.authority);
	if (!a) return null;
	let authority: ReclaimOutboxRequest["authority"];
	if (keys(a, ["kind"]) && a.kind === "repeatable")
		authority = { kind: "repeatable" };
	else if (
		keys(a, ["kind", "reconciliationRef"]) &&
		a.kind === "reconciled_absent"
	)
		authority = {
			kind: "reconciled_absent",
			reconciliationRef: bounded(a.reconciliationRef, 2048),
		};
	else return null;
	const now = instant(v.now),
		leaseExpiresAt = instant(v.leaseExpiresAt);
	if (leaseExpiresAt <= now) return null;
	return {
		outboxId: bounded(v.outboxId, 512),
		expectedAttempt: int(v.expectedAttempt, 1),
		workerId: bounded(v.workerId, 512),
		leaseToken: bounded(v.leaseToken, 2048),
		now,
		leaseExpiresAt,
		authority,
	};
}
function worker(v: Record<string, unknown>, extra: string[]) {
	if (
		!keys(v, [
			"outboxId",
			"workerId",
			"expectedAttempt",
			"leaseToken",
			...extra,
		])
	)
		return null;
	return {
		outboxId: bounded(v.outboxId, 512),
		workerId: bounded(v.workerId, 512),
		expectedAttempt: int(v.expectedAttempt, 1),
		leaseToken: bounded(v.leaseToken, 2048),
	};
}
function complete(v: Record<string, unknown>): CompleteOutboxRequest | null {
	const b = worker(v, ["receiptRef", "completedAt"]);
	return b
		? {
				...b,
				receiptRef: nullableBounded(v.receiptRef, 2048),
				completedAt: instant(v.completedAt),
			}
		: null;
}
function fail(v: Record<string, unknown>): FailOutboxRequest | null {
	const b = worker(v, ["errorTag", "certainty", "retryAt", "failedAt"]);
	return b && v.certainty === "not_applied"
		? {
				...b,
				errorTag: tag(v.errorTag),
				certainty: "not_applied",
				retryAt: ninstant(v.retryAt),
				failedAt: instant(v.failedAt),
			}
		: null;
}
function unknown(v: Record<string, unknown>): MarkOutboxUnknownRequest | null {
	const b = worker(v, ["errorTag", "certainty", "observedAt"]);
	return b && v.certainty === "unknown"
		? {
				...b,
				errorTag: tag(v.errorTag),
				certainty: "unknown",
				observedAt: instant(v.observedAt),
			}
		: null;
}
function resolve(
	v: Record<string, unknown>,
): ResolveUnknownOutboxRequest | null {
	if (
		!keys(v, [
			"outboxId",
			"expectedAttempt",
			"reconciliationRef",
			"reconciledAt",
			"resolution",
		])
	)
		return null;
	const r = rec(v.resolution);
	if (!r) return null;
	let resolution: ResolveUnknownOutboxRequest["resolution"];
	if (keys(r, ["kind", "receiptRef"]) && r.kind === "applied")
		resolution = { kind: "applied", receiptRef: nullableBounded(r.receiptRef, 2048) };
	else if (keys(r, ["kind", "errorTag", "retryAt"]) && r.kind === "not_applied")
		resolution = {
			kind: "not_applied",
			errorTag: tag(r.errorTag),
			retryAt: ninstant(r.retryAt),
		};
	else if (keys(r, ["kind", "reasonTag"]) && r.kind === "cancelled")
		resolution = { kind: "cancelled", reasonTag: tag(r.reasonTag) };
	else return null;
	return {
		outboxId: bounded(v.outboxId, 512),
		expectedAttempt: int(v.expectedAttempt, 1),
		reconciliationRef: bounded(v.reconciliationRef, 2048),
		reconciledAt: instant(v.reconciledAt),
		resolution,
	};
}
function cleanup(
	v: Record<string, unknown>,
): CleanupTerminalOutboxRequest | null {
	if (!keys(v, ["cleanupId", "before", "after", "limit"])) return null;
	return {
		cleanupId: bounded(v.cleanupId, 512),
		before: instant(v.before),
		after: cursor(v.after),
		limit: limit(v.limit),
	};
}
function effectOf(input: unknown): EffectIdentity | null {
	const v = rec(input);
	if (
		!v ||
		!keys(v, [
			"idempotencyKey",
			"requestHash",
			"operationId",
			"sourceSeq",
			"provenanceRef",
			"redactionClass",
		])
	)
		return null;
	const hash =
			typeof v.requestHash === "string" && H.test(v.requestHash)
				? v.requestHash
				: null,
		redaction = enm(v.redactionClass, R);
	if (!hash || !redaction) return null;
	return {
		idempotencyKey: bounded(v.idempotencyKey, 512),
		requestHash: hash,
		operationId: nullableBounded(v.operationId, 512),
		sourceSeq: nint(v.sourceSeq, 0),
		provenanceRef: bounded(v.provenanceRef, 2048),
		redactionClass: redaction as EffectIdentity["redactionClass"],
	};
}
function kinds(input: unknown): readonly OutboxKind[] {
	if (
		!Array.isArray(input) ||
		!input.length ||
		Object.keys(input).length !== input.length
	)
		throw 0;
	const x = input.map((v) => enm(v, K));
	if (x.some((v) => !v)) throw 0;
	return Object.freeze([...new Set(x as OutboxKind[])].sort());
}
function cursor(input: unknown): OutboxCursor | null {
	if (input === null) return null;
	const v = rec(input);
	if (!v || !keys(v, ["stateChangedAt", "outboxId"])) throw 0;
	return {
		stateChangedAt: instant(v.stateChangedAt),
		outboxId: bounded(v.outboxId, 512),
	};
}
function rec(input: unknown): Record<string, unknown> | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const p = Object.getPrototypeOf(input);
	if (p !== Object.prototype && p !== null) return null;
	const o: Record<string, unknown> = {};
	for (const [k, d] of Object.entries(
		Object.getOwnPropertyDescriptors(input),
	)) {
		if (!("value" in d) || !d.enumerable) return null;
		o[k] = d.value;
	}
	return o;
}
function keys(v: Record<string, unknown>, e: string[]) {
	const a = Object.keys(v).sort(),
		b = [...e].sort();
	return a.length === b.length && a.every((x, i) => x === b[i]);
}
function tree(v: unknown, d = 0, s = new Set<object>()): boolean {
	if (d > 8) return false;
	if (v === null || typeof v === "string" || typeof v === "boolean")
		return true;
	if (typeof v === "number") return Number.isFinite(v);
	if (typeof v !== "object" || s.has(v)) return false;
	s.add(v);
	if (Array.isArray(v))
		return (
			Object.keys(v).length === v.length && v.every((x) => tree(x, d + 1, s))
		);
	const r = rec(v);
	return !!r && Object.values(r).every((x) => tree(x, d + 1, s));
}
function txt(v: unknown) {
	return typeof v === "string" && v.length && v.trim().length ? v : null;
}
function req(v: unknown) {
	const x = txt(v);
	if (!x) throw 0;
	return x;
}
function bounded(v: unknown, max: number) {
	const x = req(v);
	if (x.length > max) throw 0;
	return x;
}
function nullableBounded(v: unknown, max: number) {
	return v === null ? null : bounded(v, max);
}
function tag(v: unknown) {
	const x = bounded(v, 128);
	if (!/^[A-Za-z0-9_.:-]+$/.test(x)) throw 0;
	return x;
}
function enm(v: unknown, s: Set<string>) {
	return typeof v === "string" && s.has(v) ? v : null;
}
function int(v: unknown, m: number) {
	if (!Number.isSafeInteger(v) || (v as number) < m) throw 0;
	return v as number;
}
function nint(v: unknown, m: number) {
	return v === null ? null : int(v, m);
}
function instant(v: unknown) {
	if (typeof v !== "string") throw 0;
	const n = Date.parse(v);
	if (!Number.isFinite(n) || new Date(n).toISOString() !== v) throw 0;
	return v;
}
function ninstant(v: unknown) {
	return v === null ? null : instant(v);
}
function limit(v: unknown) {
	const x = int(v, 1);
	if (x > 100) throw 0;
	return x;
}
function deep<T>(v: T): T {
	if (v && typeof v === "object") {
		for (const x of Object.values(v)) deep(x);
		Object.freeze(v);
	}
	return v;
}
