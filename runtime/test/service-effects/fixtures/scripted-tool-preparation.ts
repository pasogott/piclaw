import type { AgentHarnessTool, ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import type { PiclawToolContext } from "../../../src/service-effects/contracts/execution-context-resolver.js";
import type { ToolPreparationSpec } from "../../../src/service-effects/tool-preparation/types.js";

type DirectExecute = AgentHarnessTool<PiclawToolContext>["execute"];

/** Test-only scripted direct tool. It uses Earendil's execute/result types. */
export class ScriptedDirectTool {
  readonly contexts: PiclawToolContext[] = [];
  executeCount = 0;
  readonly execute: DirectExecute;

  constructor(handler: DirectExecute) {
    this.execute = async (toolCallId, params, signal, onUpdate, context) => {
      this.executeCount += 1;
      this.contexts.push(context);
      return await handler(toolCallId, params, signal, onUpdate, context);
    };
  }
}

export function createScriptedContext(operationId: string, cwd: string): PiclawToolContext {
  const env = Object.freeze({ cwd }) as ExecutionEnv;
  const localEnv = Object.freeze({ cwd: "/local" }) as ExecutionEnv;
  return Object.freeze({ chatJid: "chat-fixture", operationId, env, localEnv });
}

/** Test-only unresolved-call probe; it is not a production recovery reducer. */
export async function probeUnresolvedCall(
  spec: ToolPreparationSpec,
  tool: ScriptedDirectTool,
  context: PiclawToolContext,
): Promise<{ readonly status: "executed"; readonly result: AgentToolResult<unknown> } | { readonly status: "blocked" }> {
  if (spec.replay === "never") return Object.freeze({ status: "blocked" });
  const result = await tool.execute("recovery-call", {}, undefined, undefined, context);
  return Object.freeze({ status: "executed", result });
}

/**
 * Test-only post-result probe. The direct tool executes once; composition cannot
 * reinvoke it and a composition fault fails open to the native result.
 */
export async function composeAfterSingleExecution(
  tool: ScriptedDirectTool,
  context: PiclawToolContext,
  compose: (result: AgentToolResult<unknown>) => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>,
): Promise<AgentToolResult<unknown>> {
  const result = await tool.execute("single-call", {}, undefined, undefined, context);
  try {
    return await compose(result);
  } catch {
    return result;
  }
}

export function acceptsLateResult(expectedOperationId: string, currentOperationId: string): boolean {
  return expectedOperationId === currentOperationId;
}

export function metadataOnlyTrace(spec: ToolPreparationSpec): Readonly<Record<string, unknown>> {
  return Object.freeze({
    toolName: spec.toolName,
    effectClass: spec.effectClass,
    replay: spec.replay,
    abortExpectation: spec.abortExpectation,
    serviceEffector: spec.serviceEffector,
  });
}
