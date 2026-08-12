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
import { EffectTraceRecorder } from "../trace-recorder.js";

type Cursor = { generation: number; seq: number; closed: boolean };

export class FakeAgentProjectionSink implements AgentProjectionSink {
  readonly trace = new EffectTraceRecorder();
  readonly published: PublicAgentProjection[] = [];
  readonly #cursors = new Map<string, Cursor>();
  #failTransport = false;

  constructor(private readonly authority: ProjectionAuthority) {}

  rejectTransportOnce(): void { this.#failTransport = true; }

  publishSnapshot(value: PublicAgentSnapshot): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishSnapshot", value); }
  publishEvent(value: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishEvent", value); }
  publishTerminal(value: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> {
    if (!this.authority.isCurrentOwner(value)) return Promise.resolve(this.reject("publishTerminal", value, "owner_conflict"));
    if (!value.terminalCommitRef || !this.authority.isCommittedTerminalRef(value, value.terminalCommitRef)) return Promise.resolve(this.reject("publishTerminal", value, "terminal_not_committed"));
    return this.accept("publishTerminal", value);
  }

  private async accept(method: string, value: PublicAgentProjection): Promise<ResultValue<void, ProjectionSinkError>> {
    this.trace.recordCall(trace(method, value, null, "call"));
    if (!validProjection(value)) return this.reject(method, value, "protected_payload");
    if (!this.authority.isCurrentOwner(value)) return this.reject(method, value, "owner_conflict");
    const key = ownerKey(value);
    const cursor = this.#cursors.get(key);
    if (!cursor) {
      if (value.type !== "agent_snapshot") return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration < cursor.generation || (value.watchGeneration > cursor.generation && value.type !== "agent_snapshot")) {
      return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration === cursor.generation) {
      if (cursor.closed) return this.reject(method, value, "generation_closed");
      if (value.receiptSeq <= cursor.seq) return this.reject(method, value, "stale_sequence");
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

  private reject(method: string, value: PublicAgentProjection, tag: ProjectionSinkErrorTag): ResultValue<never, ProjectionSinkError> {
    this.trace.recordResult(trace(method, value, "not_applied", tag));
    return Result.err(Object.freeze({ _tag: tag, certainty: "not_applied", retryable: false }));
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
function validProjection(value: PublicAgentProjection): boolean {
  const allowed = KEYS[value.type];
  if (!allowed || !Object.keys(value).every((key) => allowed.has(key))) return false;
  if (!nonEmpty(value.chatJid) || !nonEmpty(value.operationId) || (value.harnessOperationId !== null && !nonEmpty(value.harnessOperationId)) || !safe(value.watchGeneration) || !safe(value.receiptSeq)) return false;
  if (value.type === "agent_snapshot") return PHASES.has(value.phase) && (value.modelLabel === null || typeof value.modelLabel === "string") && value.activeToolNames.every(nonEmpty) && typeof value.cancellationRequested === "boolean";
  if (value.type === "phase_changed") return PHASES.has(value.phase);
  if (value.type === "assistant_delta") return typeof value.textDelta === "string";
  if (value.type === "tool_started") return nonEmpty(value.toolCallId) && nonEmpty(value.toolName);
  if (value.type === "tool_updated") return nonEmpty(value.toolCallId) && (value.publicSummary === null || typeof value.publicSummary === "string");
  if (value.type === "tool_finished") return nonEmpty(value.toolCallId) && OUTCOMES.has(value.outcome);
  if (value.type === "usage_updated") return safe(value.inputTokens) && safe(value.outputTokens);
  return nonEmpty(value.terminalCommitRef) && DISPOSITIONS.has(value.disposition) && (value.messageRowId === null || (Number.isSafeInteger(value.messageRowId) && value.messageRowId > 0)) && (value.errorCode === null || typeof value.errorCode === "string");
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
