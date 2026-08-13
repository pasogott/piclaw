import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result as ResultValue } from "@earendil-works/pi-agent-core";
import type {
	CanonicalJsonValue,
	EffectIdentity,
	NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import type {
	ClaimOutboxRequest,
	CleanupTerminalOutboxRequest,
	CompleteOutboxRequest,
	EnqueueOutboxRequest,
	OutboxStoreError,
	ReclaimOutboxRequest,
} from "../../src/service-effects/contracts/service-outbox-store.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import {
	createCurrentPiclawServiceOutboxStore,
	createServiceOutboxEnqueueInserter,
	type ServiceOutboxAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-outbox-store.js";

class Runtime implements ServiceOutboxAdapterRuntime {
	readonly traces: NormalisedTraceInput[] = [];
	hitFault() {
		return false;
	}
	recordTrace(input: NormalisedTraceInput) {
		this.traces.push(input);
	}
}
function effect(key: string): EffectIdentity {
	return {
		idempotencyKey: key,
		requestHash: "",
		operationId: "opaque:operation",
		sourceSeq: 1,
		provenanceRef: "opaque:secret-provenance",
		redactionClass: "secret",
	};
}
function enqueue(
	id: string,
	extra: Partial<EnqueueOutboxRequest> = {},
): EnqueueOutboxRequest {
	const base = {
		effect: effect(`key:${id}`),
		outboxId: id,
		kind: "maintenance" as const,
		payloadRef: "opaque:secret-payload",
		destinationRef: "opaque:secret-destination",
		availableAt: "2026-08-13T10:00:00.000Z",
		enqueuedAt: "2026-08-13T09:00:00.000Z",
		repeatability: "repeatable" as const,
		...extra,
	};
	return {
		...base,
		effect: {
			...base.effect,
			requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
		},
	};
}
function claim(token: string): ClaimOutboxRequest {
	return {
		kinds: ["maintenance"],
		workerId: `worker:${token}`,
		leaseToken: `opaque:secret-${token}`,
		now: "2026-08-13T10:00:01.000Z",
		leaseExpiresAt: "2026-08-13T10:01:00.000Z",
	};
}
function open(path = ":memory:") {
	const database = new Database(path, { strict: true });
	database.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL");
	installServiceOutboxSchema(database);
	const runtime = new Runtime(),
		made = createCurrentPiclawServiceOutboxStore(database, runtime);
	if (!made.ok) throw new Error("store");
	return { database, runtime, store: made.value };
}
function typed(
	result: { ok: true } | { ok: false; error: OutboxStoreError },
	tag: OutboxStoreError["_tag"],
) {
	expect(result.ok).toBeFalse();
	if (!result.ok) {
		expect(result.error._tag).toBe(tag);
		expect(JSON.stringify(result.error)).not.toContain("SQLITE");
	}
}
describe("EF-S05 transaction composition and construction", () => {
	test("bounded construction and caller-owned insert rollback commit replay", async () => {
		const db = new Database(":memory:", { strict: true }),
			runtime = new Runtime();
		expect(createCurrentPiclawServiceOutboxStore(db, runtime).ok).toBeFalse();
		installServiceOutboxSchema(db);
		const made = createServiceOutboxEnqueueInserter(db);
		expect(made.ok).toBeTrue();
		if (!made.ok) return;
		typed(made.value.insert(enqueue("outside")), "invalid_transition");
		db.exec("BEGIN IMMEDIATE");
		expect(made.value.insert(enqueue("rollback")).ok).toBeTrue();
		db.exec("ROLLBACK");
		expect(
			(
				db.query("SELECT count(*) n FROM service_effect_s05_outbox").get() as {
					n: number;
				}
			).n,
		).toBe(0);
		db.exec("BEGIN IMMEDIATE");
		const committed = made.value.insert(enqueue("commit"));
		expect(committed.ok).toBeTrue();
		db.exec("COMMIT");
		db.exec("BEGIN IMMEDIATE");
		const replay = made.value.insert(enqueue("commit"));
		expect(replay.ok && replay.value.decision).toBe("replayed");
		db.exec("COMMIT");
		db.close();
	});
});
describe("EF-S05 two-connection lease races", () => {
	test("one claim owner wins and stale result CAS cannot replace it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-race-"));
		const path = join(dir, "store.sqlite");
		const left = open(path);
		const right = open(path);
		try {
			expect((await left.store.enqueue(enqueue("race"))).ok).toBeTrue();
			const [a, b] = await Promise.all([
				left.store.claimNext(claim("race-a")),
				right.store.claimNext(claim("race-b")),
			]);
			expect(a.ok && b.ok).toBeTrue();
			const leases = [a, b].flatMap((result) =>
				result.ok && result.value.lease ? [result.value.lease] : [],
			);
			expect(leases).toHaveLength(1);
			const lease = leases[0];
			if (!lease) throw new Error("missing race winner");
			const stale = await right.store.complete({
				outboxId: lease.record.outboxId,
				workerId: "worker:stale",
				expectedAttempt: lease.record.attempt,
				leaseToken: "opaque:secret-stale",
				receiptRef: "opaque:secret-stale-receipt",
				completedAt: "2026-08-13T10:00:30.000Z",
			});
			expect(stale.ok && stale.value.decision).toBe("stale");
			const winner = await left.store.complete({
				outboxId: lease.record.outboxId,
				workerId: lease.workerId,
				expectedAttempt: lease.record.attempt,
				leaseToken: lease.record.leaseToken,
				receiptRef: "opaque:secret-winner-receipt",
				completedAt: "2026-08-13T10:00:31.000Z",
			});
			expect(winner.ok && winner.value.decision).toBe("applied");
		} finally {
			left.database.close();
			right.database.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("EF-S05 held immediate lock is bounded", () => {
	test("enqueue claim reclaim result and cleanup return not_applied then retry", async () => {
		const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-busy-")),
			path = join(dir, "store.sqlite"),
			left = open(path),
			right = open(path);
		right.database.exec("PRAGMA busy_timeout=0");
		try {
			const withLock = async <T>(
				run: () => Promise<ResultValue<T, OutboxStoreError>>,
			): Promise<ResultValue<T, OutboxStoreError>> => {
				left.database.exec("BEGIN IMMEDIATE");
				const blocked = await run();
				typed(blocked, "storage_unavailable");
				if (!blocked.ok) expect(blocked.error.certainty).toBe("not_applied");
				left.database.exec("ROLLBACK");
				return run();
			};
			expect(
				(await withLock(() => right.store.enqueue(enqueue("busy")))).ok,
			).toBeTrue();
			expect(
				(await withLock(() => right.store.claimNext(claim("busy")))).ok,
			).toBeTrue();
			const leased = await right.store.get("busy");
			if (!leased.ok || !leased.value) throw new Error();
			const reclaim: ReclaimOutboxRequest = {
				outboxId: "busy",
				expectedAttempt: 1,
				workerId: "worker:reclaim",
				leaseToken: "opaque:secret-reclaim",
				now: "2026-08-13T10:02:00.000Z",
				leaseExpiresAt: "2026-08-13T10:03:00.000Z",
				authority: { kind: "repeatable" },
			};
			expect(
				(await withLock(() => right.store.reclaim(reclaim))).ok,
			).toBeTrue();
			const reclaimed = await right.store.get("busy");
			if (!reclaimed.ok || !reclaimed.value) throw new Error();
			const complete: CompleteOutboxRequest = {
				outboxId: "busy",
				workerId: "worker:reclaim",
				expectedAttempt: 2,
				leaseToken: "opaque:secret-reclaim",
				receiptRef: "opaque:secret-receipt",
				completedAt: "2026-08-13T10:02:30.000Z",
			};
			expect(
				(await withLock(() => right.store.complete(complete))).ok,
			).toBeTrue();
			await right.store.enqueue(enqueue("fatal"));
			const c = await right.store.claimNext({
				...claim("fatal"),
				now: "2026-08-13T10:04:00.000Z",
				leaseExpiresAt: "2026-08-13T10:05:00.000Z",
			});
			if (!c.ok || !c.value.lease) throw new Error();
			await right.store.fail({
				outboxId: "fatal",
				workerId: c.value.lease.workerId,
				expectedAttempt: 1,
				leaseToken: c.value.lease.record.leaseToken,
				errorTag: "poison",
				certainty: "not_applied",
				retryAt: null,
				failedAt: "2026-08-13T10:04:30.000Z",
			});
			const cleanup: CleanupTerminalOutboxRequest = {
				cleanupId: "busy-cleanup",
				before: "2026-08-13T11:00:00.000Z",
				after: null,
				limit: 10,
			};
			expect(
				(await withLock(() => right.store.cleanupTerminal(cleanup))).ok,
			).toBeTrue();
		} finally {
			if (left.database.inTransaction) left.database.exec("ROLLBACK");
			left.database.close();
			right.database.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
describe("EF-S05 hostile input and redaction", () => {
	test("malformed closed requests never reach SQL and protected values stay out of traces/errors", async () => {
		const f = open();
		try {
			const valid = enqueue("redacted"),
				candidates: unknown[] = [
					{ ...valid, extra: true },
					{ ...valid, effect: { ...valid.effect, requestHash: "x" } },
					Object.defineProperty({}, "effect", {
						enumerable: true,
						get() {
							throw new Error("opaque:secret-payload");
						},
					}),
					new Proxy(valid, {
						ownKeys() {
							throw new Error("opaque:secret-destination");
						},
					}),
				];
			for (const candidate of candidates)
				typed(
					await f.store.enqueue(candidate as EnqueueOutboxRequest),
					"invalid_request",
				);
			const good = await f.store.enqueue(valid);
			expect(good.ok).toBeTrue();
			const text = JSON.stringify(f.runtime.traces);
			for (const protectedValue of [
				valid.payloadRef,
				valid.destinationRef,
				valid.effect.provenanceRef,
				"opaque:secret-receipt",
				"opaque:secret-reconciliation",
			])
				if (protectedValue !== null) expect(text).not.toContain(protectedValue);
			expect(text).not.toContain("opaque:secret-");
		} finally {
			f.database.close();
		}
	});
});
