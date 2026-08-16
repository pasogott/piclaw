import type { PiclawToolContext } from "../contracts/execution-context-resolver.js";

export type ToolEffectClass = "query" | "mutation" | "mixed";
export type ToolReplayPolicy = "safe" | "never";
export type ToolServiceEffector = "EF-S01" | "EF-S03" | "EF-S04" | "EF-S05" | "EF-S07" | null;
export type ToolAbortExpectation = "must_stop" | "may_finish_late";
export type ToolContextField = keyof PiclawToolContext;

/**
 * Latent preparation metadata for one current tool family.
 *
 * This is documentation and validation data only. It is not a registration,
 * execution, result, update, or recovery abstraction.
 */
export interface ToolPreparationSpec {
  toolName: string;
  currentSource: string;
  effectClass: ToolEffectClass;
  replay: ToolReplayPolicy;
  contextFields: readonly ToolContextField[];
  serviceEffector: ToolServiceEffector;
  abortExpectation: ToolAbortExpectation;
  protectedFields: readonly string[];
}
