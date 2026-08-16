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
  readonly toolName: string;
  readonly currentSource: string;
  readonly effectClass: ToolEffectClass;
  readonly replay: ToolReplayPolicy;
  readonly contextFields: readonly ToolContextField[];
  readonly serviceEffector: ToolServiceEffector;
  readonly abortExpectation: ToolAbortExpectation;
  readonly protectedFields: readonly string[];
}
