import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type {
  AgentProjectionSink,
  ProjectionAuthority,
  ProjectionOwner,
  ProjectionSinkError,
  ProjectionSinkErrorTag,
  ProjectionTransport,
  PublicAgentEvent,
  PublicAgentProjection,
  PublicAgentSnapshot,
  PublicTerminalProjection,
} from "../contracts/agent-projection-sink.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

type ProjectionCursor = {
  generation: number;
  receiptSeq: number;
  closed: boolean;
};

export class CurrentPiclawAgentProjectionSink implements AgentProjectionSink {
  private readonly cursors = new Map<string, ProjectionCursor>();

  constructor(
    private readonly authority: ProjectionAuthority,
    private readonly transport: ProjectionTransport,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  publishSnapshot(snapshot: PublicAgentSnapshot): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishSnapshot", snapshot);
  }

  publishEvent(event: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishEvent", event);
  }

  publishTerminal(terminal: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishTerminal", terminal);
  }

  private async publish(
    method: string,
    projection: PublicAgentProjection,
  ): Promise<ResultValue<void, ProjectionSinkError>> {
    this.call(method, projection);
    if (!validProjection(projection)) return this.fail(method, projection, "protected_payload");
    if (!this.authority.isCurrentOwner(projection)) return this.fail(method, projection, "owner_conflict");
    if (projection.type === "agent_terminal" && !this.authority.isCommittedTerminalRef(projection, projection.terminalCommitRef)) {
      return this.fail(method, projection, "terminal_not_committed");
    }

    const ownerKey = keyOf(projection);
    const cursor = this.cursors.get(ownerKey);
    if (!cursor) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration < cursor.generation) {
      return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration > cursor.generation) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else {
      if (cursor.closed) return this.fail(method, projection, "generation_closed");
      if (projection.receiptSeq <= cursor.receiptSeq) return this.fail(method, projection, "stale_sequence");
    }

    if (this.runtime.hitFault("before_effect")) return this.fail(method, projection, "transport_unavailable", "not_applied", true);
    try {
      const transportResult = this.transport.publish(freezeProjection(projection)) as unknown;
      if (transportResult !== undefined) {
        if (transportResult && typeof (transportResult as { catch?: unknown }).catch === "function") {
          void (transportResult as Promise<unknown>).catch(() => undefined);
        }
        return this.fail(method, projection, "transport_unavailable", "unknown", true);
      }
      this.cursors.set(ownerKey, {
        generation: projection.watchGeneration,
        receiptSeq: projection.receiptSeq,
        closed: projection.type === "agent_terminal",
      });
      this.runtime.recordTrace(traceInput(method, projection, "applied", "published"));
      return Result.ok(undefined);
    } catch {
      return this.fail(method, projection, "transport_unavailable", "unknown", true);
    }
  }

  private call(method: string, projection: PublicAgentProjection): void {
    this.runtime.recordTrace(traceInput(method, projection, null, "call"));
  }

  private fail(
    method: string,
    projection: PublicAgentProjection,
    tag: ProjectionSinkErrorTag,
    certainty: ProjectionSinkError["certainty"] = "not_applied",
    retryable = false,
  ): ResultValue<never, ProjectionSinkError> {
    this.runtime.recordTrace(traceInput(method, projection, certainty, tag));
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

function keyOf(owner: ProjectionOwner): string {
  return JSON.stringify([owner.chatJid, owner.operationId, owner.harnessOperationId]);
}

function traceInput(method: string, value: PublicAgentProjection, certainty: ProjectionSinkError["certainty"] | null, resultTag: string) {
  return { contract: "EF-S08", method, effectId: `${keyOf(value)}:${value.watchGeneration}:${value.receiptSeq}`, operationId: value.operationId, sourceSeq: value.receiptSeq, version: value.watchGeneration, certainty, resultTag };
}

function validProjection(value: PublicAgentProjection): boolean {
  const allowed = ALLOWED_KEYS[value.type];
  if (!allowed || !Object.keys(value).every((key) => allowed.has(key))) return false;
  if (![value.chatJid, value.operationId].every(nonEmpty) || (value.harnessOperationId !== null && !nonEmpty(value.harnessOperationId))) return false;
  if (![value.watchGeneration, value.receiptSeq].every(nonNegativeSafeInteger)) return false;
  switch (value.type) {
    case "agent_snapshot": return PHASES.has(value.phase) && nullableString(value.modelLabel) && value.activeToolNames.every(nonEmpty) && typeof value.cancellationRequested === "boolean";
    case "phase_changed": return PHASES.has(value.phase);
    case "assistant_delta": return typeof value.textDelta === "string";
    case "tool_started": return nonEmpty(value.toolCallId) && nonEmpty(value.toolName);
    case "tool_updated": return nonEmpty(value.toolCallId) && nullableString(value.publicSummary);
    case "tool_finished": return nonEmpty(value.toolCallId) && TOOL_OUTCOMES.has(value.outcome);
    case "usage_updated": return nonNegativeSafeInteger(value.inputTokens) && nonNegativeSafeInteger(value.outputTokens);
    case "agent_terminal": return nonEmpty(value.terminalCommitRef) && DISPOSITIONS.has(value.disposition) && (value.messageRowId === null || (Number.isSafeInteger(value.messageRowId) && value.messageRowId > 0)) && nullableString(value.errorCode);
  }
}
const PHASES = new Set(["idle", "accepted", "running", "waiting", "suspended", "cancelling"]);
const TOOL_OUTCOMES = new Set(["completed", "failed", "cancelled"]);
const DISPOSITIONS = new Set(["completed", "cancelled", "failed", "skipped", "superseded"]);
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function nonNegativeSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }

const IDENTITY_KEYS = ["type", "chatJid", "operationId", "harnessOperationId", "watchGeneration", "receiptSeq"];
const ALLOWED_KEYS: Record<PublicAgentProjection["type"], ReadonlySet<string>> = {
  agent_snapshot: new Set([...IDENTITY_KEYS, "phase", "modelLabel", "activeToolNames", "cancellationRequested"]),
  phase_changed: new Set([...IDENTITY_KEYS, "phase"]),
  assistant_delta: new Set([...IDENTITY_KEYS, "textDelta"]),
  tool_started: new Set([...IDENTITY_KEYS, "toolCallId", "toolName"]),
  tool_updated: new Set([...IDENTITY_KEYS, "toolCallId", "publicSummary"]),
  tool_finished: new Set([...IDENTITY_KEYS, "toolCallId", "outcome"]),
  usage_updated: new Set([...IDENTITY_KEYS, "inputTokens", "outputTokens"]),
  agent_terminal: new Set([...IDENTITY_KEYS, "terminalCommitRef", "disposition", "messageRowId", "errorCode"]),
};

function freezeProjection(projection: PublicAgentProjection): PublicAgentProjection {
  if (projection.type === "agent_snapshot") return Object.freeze({ ...projection, activeToolNames: Object.freeze([...projection.activeToolNames]) });
  return Object.freeze({ ...projection });
}
