import { createHash } from "node:crypto";
import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type { DeliveryAttempt, DeliveryDriver, DeliveryDriverError, DeliveryKind, DeliveryOutcome, WebPushDeliveryCounts } from "../../contracts/delivery-driver.js";
import type { EffectPayloadResolver } from "../../contracts/payload-resolver.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

export type ScriptedDeliveryStep =
  | { readonly _tag: "outcome"; readonly outcome: DeliveryOutcome }
  | { readonly _tag: "error"; readonly error: DeliveryDriverError }
  | { readonly _tag: "delay"; readonly gate: Promise<void>; readonly next: ScriptedDeliveryStep };

export class FakeDeliveryDriver implements DeliveryDriver {
  readonly trace = new EffectTraceRecorder();
  private readonly steps: ScriptedDeliveryStep[] = [];
  private attempts = 0;

  constructor(readonly kind: DeliveryKind, private readonly payloads: EffectPayloadResolver) {}

  script(...steps: readonly ScriptedDeliveryStep[]): void { this.steps.push(...steps); }
  countAttempts(): number { return this.attempts; }

  async deliver(request: DeliveryAttempt): Promise<ResultValue<DeliveryOutcome, DeliveryDriverError>> {
    const effectId = request.outboxId || "invalid-outbox";
    this.trace.recordCall({ contract: "EF-S06", method: "deliver", effectId });
    if (request.signal.aborted) return this.fail(effectId, Object.freeze({ _tag: "aborted", certainty: "not_applied", retryable: false }));
    if (!request.outboxId || !request.idempotencyKey || !request.payloadRef || !request.deliveryIdentity || request.attempt < 1) {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    if (!request.destinationRef) return this.fail(effectId, Object.freeze({ _tag: "destination_missing", certainty: "not_applied", retryable: false }));
    const payload = await this.payloads.resolve(request.payloadRef);
    if (!payload || payload.ref !== request.payloadRef || payload.byteLength !== payload.bytes.byteLength || payload.sha256 !== createHash("sha256").update(payload.bytes).digest("hex")) {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    new Uint8Array(payload.bytes);
    this.attempts += 1;
    let step = this.steps.shift() ?? { _tag: "error", error: Object.freeze({ _tag: "transport_unavailable", certainty: "not_applied", retryable: true }) } as const;
    while (step._tag === "delay") { await step.gate; step = step.next; }
    if (step._tag === "error") return validError(step.error)
      ? this.fail(effectId, step.error)
      : this.fail(effectId, Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    if (!validOutcome(this.kind, request, step.outcome)) return this.fail(effectId, Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    const outcome = freezeOutcome(step.outcome);
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: outcome.certainty, resultTag: outcome.detail.kind });
    return Result.ok(outcome);
  }

  private fail(effectId: string, error: DeliveryDriverError): ResultValue<never, DeliveryDriverError> {
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: error.certainty, resultTag: error._tag });
    return Result.err(Object.freeze({ ...error }));
  }
}

const TAGS = new Set(["invalid_payload", "destination_missing", "rejected", "rate_limited", "timeout", "transport_unavailable", "aborted"]);
function validError(error: DeliveryDriverError): boolean {
  return TAGS.has(error._tag) && (error.certainty === "not_applied" || error.certainty === "unknown") && typeof error.retryable === "boolean" && (error.retryAfter === undefined || (typeof error.retryAfter === "string" && error.retryAfter.length > 0 && Number.isFinite(Date.parse(error.retryAfter))));
}
function validOutcome(kind: DeliveryKind, request: DeliveryAttempt, outcome: DeliveryOutcome): boolean {
  if ((outcome.certainty !== "applied" && outcome.certainty !== "not_applied" && outcome.certainty !== "unknown") || !Number.isFinite(Date.parse(outcome.acceptedAt)) || outcome.detail.kind !== kind) return false;
  if (outcome.detail.kind === "timeline_broadcast") return outcome.detail.eventId === request.deliveryIdentity;
  if (outcome.detail.kind === "wake_chat") return outcome.detail.wakeId === request.deliveryIdentity;
  if (outcome.detail.kind === "web_push") return validCounts(outcome.detail.counts);
  return true;
}
function validCounts(counts: WebPushDeliveryCounts): boolean {
  return [counts.attempted, counts.sent, counts.removed, counts.failed].every((value) => Number.isSafeInteger(value) && value >= 0) && counts.attempted === counts.sent + counts.removed + counts.failed;
}
function freezeOutcome(outcome: DeliveryOutcome): DeliveryOutcome {
  const detail = outcome.detail.kind === "web_push"
    ? Object.freeze({ ...outcome.detail, counts: Object.freeze({ ...outcome.detail.counts }) })
    : Object.freeze({ ...outcome.detail });
  return Object.freeze({ ...outcome, detail });
}
