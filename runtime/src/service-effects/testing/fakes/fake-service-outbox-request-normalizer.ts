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

type Plain = Readonly<Record<string, unknown>>;
type Reader<T> = (value: unknown) => T;

const KIND_VALUES = new Set<string>(OUTBOX_KINDS);
const REDACTION_VALUES = new Set<string>(["public", "private", "secret"]);
const HASH = /^[0-9a-f]{64}$/;
const TAG = /^[A-Za-z0-9_.:-]+$/;

const text =
  (max: number): Reader<string> =>
  (value) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > max ||
      value.trim().length === 0
    ) {
      throw new TypeError("text");
    }
    return value;
  };

const optional =
  <T>(reader: Reader<T>): Reader<T | null> =>
  (value) =>
    value === null ? null : reader(value);

const integer =
  (minimum: number, maximum = Number.MAX_SAFE_INTEGER): Reader<number> =>
  (value) => {
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < minimum ||
      (value as number) > maximum
    ) {
      throw new TypeError("integer");
    }
    return value as number;
  };

const instant: Reader<string> = (value) => {
  if (typeof value !== "string") throw new TypeError("instant");
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError("instant");
  }
  return value;
};

const tag: Reader<string> = (value) => {
  const output = text(128)(value);
  if (!TAG.test(output)) throw new TypeError("tag");
  return output;
};

function snapshot(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): unknown {
  if (depth > 8) throw new TypeError("depth");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("number");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new TypeError("tree");
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      throw new TypeError("array");
    return value.map((entry) => snapshot(entry, depth + 1, seen));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("prototype");
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("descriptor");
    output[key] = snapshot(descriptor.value, depth + 1, seen);
  }
  return output;
}

function object(value: unknown, fields: readonly string[]): Plain {
  const record = snapshot(value) as Plain;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("object");
  }
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("fields");
  }
  return record;
}

function member<T extends string>(values: ReadonlySet<string>): Reader<T> {
  return (value) => {
    if (typeof value !== "string" || !values.has(value))
      throw new TypeError("enum");
    return value as T;
  };
}

function cursor(value: unknown): OutboxCursor | null {
  if (value === null) return null;
  const record = object(value, ["stateChangedAt", "outboxId"]);
  return freeze({
    stateChangedAt: instant(record.stateChangedAt),
    outboxId: text(512)(record.outboxId),
  });
}

function kinds(value: unknown): readonly OutboxKind[] {
  const array = snapshot(value);
  if (!Array.isArray(array) || array.length === 0) throw new TypeError("kinds");
  const values = array.map(member<OutboxKind>(KIND_VALUES));
  return Object.freeze([...new Set(values)].sort());
}

function effect(value: unknown): EffectIdentity {
  const record = object(value, [
    "idempotencyKey",
    "requestHash",
    "operationId",
    "sourceSeq",
    "provenanceRef",
    "redactionClass",
  ]);
  const requestHash = text(64)(record.requestHash);
  if (!HASH.test(requestHash)) throw new TypeError("hash");
  return freeze({
    idempotencyKey: text(512)(record.idempotencyKey),
    requestHash,
    operationId: optional(text(512))(record.operationId),
    sourceSeq: optional(integer(0))(record.sourceSeq),
    provenanceRef: text(2048)(record.provenanceRef),
    redactionClass: member<EffectIdentity["redactionClass"]>(REDACTION_VALUES)(
      record.redactionClass,
    ),
  });
}

function worker(record: Plain): {
  outboxId: string;
  workerId: string;
  expectedAttempt: number;
  leaseToken: string;
} {
  return {
    outboxId: text(512)(record.outboxId),
    workerId: text(512)(record.workerId),
    expectedAttempt: integer(1)(record.expectedAttempt),
    leaseToken: text(2048)(record.leaseToken),
  };
}

const parsers: Readonly<
  Record<FakeOutboxMutationMethod, Reader<NormalisedFakeOutboxMutation>>
> = {
  enqueue(value) {
    const record = object(value, [
      "effect",
      "outboxId",
      "kind",
      "payloadRef",
      "destinationRef",
      "availableAt",
      "enqueuedAt",
      "repeatability",
    ]);
    const output: EnqueueOutboxRequest = freeze({
      effect: effect(record.effect),
      outboxId: text(512)(record.outboxId),
      kind: member<OutboxKind>(KIND_VALUES)(record.kind),
      payloadRef: text(2048)(record.payloadRef),
      destinationRef: optional(text(2048))(record.destinationRef),
      availableAt: instant(record.availableAt),
      enqueuedAt: instant(record.enqueuedAt),
      repeatability: member<EnqueueOutboxRequest["repeatability"]>(
        new Set(["repeatable", "reconciliation_required"]),
      )(record.repeatability),
    });
    if (
      hashCanonicalRequest(output as unknown as CanonicalJsonValue) !==
      output.effect.requestHash
    ) {
      throw new TypeError("request hash");
    }
    return output;
  },

  claimNext(value) {
    const record = object(value, [
      "kinds",
      "workerId",
      "leaseToken",
      "now",
      "leaseExpiresAt",
    ]);
    const now = instant(record.now);
    const leaseExpiresAt = instant(record.leaseExpiresAt);
    if (leaseExpiresAt <= now) throw new TypeError("lease interval");
    return freeze({
      kinds: kinds(record.kinds),
      workerId: text(512)(record.workerId),
      leaseToken: text(2048)(record.leaseToken),
      now,
      leaseExpiresAt,
    });
  },

  reclaim(value) {
    const record = object(value, [
      "outboxId",
      "expectedAttempt",
      "workerId",
      "leaseToken",
      "now",
      "leaseExpiresAt",
      "authority",
    ]);
    const authorityRecord = snapshot(record.authority) as Plain;
    let authority: ReclaimOutboxRequest["authority"];
    if (authorityRecord?.kind === "repeatable") {
      object(authorityRecord, ["kind"]);
      authority = { kind: "repeatable" };
    } else {
      const checked = object(authorityRecord, ["kind", "reconciliationRef"]);
      if (checked.kind !== "reconciled_absent")
        throw new TypeError("authority");
      authority = {
        kind: "reconciled_absent",
        reconciliationRef: text(2048)(checked.reconciliationRef),
      };
    }
    const now = instant(record.now);
    const leaseExpiresAt = instant(record.leaseExpiresAt);
    if (leaseExpiresAt <= now) throw new TypeError("lease interval");
    return freeze({ ...worker(record), now, leaseExpiresAt, authority });
  },

  complete(value) {
    const record = object(value, [
      "outboxId",
      "workerId",
      "expectedAttempt",
      "leaseToken",
      "receiptRef",
      "completedAt",
    ]);
    return freeze({
      ...worker(record),
      receiptRef: optional(text(2048))(record.receiptRef),
      completedAt: instant(record.completedAt),
    });
  },

  fail(value) {
    const record = object(value, [
      "outboxId",
      "workerId",
      "expectedAttempt",
      "leaseToken",
      "errorTag",
      "certainty",
      "retryAt",
      "failedAt",
    ]);
    if (record.certainty !== "not_applied") throw new TypeError("certainty");
    return freeze({
      ...worker(record),
      errorTag: tag(record.errorTag),
      certainty: "not_applied" as const,
      retryAt: optional(instant)(record.retryAt),
      failedAt: instant(record.failedAt),
    });
  },

  markUnknown(value) {
    const record = object(value, [
      "outboxId",
      "workerId",
      "expectedAttempt",
      "leaseToken",
      "errorTag",
      "certainty",
      "observedAt",
    ]);
    if (record.certainty !== "unknown") throw new TypeError("certainty");
    return freeze({
      ...worker(record),
      errorTag: tag(record.errorTag),
      certainty: "unknown" as const,
      observedAt: instant(record.observedAt),
    });
  },

  resolveUnknown(value) {
    const record = object(value, [
      "outboxId",
      "expectedAttempt",
      "reconciliationRef",
      "reconciledAt",
      "resolution",
    ]);
    const raw = snapshot(record.resolution) as Plain;
    let resolution: ResolveUnknownOutboxRequest["resolution"];
    if (raw?.kind === "applied") {
      const checked = object(raw, ["kind", "receiptRef"]);
      resolution = {
        kind: "applied",
        receiptRef: optional(text(2048))(checked.receiptRef),
      };
    } else if (raw?.kind === "not_applied") {
      const checked = object(raw, ["kind", "errorTag", "retryAt"]);
      resolution = {
        kind: "not_applied",
        errorTag: tag(checked.errorTag),
        retryAt: optional(instant)(checked.retryAt),
      };
    } else {
      const checked = object(raw, ["kind", "reasonTag"]);
      if (checked.kind !== "cancelled") throw new TypeError("resolution");
      resolution = { kind: "cancelled", reasonTag: tag(checked.reasonTag) };
    }
    return freeze({
      outboxId: text(512)(record.outboxId),
      expectedAttempt: integer(1)(record.expectedAttempt),
      reconciliationRef: text(2048)(record.reconciliationRef),
      reconciledAt: instant(record.reconciledAt),
      resolution,
    });
  },

  cleanupTerminal(value) {
    const record = object(value, ["cleanupId", "before", "after", "limit"]);
    return freeze({
      cleanupId: text(512)(record.cleanupId),
      before: instant(record.before),
      after: cursor(record.after),
      limit: integer(1, 100)(record.limit),
    });
  },
};

export function normaliseFakeOutboxMutation(
  method: FakeOutboxMutationMethod,
  input: unknown,
): NormalisedFakeOutboxMutation | null {
  try {
    return parsers[method](input);
  } catch (error) {
    void error;
    return null;
  }
}

export function normaliseFakeOutboxList(
  input: unknown,
): ListUnknownOutboxRequest | null {
  try {
    const record = object(input, ["kinds", "after", "limit"]);
    return freeze({
      kinds: kinds(record.kinds),
      after: cursor(record.after),
      limit: integer(1, 100)(record.limit),
    });
  } catch (error) {
    void error;
    return null;
  }
}

export function normaliseFakeOutboxId(input: unknown): string | null {
  try {
    return text(512)(input);
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

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
