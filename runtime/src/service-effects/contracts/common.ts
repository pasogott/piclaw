import { createHash } from "node:crypto";

export type RedactionClass = "public" | "private" | "secret";

export interface EffectIdentity {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly operationId: string | null;
  readonly sourceSeq: number | null;
  readonly provenanceRef: string;
  readonly redactionClass: RedactionClass;
}

export type EffectCertainty = "not_applied" | "applied" | "unknown";

export interface PiclawEffectError<TTag extends string = string> {
  readonly _tag: TTag;
  readonly certainty: EffectCertainty;
  readonly retryable: boolean;
}

export interface PayloadReference {
  readonly ref: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly redactionClass: RedactionClass;
}

export interface EffectClock {
  now(): Date;
}

export interface EffectIdSource {
  nextId(): string;
}

export interface NormalisedEffectTrace {
  readonly contract: string;
  readonly method: string;
  readonly effectId: string;
  readonly operationId: string | null;
  readonly sourceSeq: number | null;
  readonly version: number | null;
  readonly certainty: EffectCertainty | null;
  readonly resultTag: string;
}

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

export const OMITTED_REQUEST_HASH_FIELDS = Object.freeze([
  "requestHash",
  "attempt",
  "attemptNumber",
  "leaseToken",
  "leaseExpiresAt",
  "traceId",
  "spanId",
  "traceparent",
  "tracestate",
  "tracing",
  "telemetry",
] as const);

const OMITTED_REQUEST_HASH_FIELD_SET = new Set<string>(OMITTED_REQUEST_HASH_FIELDS);

function assertCanonicalNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical requests cannot contain non-finite numbers.");
  }
}

/** Canonical JSON with lexical object keys and significant array order. */
export function canonicaliseRequest(value: CanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assertCanonicalNumber(value);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicaliseRequest(entry)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([key, entry]) => entry !== undefined && !OMITTED_REQUEST_HASH_FIELD_SET.has(key))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicaliseRequest(entry!)}`).join(",")}}`;
}

export function hashCanonicalRequest(value: CanonicalJsonValue): string {
  return createHash("sha256").update(canonicaliseRequest(value), "utf8").digest("hex");
}

const PROTECTED_TRACE_KEYS = /(?:body|bytes|content|credential|media|message|password|prompt|secret|token|toolarguments?|toolresults?)/i;

export type NormalisedTraceInput = Readonly<Record<string, unknown>>;

/**
 * Narrow an effect observation to the fixed trace contract. Unknown and
 * protected fields are ignored rather than copied or stringified.
 */
export function normaliseEffectTrace(input: NormalisedTraceInput): NormalisedEffectTrace {
  for (const key of Object.keys(input)) {
    if (PROTECTED_TRACE_KEYS.test(key) && input[key] !== undefined && input[key] !== null) {
      throw new TypeError(`Protected trace field rejected: ${key}`);
    }
  }

  return Object.freeze({
    contract: requireTraceString(input.contract, "contract"),
    method: requireTraceString(input.method, "method"),
    effectId: requireTraceString(input.effectId, "effectId"),
    operationId: optionalTraceString(input.operationId, "operationId"),
    sourceSeq: optionalTraceInteger(input.sourceSeq, "sourceSeq"),
    version: optionalTraceInteger(input.version, "version"),
    certainty: optionalCertainty(input.certainty),
    resultTag: requireTraceString(input.resultTag, "resultTag"),
  });
}

function requireTraceString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Trace ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalTraceString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Trace ${field} must be a non-empty string or null.`);
  }
  return value;
}

function optionalTraceInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Trace ${field} must be a safe integer or null.`);
  }
  return value as number;
}

function optionalCertainty(value: unknown): EffectCertainty | null {
  if (value === undefined || value === null) return null;
  if (value === "not_applied" || value === "applied" || value === "unknown") return value;
  throw new TypeError("Trace certainty is invalid.");
}
