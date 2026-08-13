import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";
import type Database from "bun:sqlite";

import { hashCanonicalRequest, type CanonicalJsonValue, type NormalisedTraceInput } from "../contracts/common.js";
import type {
  AcceptCancellationRequest, AcceptedSourceSnapshot, AcceptSourceRequest, AppendOperationIntentRequest,
  BindHarnessRequest, ChatFrontierSnapshot, ClaimedOperation, ClaimNextSourceRequest, HarnessCorrelation,
  ListOpenOperationsRequest, OperationSnapshot, QueuedInputState, RecordQueuedInputRequest,
  ServiceWorkError, ServiceWorkErrorTag, ServiceWorkStore,
} from "../contracts/service-work-store.js";

export interface ServiceWorkAdapterRuntime {
  nextId(): string;
  hitFault(point: "before_effect" | "effect_then_lost_acknowledgement", method?: string): boolean;
  recordTrace(input: NormalisedTraceInput): void;
}

type MutationRequest = AcceptSourceRequest | ClaimNextSourceRequest | AppendOperationIntentRequest | AcceptCancellationRequest | BindHarnessRequest | RecordQueuedInputRequest;
type StoredDecision<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ServiceWorkError };
type MutationOutcome<T> = { readonly ok: true; readonly value: T; readonly duplicate: boolean } | { readonly ok: false; readonly error: ServiceWorkError };

interface SourceRow { chat_jid: string; source_seq: number; source_id: string; request_hash: string; kind: AcceptedSourceSnapshot["kind"]; state: AcceptedSourceSnapshot["state"]; payload_ref: string; target_operation_id: string | null; parent_source_seq: number | null; accepted_at: string; disposition_reason: string | null; provenance_ref: string }
interface OperationRow { operation_id: string; chat_jid: string; version: number; phase: OperationSnapshot["phase"]; primary_source_seq: number; cancellation_source_id: string | null; cancellation_source_seq: number | null; cancellation_cause: string | null; cancellation_requested_at: string | null; harness_session_id: string | null; harness_lane: string | null; harness_operation_id: string | null; harness_state: HarnessCorrelation["state"] | null; harness_watch_generation: number | null; terminal_disposition: OperationSnapshot["terminal"] extends infer _T ? string | null : never; terminal_message_row_id: number | null; terminal_error_code: string | null; terminal_committed_at: string | null }

export class CurrentPiclawServiceWorkStore implements ServiceWorkStore {
  constructor(readonly database: Database, private readonly runtime: ServiceWorkAdapterRuntime) {}

  async acceptSource(input: AcceptSourceRequest): Promise<ResultValue<AcceptedSourceSnapshot, ServiceWorkError>> {
    return this.mutate("acceptSource", input, (request) => {
      this.ensureChat(request.chatJid);
      const known = this.database.prepare("SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND source_id = ?").get(request.chatJid, request.sourceId) as SourceRow | undefined;
      if (known) return known.request_hash === request.effect.requestHash ? this.applied(sourceSnapshot(known), true) : this.rejected("idempotency_conflict");
      if (request.parentSourceSeq !== null && !this.sourceRow(request.chatJid, request.parentSourceSeq)) return this.rejected("not_found");
      const frontier = this.database.prepare("SELECT next_source_seq FROM service_effect_s01_chats WHERE chat_jid = ?").get(request.chatJid) as { next_source_seq: number };
      const sourceSeq = frontier.next_source_seq;
      this.database.prepare("UPDATE service_effect_s01_chats SET next_source_seq = next_source_seq + 1 WHERE chat_jid = ?").run(request.chatJid);
      this.database.prepare(`INSERT INTO service_effect_s01_sources
        (chat_jid,source_seq,source_id,request_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,accepted_at,disposition_reason,provenance_ref,create_wake_intent)
        VALUES (?,?,?,?,?,'pending',?,?,?,?,NULL,?,?)`).run(request.chatJid, sourceSeq, request.sourceId, request.effect.requestHash, request.kind, request.payloadRef, request.targetOperationId, request.parentSourceSeq, request.acceptedAt, request.effect.provenanceRef, request.createWakeIntent ? 1 : 0);
      if (request.createWakeIntent) this.database.prepare("INSERT INTO service_effect_s01_wake_intents(chat_jid,source_seq) VALUES (?,?)").run(request.chatJid, sourceSeq);
      return this.applied(sourceSnapshot(this.sourceRow(request.chatJid, sourceSeq)!), false);
    });
  }

  async claimNext(input: ClaimNextSourceRequest): Promise<ResultValue<ClaimedOperation | null, ServiceWorkError>> {
    return this.mutate("claimNext", input, (request) => {
      this.ensureChat(request.chatJid);
      const chat = this.chatRow(request.chatJid);
      if (chat.consumed_through_source_seq !== request.expectedFrontier) return this.rejected("frontier_mismatch", { observedFrontier: chat.consumed_through_source_seq });
      if (chat.active_operation_id) return this.rejected("owner_conflict", { conflictingOperationId: chat.active_operation_id });
      const source = this.database.prepare("SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND state = 'pending' AND source_seq > ? ORDER BY source_seq LIMIT 1").get(request.chatJid, request.expectedFrontier) as SourceRow | undefined;
      if (!source) return this.applied(null, false);
      const existing = this.operationRow(request.newOperationId);
      if (existing) return this.rejected("owner_conflict", { conflictingOperationId: existing.operation_id });
      this.database.prepare("UPDATE service_effect_s01_sources SET state = 'claimed' WHERE chat_jid = ? AND source_seq = ? AND state = 'pending'").run(request.chatJid, source.source_seq);
      this.database.prepare("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES (?, ?, 1, 'claimed', ?)").run(request.newOperationId, request.chatJid, source.source_seq);
      this.database.prepare("INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES (?,?,?)").run(request.chatJid, request.newOperationId, source.source_seq);
      this.database.prepare("UPDATE service_effect_s01_chats SET active_operation_id = ? WHERE chat_jid = ? AND active_operation_id IS NULL").run(request.newOperationId, request.chatJid);
      return this.applied(Object.freeze({ source: sourceSnapshot(this.sourceRow(request.chatJid, source.source_seq)!), operation: this.operationSnapshot(request.newOperationId)! }), false);
    });
  }

  async appendIntent(input: AppendOperationIntentRequest): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("appendIntent", input, (request) => {
      const checked = this.requireVersion(request.effect.operationId, request.expectedVersion); if (!checked.ok) return checked;
      const known = this.database.prepare("SELECT kind,payload_ref,created_at FROM service_effect_s01_intents WHERE operation_id = ? AND intent_id = ?").get(request.effect.operationId, request.intentId) as { kind: string; payload_ref: string; created_at: string } | undefined;
      if (known) return this.rejected("idempotency_conflict");
      this.database.prepare("INSERT INTO service_effect_s01_intents(operation_id,intent_id,kind,payload_ref,created_at) VALUES (?,?,?,?,?)").run(request.effect.operationId, request.intentId, request.kind, request.payloadRef, request.createdAt);
      this.bump(request.effect.operationId, request.expectedVersion);
      return this.applied(this.operationSnapshot(request.effect.operationId)!, false);
    });
  }

  async acceptCancellation(input: AcceptCancellationRequest): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("acceptCancellation", input, (request) => {
      const row = this.operationRow(request.effect.operationId); if (!row) return this.rejected("not_found");
      if (row.cancellation_source_seq !== null) {
        return row.cancellation_source_id === request.sourceId && row.cancellation_source_seq === request.sourceSeq && row.cancellation_cause === request.cause && row.cancellation_requested_at === request.requestedAt
          ? this.applied(this.operationSnapshot(request.effect.operationId)!, true) : this.rejected("owner_conflict", { conflictingOperationId: request.effect.operationId });
      }
      if (row.version !== request.expectedVersion) return this.rejected("version_mismatch", { observedVersion: row.version });
      const source = this.sourceRow(row.chat_jid, request.sourceSeq);
      if (!source || source.source_id !== request.sourceId) return this.rejected("not_found");
      this.database.prepare(`UPDATE service_effect_s01_operations SET cancellation_source_id=?, cancellation_source_seq=?, cancellation_cause=?, cancellation_requested_at=?, phase='cancelling', version=version+1 WHERE operation_id=? AND version=?`).run(request.sourceId, request.sourceSeq, request.cause, request.requestedAt, request.effect.operationId, request.expectedVersion);
      return this.applied(this.operationSnapshot(request.effect.operationId)!, false);
    });
  }

  async bindHarness(input: BindHarnessRequest): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("bindHarness", input, (request) => {
      const row = this.operationRow(request.effect.operationId); if (!row) return this.rejected("not_found");
      if (row.harness_session_id !== null) {
        return row.harness_session_id === request.sessionId && row.harness_lane === request.lane && row.harness_operation_id === request.harnessOperationId && row.harness_state === request.state && row.harness_watch_generation === request.watchGeneration
          ? this.applied(this.operationSnapshot(request.effect.operationId)!, true) : this.rejected("owner_conflict", { conflictingOperationId: request.effect.operationId });
      }
      if (row.version !== request.expectedVersion) return this.rejected("version_mismatch", { observedVersion: row.version });
      this.database.prepare(`UPDATE service_effect_s01_operations SET harness_session_id=?,harness_lane=?,harness_operation_id=?,harness_state=?,harness_watch_generation=?,phase=?,version=version+1 WHERE operation_id=? AND version=?`).run(request.sessionId, request.lane, request.harnessOperationId, request.state, request.watchGeneration, phaseForHarness(request.state), request.effect.operationId, request.expectedVersion);
      return this.applied(this.operationSnapshot(request.effect.operationId)!, false);
    });
  }

  async recordQueuedInput(input: RecordQueuedInputRequest): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("recordQueuedInput", input, (request) => {
      const checked = this.requireVersion(request.effect.operationId, request.expectedVersion); if (!checked.ok) return checked;
      const row = checked.row; const source = this.sourceRow(row.chat_jid, request.sourceSeq); if (!source) return this.rejected("not_found");
      let known = this.database.prepare("SELECT queue_kind,harness_entry_id,state FROM service_effect_s01_queued_inputs WHERE operation_id=? AND source_seq=?").get(request.effect.operationId, request.sourceSeq) as { queue_kind: string; harness_entry_id: string | null; state: QueuedInputState } | undefined;
      if (!known) {
        if (request.state !== "accepted" || (source.target_operation_id !== request.effect.operationId && source.source_seq !== row.primary_source_seq)) return this.rejected("invalid_transition");
        this.database.prepare("INSERT OR IGNORE INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES (?,?,?)").run(row.chat_jid, request.effect.operationId, request.sourceSeq);
        this.database.prepare("UPDATE service_effect_s01_sources SET state='claimed' WHERE chat_jid=? AND source_seq=? AND state='pending'").run(row.chat_jid, request.sourceSeq);
        this.database.prepare("INSERT INTO service_effect_s01_queued_inputs(chat_jid,operation_id,source_seq,queue_kind,harness_entry_id,state) VALUES (?,?,?,?,?,'accepted')").run(row.chat_jid, request.effect.operationId, request.sourceSeq, request.queueKind, request.harnessEntryId);
      } else {
        if (known.queue_kind !== request.queueKind || !validQueueEntryTransition(known.state, known.harness_entry_id, request.state, request.harnessEntryId) || !queueTransition(known.state, request.state)) return this.rejected("invalid_transition");
        this.database.prepare("UPDATE service_effect_s01_queued_inputs SET state=?, harness_entry_id=? WHERE operation_id=? AND source_seq=?").run(request.state, request.harnessEntryId, request.effect.operationId, request.sourceSeq);
        this.database.prepare("UPDATE service_effect_s01_sources SET state=? WHERE chat_jid=? AND source_seq=?").run(request.state === "queued" ? "queued" : request.state, row.chat_jid, request.sourceSeq);
      }
      this.bump(request.effect.operationId, request.expectedVersion);
      return this.applied(this.operationSnapshot(request.effect.operationId)!, false);
    });
  }

  async getOperation(operationId: string): Promise<ResultValue<OperationSnapshot | null, ServiceWorkError>> { return this.read("getOperation", operationId, () => this.operationSnapshot(validText(operationId) ? operationId : "")); }
  async getChatFrontier(chatJid: string): Promise<ResultValue<ChatFrontierSnapshot, ServiceWorkError>> {
    return this.read("getChatFrontier", chatJid, () => { if (!validText(chatJid)) throw new BoundaryError(); this.ensureChat(chatJid); const row = this.chatRow(chatJid); const pending = this.database.prepare("SELECT MIN(source_seq) AS seq FROM service_effect_s01_sources WHERE chat_jid=? AND state='pending'").get(chatJid) as { seq: number | null }; return Object.freeze({ chatJid, consumedThroughSourceSeq: row.consumed_through_source_seq, activeOperationId: row.active_operation_id, nextPendingSourceSeq: pending.seq }); });
  }
  async listOpenOperations(input: ListOpenOperationsRequest = {}): Promise<ResultValue<readonly OperationSnapshot[], ServiceWorkError>> {
    return this.read("listOpenOperations", "list", () => { const request = stableClone<ListOpenOperationsRequest>(input); if (!request || (request.chatJid !== undefined && !validText(request.chatJid)) || (request.afterOperationId !== undefined && !validText(request.afterOperationId)) || (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100))) throw new BoundaryError(); const limit = request.limit ?? 100; const rows = this.database.prepare(`SELECT operation_id FROM service_effect_s01_operations WHERE phase <> 'terminal' AND (? IS NULL OR chat_jid=?) AND operation_id > ? ORDER BY operation_id LIMIT ?`).all(request.chatJid ?? null, request.chatJid ?? null, request.afterOperationId ?? "", limit) as Array<{ operation_id: string }>; return Object.freeze(rows.map((row) => this.operationSnapshot(row.operation_id)!)); });
  }

  private async mutate<T>(method: string, input: MutationRequest, apply: (request: any) => MutationOutcome<T>): Promise<ResultValue<T, ServiceWorkError>> {
    const request = stableClone<MutationRequest>(input); const candidateEffect = request?.effect;
    this.trace(method, candidateEffect?.idempotencyKey ?? "invalid", candidateEffect?.operationId ?? null, candidateEffect?.sourceSeq ?? null, null, "call");
    if (!request || !validEffect(candidateEffect) || candidateEffect.requestHash !== safeHash(request) || !validMutation(method, request)) return this.fail(method, candidateEffect, serviceError("idempotency_conflict"));
    const effect = candidateEffect as MutationRequest["effect"];
    if (this.safeFault("before_effect", method)) return this.fail(method, effect, serviceError("storage_unavailable", "not_applied", true));
    try {
      const outcome = this.database.transaction(() => {
        const replay = this.readDecision<T>(method, effect.idempotencyKey, effect.requestHash); if (replay) return replay;
        const value = apply(request as never);
        if (!value.ok) { this.writeDecision(method, effect.idempotencyKey, effect.requestHash, value); return value; }
        if (this.safeFault("before_effect", method)) throw new RollbackFault();
        this.writeDecision(method, effect.idempotencyKey, effect.requestHash, value);
        return value;
      }).immediate();
      if (!outcome.ok) return this.fail(method, effect, outcome.error);
      if (this.safeFault("effect_then_lost_acknowledgement", method)) return this.fail(method, effect, serviceError("storage_unavailable", "unknown", true));
      return this.ok(method, effect, outcome.value, outcome.duplicate ? "duplicate" : "ok");
    } catch (error) { return this.fail(method, effect, serviceError("storage_unavailable", error instanceof RollbackFault ? "not_applied" : "unknown", true)); }
  }

  private async read<T>(method: string, effectId: string, run: () => T): Promise<ResultValue<T, ServiceWorkError>> { this.trace(method, validText(effectId) ? effectId : "invalid", null, null, null, "call"); try { const value = run(); this.trace(method, effectId || "invalid", null, null, null, "ok", "applied"); return Result.ok(value); } catch (error) { const tag = error instanceof BoundaryError ? "invalid_transition" : "storage_unavailable"; const failure = serviceError(tag, error instanceof BoundaryError ? "not_applied" : "unknown", tag === "storage_unavailable"); this.trace(method, effectId || "invalid", null, null, null, tag, failure.certainty); return Result.err(failure); } }
  private readDecision<T>(method: string, key: string, hash: string): MutationOutcome<T> | null { const row = this.database.prepare("SELECT request_hash,result_json FROM service_effect_s01_decisions WHERE method=? AND idempotency_key=?").get(method, key) as { request_hash: string; result_json: string } | undefined; if (!row) return null; if (row.request_hash !== hash) return this.rejected("idempotency_conflict"); try { const decision = deepFreeze(JSON.parse(row.result_json) as StoredDecision<T>); return decision.ok ? this.applied(decision.value, true) : { ok: false, error: decision.error }; } catch { return this.rejected("corrupt_state"); } }
  private writeDecision(method: string, key: string, hash: string, outcome: MutationOutcome<unknown>): void { const decision: StoredDecision<unknown> = outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: outcome.error }; this.database.prepare("INSERT INTO service_effect_s01_decisions(method,idempotency_key,request_hash,result_json) VALUES (?,?,?,?)").run(method, key, hash, JSON.stringify(decision)); }
  private ensureChat(chatJid: string): void { this.database.prepare("INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid) VALUES (?)").run(chatJid); }
  private chatRow(chatJid: string): { next_source_seq: number; consumed_through_source_seq: number; active_operation_id: string | null } { return this.database.prepare("SELECT next_source_seq,consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?").get(chatJid) as any; }
  private sourceRow(chatJid: string, seq: number): SourceRow | undefined { return this.database.prepare("SELECT * FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?").get(chatJid, seq) as SourceRow | undefined; }
  private operationRow(id: string): OperationRow | undefined { return this.database.prepare("SELECT * FROM service_effect_s01_operations WHERE operation_id=?").get(id) as OperationRow | undefined; }
  private operationSnapshot(id: string): OperationSnapshot | null { const row = this.operationRow(id); if (!row) return null; const claimed = (this.database.prepare("SELECT source_seq FROM service_effect_s01_operation_sources WHERE operation_id=? ORDER BY source_seq").all(id) as Array<{ source_seq: number }>).map((entry) => entry.source_seq); return operationSnapshot(row, claimed); }
  private requireVersion(id: string, version: number): ({ ok: true; row: OperationRow } | { ok: false; error: ServiceWorkError }) { const row = this.operationRow(id); if (!row) return this.rejected("not_found"); if (row.version !== version) return this.rejected("version_mismatch", { observedVersion: row.version }); return { ok: true, row }; }
  private bump(id: string, version: number): void { this.database.prepare("UPDATE service_effect_s01_operations SET version=version+1 WHERE operation_id=? AND version=?").run(id, version); }
  private applied<T>(value: T, duplicate: boolean): MutationOutcome<T> { return { ok: true, value: deepFreeze(value), duplicate }; }
  private rejected(tag: ServiceWorkErrorTag, details: Partial<ServiceWorkError> = {}): { ok: false; error: ServiceWorkError } { return { ok: false, error: serviceError(tag, "not_applied", false, details) }; }
  private ok<T>(method: string, effect: MutationRequest["effect"], value: T, tag: string): ResultValue<T, never> { this.trace(method, effect.idempotencyKey, effect.operationId, effect.sourceSeq, null, tag, "applied"); return Result.ok(value); }
  private fail(method: string, effect: MutationRequest["effect"] | undefined, error: ServiceWorkError): ResultValue<never, ServiceWorkError> { this.trace(method, effect?.idempotencyKey ?? "invalid", effect?.operationId ?? null, effect?.sourceSeq ?? null, null, error._tag, error.certainty); return Result.err(error); }
  private safeFault(point: "before_effect" | "effect_then_lost_acknowledgement", method: string): boolean { try { return this.runtime.hitFault(point, method) === true; } catch { return true; } }
  private trace(method: string, effectId: string, operationId: string | null, sourceSeq: number | null, version: number | null, resultTag: string, certainty?: ServiceWorkError["certainty"]): void { try { this.runtime.recordTrace({ contract: "EF-S01", method, effectId, operationId, sourceSeq, version, ...(certainty ? { certainty } : {}), resultTag }); } catch (error) { void error; /* trace observation cannot alter durable semantics */ } }
}

class BoundaryError extends Error {} class RollbackFault extends Error {}
function validText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim().length > 0; }
function validInstant(value: unknown): value is string { return validText(value) && Number.isFinite(Date.parse(value)); }
function validEffect(value: any): value is MutationRequest["effect"] { return value && validText(value.idempotencyKey) && typeof value.requestHash === "string" && (value.operationId === null || validText(value.operationId)) && (value.sourceSeq === null || (Number.isSafeInteger(value.sourceSeq) && value.sourceSeq >= 0)) && validText(value.provenanceRef) && ["public","private","secret"].includes(value.redactionClass); }
function validMutation(method: string, r: any): boolean { const safe = (n: unknown, min = 0) => Number.isSafeInteger(n) && (n as number) >= min; if (method === "acceptSource") return validText(r.chatJid) && validText(r.sourceId) && validText(r.payloadRef) && validInstant(r.acceptedAt) && typeof r.createWakeIntent === "boolean" && (r.targetOperationId === null || validText(r.targetOperationId)) && (r.parentSourceSeq === null || safe(r.parentSourceSeq, 1)); if (method === "claimNext") return validText(r.chatJid) && safe(r.expectedFrontier) && validText(r.newOperationId) && validInstant(r.claimedAt); if (!validText(r.effect.operationId) || !safe(r.expectedVersion, 1)) return false; if (method === "appendIntent") return validText(r.intentId) && validText(r.payloadRef) && validInstant(r.createdAt); if (method === "acceptCancellation") return validText(r.sourceId) && safe(r.sourceSeq, 1) && validText(r.cause) && validInstant(r.requestedAt); if (method === "bindHarness") return validText(r.sessionId) && validText(r.lane) && (r.harnessOperationId === null || validText(r.harnessOperationId)) && ["not_started","running","suspended","aborting","finished"].includes(r.state) && safe(r.watchGeneration); if (method === "recordQueuedInput") return safe(r.sourceSeq, 1) && ["steer","follow_up","next_run"].includes(r.queueKind) && (r.harnessEntryId === null || validText(r.harnessEntryId)) && ["accepted","queued","consumed","disposed"].includes(r.state); return false; }
function safeHash(value: MutationRequest): string { try { return hashCanonicalRequest(value as unknown as CanonicalJsonValue); } catch { return ""; } }
function stableClone<T>(value: unknown, depth = 0): T | null { try { if (depth > 8) return null; if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value as T; if (!value || typeof value !== "object") return null; if (Array.isArray(value)) { const out = value.map((entry) => stableClone(entry, depth + 1)); return (out.some((entry) => entry === null) ? null : out) as T | null; } const out: Record<string, unknown> = {}; for (const key of Object.keys(value)) { const first = (value as any)[key]; const second = (value as any)[key]; if (!Object.is(first, second)) return null; const cloned = stableClone(first, depth + 1); if (cloned === null && first !== null) return null; out[key] = cloned; } return out as T; } catch { return null; } }
function sourceSnapshot(row: SourceRow): AcceptedSourceSnapshot { return Object.freeze({ chatJid: row.chat_jid, sourceSeq: row.source_seq, sourceId: row.source_id, kind: row.kind, state: row.state, payloadRef: row.payload_ref, targetOperationId: row.target_operation_id, parentSourceSeq: row.parent_source_seq, acceptedAt: row.accepted_at, dispositionReason: row.disposition_reason, provenanceRef: row.provenance_ref }); }
function operationSnapshot(row: OperationRow, claimedSourceSeqs: number[]): OperationSnapshot { const cancellation = row.cancellation_source_seq === null ? null : Object.freeze({ sourceSeq: row.cancellation_source_seq, cause: row.cancellation_cause!, requestedAt: row.cancellation_requested_at! }); const harness = row.harness_session_id === null ? null : Object.freeze({ sessionId: row.harness_session_id, lane: row.harness_lane!, harnessOperationId: row.harness_operation_id, state: row.harness_state!, watchGeneration: row.harness_watch_generation! }); const terminal = row.terminal_disposition === null ? null : Object.freeze({ disposition: row.terminal_disposition as any, messageRowId: row.terminal_message_row_id, errorCode: row.terminal_error_code, committedAt: row.terminal_committed_at! }); return Object.freeze({ operationId: row.operation_id, chatJid: row.chat_jid, version: row.version, phase: row.phase, primarySourceSeq: row.primary_source_seq, claimedSourceSeqs: Object.freeze(claimedSourceSeqs), cancellation, harness, terminal }); }
function serviceError(tag: ServiceWorkErrorTag, certainty: ServiceWorkError["certainty"] = "not_applied", retryable = false, details: Partial<ServiceWorkError> = {}): ServiceWorkError { const bounded: any = { _tag: tag, certainty, retryable }; if (Number.isSafeInteger(details.observedVersion)) bounded.observedVersion = details.observedVersion; if (Number.isSafeInteger(details.observedFrontier)) bounded.observedFrontier = details.observedFrontier; if (validText(details.conflictingOperationId)) bounded.conflictingOperationId = details.conflictingOperationId; return Object.freeze(bounded); }
function phaseForHarness(state: HarnessCorrelation["state"]): OperationSnapshot["phase"] { return state === "not_started" ? "starting_harness" : state === "running" ? "executing" : state === "suspended" ? "suspended" : state === "aborting" ? "cancelling" : "settling"; }
function queueTransition(from: QueuedInputState, to: QueuedInputState): boolean { return (from === "accepted" && (to === "queued" || to === "disposed")) || (from === "queued" && (to === "consumed" || to === "disposed")); }
function validQueueEntryTransition(from: QueuedInputState, previous: string | null, to: QueuedInputState, next: string | null): boolean { if (from === "accepted" && to === "queued") return previous === null && validText(next); return previous === next; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const entry of Object.values(value as any)) deepFreeze(entry); Object.freeze(value); } return value; }
