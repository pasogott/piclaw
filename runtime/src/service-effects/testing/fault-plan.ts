export const STANDARD_FAULT_POINTS = Object.freeze([
  "before_effect",
  "effect_then_lost_acknowledgement",
  "acknowledgement_then_crash",
  "duplicate_result",
  "delayed_or_late_result",
  "malformed_state",
  "stale_owner_or_version",
  "cancellation_race",
  "lease_expiry",
  "redaction_violation",
] as const);

export type StandardFaultPoint = typeof STANDARD_FAULT_POINTS[number];

export interface PlannedFault {
  readonly point: StandardFaultPoint;
  readonly occurrence?: number;
}

export interface FaultPlanSnapshot {
  readonly consumed: Readonly<Record<StandardFaultPoint, number>>;
}

export class DeterministicFaultPlan {
  readonly #planned: ReadonlyMap<StandardFaultPoint, ReadonlySet<number>>;
  #consumed = new Map<StandardFaultPoint, number>();

  constructor(faults: readonly PlannedFault[] = []) {
    const planned = new Map<StandardFaultPoint, Set<number>>();
    for (const fault of faults) {
      const occurrence = fault.occurrence ?? 1;
      if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
        throw new TypeError("Fault occurrence must be a positive safe integer.");
      }
      const occurrences = planned.get(fault.point) ?? new Set<number>();
      occurrences.add(occurrence);
      planned.set(fault.point, occurrences);
    }
    this.#planned = new Map(
      [...planned.entries()].map(([point, occurrences]) => [point, new Set(occurrences)]),
    );
  }

  hit(point: StandardFaultPoint): boolean {
    const occurrence = (this.#consumed.get(point) ?? 0) + 1;
    this.#consumed.set(point, occurrence);
    return this.#planned.get(point)?.has(occurrence) ?? false;
  }

  snapshot(): FaultPlanSnapshot {
    return Object.freeze({
      consumed: Object.freeze(Object.fromEntries(
        STANDARD_FAULT_POINTS.map((point) => [point, this.#consumed.get(point) ?? 0]),
      ) as Record<StandardFaultPoint, number>),
    });
  }

  restore(snapshot: FaultPlanSnapshot): void {
    this.#consumed = new Map(
      STANDARD_FAULT_POINTS.map((point) => [point, snapshot.consumed[point] ?? 0]),
    );
  }
}
