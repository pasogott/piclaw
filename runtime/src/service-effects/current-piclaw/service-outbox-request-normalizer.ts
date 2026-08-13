import {
	type CanonicalJsonValue,
	type EffectIdentity,
	hashCanonicalRequest,
} from "../contracts/common.js";
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
} from "../contracts/service-outbox-store.js";

export type OutboxMutationMethod =
	| "enqueue"
	| "claimNext"
	| "reclaim"
	| "complete"
	| "fail"
	| "markUnknown"
	| "resolveUnknown"
	| "cleanupTerminal";
export type NormalisedOutboxMutation =
	| EnqueueOutboxRequest
	| ClaimOutboxRequest
	| ReclaimOutboxRequest
	| CompleteOutboxRequest
	| FailOutboxRequest
	| MarkOutboxUnknownRequest
	| ResolveUnknownOutboxRequest
	| CleanupTerminalOutboxRequest;

const HASH = /^[0-9a-f]{64}$/;
const KINDS = new Set<string>(OUTBOX_KINDS);
const REDACTION = new Set(["public", "private", "secret"]);

export function normaliseOutboxMutation(
	method: OutboxMutationMethod,
	input: unknown,
): NormalisedOutboxMutation | null {
	try {
		const value = record(input);
		if (!value || !bounded(input)) return null;
		let request: NormalisedOutboxMutation | null = null;
		switch (method) {
			case "enqueue":
				request = enqueue(value);
				break;
			case "claimNext":
				request = claim(value);
				break;
			case "reclaim":
				request = reclaim(value);
				break;
			case "complete":
				request = complete(value);
				break;
			case "fail":
				request = fail(value);
				break;
			case "markUnknown":
				request = unknown(value);
				break;
			case "resolveUnknown":
				request = resolve(value);
				break;
			case "cleanupTerminal":
				request = cleanup(value);
				break;
		}
		return request ? deepFreeze(request) : null;
	} catch {
		return null;
	}
}

export function normaliseOutboxList(
	input: unknown,
): ListUnknownOutboxRequest | null {
	try {
		const value = record(input);
		if (!value || !bounded(input) || !exact(value, ["kinds", "after", "limit"]))
			return null;
		return deepFreeze({
			kinds: kinds(value.kinds),
			after: cursor(value.after),
			limit: limit(value.limit),
		});
	} catch {
		return null;
	}
}

export function normaliseOutboxId(input: unknown): string | null {
	try {
		return text(input);
	} catch {
		return null;
	}
}

export function hashOutboxRequest(
	request: Exclude<NormalisedOutboxMutation, EnqueueOutboxRequest>,
): string {
	return hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}

function enqueue(value: Record<string, unknown>): EnqueueOutboxRequest | null {
	if (
		!exact(value, [
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
	const effect = normaliseEffect(value.effect);
	const kind = enumText(value.kind, KINDS) as OutboxKind | null;
	const repeatability = enumText(
		value.repeatability,
		new Set(["repeatable", "reconciliation_required"]),
	);
	if (!effect || !kind || !repeatability) return null;
	const request: EnqueueOutboxRequest = {
		effect,
		outboxId: requiredText(value.outboxId),
		kind,
		payloadRef: requiredText(value.payloadRef),
		destinationRef: nullableTextRequired(value.destinationRef),
		availableAt: requiredInstant(value.availableAt),
		enqueuedAt: requiredInstant(value.enqueuedAt),
		repeatability: repeatability as EnqueueOutboxRequest["repeatability"],
	};
	return hashCanonicalRequest(request as unknown as CanonicalJsonValue) ===
		effect.requestHash
		? request
		: null;
}
function claim(value: Record<string, unknown>): ClaimOutboxRequest | null {
	if (
		!exact(value, ["kinds", "workerId", "leaseToken", "now", "leaseExpiresAt"])
	)
		return null;
	const now = requiredInstant(value.now),
		leaseExpiresAt = requiredInstant(value.leaseExpiresAt);
	if (leaseExpiresAt <= now) return null;
	return {
		kinds: kinds(value.kinds),
		workerId: requiredText(value.workerId),
		leaseToken: requiredText(value.leaseToken),
		now,
		leaseExpiresAt,
	};
}
function reclaim(value: Record<string, unknown>): ReclaimOutboxRequest | null {
	if (
		!exact(value, [
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
	const authorityValue = record(value.authority);
	if (!authorityValue) return null;
	let authority: ReclaimOutboxRequest["authority"];
	if (exact(authorityValue, ["kind"]) && authorityValue.kind === "repeatable")
		authority = { kind: "repeatable" };
	else if (
		exact(authorityValue, ["kind", "reconciliationRef"]) &&
		authorityValue.kind === "reconciled_absent"
	)
		authority = {
			kind: "reconciled_absent",
			reconciliationRef: requiredText(authorityValue.reconciliationRef),
		};
	else return null;
	const now = requiredInstant(value.now),
		leaseExpiresAt = requiredInstant(value.leaseExpiresAt);
	if (leaseExpiresAt <= now) return null;
	return {
		outboxId: requiredText(value.outboxId),
		expectedAttempt: integer(value.expectedAttempt, 1),
		workerId: requiredText(value.workerId),
		leaseToken: requiredText(value.leaseToken),
		now,
		leaseExpiresAt,
		authority,
	};
}
function worker(value: Record<string, unknown>, extras: readonly string[]) {
	if (
		!exact(value, [
			"outboxId",
			"workerId",
			"expectedAttempt",
			"leaseToken",
			...extras,
		])
	)
		return null;
	return {
		outboxId: requiredText(value.outboxId),
		workerId: requiredText(value.workerId),
		expectedAttempt: integer(value.expectedAttempt, 1),
		leaseToken: requiredText(value.leaseToken),
	};
}
function complete(
	value: Record<string, unknown>,
): CompleteOutboxRequest | null {
	const base = worker(value, ["receiptRef", "completedAt"]);
	return base
		? {
				...base,
				receiptRef: nullableTextRequired(value.receiptRef),
				completedAt: requiredInstant(value.completedAt),
			}
		: null;
}
function fail(value: Record<string, unknown>): FailOutboxRequest | null {
	const base = worker(value, ["errorTag", "certainty", "retryAt", "failedAt"]);
	if (!base || value.certainty !== "not_applied") return null;
	return {
		...base,
		errorTag: requiredText(value.errorTag),
		certainty: "not_applied",
		retryAt: nullableInstant(value.retryAt),
		failedAt: requiredInstant(value.failedAt),
	};
}
function unknown(
	value: Record<string, unknown>,
): MarkOutboxUnknownRequest | null {
	const base = worker(value, ["errorTag", "certainty", "observedAt"]);
	if (!base || value.certainty !== "unknown") return null;
	return {
		...base,
		errorTag: requiredText(value.errorTag),
		certainty: "unknown",
		observedAt: requiredInstant(value.observedAt),
	};
}
function resolve(
	value: Record<string, unknown>,
): ResolveUnknownOutboxRequest | null {
	if (
		!exact(value, [
			"outboxId",
			"expectedAttempt",
			"reconciliationRef",
			"reconciledAt",
			"resolution",
		])
	)
		return null;
	const r = record(value.resolution);
	if (!r) return null;
	let resolution: ResolveUnknownOutboxRequest["resolution"];
	if (exact(r, ["kind", "receiptRef"]) && r.kind === "applied")
		resolution = {
			kind: "applied",
			receiptRef: nullableTextRequired(r.receiptRef),
		};
	else if (
		exact(r, ["kind", "errorTag", "retryAt"]) &&
		r.kind === "not_applied"
	)
		resolution = {
			kind: "not_applied",
			errorTag: requiredText(r.errorTag),
			retryAt: nullableInstant(r.retryAt),
		};
	else if (exact(r, ["kind", "reasonTag"]) && r.kind === "cancelled")
		resolution = { kind: "cancelled", reasonTag: requiredText(r.reasonTag) };
	else return null;
	return {
		outboxId: requiredText(value.outboxId),
		expectedAttempt: integer(value.expectedAttempt, 1),
		reconciliationRef: requiredText(value.reconciliationRef),
		reconciledAt: requiredInstant(value.reconciledAt),
		resolution,
	};
}
function cleanup(
	value: Record<string, unknown>,
): CleanupTerminalOutboxRequest | null {
	if (!exact(value, ["cleanupId", "before", "after", "limit"])) return null;
	return {
		cleanupId: requiredText(value.cleanupId),
		before: requiredInstant(value.before),
		after: cursor(value.after),
		limit: limit(value.limit),
	};
}
function normaliseEffect(input: unknown): EffectIdentity | null {
	const value = record(input);
	if (
		!value ||
		!exact(value, [
			"idempotencyKey",
			"requestHash",
			"operationId",
			"sourceSeq",
			"provenanceRef",
			"redactionClass",
		])
	)
		return null;
	const requestHash =
		typeof value.requestHash === "string" && HASH.test(value.requestHash)
			? value.requestHash
			: null;
	const redactionClass = enumText(value.redactionClass, REDACTION);
	if (!requestHash || !redactionClass) return null;
	return {
		idempotencyKey: requiredText(value.idempotencyKey),
		requestHash,
		operationId: nullableTextRequired(value.operationId),
		sourceSeq: nullableInteger(value.sourceSeq, 0),
		provenanceRef: requiredText(value.provenanceRef),
		redactionClass: redactionClass as EffectIdentity["redactionClass"],
	};
}
function kinds(input: unknown): readonly OutboxKind[] {
	if (
		!Array.isArray(input) ||
		input.length === 0 ||
		Object.keys(input).length !== input.length
	)
		throw new TypeError();
	const output = input.map(
		(entry) => enumText(entry, KINDS) as OutboxKind | null,
	);
	if (output.some((entry) => !entry)) throw new TypeError();
	return Object.freeze([...new Set(output as OutboxKind[])].sort());
}
function cursor(input: unknown): OutboxCursor | null {
	if (input === null) return null;
	const value = record(input);
	if (!value || !exact(value, ["stateChangedAt", "outboxId"]))
		throw new TypeError();
	return Object.freeze({
		stateChangedAt: requiredInstant(value.stateChangedAt),
		outboxId: requiredText(value.outboxId),
	});
}
function limit(input: unknown): number {
	const value = integer(input, 1);
	if (value > 100) throw new TypeError();
	return value;
}
function record(input: unknown): Record<string, unknown> | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const p = Object.getPrototypeOf(input);
	if (p !== Object.prototype && p !== null) return null;
	const out: Record<string, unknown> = {};
	for (const [key, d] of Object.entries(
		Object.getOwnPropertyDescriptors(input),
	)) {
		if (!("value" in d) || !d.enumerable) return null;
		out[key] = d.value;
	}
	return out;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
	const actual = Object.keys(value).sort(),
		expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, i) => key === expected[i])
	);
}
function bounded(input: unknown, depth = 0, seen = new Set<object>()): boolean {
	if (depth > 8) return false;
	if (input === null || ["string", "boolean"].includes(typeof input))
		return true;
	if (typeof input === "number") return Number.isFinite(input);
	if (typeof input !== "object" || seen.has(input)) return false;
	seen.add(input);
	if (Array.isArray(input))
		return (
			Object.keys(input).length === input.length &&
			input.every((entry) => bounded(entry, depth + 1, seen))
		);
	const value = record(input);
	return (
		!!value &&
		Object.values(value).every((entry) => bounded(entry, depth + 1, seen))
	);
}
function text(input: unknown): string | null {
	return typeof input === "string" &&
		input.length > 0 &&
		input.trim().length > 0
		? input
		: null;
}
function requiredText(input: unknown): string {
	const value = text(input);
	if (!value) throw new TypeError();
	return value;
}
function nullableTextRequired(input: unknown): string | null {
	if (input === null) return null;
	return requiredText(input);
}
function enumText(input: unknown, values: ReadonlySet<string>): string | null {
	return typeof input === "string" && values.has(input) ? input : null;
}
function integer(input: unknown, min: number): number {
	if (!Number.isSafeInteger(input) || (input as number) < min)
		throw new TypeError();
	return input as number;
}
function nullableInteger(input: unknown, min: number): number | null {
	return input === null ? null : integer(input, min);
}
function requiredInstant(input: unknown): string {
	if (typeof input !== "string") throw new TypeError();
	const ms = Date.parse(input);
	if (!Number.isFinite(ms) || new Date(ms).toISOString() !== input)
		throw new TypeError();
	return input;
}
function nullableInstant(input: unknown): string | null {
	return input === null ? null : requiredInstant(input);
}
function deepFreeze<T>(input: T): T {
	if (input && typeof input === "object") {
		for (const value of Object.values(input)) deepFreeze(value);
		Object.freeze(input);
	}
	return input;
}
