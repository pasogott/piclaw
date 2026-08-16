import type { AgentHarnessTool, ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import type { PiclawToolContext } from "../../../src/service-effects/contracts/execution-context-resolver.js";
import type { ToolPreparationSpec, ToolServiceEffector } from "../../../src/service-effects/tool-preparation/types.js";

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

export type ScriptedEffectCertainty = "not_applied" | "applied" | "unknown";

export interface ScriptedAuthorityRequest {
  readonly effector: Exclude<ToolServiceEffector, null>;
  readonly toolName: string;
  readonly operationId: string;
  readonly ownerVersion: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

type ScriptedDecision = Readonly<{
  certainty: ScriptedEffectCertainty;
  requestHash: string;
}>;

/** Independent in-memory authority/decision ledger; it imports no live store. */
export class ScriptedServiceDecisionOracle {
  private readonly decisions = new Map<string, ScriptedDecision>();
  private readonly pending = new Map<string, string>();

  constructor(readonly operationId: string, readonly ownerVersion: number) {}

  acquire(spec: ToolPreparationSpec, request: ScriptedAuthorityRequest): Readonly<
    | { status: "granted" }
    | { status: "reconciled"; certainty: ScriptedEffectCertainty; autoReplay: false }
    | { status: "idempotency_conflict" }
    | { status: "stale_owner" }
    | { status: "wrong_authority" }
  > {
    if (spec.serviceEffector === null || request.effector !== spec.serviceEffector || request.toolName !== spec.toolName) {
      return Object.freeze({ status: "wrong_authority" });
    }
    if (request.operationId !== this.operationId || request.ownerVersion !== this.ownerVersion) {
      return Object.freeze({ status: "stale_owner" });
    }
    const key = `${request.effector}:${request.idempotencyKey}`;
    const existing = this.decisions.get(key);
    if (existing) {
      if (existing.requestHash !== request.requestHash) return Object.freeze({ status: "idempotency_conflict" });
      return Object.freeze({ status: "reconciled", certainty: existing.certainty, autoReplay: false });
    }
    const pendingHash = this.pending.get(key);
    if (pendingHash !== undefined) {
      return Object.freeze({ status: pendingHash === request.requestHash ? "wrong_authority" : "idempotency_conflict" });
    }
    this.pending.set(key, request.requestHash);
    return Object.freeze({ status: "granted" });
  }

  settle(request: ScriptedAuthorityRequest, certainty: ScriptedEffectCertainty): void {
    const key = `${request.effector}:${request.idempotencyKey}`;
    if (this.pending.get(key) !== request.requestHash) throw new Error("decision settlement lacks matching grant");
    this.pending.delete(key);
    this.decisions.set(key, Object.freeze({ requestHash: request.requestHash, certainty }));
  }

  snapshot(): Readonly<Record<string, ScriptedDecision>> {
    return Object.freeze(Object.fromEntries([...this.decisions].map(([key, decision]) => [key, Object.freeze({ ...decision })])));
  }
}

/** Test-only decision probe; no production tool, store, or effector is activated. */
export async function executeWithServiceDecision(
  spec: ToolPreparationSpec,
  tool: ScriptedDirectTool,
  context: PiclawToolContext,
  oracle: ScriptedServiceDecisionOracle,
  request: ScriptedAuthorityRequest,
  certainty: ScriptedEffectCertainty,
): Promise<Readonly<
  | { status: "executed"; result: AgentToolResult<unknown>; certainty: ScriptedEffectCertainty }
  | { status: "reconciled"; certainty: ScriptedEffectCertainty; autoReplay: false }
  | { status: "idempotency_conflict" | "stale_owner" | "wrong_authority" }
>> {
  if (context.operationId !== request.operationId) return Object.freeze({ status: "stale_owner" });
  const decision = oracle.acquire(spec, request);
  if (decision.status !== "granted") return decision;
  const result = await tool.execute("authority-call", {}, undefined, undefined, context);
  oracle.settle(request, certainty);
  return Object.freeze({ status: "executed", result, certainty });
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

export async function executeWithFence(
  tool: ScriptedDirectTool,
  context: PiclawToolContext,
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult<unknown>) => void,
  currentOperationId: () => string = () => context.operationId,
): Promise<Readonly<{ status: "accepted"; result: AgentToolResult<unknown> } | { status: "discarded" } | { status: "aborted" }>> {
  if (signal.aborted) return Object.freeze({ status: "aborted" });
  let terminal = false;
  const update = (value: AgentToolResult<unknown>): void => {
    if (!terminal && !signal.aborted && currentOperationId() === context.operationId) onUpdate(value);
  };
  try {
    const result = await tool.execute("fenced-call", {}, signal, update, context);
    terminal = true;
    if (signal.aborted || currentOperationId() !== context.operationId) return Object.freeze({ status: "discarded" });
    return Object.freeze({ status: "accepted", result });
  } catch (error) {
    terminal = true;
    if (signal.aborted) return Object.freeze({ status: "aborted" });
    throw error;
  }
}

export function exactEditFixture(content: string, oldText: string, newText: string): string {
  if (!oldText) throw new Error("oldText must not be empty");
  let occurrences = 0;
  let offset = 0;
  while ((offset = content.indexOf(oldText, offset)) >= 0) {
    occurrences += 1;
    offset += oldText.length;
  }
  if (occurrences !== 1) throw new Error(`expected exactly one occurrence, found ${occurrences}`);
  return content.replace(oldText, newText);
}

export function boundedOutputFixture(text: string, maxLines: number, maxBytes: number): Readonly<{
  preview: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
}> {
  const encoder = new TextEncoder();
  const lines = text.split("\n");
  let preview = lines.slice(0, maxLines).join("\n");
  const bytes = encoder.encode(preview);
  if (bytes.length > maxBytes) preview = new TextDecoder().decode(bytes.slice(0, maxBytes));
  return Object.freeze({
    preview,
    truncated: lines.length > maxLines || encoder.encode(text).length > maxBytes,
    totalLines: lines.length,
    totalBytes: encoder.encode(text).length,
  });
}

export async function composeCompleteOutputFixture(
  nativeResult: AgentToolResult<Record<string, unknown>>,
  readSpill: (path: string) => string | undefined,
  persist: (fullOutput: string) => string | Promise<string>,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const details = nativeResult.details ?? {};
  const fullOutputPath = typeof details.fullOutputPath === "string" ? details.fullOutputPath : undefined;
  const nativeText = nativeResult.content
    .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
  const fullOutput = fullOutputPath ? readSpill(fullOutputPath) : nativeText;
  if (fullOutput === undefined) return nativeResult;
  try {
    const storedOutputId = await persist(fullOutput);
    return {
      content: nativeResult.content,
      details: { ...details, storedOutputId },
    };
  } catch {
    return nativeResult;
  }
}

export async function serializeWritesFixture<T>(operations: readonly (() => Promise<T>)[]): Promise<readonly T[]> {
  const results: T[] = [];
  for (const operation of operations) results.push(await operation());
  return Object.freeze(results);
}
