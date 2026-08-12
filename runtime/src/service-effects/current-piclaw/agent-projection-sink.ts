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
    if (!this.authority.isCurrentOwner(terminal)) return Promise.resolve(this.fail("publishTerminal", terminal, "owner_conflict"));
    if (!terminal.terminalCommitRef || !this.authority.isCommittedTerminalRef(terminal, terminal.terminalCommitRef)) {
      return Promise.resolve(this.fail("publishTerminal", terminal, "terminal_not_committed"));
    }
    return this.publish("publishTerminal", terminal, true);
  }

  private async publish(
    method: string,
    projection: PublicAgentProjection,
    terminalValidated = false,
  ): Promise<ResultValue<void, ProjectionSinkError>> {
    this.call(method, projection);
    if (!this.authority.isCurrentOwner(projection)) return this.fail(method, projection, "owner_conflict");
    if (!isClosedProjection(projection)) return this.fail(method, projection, "protected_payload");
    if (projection.type === "agent_terminal" && !terminalValidated) return this.fail(method, projection, "terminal_not_committed");

    const ownerKey = keyOf(projection);
    const cursor = this.cursors.get(ownerKey);
    if (!cursor) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration < cursor.generation) {
      return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration > cursor.generation) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else {
      if (cursor.closed && projection.type !== "agent_snapshot") return this.fail(method, projection, "generation_closed");
      if (projection.receiptSeq <= cursor.receiptSeq) return this.fail(method, projection, "stale_sequence");
    }

    if (this.runtime.hitFault("before_effect")) return this.fail(method, projection, "transport_unavailable", "not_applied", true);
    try {
      await this.transport.publish(freezeProjection(projection));
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

function isClosedProjection(value: PublicAgentProjection): boolean {
  const allowed = ALLOWED_KEYS[value.type];
  return Object.keys(value).every((key) => allowed.has(key));
}

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
