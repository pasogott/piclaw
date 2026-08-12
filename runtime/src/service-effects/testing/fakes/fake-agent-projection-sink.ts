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
    if (!this.authority.isCurrentOwner(value)) return this.reject(method, value, "owner_conflict");
    if (!closedShape(value)) return this.reject(method, value, "protected_payload");
    const key = ownerKey(value);
    const cursor = this.#cursors.get(key);
    if (!cursor) {
      if (value.type !== "agent_snapshot") return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration < cursor.generation || (value.watchGeneration > cursor.generation && value.type !== "agent_snapshot")) {
      return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration === cursor.generation) {
      if (cursor.closed && value.type !== "agent_snapshot") return this.reject(method, value, "generation_closed");
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
function closedShape(value: PublicAgentProjection): boolean { return Object.keys(value).every((key) => KEYS[value.type].has(key)); }
function freezeProjection(value: PublicAgentProjection): PublicAgentProjection {
  if (value.type === "agent_snapshot") return Object.freeze({ ...value, activeToolNames: Object.freeze([...value.activeToolNames]) });
  return Object.freeze({ ...value });
}
