import type { NormalisedTraceInput } from "../contracts/common.js";

export type CurrentPiclawAdapterFaultPoint =
  | "before_effect"
  | "before_delete_transaction"
  | "effect_then_lost_acknowledgement";

/** Narrow injectable runtime surface; production adapters do not depend on test infrastructure. */
export interface CurrentPiclawAdapterRuntime {
  nextId(): string;
  hitFault(point: CurrentPiclawAdapterFaultPoint): boolean;
  recordTrace(input: NormalisedTraceInput): void;
}
