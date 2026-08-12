import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type {
  AgentProjectionSink,
  ProjectionAuthority,
  ProjectionOwner,
  ProjectionSinkError,
  ProjectionSinkErrorTag,
  PublicAgentEvent,
  PublicAgentProjection,
  PublicAgentSnapshot,
  PublicTerminalProjection,
} from "../../contracts/agent-projection-sink.js";
import type { NormalisedEffectTrace } from "../../contracts/common.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

type Cursor = { generation: number; seq: number; closed: boolean };

export class FakeAgentProjectionSink implements AgentProjectionSink {
  readonly trace: EffectTraceRecorder;
  readonly published: PublicAgentProjection[] = [];
  readonly #cursors = new Map<string, Cursor>();
  #failTransport = false;
  #asyncTransport = false;

  constructor(private readonly authority: ProjectionAuthority, traceSnapshot: readonly NormalisedEffectTrace[] = []) { this.trace = EffectTraceRecorder.fromSnapshot(traceSnapshot); }

  rejectTransportOnce(): void { this.#failTransport = true; }
  returnAsyncTransportOnce(): void { this.#asyncTransport = true; }

  publishSnapshot(value: PublicAgentSnapshot): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishSnapshot", value as unknown); }
  publishEvent(value: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishEvent", value as unknown); }
  publishTerminal(value: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishTerminal", value as unknown); }

  private async accept(method: string, candidate: unknown): Promise<ResultValue<void, ProjectionSinkError>> {
    if (!validProjection(candidate)) return this.invalid(method);
    const value = candidate;
    this.trace.recordCall(trace(method, value, null, "call"));
    let authorized: boolean;
    try { authorized = this.authority.isCurrentOwner(value); } catch { return this.reject(method, value, "transport_unavailable", "not_applied", true); }
    if (!authorized) return this.reject(method, value, "owner_conflict");
    if (value.type === "agent_terminal") {
      let committed: boolean;
      try { committed = this.authority.isCommittedTerminalRef(value, value.terminalCommitRef); } catch { return this.reject(method, value, "transport_unavailable", "not_applied", true); }
      if (!committed) return this.reject(method, value, "terminal_not_committed");
    }
    const key = ownerKey(value);
    const cursor = this.#cursors.get(key);
    if (!cursor) {
      if (value.type !== "agent_snapshot") return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration < cursor.generation || (value.watchGeneration > cursor.generation && value.type !== "agent_snapshot")) {
      return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration === cursor.generation) {
      if (cursor.closed) return this.reject(method, value, "generation_closed");
      if (value.type === "agent_snapshot") return this.reject(method, value, "stale_generation");
      if (value.receiptSeq <= cursor.seq) return this.reject(method, value, "stale_sequence");
    }
    if (this.#asyncTransport) {
      this.#asyncTransport = false;
      this.trace.recordResult(trace(method, value, "unknown", "transport_unavailable"));
      return Result.err(Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    }
    if (this.#failTransport) {
      this.#failTransport = false;
      this.trace.recordResult(trace(method, value, "unknown", "transport_unavailable"));
      return Result.err(Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    }
    this.#cursors.set(key, { generation: value.watchGeneration, seq: value.receiptSeq, closed: value.type === "agent_terminal" });
    this.published.push(freezeProjection(value));
    this.trace.recordResult(trace(method, value, "applied", "published"));
    return Result.ok(undefined);
  }

  private invalid(method: string): ResultValue<never, ProjectionSinkError> {
    this.trace.recordResult({ contract: "EF-S08", method, effectId: "invalid-projection", certainty: "not_applied", resultTag: "protected_payload" });
    return Result.err(Object.freeze({ _tag: "protected_payload", certainty: "not_applied", retryable: false }));
  }

  private reject(method: string, value: PublicAgentProjection, tag: ProjectionSinkErrorTag, certainty: ProjectionSinkError["certainty"] = "not_applied", retryable = false): ResultValue<never, ProjectionSinkError> {
    this.trace.recordResult(trace(method, value, certainty, tag));
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

function ownerKey(owner: ProjectionOwner): string { return JSON.stringify([owner.chatJid, owner.operationId, owner.harnessOperationId]); }
function trace(method: string, value: PublicAgentProjection, certainty: ProjectionSinkError["certainty"] | null, resultTag: string) {
  return { contract: "EF-S08", method, effectId: `${ownerKey(value)}:${value.watchGeneration}:${value.receiptSeq}`, operationId: value.operationId, sourceSeq: value.receiptSeq, version: value.watchGeneration, certainty, resultTag };
}
const BASE = ["type", "chatJid", "operationId", "harnessOperationId", "watchGeneration", "receiptSeq"];
const KEYS: Record<PublicAgentProjection["type"], Set<string>> = {
  agent_snapshot: new Set([...BASE, "phase", "modelLabel", "activeToolNames", "cancellationRequested"]),
  phase_changed: new Set([...BASE, "phase"]), assistant_delta: new Set([...BASE, "textDelta"]),
  tool_started: new Set([...BASE, "toolCallId", "toolName"]), tool_updated: new Set([...BASE, "toolCallId", "publicSummary"]),
  tool_finished: new Set([...BASE, "toolCallId", "outcome"]), usage_updated: new Set([...BASE, "inputTokens", "outputTokens"]),
  agent_terminal: new Set([...BASE, "terminalCommitRef", "disposition", "messageRowId", "errorCode"]),
};
function validProjection(value: unknown): value is PublicAgentProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;
  const allowed = KEYS[candidate.type as PublicAgentProjection["type"]];
  if (!allowed || !Object.keys(candidate).every((key) => allowed.has(key))) return false;
  const projection = candidate as unknown as PublicAgentProjection;
  if (!nonEmpty(projection.chatJid) || !nonEmpty(projection.operationId) || (projection.harnessOperationId !== null && !nonEmpty(projection.harnessOperationId)) || !safe(projection.watchGeneration) || !safe(projection.receiptSeq)) return false;
  if (projection.type === "agent_snapshot") return PHASES.has(projection.phase) && (projection.modelLabel === null || typeof projection.modelLabel === "string") && Array.isArray(projection.activeToolNames) && projection.activeToolNames.every(nonEmpty) && typeof projection.cancellationRequested === "boolean";
  if (projection.type === "phase_changed") return PHASES.has(projection.phase);
  if (projection.type === "assistant_delta") return typeof projection.textDelta === "string";
  if (projection.type === "tool_started") return nonEmpty(projection.toolCallId) && nonEmpty(projection.toolName);
  if (projection.type === "tool_updated") return nonEmpty(projection.toolCallId) && (projection.publicSummary === null || typeof projection.publicSummary === "string");
  if (projection.type === "tool_finished") return nonEmpty(projection.toolCallId) && OUTCOMES.has(projection.outcome);
  if (projection.type === "usage_updated") return safe(projection.inputTokens) && safe(projection.outputTokens);
  return nonEmpty(projection.terminalCommitRef) && DISPOSITIONS.has(projection.disposition) && (projection.messageRowId === null || (Number.isSafeInteger(projection.messageRowId) && projection.messageRowId > 0)) && (projection.errorCode === null || typeof projection.errorCode === "string");
}
const PHASES = new Set(["idle", "accepted", "running", "waiting", "suspended", "cancelling"]);
const OUTCOMES = new Set(["completed", "failed", "cancelled"]);
const DISPOSITIONS = new Set(["completed", "cancelled", "failed", "skipped", "superseded"]);
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function safe(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function freezeProjection(value: PublicAgentProjection): PublicAgentProjection {
  if (value.type === "agent_snapshot") return Object.freeze({ ...value, activeToolNames: Object.freeze([...value.activeToolNames]) });
  return Object.freeze({ ...value });
}
