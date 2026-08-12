import { describe, expect, test } from "bun:test";

import {
  canonicaliseRequest,
  hashCanonicalRequest,
  normaliseEffectTrace,
  type EffectClock,
  type EffectIdSource,
  type EffectIdentity,
  type PayloadReference,
  type PiclawEffectError,
} from "../../src/service-effects/contracts/common.js";
import { CANONICAL_REQUEST_HASH_VECTORS } from "../../src/service-effects/testing/canonical-request-hash-vectors.js";

describe("latent service-effect common contracts", () => {
  test("fixed canonical request-hash vectors remain stable", () => {
    for (const vector of CANONICAL_REQUEST_HASH_VECTORS) {
      for (const request of vector.requests) {
        expect(canonicaliseRequest(request)).toBe(vector.canonical);
        expect(hashCanonicalRequest(request)).toBe(vector.sha256);
      }
    }
  });

  test("conflicting semantic payloads have different hashes", () => {
    expect(hashCanonicalRequest({ payloadRef: "sha256:a", destinationRef: "chat:1" }))
      .not.toBe(hashCanonicalRequest({ payloadRef: "sha256:b", destinationRef: "chat:1" }));
  });

  test("canonicalisation rejects values outside the canonical JSON domain", () => {
    expect(() => canonicaliseRequest({ count: Number.NaN })).toThrow("non-finite");
    expect(() => canonicaliseRequest({ count: Number.POSITIVE_INFINITY })).toThrow("non-finite");
  });

  test("identity, certainty, payload references, clocks and IDs are implementation-neutral", () => {
    const clock: EffectClock = { now: () => new Date("2026-01-02T03:04:05.000Z") };
    const ids: EffectIdSource = { nextId: () => "effect-001" };
    const effect: EffectIdentity = {
      idempotencyKey: ids.nextId(),
      requestHash: hashCanonicalRequest({ payloadRef: "content:1" }),
      operationId: null,
      sourceSeq: null,
      provenanceRef: "source:test",
      redactionClass: "private",
    };
    const payload: PayloadReference = Object.freeze({
      ref: "content:1",
      sha256: "a".repeat(64),
      byteLength: 12,
      mediaType: "text/plain",
      redactionClass: "private",
    });
    const error: PiclawEffectError<"version_mismatch"> = {
      _tag: "version_mismatch",
      certainty: "not_applied",
      retryable: false,
    };

    expect(clock.now().toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(effect.idempotencyKey).toBe("effect-001");
    expect(Object.isFrozen(payload)).toBeTrue();
    expect(error).toEqual({ _tag: "version_mismatch", certainty: "not_applied", retryable: false });
  });

  test("normalised traces retain only symbolic bounded fields", () => {
    const trace = normaliseEffectTrace({
      contract: "EF-S03",
      method: "commitDraft",
      effectId: "effect-001",
      operationId: "operation-001",
      sourceSeq: 4,
      version: 2,
      certainty: "applied",
      resultTag: "ok",
      ignoredDiagnostic: { arbitrary: true },
    });

    expect(trace).toEqual({
      contract: "EF-S03",
      method: "commitDraft",
      effectId: "effect-001",
      operationId: "operation-001",
      sourceSeq: 4,
      version: 2,
      certainty: "applied",
      resultTag: "ok",
    });
    expect(Object.isFrozen(trace)).toBeTrue();
  });

  test.each([
    "messageBody",
    "mediaBytes",
    "toolArguments",
    "toolResult",
    "secret",
    "password",
    "credential",
    "token",
    "promptContent",
  ])("normalised traces reject protected field %s", (protectedField) => {
    expect(() => normaliseEffectTrace({
      contract: "EF-S06",
      method: "deliver",
      effectId: "effect-001",
      resultTag: "unknown",
      [protectedField]: "protected-value",
    })).toThrow(`Protected trace field rejected: ${protectedField}`);
  });
});
