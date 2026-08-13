import type Database from "bun:sqlite";
import {
	Result,
	type Result as ResultValue,
} from "@earendil-works/pi-agent-core";

import type {
	EffectCertainty,
	NormalisedTraceInput,
} from "../contracts/common.js";
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
	ServiceOutboxEnqueueInserter,
	ServiceOutboxStore,
} from "../contracts/service-outbox-store.js";
import {
	hashOutboxRequest,
	normaliseOutboxId,
	normaliseOutboxList,
	normaliseOutboxMutation,
	type OutboxMutationMethod,
} from "./service-outbox-request-normalizer.js";

const OUTBOX = "service_effect_s05_outbox";
const DECISIONS = "service_effect_s05_decisions";

export interface ServiceOutboxAdapterRuntime {
	hitFault(
		point: "before_effect" | "effect_then_lost_acknowledgement",
		method: OutboxMutationMethod,
	): unknown;
	recordTrace(input: NormalisedTraceInput): void;
}
interface DecisionRow {
	method: string;
	request_hash: string;
	result_json: string;
	outbox_id: string | null;
	protected_lease_token: string | null;
}
interface RawRow {
	[key: string]: unknown;
}
class RollbackFault extends Error {}

type ConstructionResult = ResultValue<
	CurrentPiclawServiceOutboxStore,
	OutboxStoreError
>;
type InserterConstructionResult = ResultValue<
	ServiceOutboxEnqueueInserter,
	OutboxStoreError
>;

export function createCurrentPiclawServiceOutboxStore(
	database: Database,
	runtime: ServiceOutboxAdapterRuntime,
): ConstructionResult {
	try {
		return Result.ok(new CurrentPiclawServiceOutboxStore(database, runtime));
	} catch {
		return Result.err(storeError("storage_unavailable", "not_applied", true));
	}
}
export function createServiceOutboxEnqueueInserter(
	database: Database,
): InserterConstructionResult {
	try {
		verifyDatabase(database);
		return Result.ok(
			Object.freeze({
				insert(input: EnqueueOutboxRequest) {
					if (!database.inTransaction)
						return Result.err(storeError("invalid_transition"));
					const request = normaliseOutboxMutation(
						"enqueue",
						input,
					) as EnqueueOutboxRequest | null;
					if (!request) return Result.err(storeError("invalid_request"));
					try {
						return insertEnqueue(database, request);
					} catch {
						return Result.err(
							storeError("storage_unavailable", "not_applied", true),
						);
					}
				},
			}),
		);
	} catch {
		return Result.err(storeError("storage_unavailable", "not_applied", true));
	}
}

export class CurrentPiclawServiceOutboxStore implements ServiceOutboxStore {
	#serial: Promise<void> = Promise.resolve();
	constructor(
		readonly database: Database,
		private readonly runtime: ServiceOutboxAdapterRuntime,
	) {
		verifyDatabase(database);
	}

	enqueue(input: EnqueueOutboxRequest) {
		return this.mutate("enqueue", input, (request) =>
			insertEnqueue(this.database, request as EnqueueOutboxRequest),
		);
	}

	claimNext(input: ClaimOutboxRequest) {
		return this.mutate("claimNext", input, (candidate) => {
			const request = candidate as ClaimOutboxRequest;
			const hash = hashOutboxRequest(request);
			const key = `claim:${request.leaseToken}`;
			const replay = this.replay<OutboxClaimDecision>(key, "claimNext", hash);
			if (replay) return replay;
			if (this.leaseTokenUsed(request.leaseToken))
				return Result.err(storeError("idempotency_conflict"));
			const placeholders = request.kinds.map(() => "?").join(",");
			const row = this.database
				.query(`SELECT * FROM ${OUTBOX}
        WHERE kind IN (${placeholders}) AND ((state='pending' AND available_at<=?) OR (state='failed' AND retry_at IS NOT NULL AND retry_at<=?))
        ORDER BY CASE WHEN state='pending' THEN available_at ELSE retry_at END, outbox_id LIMIT 1`)
				.get(...request.kinds, request.now, request.now) as RawRow | null;
			let decision: OutboxClaimDecision;
			let outboxId: string | null = null;
			if (!row) decision = freeze({ decision: "empty", lease: null });
			else {
				const current = decodeRecord(row);
				outboxId = current.outboxId;
				const changed = this.database
					.query(
						`UPDATE ${OUTBOX} SET state='started',state_changed_at=?,attempt=attempt+1,worker_id=?,claimed_at=?,lease_token=?,lease_expires_at=?,certainty=NULL,retry_at=NULL,receipt_ref=NULL,last_error_tag=NULL,result_at=NULL,reconciled_at=NULL,cancellation_reason_tag=NULL WHERE outbox_id=? AND state=? AND attempt=?`,
					)
					.run(
						request.now,
						request.workerId,
						request.now,
						request.leaseToken,
						request.leaseExpiresAt,
						current.outboxId,
						current.state,
						current.attempt,
					);
				if (changed.changes !== 1)
					return Result.err(
						storeError("storage_unavailable", "not_applied", true),
					);
				const record = this.requireRecord(current.outboxId);
				const lease = freeze({
					record: record as OutboxLease["record"],
					workerId: request.workerId,
				});
				decision = freeze({ decision: "applied", lease });
			}
			this.writeDecision(
				key,
				"claimNext",
				hash,
				decision,
				outboxId,
				request.leaseToken,
			);
			return Result.ok(decision);
		});
	}

	reclaim(input: ReclaimOutboxRequest) {
		return this.mutate("reclaim", input, (candidate) => {
			const request = candidate as ReclaimOutboxRequest,
				hash = hashOutboxRequest(request),
				key = `reclaim:${request.outboxId}:${request.expectedAttempt}`;
			const replay = this.replay<OutboxMutationDecision>(key, "reclaim", hash);
			if (replay) return replay;
			if (this.leaseTokenUsed(request.leaseToken))
				return Result.err(storeError("idempotency_conflict"));
			const row = this.readRecord(request.outboxId);
			if (!row) return Result.err(storeError("not_found"));
			const allowed =
				row.state === "started" &&
				row.attempt === request.expectedAttempt &&
				!!row.leaseExpiresAt &&
				row.leaseExpiresAt <= request.now &&
				((request.authority.kind === "repeatable" &&
					row.repeatability === "repeatable") ||
					request.authority.kind === "reconciled_absent");
			let decision: OutboxMutationDecision;
			if (!allowed) decision = stale();
			else {
				const reconciliationRef =
					request.authority.kind === "reconciled_absent"
						? request.authority.reconciliationRef
						: row.reconciliationRef;
				this.database
					.query(
						`UPDATE ${OUTBOX} SET state_changed_at=?,attempt=attempt+1,worker_id=?,claimed_at=?,lease_token=?,lease_expires_at=?,reconciliation_ref=? WHERE outbox_id=?`,
					)
					.run(
						request.now,
						request.workerId,
						request.now,
						request.leaseToken,
						request.leaseExpiresAt,
						reconciliationRef,
						request.outboxId,
					);
				decision = applied(this.requireRecord(request.outboxId));
			}
			this.writeDecision(
				key,
				"reclaim",
				hash,
				decision,
				request.outboxId,
				request.leaseToken,
			);
			return Result.ok(decision);
		});
	}

	complete(input: CompleteOutboxRequest) {
		return this.workerResult("complete", input, (request) => ({
			state: "completed",
			certainty: "applied",
			at: request.completedAt,
			receiptRef: request.receiptRef,
			errorTag: null,
			retryAt: null,
		}));
	}
	fail(input: FailOutboxRequest) {
		return this.workerResult("fail", input, (request) => ({
			state: "failed",
			certainty: "not_applied",
			at: request.failedAt,
			receiptRef: null,
			errorTag: request.errorTag,
			retryAt: request.retryAt,
		}));
	}
	markUnknown(input: MarkOutboxUnknownRequest) {
		return this.workerResult("markUnknown", input, (request) => ({
			state: "unknown",
			certainty: "unknown",
			at: request.observedAt,
			receiptRef: null,
			errorTag: request.errorTag,
			retryAt: null,
		}));
	}

	resolveUnknown(input: ResolveUnknownOutboxRequest) {
		return this.mutate("resolveUnknown", input, (candidate) => {
			const request = candidate as ResolveUnknownOutboxRequest,
				hash = hashOutboxRequest(request),
				key = `resolve:${request.outboxId}:${request.expectedAttempt}`;
			const replay = this.replay<OutboxMutationDecision>(
				key,
				"resolveUnknown",
				hash,
			);
			if (replay) return replay;
			const row = this.readRecord(request.outboxId);
			if (!row) return Result.err(storeError("not_found"));
			let decision: OutboxMutationDecision;
			if (row.state !== "unknown" || row.attempt !== request.expectedAttempt)
				decision = stale();
			else {
				const resolution = request.resolution;
				if (resolution.kind === "applied")
					this.database
						.query(
							`UPDATE ${OUTBOX} SET state='completed',state_changed_at=?,certainty='applied',receipt_ref=?,last_error_tag=NULL,retry_at=NULL,result_at=?,reconciliation_ref=?,reconciled_at=?,cancellation_reason_tag=NULL WHERE outbox_id=?`,
						)
						.run(
							request.reconciledAt,
							resolution.receiptRef,
							request.reconciledAt,
							request.reconciliationRef,
							request.reconciledAt,
							request.outboxId,
						);
				else if (resolution.kind === "not_applied")
					this.database
						.query(
							`UPDATE ${OUTBOX} SET state='failed',state_changed_at=?,certainty='not_applied',receipt_ref=NULL,last_error_tag=?,retry_at=?,result_at=?,reconciliation_ref=?,reconciled_at=?,cancellation_reason_tag=NULL WHERE outbox_id=?`,
						)
						.run(
							request.reconciledAt,
							resolution.errorTag,
							resolution.retryAt,
							request.reconciledAt,
							request.reconciliationRef,
							request.reconciledAt,
							request.outboxId,
						);
				else
					this.database
						.query(
							`UPDATE ${OUTBOX} SET state='cancelled',state_changed_at=?,certainty='not_applied',receipt_ref=NULL,last_error_tag=NULL,retry_at=NULL,result_at=?,reconciliation_ref=?,reconciled_at=?,cancellation_reason_tag=? WHERE outbox_id=?`,
						)
						.run(
							request.reconciledAt,
							request.reconciledAt,
							request.reconciliationRef,
							request.reconciledAt,
							resolution.reasonTag,
							request.outboxId,
						);
				decision = applied(this.requireRecord(request.outboxId));
			}
			this.writeDecision(
				key,
				"resolveUnknown",
				hash,
				decision,
				request.outboxId,
				null,
			);
			return Result.ok(decision);
		});
	}

	async get(
		input: string,
	): Promise<ResultValue<OutboxRecord | null, OutboxStoreError>> {
		const id = normaliseOutboxId(input);
		if (!id) return Result.err(storeError("invalid_request"));
		try {
			return Result.ok(this.readRecord(id));
		} catch {
			return Result.err(storeError("storage_unavailable", "not_applied", true));
		}
	}
	async listUnknown(
		input: ListUnknownOutboxRequest,
	): Promise<ResultValue<ListUnknownOutboxResult, OutboxStoreError>> {
		const request = normaliseOutboxList(input);
		if (!request) return Result.err(storeError("invalid_request"));
		try {
			const placeholders = request.kinds.map(() => "?").join(","),
				after = request.after;
			const rows = this.database
				.query(
					`SELECT * FROM ${OUTBOX} WHERE state='unknown' AND kind IN (${placeholders}) AND (? IS NULL OR state_changed_at>? OR (state_changed_at=? AND outbox_id>?)) ORDER BY state_changed_at,outbox_id LIMIT ?`,
				)
				.all(
					...request.kinds,
					after?.stateChangedAt ?? null,
					after?.stateChangedAt ?? "",
					after?.stateChangedAt ?? "",
					after?.outboxId ?? "",
					request.limit,
				) as RawRow[];
			const records = Object.freeze(rows.map(decodeRecord));
			const last =
				records.length === request.limit ? (records.at(-1) ?? null) : null;
			return Result.ok(
				freeze({
					records,
					nextCursor: last
						? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
						: null,
				}),
			);
		} catch {
			return Result.err(storeError("storage_unavailable", "not_applied", true));
		}
	}

	cleanupTerminal(input: CleanupTerminalOutboxRequest) {
		return this.mutate("cleanupTerminal", input, (candidate) => {
			const request = candidate as CleanupTerminalOutboxRequest,
				hash = hashOutboxRequest(request),
				key = `cleanup:${request.cleanupId}`;
			const replay = this.replay<OutboxCleanupDecision>(
				key,
				"cleanupTerminal",
				hash,
			);
			if (replay) return replay;
			const after = request.after;
			const rows = this.database
				.query(
					`SELECT outbox_id,state_changed_at FROM ${OUTBOX} WHERE state_changed_at<? AND (state='cancelled' OR (state='failed' AND certainty='not_applied' AND retry_at IS NULL)) AND (? IS NULL OR state_changed_at>? OR (state_changed_at=? AND outbox_id>?)) ORDER BY state_changed_at,outbox_id LIMIT ?`,
				)
				.all(
					request.before,
					after?.stateChangedAt ?? null,
					after?.stateChangedAt ?? "",
					after?.stateChangedAt ?? "",
					after?.outboxId ?? "",
					request.limit,
				) as Array<{ outbox_id: string; state_changed_at: string }>;
			const ids = rows.map((r) => r.outbox_id);
			for (const id of ids) {
				this.database
					.query(`DELETE FROM ${DECISIONS} WHERE outbox_id=?`)
					.run(id);
				this.database.query(`DELETE FROM ${OUTBOX} WHERE outbox_id=?`).run(id);
			}
			const last = rows.length === request.limit ? (rows.at(-1) ?? null) : null;
			const result = freeze({
				deletedIds: Object.freeze(ids),
				deletedCount: ids.length,
				nextCursor: last
					? { stateChangedAt: last.state_changed_at, outboxId: last.outbox_id }
					: null,
			});
			const decision = freeze({ decision: "applied" as const, result });
			this.writeDecision(key, "cleanupTerminal", hash, decision, null, null);
			return Result.ok(decision);
		});
	}

	private workerResult<
		T extends
			| CompleteOutboxRequest
			| FailOutboxRequest
			| MarkOutboxUnknownRequest,
	>(
		method: "complete" | "fail" | "markUnknown",
		input: T,
		map: (request: T) => {
			state: "completed" | "failed" | "unknown";
			certainty: EffectCertainty;
			at: string;
			receiptRef: string | null;
			errorTag: string | null;
			retryAt: string | null;
		},
	) {
		return this.mutate(method, input, (candidate) => {
			const request = candidate as T,
				hash = hashOutboxRequest(request),
				key = `outcome:${request.outboxId}:${request.expectedAttempt}`;
			const existing = this.database
				.query(`SELECT * FROM ${DECISIONS} WHERE decision_key=?`)
				.get(key) as DecisionRow | null;
			if (existing) {
				if (existing.method === method && existing.request_hash === hash)
					return Result.ok(replayDecision<OutboxMutationDecision>(existing));
				const existingDecision = JSON.parse(existing.result_json) as {
					decision?: unknown;
				};
				if (existingDecision.decision !== "stale") return Result.ok(stale());
			}
			const row = this.readRecord(request.outboxId);
			if (!row) return Result.err(storeError("not_found"));
			const outcome = map(request);
			let decision: OutboxMutationDecision;
			if (
				row.state !== "started" ||
				row.workerId !== request.workerId ||
				row.attempt !== request.expectedAttempt ||
				row.leaseToken !== request.leaseToken ||
				!row.leaseExpiresAt ||
				outcome.at >= row.leaseExpiresAt
			)
				decision = stale();
			else {
				this.database
					.query(
						`UPDATE ${OUTBOX} SET state=?,state_changed_at=?,worker_id=NULL,claimed_at=NULL,lease_token=NULL,lease_expires_at=NULL,certainty=?,retry_at=?,receipt_ref=?,last_error_tag=?,result_at=?,reconciled_at=NULL,cancellation_reason_tag=NULL WHERE outbox_id=?`,
					)
					.run(
						outcome.state,
						outcome.at,
						outcome.certainty,
						outcome.retryAt,
						outcome.receiptRef,
						outcome.errorTag,
						outcome.at,
						request.outboxId,
					);
				decision = applied(this.requireRecord(request.outboxId));
			}
			if (existing)
				this.database
					.query(`DELETE FROM ${DECISIONS} WHERE decision_key=?`)
					.run(key);
			this.writeDecision(key, method, hash, decision, request.outboxId, null);
			return Result.ok(decision);
		});
	}

	private async mutate<T>(
		method: OutboxMutationMethod,
		input: unknown,
		apply: (request: unknown) => ResultValue<T, OutboxStoreError>,
	): Promise<ResultValue<T, OutboxStoreError>> {
		const request = normaliseOutboxMutation(method, input);
		const previous = this.#serial;
		let release!: () => void;
		this.#serial = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			this.trace(method, request, "call", null);
			if (!request)
				return this.finish(method, Result.err(storeError("invalid_request")));
			const outcome = this.database
				.transaction(() => {
					const value = apply(request);
					if (!value.ok) return value;
					const fault = this.fault(method, "before_effect");
					if (!fault.ok) return Result.err(fault.error);
					if (fault.injected) throw new RollbackFault();
					return value;
				})
				.immediate();
			if (!outcome.ok) return this.finish(method, outcome);
			const lost = this.fault(method, "effect_then_lost_acknowledgement");
			if (!lost.ok) return this.finish(method, Result.err(lost.error));
			if (lost.injected)
				return this.finish(
					method,
					Result.err(storeError("storage_unavailable", "unknown", true)),
				);
			return this.finish(method, Result.ok(outcome.value));
		} catch (error) {
			const bounded =
				error instanceof RollbackFault
					? storeError("storage_unavailable", "not_applied", true)
					: storeError("storage_unavailable", "not_applied", true);
			return this.finish(method, Result.err(bounded));
		} finally {
			release();
		}
	}
	private replay<T>(
		key: string,
		method: string,
		hash: string,
	): ResultValue<T, OutboxStoreError> | null {
		const row = this.database
			.query(`SELECT * FROM ${DECISIONS} WHERE decision_key=?`)
			.get(key) as DecisionRow | null;
		if (!row) return null;
		if (row.method !== method || row.request_hash !== hash)
			return Result.err(storeError("idempotency_conflict"));
		return Result.ok(replayDecision<T>(row));
	}
	private writeDecision(
		key: string,
		method: string,
		hash: string,
		result: unknown,
		outboxId: string | null,
		token: string | null,
	) {
		this.database
			.query(
				`INSERT INTO ${DECISIONS}(decision_key,method,request_hash,result_json,outbox_id,protected_lease_token) VALUES (?,?,?,?,?,?)`,
			)
			.run(key, method, hash, JSON.stringify(result), outboxId, token);
	}
	private leaseTokenUsed(token: string) {
		return !!this.database
			.query(`SELECT 1 FROM ${DECISIONS} WHERE protected_lease_token=?`)
			.get(token);
	}
	private readRecord(id: string): OutboxRecord | null {
		const row = this.database
			.query(`SELECT * FROM ${OUTBOX} WHERE outbox_id=?`)
			.get(id) as RawRow | null;
		return row ? decodeRecord(row) : null;
	}
	private requireRecord(id: string): OutboxRecord {
		const value = this.readRecord(id);
		if (!value) throw new Error();
		return value;
	}
	private fault(
		method: OutboxMutationMethod,
		point: "before_effect" | "effect_then_lost_acknowledgement",
	): { ok: true; injected: boolean } | { ok: false; error: OutboxStoreError } {
		try {
			const value = this.runtime.hitFault(point, method);
			return typeof value === "boolean"
				? { ok: true, injected: value }
				: {
						ok: false,
						error: storeError("storage_unavailable", "not_applied", true),
					};
		} catch {
			return {
				ok: false,
				error: storeError("storage_unavailable", "not_applied", true),
			};
		}
	}
	private trace(
		method: string,
		request: unknown,
		resultTag: string,
		certainty: EffectCertainty | null,
	) {
		try {
			const r = request as {
				outboxId?: string;
				effect?: { operationId?: string | null; sourceSeq?: number | null };
				expectedAttempt?: number;
			};
			this.runtime.recordTrace({
				contract: "EF-S05",
				method,
				effectId: r?.outboxId ?? "invalid",
				operationId: r?.effect?.operationId ?? null,
				sourceSeq: r?.effect?.sourceSeq ?? null,
				version: r?.expectedAttempt ?? null,
				certainty,
				resultTag,
			});
		} catch {
			/* observation is non-authoritative */
		}
	}
	private finish<T>(
		method: string,
		result: ResultValue<T, OutboxStoreError>,
	): ResultValue<T, OutboxStoreError> {
		this.trace(
			method,
			null,
			result.ok ? decisionTag(result.value) : result.error._tag,
			result.ok ? decisionCertainty(result.value) : result.error.certainty,
		);
		return result;
	}
}

function insertEnqueue(
	database: Database,
	request: EnqueueOutboxRequest,
): ResultValue<OutboxEnqueueDecision, OutboxStoreError> {
	const key = `enqueue:${request.kind}:${request.effect.idempotencyKey}`;
	const existing = database
		.query(`SELECT * FROM ${DECISIONS} WHERE decision_key=?`)
		.get(key) as DecisionRow | null;
	if (existing)
		return existing.method === "enqueue" &&
			existing.request_hash === request.effect.requestHash
			? Result.ok(replayDecision<OutboxEnqueueDecision>(existing))
			: Result.err(storeError("idempotency_conflict"));
	const idRow = database
		.query(
			`SELECT request_hash,kind,idempotency_key FROM ${OUTBOX} WHERE outbox_id=?`,
		)
		.get(request.outboxId) as {
		request_hash: string;
		kind: string;
		idempotency_key: string;
	} | null;
	if (idRow) return Result.err(storeError("idempotency_conflict"));
	database
		.query(
			`INSERT INTO ${OUTBOX}(outbox_id,kind,state,idempotency_key,request_hash,operation_id,source_seq,provenance_ref,redaction_class,payload_ref,destination_ref,available_at,enqueued_at,state_changed_at,repeatability,attempt,worker_id,claimed_at,lease_token,lease_expires_at,certainty,retry_at,receipt_ref,last_error_tag,result_at,reconciliation_ref,reconciled_at,cancellation_reason_tag) VALUES (?,?, 'pending',?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,NULL,NULL,'not_applied',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
		)
		.run(
			request.outboxId,
			request.kind,
			request.effect.idempotencyKey,
			request.effect.requestHash,
			request.effect.operationId,
			request.effect.sourceSeq,
			request.effect.provenanceRef,
			request.effect.redactionClass,
			request.payloadRef,
			request.destinationRef,
			request.availableAt,
			request.enqueuedAt,
			request.enqueuedAt,
			request.repeatability,
		);
	const record = decodeRecord(
		database
			.query(`SELECT * FROM ${OUTBOX} WHERE outbox_id=?`)
			.get(request.outboxId) as RawRow,
	);
	const decision = freeze({ decision: "applied" as const, record });
	database
		.query(
			`INSERT INTO ${DECISIONS}(decision_key,method,request_hash,result_json,outbox_id,protected_lease_token) VALUES (?, 'enqueue', ?, ?, ?, NULL)`,
		)
		.run(
			key,
			request.effect.requestHash,
			JSON.stringify(decision),
			request.outboxId,
		);
	return Result.ok(decision);
}
function verifyDatabase(database: Database) {
	const fk = database.query("PRAGMA foreign_keys").get() as
		| { foreign_keys?: number }
		| undefined;
	if (fk?.foreign_keys !== 1) throw new Error();
	database.query(`SELECT outbox_id FROM ${OUTBOX} LIMIT 1`).get();
	database.query(`SELECT decision_key FROM ${DECISIONS} LIMIT 1`).get();
	database.exec("PRAGMA busy_timeout = 5000");
}
function decodeRecord(row: RawRow): OutboxRecord {
	const value: OutboxRecord = {
		outboxId: s(row.outbox_id),
		kind: s(row.kind) as OutboxRecord["kind"],
		state: s(row.state) as OutboxRecord["state"],
		idempotencyKey: s(row.idempotency_key),
		requestHash: s(row.request_hash),
		operationId: n(row.operation_id),
		sourceSeq: ni(row.source_seq),
		provenanceRef: s(row.provenance_ref),
		redactionClass: s(row.redaction_class) as OutboxRecord["redactionClass"],
		payloadRef: s(row.payload_ref),
		destinationRef: n(row.destination_ref),
		availableAt: s(row.available_at),
		enqueuedAt: s(row.enqueued_at),
		stateChangedAt: s(row.state_changed_at),
		repeatability: s(row.repeatability) as OutboxRecord["repeatability"],
		attempt: i(row.attempt),
		workerId: n(row.worker_id),
		claimedAt: n(row.claimed_at),
		leaseToken: n(row.lease_token),
		leaseExpiresAt: n(row.lease_expires_at),
		certainty: n(row.certainty) as OutboxRecord["certainty"],
		retryAt: n(row.retry_at),
		receiptRef: n(row.receipt_ref),
		lastErrorTag: n(row.last_error_tag),
		resultAt: n(row.result_at),
		reconciliationRef: n(row.reconciliation_ref),
		reconciledAt: n(row.reconciled_at),
		cancellationReasonTag: n(row.cancellation_reason_tag),
	};
	if (
		!/^[0-9a-f]{64}$/.test(value.requestHash) ||
		!Number.isSafeInteger(value.attempt)
	)
		throw new Error();
	return freeze(value);
}
function s(v: unknown): string {
	if (typeof v !== "string" || !v) throw new Error();
	return v;
}
function n(v: unknown): string | null {
	if (v === null) return null;
	return s(v);
}
function i(v: unknown): number {
	if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error();
	return v as number;
}
function ni(v: unknown): number | null {
	return v === null ? null : i(v);
}
function storeError(
	tag: OutboxStoreErrorTag,
	certainty: EffectCertainty = "not_applied",
	retryable = false,
): OutboxStoreError {
	return freeze({ _tag: tag, certainty, retryable });
}
function applied(record: OutboxRecord): OutboxMutationDecision {
	return freeze({ decision: "applied", record });
}
function stale(): OutboxMutationDecision {
	return freeze({ decision: "stale", record: null });
}
function replayDecision<T>(row: DecisionRow): T {
	const value = JSON.parse(row.result_json) as Record<string, unknown>;
	if (value.decision === "applied") value.decision = "replayed";
	else if (value.decision === "empty") value.decision = "replayed";
	return freeze(value) as T;
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function decisionTag(value: unknown): string {
	try {
		return typeof (value as { decision?: unknown })?.decision === "string"
			? (value as { decision: string }).decision
			: "ok";
	} catch {
		return "ok";
	}
}
function decisionCertainty(value: unknown): EffectCertainty | null {
	try {
		const record =
			(value as { record?: OutboxRecord; lease?: OutboxLease })?.record ??
			(value as { lease?: OutboxLease })?.lease?.record;
		return record?.certainty ?? null;
	} catch {
		return null;
	}
}
