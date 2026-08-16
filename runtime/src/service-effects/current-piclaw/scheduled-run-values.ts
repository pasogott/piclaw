import { createHash } from "node:crypto";

import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CleanupScheduledRunsRequest,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ScheduledRunReclaimAuthority,
  ScheduledTaskAuthorityInput,
  ScheduledTaskSnapshot,
  UpdateScheduledTaskAuthorityRequest,
} from "../contracts/scheduled-run-store.js";
import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../contracts/common.js";
import type { EnqueueOutboxRequest } from "../contracts/service-outbox-store.js";
import { computeNextRun } from "../../task-scheduler-utils.js";

const ID = /^[^\s]{1,512}$/u;
const REF = /^.{1,2048}$/su;
const TAG = /^[A-Za-z0-9_.:-]{1,128}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : value;
}

export function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
export function validRef(value: unknown): value is string {
  return typeof value === "string" && REF.test(value);
}
export function validTag(value: unknown): value is string {
  return typeof value === "string" && TAG.test(value);
}
export function validHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}
export function safeInteger(value: unknown, min = 0, max = MAX_SAFE): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
      && actual.every((key, index) => key === expected[index])
      && Object.values(descriptors).every((descriptor) => "value" in descriptor && descriptor.get === undefined && descriptor.set === undefined);
  } catch {
    return false;
  }
}

function dataOnly(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
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

function readObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!exactKeys(value, keys) || !dataOnly(value)) return null;
  try {
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = (value as Record<string, unknown>)[key];
    return out;
  } catch {
    return null;
  }
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function effect(value: unknown): EffectIdentity | null {
  const row = readObject(value, [
    "idempotencyKey", "requestHash", "operationId", "sourceSeq", "provenanceRef", "redactionClass",
  ]);
  if (!row || !validId(row.idempotencyKey) || !validHash(row.requestHash)) return null;
  if (row.operationId !== null && !validId(row.operationId)) return null;
  if (row.sourceSeq !== null && !safeInteger(row.sourceSeq, 0)) return null;
  if (!validRef(row.provenanceRef)) return null;
  if (row.redactionClass !== "public" && row.redactionClass !== "private" && row.redactionClass !== "secret") return null;
  return Object.freeze({
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    operationId: row.operationId as string | null,
    sourceSeq: row.sourceSeq as number | null,
    provenanceRef: row.provenanceRef,
    redactionClass: row.redactionClass,
  });
}

function outbox(value: unknown): EnqueueOutboxRequest | null {
  const row = readObject(value, [
    "effect", "outboxId", "kind", "payloadRef", "destinationRef", "availableAt", "enqueuedAt", "repeatability",
  ]);
  if (!row) return null;
  const identity = effect(row.effect);
  const kinds = new Set(["wake_chat", "timeline_broadcast", "channel_delivery", "notification", "scheduler_run_log", "maintenance"]);
  if (!identity || !validId(row.outboxId) || !kinds.has(row.kind as string) || !validRef(row.payloadRef)) return null;
  if (row.destinationRef !== null && !validRef(row.destinationRef)) return null;
  const availableAt = canonicalInstant(row.availableAt), enqueuedAt = canonicalInstant(row.enqueuedAt);
  if (!availableAt || !enqueuedAt || availableAt < enqueuedAt) return null;
  if (row.repeatability !== "repeatable" && row.repeatability !== "reconciliation_required") return null;
  return Object.freeze({
    effect: identity,
    outboxId: row.outboxId,
    kind: row.kind as EnqueueOutboxRequest["kind"],
    payloadRef: row.payloadRef,
    destinationRef: row.destinationRef as string | null,
    availableAt,
    enqueuedAt,
    repeatability: row.repeatability,
  });
}

export function deriveScheduledRunId(taskId: string, scheduledFor: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([taskId, scheduledFor]), "utf8")
    .digest("hex");
  return `scheduled_run:${digest}`;
}

export function validateScheduledRunId(runId: string, taskId: string, scheduledFor: string): boolean {
  return runId === deriveScheduledRunId(taskId, scheduledFor);
}

export function deriveScheduledLeaseToken(prefix: string, runId: string, attempt: number): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([prefix, runId, attempt]), "utf8")
    .digest("hex");
  return `scheduled_lease:${digest}`;
}

export function hashScheduledLeaseToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function scheduleValid(type: unknown, value: unknown, timezone: string, anchor: string): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024) return false;
  if (type === "interval") return /^[1-9]\d*$/u.test(value) && safeInteger(Number(value), 1);
  if (type === "once") return canonicalInstant(value) !== null;
  if (type === "cron") return computeNextRun("cron", value, { currentDate: anchor, timezone }) !== null;
  return false;
}

const TASK_KEYS = [
  "taskId", "chatJid", "kind", "payloadRef", "modelLabel", "scheduleType", "scheduleValue", "timezone",
  "notifyOnComplete", "muted", "cwd", "timeoutSec", "internalTask", "redactionClass",
  "executionRepeatability", "nextRunAt", "authoredAt",
] as const;

export function normaliseTaskAuthorityInput(value: unknown): ScheduledTaskAuthorityInput | null {
  const row = readObject(value, TASK_KEYS);
  if (!row || !validId(row.taskId) || !validId(row.chatJid) || !validRef(row.payloadRef)) return null;
  if (row.kind !== "agent" && row.kind !== "shell" && row.kind !== "internal") return null;
  if (row.modelLabel !== null && !validId(row.modelLabel)) return null;
  if (!validTimezone(row.timezone)) return null;
  const nextRunAt = canonicalInstant(row.nextRunAt), authoredAt = canonicalInstant(row.authoredAt);
  if (!nextRunAt || !authoredAt || !scheduleValid(row.scheduleType, row.scheduleValue, row.timezone as string, nextRunAt)) return null;
  if (typeof row.notifyOnComplete !== "boolean" || typeof row.muted !== "boolean" || row.muted === row.notifyOnComplete) return null;
  if (row.cwd !== null && !validRef(row.cwd)) return null;
  if (row.timeoutSec !== null && !safeInteger(row.timeoutSec, 1, 86400)) return null;
  if (row.redactionClass !== "public" && row.redactionClass !== "private" && row.redactionClass !== "secret") return null;
  if (row.executionRepeatability !== "agent_source" && row.executionRepeatability !== "repeatable" && row.executionRepeatability !== "reconciliation_required") return null;
  if (row.kind === "agent" && row.executionRepeatability !== "agent_source") return null;
  if (row.kind !== "agent" && row.executionRepeatability === "agent_source") return null;
  let internalTask: { discriminator: string; reference: string } | null = null;
  if (row.kind === "internal") {
    const internal = readObject(row.internalTask, ["discriminator", "reference"]);
    if (!internal || !validTag(internal.discriminator) || !validRef(internal.reference)) return null;
    internalTask = Object.freeze({ discriminator: internal.discriminator, reference: internal.reference });
  } else if (row.internalTask !== null) return null;
  if (row.kind !== "shell" && (row.cwd !== null || row.timeoutSec !== null)) return null;
  return Object.freeze({
    taskId: row.taskId,
    chatJid: row.chatJid,
    kind: row.kind,
    payloadRef: row.payloadRef,
    modelLabel: row.modelLabel as string | null,
    scheduleType: row.scheduleType as ScheduledTaskAuthorityInput["scheduleType"],
    scheduleValue: row.scheduleValue as string,
    timezone: row.timezone,
    notifyOnComplete: row.notifyOnComplete,
    muted: row.muted,
    cwd: row.cwd as string | null,
    timeoutSec: row.timeoutSec as number | null,
    internalTask,
    redactionClass: row.redactionClass,
    executionRepeatability: row.executionRepeatability,
    nextRunAt,
    authoredAt,
  });
}

export function normaliseTaskUpdate(value: unknown): UpdateScheduledTaskAuthorityRequest | null {
  if (!value || typeof value !== "object") return null;
  const keys = [...TASK_KEYS, "expectedRevision"];
  const row = readObject(value, keys);
  if (!row || !safeInteger(row.expectedRevision, 1)) return null;
  const base: Record<string, unknown> = {};
  for (const key of TASK_KEYS) base[key] = row[key];
  const parsed = normaliseTaskAuthorityInput(base);
  return parsed ? Object.freeze({ ...parsed, expectedRevision: row.expectedRevision }) : null;
}

export function taskConfigProjection(input: ScheduledTaskAuthorityInput): CanonicalJsonValue {
  return {
    taskId: input.taskId,
    chatJid: input.chatJid,
    kind: input.kind,
    payloadRef: input.payloadRef,
    modelLabel: input.modelLabel,
    scheduleType: input.scheduleType,
    scheduleValue: input.scheduleValue,
    timezone: input.timezone,
    notifyOnComplete: input.notifyOnComplete,
    muted: input.muted,
    cwd: input.cwd,
    timeoutSec: input.timeoutSec,
    internalTask: input.internalTask,
    redactionClass: input.redactionClass,
    executionRepeatability: input.executionRepeatability,
  } as CanonicalJsonValue;
}

export function makeTaskSnapshot(input: ScheduledTaskAuthorityInput, revision: number): ScheduledTaskSnapshot {
  return Object.freeze({
    ...taskConfigProjection(input) as Omit<ScheduledTaskSnapshot, "revision" | "configHash">,
    revision,
    configHash: hashCanonicalRequest(taskConfigProjection(input)),
  }) as ScheduledTaskSnapshot;
}

export function decodeTaskSnapshot(value: unknown): ScheduledTaskSnapshot | null {
  const row = readObject(value, [
    "taskId", "revision", "configHash", "chatJid", "kind", "payloadRef", "modelLabel", "scheduleType",
    "scheduleValue", "timezone", "notifyOnComplete", "muted", "cwd", "timeoutSec", "internalTask",
    "redactionClass", "executionRepeatability",
  ]);
  if (!row || !safeInteger(row.revision, 1) || !validHash(row.configHash)) return null;
  const authored = normaliseTaskAuthorityInput({
    taskId: row.taskId,
    chatJid: row.chatJid,
    kind: row.kind,
    payloadRef: row.payloadRef,
    modelLabel: row.modelLabel,
    scheduleType: row.scheduleType,
    scheduleValue: row.scheduleValue,
    timezone: row.timezone,
    notifyOnComplete: row.notifyOnComplete,
    muted: row.muted,
    cwd: row.cwd,
    timeoutSec: row.timeoutSec,
    internalTask: row.internalTask,
    redactionClass: row.redactionClass,
    executionRepeatability: row.executionRepeatability,
    nextRunAt: row.scheduleType === "once" ? row.scheduleValue : "2000-01-01T00:00:00.000Z",
    authoredAt: "2000-01-01T00:00:00.000Z",
  });
  if (!authored) return null;
  const snapshot = makeTaskSnapshot(authored, row.revision);
  return snapshot.configHash === row.configHash ? snapshot : null;
}

export function normaliseClaim(value: unknown): ClaimDueRunsRequest | null {
  const row = readObject(value, ["now", "limit", "workerId", "leaseTokenPrefix", "leaseDurationMs", "reclaimAuthorities"]);
  const now = row && canonicalInstant(row.now);
  if (!row || !now || !safeInteger(row.limit, 1, 100) || !validId(row.workerId) || !validId(row.leaseTokenPrefix) || !safeInteger(row.leaseDurationMs, 1, 86400000) || !Array.isArray(row.reclaimAuthorities) || row.reclaimAuthorities.length > 100) return null;
  const seen = new Set<string>();
  const authorities: ScheduledRunReclaimAuthority[] = [];
  for (const item of row.reclaimAuthorities) {
    const parsed = normaliseAuthority(item);
    if (!parsed || seen.has(parsed.runId)) return null;
    seen.add(parsed.runId);
    authorities.push(parsed);
  }
  return Object.freeze({ now, limit: row.limit, workerId: row.workerId, leaseTokenPrefix: row.leaseTokenPrefix, leaseDurationMs: row.leaseDurationMs, reclaimAuthorities: Object.freeze(authorities) });
}

function normaliseAuthority(value: unknown): ScheduledRunReclaimAuthority | null {
  const row = readObject(value, ["runId", "expectedAttempt", "kind", "reconciliationRef"]);
  if (!row || !validId(row.runId) || !safeInteger(row.expectedAttempt, 1)) return null;
  if (row.kind === "repeatable" && row.reconciliationRef === null) return Object.freeze({ runId: row.runId, expectedAttempt: row.expectedAttempt, kind: "repeatable", reconciliationRef: null });
  if (row.kind === "reconciled_absent" && validRef(row.reconciliationRef)) return Object.freeze({ runId: row.runId, expectedAttempt: row.expectedAttempt, kind: "reconciled_absent", reconciliationRef: row.reconciliationRef });
  return null;
}

const FENCE_KEYS = ["runId", "workerId", "expectedAttempt", "expectedTaskRevision", "leaseToken", "now"] as const;
function fence(row: Record<string, unknown>): boolean {
  return validId(row.runId) && validId(row.workerId) && safeInteger(row.expectedAttempt, 1) && safeInteger(row.expectedTaskRevision, 1) && validRef(row.leaseToken) && canonicalInstant(row.now) !== null;
}

export function normaliseRenew(value: unknown): RenewScheduledRunRequest | null {
  const row = readObject(value, [...FENCE_KEYS, "leaseExpiresAt"]);
  if (!row || !fence(row)) return null;
  const now = canonicalInstant(row.now)!, leaseExpiresAt = canonicalInstant(row.leaseExpiresAt);
  return leaseExpiresAt && leaseExpiresAt > now ? Object.freeze({ ...row, now, leaseExpiresAt }) as unknown as RenewScheduledRunRequest : null;
}

export function normaliseBind(value: unknown): BindScheduledSourceRequest | null {
  const row = readObject(value, [...FENCE_KEYS, "effect", "sourceSeq", "operationId", "boundAt"]);
  if (!row || !fence(row)) return null;
  const identity = effect(row.effect), boundAt = canonicalInstant(row.boundAt);
  if (!identity || !safeInteger(row.sourceSeq, 1) || !validId(row.operationId) || !boundAt) return null;
  const request = Object.freeze({ ...row, now: canonicalInstant(row.now), effect: identity, boundAt }) as unknown as BindScheduledSourceRequest;
  return identity.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue) ? request : null;
}

export function normaliseComplete(value: unknown): CompleteScheduledRunRequest | null {
  const row = readObject(value, [...FENCE_KEYS, "effect", "status", "durationMs", "resultRef", "errorCode", "completedAt", "outboxIntents"]);
  if (!row || !fence(row)) return null;
  const identity = effect(row.effect), completedAt = canonicalInstant(row.completedAt);
  if (!identity || !completedAt || !safeInteger(row.durationMs, 0) || (row.status !== "success" && row.status !== "error")) return null;
  if (row.resultRef !== null && !validRef(row.resultRef)) return null;
  if (row.errorCode !== null && !validTag(row.errorCode)) return null;
  if (row.status === "success" && row.errorCode !== null) return null;
  if (row.status === "error" && row.errorCode === null) return null;
  if (!Array.isArray(row.outboxIntents) || row.outboxIntents.length > 100) return null;
  const intents: EnqueueOutboxRequest[] = [], ids = new Set<string>();
  for (const item of row.outboxIntents) {
    const parsed = outbox(item);
    if (!parsed || ids.has(parsed.outboxId)) return null;
    ids.add(parsed.outboxId); intents.push(parsed);
  }
  const request = Object.freeze({ ...row, now: canonicalInstant(row.now), effect: identity, completedAt, outboxIntents: Object.freeze(intents) }) as unknown as CompleteScheduledRunRequest;
  return identity.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue) ? request : null;
}

export function normaliseAbandon(value: unknown): AbandonScheduledRunRequest | null {
  const row = readObject(value, [...FENCE_KEYS, "effect", "reasonTag", "abandonedAt", "retryAt"]);
  if (!row || !fence(row)) return null;
  const identity = effect(row.effect), abandonedAt = canonicalInstant(row.abandonedAt);
  const retryAt = row.retryAt === null ? null : canonicalInstant(row.retryAt);
  if (!identity || !abandonedAt || !validTag(row.reasonTag) || (row.retryAt !== null && !retryAt) || (retryAt && retryAt <= abandonedAt)) return null;
  const request = Object.freeze({ ...row, now: canonicalInstant(row.now), effect: identity, abandonedAt, retryAt }) as unknown as AbandonScheduledRunRequest;
  return identity.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue) ? request : null;
}

export function normaliseList(value: unknown): ListScheduledRunsRequest | null {
  const candidate = value ?? {};
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !dataOnly(candidate)) return null;
  const allowed = new Set(["taskId", "state", "limit", "afterScheduledFor", "afterRunId"]);
  try { if (Object.keys(candidate).some((key) => !allowed.has(key))) return null; } catch { return null; }
  const row = candidate as Record<string, unknown>;
  if (row.taskId !== undefined && !validId(row.taskId)) return null;
  if (row.state !== undefined && !["claimed", "source_bound", "completed", "abandoned"].includes(row.state as string)) return null;
  const limit = row.limit === undefined ? 50 : row.limit;
  if (!safeInteger(limit, 1, 100)) return null;
  if ((row.afterScheduledFor === undefined) !== (row.afterRunId === undefined)) return null;
  if (row.afterScheduledFor !== undefined && (!canonicalInstant(row.afterScheduledFor) || !validId(row.afterRunId))) return null;
  return Object.freeze({ taskId: row.taskId as string | undefined, state: row.state as ListScheduledRunsRequest["state"], limit, afterScheduledFor: row.afterScheduledFor as string | undefined, afterRunId: row.afterRunId as string | undefined });
}

export function normaliseCleanup(value: unknown): CleanupScheduledRunsRequest | null {
  const row = readObject(value, ["settledBefore", "limit"]);
  const settledBefore = row && canonicalInstant(row.settledBefore);
  return row && settledBefore && safeInteger(row.limit, 1, 100) ? Object.freeze({ settledBefore, limit: row.limit }) : null;
}

export function computeScheduledSuccessor(snapshot: ScheduledTaskSnapshot, scheduledFor: string, settledAt: string): string | null {
  if (snapshot.scheduleType === "once") return null;
  if (snapshot.scheduleType === "interval") {
    const interval = Number(snapshot.scheduleValue);
    if (!safeInteger(interval, 1)) return null;
    return new Date(new Date(settledAt).getTime() + interval).toISOString();
  }
  return computeNextRun("cron", snapshot.scheduleValue, { currentDate: scheduledFor, timezone: snapshot.timezone });
}

export function canonicalRequestHash(value: unknown): string {
  return hashCanonicalRequest(value as CanonicalJsonValue);
}
