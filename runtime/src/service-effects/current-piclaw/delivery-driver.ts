import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type { EffectPayloadResolver, ResolvedEffectPayload } from "../contracts/payload-resolver.js";
import type {
  DeliveryAttempt,
  DeliveryBoundary,
  DeliveryDriver,
  DeliveryDriverError,
  DeliveryKind,
  DeliveryOutcome,
  DeliveryPayloadValidator,
  DeliveryProviderDetail,
  WebPushDeliveryCounts,
} from "../contracts/delivery-driver.js";
import { resolveVerifiedPayload } from "../payloads.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

export class CurrentPiclawDeliveryDriver implements DeliveryDriver {
  constructor(
    readonly kind: DeliveryKind,
    private readonly payloads: EffectPayloadResolver,
    private readonly validatePayload: DeliveryPayloadValidator,
    private readonly boundary: DeliveryBoundary,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  async deliver(request: DeliveryAttempt): Promise<ResultValue<DeliveryOutcome, DeliveryDriverError>> {
    this.call(request);
    if (request.signal.aborted) return this.fail(request, "aborted", "not_applied", false);
    if (!validRequest(request)) return this.fail(request, "invalid_payload", "not_applied", false);
    if (!request.destinationRef) return this.fail(request, "destination_missing", "not_applied", false);

    let payload: ResolvedEffectPayload | null;
    try {
      payload = await resolveVerifiedPayload(this.payloads, request.payloadRef);
    } catch {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    if (!payload) return this.fail(request, "invalid_payload", "not_applied", false);
    const immutablePayload = snapshotPayload(payload);
    try {
      if (!this.validatePayload(this.kind, request, immutablePayload)) {
        return this.fail(request, "invalid_payload", "not_applied", false);
      }
    } catch {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    if (request.signal.aborted) return this.fail(request, "aborted", "not_applied", false);
    if (this.runtime.hitFault("before_effect")) return this.fail(request, "transport_unavailable", "not_applied", true);

    try {
      const success = await this.boundary.attempt({ request, payload: immutablePayload });
      if (!validBoundarySuccess(this.kind, request, success)) return this.fail(request, "transport_unavailable", "unknown", true);
      const certainty = certaintyFor(success.detail);
      const outcome = Object.freeze({
        certainty,
        acceptedAt: success.acceptedAt,
        receiptRef: success.receiptRef,
        detail: freezeDetail(success.detail),
      });
      this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId, certainty, resultTag: success.detail.kind });
      return Result.ok(outcome);
    } catch (error) {
      let classified: DeliveryDriverError | null | undefined;
      try { classified = this.boundary.classifyError?.(error); } catch { classified = null; }
      return validClassifiedError(classified)
        ? this.fail(request, classified._tag, classified.certainty, classified.retryable, classified.retryAfter)
        : this.fail(request, "transport_unavailable", "unknown", true);
    }
  }

  private call(request: DeliveryAttempt): void {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: safeEffectId(request), certainty: null, resultTag: "call" });
  }

  private fail(
    request: DeliveryAttempt,
    tag: DeliveryDriverError["_tag"],
    certainty: DeliveryDriverError["certainty"],
    retryable: boolean,
    retryAfter?: string,
  ): ResultValue<never, DeliveryDriverError> {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: safeEffectId(request), certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable, ...(retryAfter ? { retryAfter } : {}) }));
  }
}

function validRequest(request: DeliveryAttempt): boolean {
  return Boolean(nonEmptyString(request.outboxId) && nonEmptyString(request.idempotencyKey) && nonEmptyString(request.payloadRef) && nonEmptyString(request.deliveryIdentity) && Number.isSafeInteger(request.attempt) && request.attempt >= 1);
}
function safeEffectId(request: DeliveryAttempt): string { return nonEmptyString(request?.outboxId) ? request.outboxId : "invalid-outbox"; }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

const ERROR_TAGS = new Set<DeliveryDriverError["_tag"]>(["invalid_payload", "destination_missing", "rejected", "rate_limited", "timeout", "transport_unavailable", "aborted"]);
function validClassifiedError(error: DeliveryDriverError | null | undefined): error is DeliveryDriverError {
  return Boolean(error && ERROR_TAGS.has(error._tag) && (error.certainty === "not_applied" || error.certainty === "unknown") && typeof error.retryable === "boolean" && (error.retryAfter === undefined || nonEmptyInstant(error.retryAfter)));
}

function validBoundarySuccess(kind: DeliveryKind, request: DeliveryAttempt, success: { acceptedAt: string; receiptRef: string | null; detail: DeliveryProviderDetail }): boolean {
  if (!nonEmptyInstant(success.acceptedAt) || (success.receiptRef !== null && !nonEmptyString(success.receiptRef))) return false;
  if (success.detail.kind !== kind) return false;
  if (kind === "timeline_broadcast" && success.detail.kind === kind) return success.detail.providerMessageId === null && success.detail.eventId === request.deliveryIdentity;
  if (kind === "wake_chat" && success.detail.kind === kind) return success.detail.providerMessageId === null && success.detail.wakeId === request.deliveryIdentity;
  if (kind === "web_push" && success.detail.kind === kind) return success.detail.providerMessageId === null && validCounts(success.detail.counts);
  return (success.detail.kind === "channel_delivery" || success.detail.kind === "pushover") && (success.detail.providerMessageId === null || nonEmptyString(success.detail.providerMessageId));
}

function validCounts(counts: WebPushDeliveryCounts): boolean {
  const values = [counts.attempted, counts.sent, counts.removed, counts.failed];
  return values.every((value) => Number.isSafeInteger(value) && value >= 0) && counts.attempted === counts.sent + counts.removed + counts.failed;
}

function nonEmptyInstant(value: string): boolean { return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)); }

function certaintyFor(detail: DeliveryProviderDetail): DeliveryOutcome["certainty"] {
  if (detail.kind !== "web_push") return "applied";
  if (detail.counts.attempted === 0) return "not_applied";
  return detail.counts.failed > 0 ? "unknown" : "applied";
}

function freezeDetail(detail: DeliveryProviderDetail): DeliveryProviderDetail {
  if (detail.kind === "web_push") return Object.freeze({ ...detail, counts: freezeCounts(detail.counts) });
  return Object.freeze({ ...detail });
}

function freezeCounts(counts: WebPushDeliveryCounts): WebPushDeliveryCounts {
  return Object.freeze({ attempted: counts.attempted, sent: counts.sent, removed: counts.removed, failed: counts.failed });
}

function snapshotPayload(payload: ResolvedEffectPayload): ResolvedEffectPayload {
  return Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) });
}
