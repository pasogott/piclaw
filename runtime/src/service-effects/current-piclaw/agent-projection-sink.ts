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
    return this.publish("publishSnapshot", snapshot as unknown);
  }

  publishEvent(event: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishEvent", event as unknown);
  }

  publishTerminal(terminal: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishTerminal", terminal as unknown);
  }

  private async publish(
    method: string,
    candidate: unknown,
  ): Promise<ResultValue<void, ProjectionSinkError>> {
    if (!validProjection(candidate)) return this.invalid(method, candidate);
    const projection = candidate;
    this.call(method, projection);
    let authorized: boolean;
    try { authorized = this.authority.isCurrentOwner(projection); } catch { return this.fail(method, projection, "transport_unavailable", "not_applied", true); }
    if (!authorized) return this.fail(method, projection, "owner_conflict");
    if (projection.type === "agent_terminal") {
      let committed: boolean;
      try { committed = this.authority.isCommittedTerminalRef(projection, projection.terminalCommitRef); } catch { return this.fail(method, projection, "transport_unavailable", "not_applied", true); }
      if (!committed) return this.fail(method, projection, "terminal_not_committed");
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
      if (projection.type === "agent_snapshot") return this.fail(method, projection, "stale_generation");
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

  private invalid(method: string, _candidate: unknown): ResultValue<never, ProjectionSinkError> {
    this.runtime.recordTrace({ contract: "EF-S08", method, effectId: "invalid-projection", certainty: "not_applied", resultTag: "protected_payload" });
    return Result.err(Object.freeze({ _tag: "protected_payload", certainty: "not_applied", retryable: false }));
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

function validProjection(value: unknown): value is PublicAgentProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;
  const allowed = ALLOWED_KEYS[candidate.type as PublicAgentProjection["type"]];
  if (!allowed || !Object.keys(candidate).every((key) => allowed.has(key))) return false;
  const projection = candidate as unknown as PublicAgentProjection;
  if (![projection.chatJid, projection.operationId].every(nonEmpty) || (projection.harnessOperationId !== null && !nonEmpty(projection.harnessOperationId))) return false;
  if (![projection.watchGeneration, projection.receiptSeq].every(nonNegativeSafeInteger)) return false;
  switch (projection.type) {
    case "agent_snapshot": return PHASES.has(projection.phase) && nullableString(projection.modelLabel) && Array.isArray(projection.activeToolNames) && projection.activeToolNames.every(nonEmpty) && typeof projection.cancellationRequested === "boolean";
    case "phase_changed": return PHASES.has(projection.phase);
    case "assistant_delta": return typeof projection.textDelta === "string";
    case "tool_started": return nonEmpty(projection.toolCallId) && nonEmpty(projection.toolName);
    case "tool_updated": return nonEmpty(projection.toolCallId) && nullableString(projection.publicSummary);
    case "tool_finished": return nonEmpty(projection.toolCallId) && TOOL_OUTCOMES.has(projection.outcome);
    case "usage_updated": return nonNegativeSafeInteger(projection.inputTokens) && nonNegativeSafeInteger(projection.outputTokens);
    case "agent_terminal": return nonEmpty(projection.terminalCommitRef) && DISPOSITIONS.has(projection.disposition) && (projection.messageRowId === null || (Number.isSafeInteger(projection.messageRowId) && projection.messageRowId > 0)) && nullableString(projection.errorCode);
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
