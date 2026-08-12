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
      payload = await this.payloads.resolve(request.payloadRef);
    } catch {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    if (!payload) return this.fail(request, "invalid_payload", "not_applied", false);
    const immutablePayload = snapshotPayload(payload);
    if (!this.validatePayload(this.kind, request, immutablePayload)) {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    if (request.signal.aborted) return this.fail(request, "aborted", "not_applied", false);
    if (this.runtime.hitFault("before_effect")) return this.fail(request, "transport_unavailable", "not_applied", true);

    try {
      const success = await this.boundary.attempt({ request, payload: immutablePayload });
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
      const classified = this.boundary.classifyError?.(error);
      return classified
        ? this.fail(request, classified._tag, classified.certainty, classified.retryable, classified.retryAfter)
        : this.fail(request, "transport_unavailable", "unknown", true);
    }
  }

  private call(request: DeliveryAttempt): void {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId || "invalid-outbox", certainty: null, resultTag: "call" });
  }

  private fail(
    request: DeliveryAttempt,
    tag: DeliveryDriverError["_tag"],
    certainty: DeliveryDriverError["certainty"],
    retryable: boolean,
    retryAfter?: string,
  ): ResultValue<never, DeliveryDriverError> {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId || "invalid-outbox", certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable, ...(retryAfter ? { retryAfter } : {}) }));
  }
}

function validRequest(request: DeliveryAttempt): boolean {
  return Boolean(request.outboxId && request.idempotencyKey && request.payloadRef && Number.isSafeInteger(request.attempt) && request.attempt >= 1);
}

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
