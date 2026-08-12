import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type { DeliveryAttempt, DeliveryDriver, DeliveryDriverError, DeliveryKind, DeliveryOutcome } from "../../contracts/delivery-driver.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

export type ScriptedDeliveryStep =
  | { readonly _tag: "outcome"; readonly outcome: DeliveryOutcome }
  | { readonly _tag: "error"; readonly error: DeliveryDriverError }
  | { readonly _tag: "delay"; readonly gate: Promise<void>; readonly next: ScriptedDeliveryStep };

export class FakeDeliveryDriver implements DeliveryDriver {
  readonly trace = new EffectTraceRecorder();
  private readonly steps: ScriptedDeliveryStep[] = [];
  private attempts = 0;

  constructor(readonly kind: DeliveryKind) {}

  script(...steps: readonly ScriptedDeliveryStep[]): void { this.steps.push(...steps); }
  countAttempts(): number { return this.attempts; }

  async deliver(request: DeliveryAttempt): Promise<ResultValue<DeliveryOutcome, DeliveryDriverError>> {
    const effectId = request.outboxId || "invalid-outbox";
    this.trace.recordCall({ contract: "EF-S06", method: "deliver", effectId });
    if (request.signal.aborted) return this.fail(effectId, Object.freeze({ _tag: "aborted", certainty: "not_applied", retryable: false }));
    if (!request.outboxId || !request.idempotencyKey || !request.payloadRef || request.attempt < 1) {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    if (!request.destinationRef) return this.fail(effectId, Object.freeze({ _tag: "destination_missing", certainty: "not_applied", retryable: false }));
    this.attempts += 1;
    let step = this.steps.shift() ?? { _tag: "error", error: Object.freeze({ _tag: "transport_unavailable", certainty: "not_applied", retryable: true }) } as const;
    while (step._tag === "delay") { await step.gate; step = step.next; }
    if (step._tag === "error") return this.fail(effectId, step.error);
    const outcome = freezeOutcome(step.outcome);
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: outcome.certainty, resultTag: outcome.detail.kind });
    return Result.ok(outcome);
  }

  private fail(effectId: string, error: DeliveryDriverError): ResultValue<never, DeliveryDriverError> {
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: error.certainty, resultTag: error._tag });
    return Result.err(Object.freeze({ ...error }));
  }
}

function freezeOutcome(outcome: DeliveryOutcome): DeliveryOutcome {
  const detail = outcome.detail.kind === "web_push"
    ? Object.freeze({ ...outcome.detail, counts: Object.freeze({ ...outcome.detail.counts }) })
    : Object.freeze({ ...outcome.detail });
  return Object.freeze({ ...outcome, detail });
}
