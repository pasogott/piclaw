import { createHash } from "node:crypto";
import { Result } from "@earendil-works/pi-agent-core";

import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
  type NormalisedEffectTrace,
} from "../../contracts/common.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CleanupScheduledRunsRequest,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ScheduledRunLease,
  ScheduledRunRecord,
  ScheduledRunStore,
  ScheduledRunStoreError,
  ScheduledTaskAuthority,
  ScheduledTaskAuthorityInput,
  ScheduledTaskSnapshot,
  UpdateScheduledTaskAuthorityRequest,
} from "../../contracts/scheduled-run-store.js";
import { computeNextRun } from "../../../task-scheduler-utils.js";
import type { ContractTestContext } from "../contract-suite.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ID = /^\S{1,512}$/u;
const TAG = /^[A-Za-z0-9_.:-]{1,128}$/u;

type Head = { revision: number; status: "active" | "paused" | "completed" | "deleted"; nextRunAt: string | null; snapshots: Map<number, ScheduledTaskSnapshot> };
type Run = { record: ScheduledRunRecord; snapshot: ScheduledTaskSnapshot; tokenHash: string | null; claimedAt: string };
type Source = { sourceId: string; kind: string; chatJid: string; sourceSeq: number; operationId: string; primary: boolean };
type Decision = { requestHash: string; value: unknown; runId: string | null };
type Tombstone = ScheduledRunRecord & { decisionHash: string };

export interface FakeScheduledRunSnapshot {
  readonly heads: readonly [string, Head][];
  readonly runs: readonly [string, Run][];
  readonly decisions: readonly [string, Decision][];
  readonly outboxIds: readonly string[];
  readonly sources: readonly [string, Source][];
  readonly tombstones: readonly [string, Tombstone][];
  readonly trace: readonly NormalisedEffectTrace[];
}

function clone<T>(value: T): T { return structuredClone(value); }
function dataOnly(value: unknown, seen: Set<object>): boolean {
  if (value === null || typeof value !== "object") return ["string", "number", "boolean", "undefined"].includes(typeof value) || value === null;
  if (seen.has(value)) return false;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || !dataOnly(descriptor.value, seen)) return false;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}
function freezeRecord(record: ScheduledRunRecord): ScheduledRunRecord {
  return Object.freeze({ ...record, outboxIds: Object.freeze([...record.outboxIds]) });
}
function err(tag: ScheduledRunStoreError["_tag"], certainty: "not_applied" | "unknown" = "not_applied", details: Partial<ScheduledRunStoreError> = {}): ScheduledRunStoreError {
  return Object.freeze({ _tag: tag, certainty, retryable: tag === "storage_unavailable", ...details });
}
class FakeFailure extends Error {
  constructor(readonly error: ScheduledRunStoreError) { super(error._tag); }
}
function validInstant(value: unknown): value is string {
  return typeof value === "string" && INSTANT.test(value) && new Date(value).toISOString() === value;
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function runId(taskId: string, scheduledFor: string): string { return `scheduled_run:${digest(JSON.stringify([taskId, scheduledFor]))}`; }
function token(prefix: string, id: string, attempt: number): string { return `scheduled_lease:${digest(JSON.stringify([prefix, id, attempt]))}`; }
function tokenHash(value: string): string { return digest(value); }
function requestHash(value: unknown): string { return hashCanonicalRequest(value as CanonicalJsonValue); }
function isIdentity(value: unknown): value is EffectIdentity {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.idempotencyKey === "string" && ID.test(row.idempotencyKey)
    && typeof row.requestHash === "string" && HASH.test(row.requestHash)
    && (row.operationId === null || (typeof row.operationId === "string" && ID.test(row.operationId)))
    && (row.sourceSeq === null || Number.isSafeInteger(row.sourceSeq))
    && typeof row.provenanceRef === "string" && row.provenanceRef.length > 0
    && ["public", "private", "secret"].includes(row.redactionClass as string);
}
function effectValid(request: { effect: EffectIdentity }): boolean {
  return isIdentity(request.effect) && request.effect.requestHash === requestHash(request);
}

function configProjection(input: ScheduledTaskAuthorityInput): CanonicalJsonValue {
  return {
    taskId: input.taskId, chatJid: input.chatJid, kind: input.kind, payloadRef: input.payloadRef,
    modelLabel: input.modelLabel, scheduleType: input.scheduleType, scheduleValue: input.scheduleValue,
    timezone: input.timezone, notifyOnComplete: input.notifyOnComplete, muted: input.muted,
    cwd: input.cwd, timeoutSec: input.timeoutSec, internalTask: input.internalTask,
    redactionClass: input.redactionClass, executionRepeatability: input.executionRepeatability,
  } as CanonicalJsonValue;
}
function taskSnapshot(input: ScheduledTaskAuthorityInput, revision: number): ScheduledTaskSnapshot {
  return Object.freeze({ ...(configProjection(input) as Omit<ScheduledTaskSnapshot, "revision" | "configHash">), revision, configHash: hashCanonicalRequest(configProjection(input)) }) as ScheduledTaskSnapshot;
}
function validTask(input: ScheduledTaskAuthorityInput): boolean {
  if (!ID.test(input.taskId) || !ID.test(input.chatJid) || !input.payloadRef || !validInstant(input.nextRunAt) || !validInstant(input.authoredAt)) return false;
  if (input.muted === input.notifyOnComplete) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(new Date(0)); } catch { return false; }
  if (input.kind === "agent" && input.executionRepeatability !== "agent_source") return false;
  if (input.kind !== "agent" && input.executionRepeatability === "agent_source") return false;
  if (input.kind === "internal" && (!input.internalTask || !TAG.test(input.internalTask.discriminator))) return false;
  if (input.kind !== "internal" && input.internalTask !== null) return false;
  if (input.scheduleType === "interval" && (!/^[1-9]\d*$/u.test(input.scheduleValue) || !Number.isSafeInteger(Number(input.scheduleValue)))) return false;
  if (input.scheduleType === "once" && !validInstant(input.scheduleValue)) return false;
  if (input.scheduleType === "cron" && computeNextRun("cron", input.scheduleValue, { currentDate: input.nextRunAt, timezone: input.timezone }) === null) return false;
  return true;
}

export class FakeScheduledRunBackend {
  heads = new Map<string, Head>();
  runs = new Map<string, Run>();
  decisions = new Map<string, Decision>();
  outboxIds = new Set<string>();
  sources = new Map<string, Source>();
  tombstones = new Map<string, Tombstone>();

  snapshot(trace: readonly NormalisedEffectTrace[] = []): FakeScheduledRunSnapshot {
    return clone({ heads: [...this.heads], runs: [...this.runs], decisions: [...this.decisions], outboxIds: [...this.outboxIds], sources: [...this.sources], tombstones: [...this.tombstones], trace });
  }
  restore(snapshot: FakeScheduledRunSnapshot): void {
    this.heads = new Map(clone(snapshot.heads)); this.runs = new Map(clone(snapshot.runs));
    this.decisions = new Map(clone(snapshot.decisions)); this.outboxIds = new Set(clone(snapshot.outboxIds));
    this.sources = new Map(clone(snapshot.sources)); this.tombstones = new Map(clone(snapshot.tombstones));
  }
  acceptScheduledAgentSource(source: Source): void { this.sources.set(`${source.chatJid}:${source.sourceSeq}:${source.operationId}`, clone(source)); }
}

export function createFakeScheduledTaskAuthority(backend: FakeScheduledRunBackend): ScheduledTaskAuthority {
  return Object.freeze({
    create(input: ScheduledTaskAuthorityInput) {
      const closed = clone(input); if (!validTask(closed) || backend.heads.has(closed.taskId)) throw new TypeError("Invalid fake scheduled task.");
      const snapshot = taskSnapshot(closed, 1);
      backend.heads.set(closed.taskId, { revision: 1, status: "active", nextRunAt: closed.nextRunAt, snapshots: new Map([[1, snapshot]]) });
      return snapshot;
    },
    update(input: UpdateScheduledTaskAuthorityRequest) {
      const closed = clone(input); if (!validTask(closed)) throw new TypeError("Invalid fake scheduled task update.");
      const head = backend.heads.get(closed.taskId); if (!head || head.revision !== closed.expectedRevision || head.status === "deleted") throw new Error("Fake task revision mismatch.");
      const revision = head.revision + 1, snapshot = taskSnapshot(closed, revision);
      head.revision = revision; head.status = "active"; head.nextRunAt = closed.nextRunAt; head.snapshots.set(revision, snapshot);
      return snapshot;
    },
    pause(taskId: string) { const head = backend.heads.get(taskId); if (!head || head.status !== "active") throw new Error("Fake active task not found."); head.status = "paused"; },
    resume(taskId: string) {
      const head = backend.heads.get(taskId); if (!head || head.status !== "paused") throw new Error("Fake paused task not found.");
      const latest = [...backend.runs.values()].filter((run) => run.record.taskId === taskId && run.record.taskRevision === head.revision && run.record.headDisposition === "paused").sort((a, b) => b.record.scheduledFor.localeCompare(a.record.scheduledFor))[0];
      if (latest) head.nextRunAt = latest.record.nextRunAt;
      head.status = head.nextRunAt === null ? "completed" : "active";
    },
    delete(taskId: string) { const head = backend.heads.get(taskId); if (!head || head.status === "deleted") throw new Error("Fake task not found."); head.status = "deleted"; head.nextRunAt = null; },
    get(taskId: string) { const head = backend.heads.get(taskId); return head?.snapshots.get(head.revision) ?? null; },
  });
}

export class FakeScheduledRunStore implements ScheduledRunStore {
  readonly trace: EffectTraceRecorder;
  private readonly plannedFaults = new Map<string, Set<number>>();
  private readonly faultCounts = new Map<string, number>();
  constructor(readonly backend: FakeScheduledRunBackend, private readonly context: ContractTestContext, trace: readonly NormalisedEffectTrace[] = []) {
    this.trace = EffectTraceRecorder.fromSnapshot(trace);
  }

  planFault(method: string, point: "before_effect" | "effect_then_lost_acknowledgement", occurrence: number): void {
    const key = `${method}:${point}`;
    const base = this.faultCounts.get(key) ?? 0;
    this.plannedFaults.set(key, new Set([base + occurrence]));
  }

  async claimDue(input: ClaimDueRunsRequest) {
    const request = this.close(input);
    const effectId = request ? `claim:${tokenHash(request.leaseTokenPrefix)}` : "invalid";
    if (!request || !validInstant(request.now) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100 || !ID.test(request.workerId) || !ID.test(request.leaseTokenPrefix) || !Number.isSafeInteger(request.leaseDurationMs) || request.leaseDurationMs < 1 || !Array.isArray(request.reclaimAuthorities)) return Result.err(err("invalid_request"));
    return this.mutate("claimDue", effectId, () => {
      const key = `claim:${tokenHash(request.leaseTokenPrefix)}`, hash = requestHash(request);
      const replay = this.decision(key, hash);
      if (replay !== undefined) return Result.ok(this.restoreClaim(request, replay));
      type Candidate = { kind: "new" | "expired"; taskId: string; scheduledFor: string; id: string };
      const candidates: Candidate[] = [];
      for (const [taskId, head] of this.backend.heads) if (head.status === "active" && head.nextRunAt && head.nextRunAt <= request.now) candidates.push({ kind: "new", taskId, scheduledFor: head.nextRunAt, id: runId(taskId, head.nextRunAt) });
      for (const [id, run] of this.backend.runs) if ((run.record.state === "claimed" || run.record.state === "source_bound") && run.record.leaseExpiresAt! <= request.now) candidates.push({ kind: "expired", taskId: run.record.taskId, scheduledFor: run.record.scheduledFor, id });
      candidates.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));
      const leases: ScheduledRunLease[] = [], rows: Array<{ runId: string; attempt: number; state: "claimed" | "source_bound"; workerId: string; leaseExpiresAt: string }> = [];
      for (const candidate of candidates) {
        if (leases.length >= request.limit) break;
        if (candidate.kind === "new") {
          if (this.backend.runs.has(candidate.id) || this.backend.tombstones.has(candidate.id)) continue;
          const head = this.backend.heads.get(candidate.taskId)!; if (head.status !== "active" || head.nextRunAt !== candidate.scheduledFor) continue;
          const snapshot = head.snapshots.get(head.revision)!;
          const leaseToken = token(request.leaseTokenPrefix, candidate.id, 1), expires = new Date(new Date(request.now).getTime() + request.leaseDurationMs).toISOString();
          const record = freezeRecord({ runId: candidate.id, taskId: candidate.taskId, taskRevision: snapshot.revision, scheduledFor: candidate.scheduledFor, state: "claimed", attempt: 1, workerId: request.workerId, leaseExpiresAt: expires, acceptedSourceSeq: null, operationId: null, status: null, durationMs: null, resultRef: null, errorCode: null, nextRunAt: null, headDisposition: "pending", settledAt: null, abandonmentReasonTag: null, outboxIds: [], retained: false });
          this.backend.runs.set(candidate.id, { record, snapshot, tokenHash: tokenHash(leaseToken), claimedAt: request.now });
          leases.push(Object.freeze({ record: record as ScheduledRunLease["record"], task: snapshot, leaseToken })); rows.push({ runId: candidate.id, attempt: 1, state: "claimed", workerId: request.workerId, leaseExpiresAt: expires });
        } else {
          const run = this.backend.runs.get(candidate.id)!; const expected = request.reclaimAuthorities.find((item) => item.runId === candidate.id && item.expectedAttempt === run.record.attempt);
          const allowed = run.snapshot.executionRepeatability === "agent_source" || (run.snapshot.executionRepeatability === "repeatable" && expected?.kind === "repeatable") || (run.snapshot.executionRepeatability === "reconciliation_required" && expected?.kind === "reconciled_absent");
          if (!allowed) continue;
          const attempt = run.record.attempt + 1, leaseToken = token(request.leaseTokenPrefix, candidate.id, attempt), expires = new Date(new Date(request.now).getTime() + request.leaseDurationMs).toISOString();
          run.tokenHash = tokenHash(leaseToken); run.claimedAt = request.now;
          run.record = freezeRecord({ ...run.record, attempt, workerId: request.workerId, leaseExpiresAt: expires });
          leases.push(Object.freeze({ record: run.record as ScheduledRunLease["record"], task: run.snapshot, leaseToken })); rows.push({ runId: candidate.id, attempt, state: run.record.state === "source_bound" ? "source_bound" : "claimed", workerId: request.workerId, leaseExpiresAt: expires });
        }
      }
      this.backend.decisions.set(key, { requestHash: hash, value: clone(rows), runId: null });
      return Result.ok(Object.freeze(leases));
    });
  }

  async renew(input: RenewScheduledRunRequest) {
    const request = this.close(input); if (!request || !validInstant(request.now) || !validInstant(request.leaseExpiresAt) || request.leaseExpiresAt <= request.now) return Result.err(err("invalid_request"));
    return this.mutate("renew", `renew:${request.runId}`, () => {
      const fenced = this.fence(request); if (!fenced.ok) return fenced;
      const run = fenced.value; if (request.leaseExpiresAt <= run.record.leaseExpiresAt!) return Result.err(err("invalid_request"));
      run.record = freezeRecord({ ...run.record, leaseExpiresAt: request.leaseExpiresAt });
      return Result.ok(Object.freeze({ record: run.record as ScheduledRunLease["record"], task: run.snapshot, leaseToken: request.leaseToken }));
    });
  }

  async bindAcceptedSource(input: BindScheduledSourceRequest) {
    const request = this.close(input); if (!request || !effectValid(request) || !validInstant(request.boundAt)) return Result.err(err("invalid_request"));
    return this.mutate("bindAcceptedSource", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      if (run.record.state === "source_bound") return Result.err(err("idempotency_conflict"));
      if (run.snapshot.kind !== "agent" || run.record.state !== "claimed" || request.effect.operationId !== request.operationId || request.effect.sourceSeq !== request.sourceSeq) return Result.err(err("invalid_transition"));
      const source = this.backend.sources.get(`${run.snapshot.chatJid}:${request.sourceSeq}:${request.operationId}`);
      if (!source) return Result.err(err("not_found"));
      if (source.sourceId !== request.runId || source.kind !== "scheduled_agent" || !source.primary) return Result.err(err("invalid_transition"));
      run.record = freezeRecord({ ...run.record, state: "source_bound", acceptedSourceSeq: request.sourceSeq, operationId: request.operationId });
      this.backend.decisions.set(key, { requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async complete(input: CompleteScheduledRunRequest) {
    const request = this.close(input); if (!request || !effectValid(request) || !validInstant(request.completedAt) || !Number.isSafeInteger(request.durationMs) || request.durationMs < 0 || (request.status === "success" ? request.errorCode !== null : !request.errorCode)) return Result.err(err("invalid_request"));
    return this.mutate("complete", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      if (!this.resultShape(run, request)) return Result.err(err("invalid_transition"));
      for (const intent of request.outboxIntents) {
        if (!isIdentity(intent.effect) || intent.effect.requestHash !== requestHash(intent) || this.backend.outboxIds.has(intent.outboxId)) return Result.err(err("idempotency_conflict"));
        if (run.snapshot.kind === "agent" ? (intent.effect.operationId !== run.record.operationId || intent.effect.sourceSeq !== run.record.acceptedSourceSeq) : (intent.effect.operationId !== null || intent.effect.sourceSeq !== null)) return Result.err(err("invalid_request"));
        if ((run.snapshot.muted || run.snapshot.kind === "internal") && intent.kind === "notification") return Result.err(err("invalid_request"));
      }
      const next = this.successor(run, request.completedAt, null), headDisposition = this.headDecision(run, next);
      request.outboxIntents.forEach((intent) => this.backend.outboxIds.add(intent.outboxId));
      run.tokenHash = null; run.record = freezeRecord({ ...run.record, state: "completed", workerId: null, leaseExpiresAt: null, status: request.status, durationMs: request.durationMs, resultRef: request.resultRef, errorCode: request.errorCode, nextRunAt: headDisposition === "advanced" || headDisposition === "paused" ? next : null, headDisposition, settledAt: request.completedAt, outboxIds: request.outboxIntents.map((intent) => intent.outboxId) });
      this.advanceHead(run, next, headDisposition);
      this.backend.decisions.set(key, { requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async abandon(input: AbandonScheduledRunRequest) {
    const request = this.close(input); if (!request || !effectValid(request) || !validInstant(request.abandonedAt) || !TAG.test(request.reasonTag) || (request.retryAt !== null && (!validInstant(request.retryAt) || request.retryAt <= request.abandonedAt))) return Result.err(err("invalid_request"));
    return this.mutate("abandon", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      const next = this.successor(run, request.abandonedAt, request.retryAt), headDisposition = this.headDecision(run, next);
      run.tokenHash = null; run.record = freezeRecord({ ...run.record, state: "abandoned", workerId: null, leaseExpiresAt: null, nextRunAt: headDisposition === "advanced" || headDisposition === "paused" ? next : null, headDisposition, settledAt: request.abandonedAt, abandonmentReasonTag: request.reasonTag });
      this.advanceHead(run, next, headDisposition);
      this.backend.decisions.set(key, { requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async get(id: string) { if (!ID.test(id)) return Result.err(err("invalid_request")); return Result.ok(this.backend.runs.get(id)?.record ?? this.backend.tombstones.get(id) ?? null); }
  async listRuns(input: ListScheduledRunsRequest = {}) {
    const limit = input.limit ?? 50; if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || ((input.afterRunId === undefined) !== (input.afterScheduledFor === undefined))) return Result.err(err("invalid_request"));
    const rows = [...[...this.backend.runs.values()].map((run) => run.record), ...this.backend.tombstones.values()]
      .filter((row) => (!input.taskId || row.taskId === input.taskId) && (!input.state || row.state === input.state) && (!input.afterScheduledFor || row.scheduledFor > input.afterScheduledFor || (row.scheduledFor === input.afterScheduledFor && row.runId > input.afterRunId!)))
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.runId.localeCompare(b.runId)).slice(0, limit);
    return Result.ok(Object.freeze(rows));
  }
  async cleanupTerminal(input: CleanupScheduledRunsRequest) {
    if (!validInstant(input.settledBefore) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) return Result.err(err("invalid_request"));
    return this.mutate("cleanupTerminal", `cleanup:${input.settledBefore}:${input.limit}`, () => {
      const candidates = [...this.backend.runs.values()].filter((run) => (run.record.state === "completed" || run.record.state === "abandoned") && run.record.settledAt! < input.settledBefore).sort((a, b) => a.record.settledAt!.localeCompare(b.record.settledAt!) || a.record.runId.localeCompare(b.record.runId)).slice(0, input.limit);
      const ids: string[] = [];
      for (const run of candidates) {
        const terminal = [...this.backend.decisions.values()].find((decision) => decision.runId === run.record.runId);
        const retained = Object.freeze({ ...run.record, workerId: null, leaseExpiresAt: null, acceptedSourceSeq: null, operationId: null, durationMs: null, resultRef: null, errorCode: null, abandonmentReasonTag: null, outboxIds: Object.freeze([]), retained: true, decisionHash: terminal?.requestHash ?? requestHash(run.record) }) as Tombstone;
        this.backend.tombstones.set(run.record.runId, retained); this.backend.runs.delete(run.record.runId);
        for (const [key, decision] of this.backend.decisions) if (decision.runId === run.record.runId) this.backend.decisions.delete(key);
        ids.push(run.record.runId);
      }
      return Result.ok(Object.freeze({ removed: ids.length, runIds: Object.freeze(ids) }));
    });
  }

  snapshot(): FakeScheduledRunSnapshot { return this.backend.snapshot(this.trace.snapshot()); }
  restore(snapshot: FakeScheduledRunSnapshot): FakeScheduledRunStore { this.backend.restore(snapshot); return new FakeScheduledRunStore(this.backend, this.context, snapshot.trace); }

  private close<T>(value: T): T | null {
    try { return dataOnly(value, new Set()) ? clone(value) : null; } catch { return null; }
  }
  private mutate<T>(method: "claimDue" | "renew" | "bindAcceptedSource" | "complete" | "abandon" | "cleanupTerminal", effectId: string, action: () => ReturnType<typeof Result.ok<T>> | ReturnType<typeof Result.err<ScheduledRunStoreError>>) {
    this.trace.recordCall({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: null, resultTag: "call" });
    if (this.hitFault(method, "before_effect")) return Result.err(err("storage_unavailable"));
    const snapshot = this.backend.snapshot();
    let result;
    try { result = action(); } catch (error) { this.backend.restore(snapshot); return Result.err(error instanceof FakeFailure ? error.error : err("storage_unavailable")); }
    if (!result.ok) { this.backend.restore(snapshot); this.trace.recordResult({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: result.error.certainty, resultTag: result.error._tag }); return result; }
    if (this.hitFault(method, "effect_then_lost_acknowledgement")) return Result.err(err("storage_unavailable", "unknown"));
    this.trace.recordResult({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: "applied", resultTag: "applied" });
    return result;
  }
  private hitFault(method: string, point: "before_effect" | "effect_then_lost_acknowledgement"): boolean {
    const key = `${method}:${point}`;
    const occurrence = (this.faultCounts.get(key) ?? 0) + 1;
    this.faultCounts.set(key, occurrence);
    return this.plannedFaults.get(key)?.has(occurrence) ?? this.context.faults.hit(point);
  }
  private decision(key: string, hash: string): unknown | undefined { const existing = this.backend.decisions.get(key); if (!existing) return undefined; if (existing.requestHash !== hash) throw new FakeFailure(err("idempotency_conflict")); return clone(existing.value); }
  private recordDecision(key: string, hash: string, id: string): ScheduledRunRecord | null {
    const existing = this.backend.decisions.get(key); if (existing) { if (existing.requestHash !== hash) throw new FakeFailure(err("idempotency_conflict")); return this.backend.runs.get(id)?.record ?? this.backend.tombstones.get(id) ?? null; }
    const tombstone = this.backend.tombstones.get(id); if (!tombstone) return null; if (tombstone.decisionHash !== hash) throw new FakeFailure(err("idempotency_conflict")); return tombstone;
  }
  private restoreClaim(request: ClaimDueRunsRequest, value: unknown): readonly ScheduledRunLease[] {
    if (!Array.isArray(value)) throw new Error("corrupt");
    return Object.freeze(value.map((row: { runId: string; attempt: number; state: "claimed" | "source_bound"; workerId: string; leaseExpiresAt: string }) => {
      const run = this.backend.runs.get(row.runId); if (!run || (row.state !== "claimed" && row.state !== "source_bound")) throw new Error("corrupt");
      const leaseToken = token(request.leaseTokenPrefix, row.runId, row.attempt);
      const record = freezeRecord({ ...run.record, state: row.state, attempt: row.attempt, workerId: row.workerId, leaseExpiresAt: row.leaseExpiresAt, acceptedSourceSeq: row.state === "source_bound" ? run.record.acceptedSourceSeq : null, operationId: row.state === "source_bound" ? run.record.operationId : null, status: null, durationMs: null, resultRef: null, errorCode: null, nextRunAt: null, headDisposition: "pending", settledAt: null, abandonmentReasonTag: null, outboxIds: [], retained: false });
      return Object.freeze({ record: record as ScheduledRunLease["record"], task: run.snapshot, leaseToken });
    }));
  }
  private fence(request: { runId: string; workerId: string; expectedAttempt: number; expectedTaskRevision: number; leaseToken: string; now: string }) {
    const run = this.backend.runs.get(request.runId); if (!run) return Result.err(err(this.backend.tombstones.has(request.runId) ? "invalid_transition" : "not_found"));
    if (run.record.taskRevision !== request.expectedTaskRevision) return Result.err(err("task_revision_mismatch", "not_applied", { observedTaskRevision: run.record.taskRevision }));
    if (run.record.state === "completed" || run.record.state === "abandoned") return Result.err(err("invalid_transition"));
    if (run.record.workerId !== request.workerId || run.record.attempt !== request.expectedAttempt || run.tokenHash !== tokenHash(request.leaseToken)) return Result.err(err("lease_conflict", "not_applied", { observedAttempt: run.record.attempt }));
    if (run.record.leaseExpiresAt! <= request.now) return Result.err(err("lease_expired"));
    return Result.ok(run);
  }
  private resultShape(run: Run, request: CompleteScheduledRunRequest): boolean {
    if (run.snapshot.kind === "agent") return run.record.state === "source_bound" && request.effect.operationId === run.record.operationId && request.effect.sourceSeq === run.record.acceptedSourceSeq;
    return run.record.state === "claimed" && request.effect.operationId === null && request.effect.sourceSeq === null;
  }
  private successor(run: Run, settledAt: string, retryAt: string | null): string | null {
    if (retryAt) return retryAt; if (run.snapshot.scheduleType === "once") return null;
    if (run.snapshot.scheduleType === "interval") return new Date(new Date(settledAt).getTime() + Number(run.snapshot.scheduleValue)).toISOString();
    const next = computeNextRun("cron", run.snapshot.scheduleValue, { currentDate: run.record.scheduledFor, timezone: run.snapshot.timezone }); if (!next) throw new Error("corrupt"); return next;
  }
  private headDecision(run: Run, _next: string | null): "advanced" | "paused" | "deleted" | "superseded" {
    const head = this.backend.heads.get(run.record.taskId); if (!head) throw new FakeFailure(err("task_not_found"));
    if (head.status === "deleted") return "deleted";
    if (head.revision !== run.record.taskRevision || head.nextRunAt !== run.record.scheduledFor) return "superseded";
    if (head.status === "paused") return "paused"; if (head.status === "active") return "advanced";
    throw new FakeFailure(err("task_inactive"));
  }
  private advanceHead(run: Run, next: string | null, disposition: string): void { if (disposition !== "advanced") return; const head = this.backend.heads.get(run.record.taskId)!; head.nextRunAt = next; head.status = next === null ? "completed" : "active"; }
}
