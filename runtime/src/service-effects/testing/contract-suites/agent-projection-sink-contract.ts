import type { AgentProjectionSink, ProjectionOwner, PublicAgentEvent, PublicAgentProjection, PublicAgentSnapshot, PublicTerminalProjection } from "../../contracts/agent-projection-sink.js";
import { runParameterisedContractSuite, type ContractCaseResult, type ContractSubjectFactory, type ContractTestContext, type ParameterisedContractCase } from "../contract-suite.js";

export interface AgentProjectionContractSubject {
  readonly sink: AgentProjectionSink;
  authorize(owner: ProjectionOwner): void;
  commit(owner: ProjectionOwner, terminalCommitRef: string): void;
  rejectTransportOnce(): void;
  transportCalls(): readonly PublicAgentProjection[];
}

export function defineAgentProjectionSinkContract(
  factory: ContractSubjectFactory<AgentProjectionContractSubject>,
  createContext: () => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  return runParameterisedContractSuite(factory, cases, createContext);
}

const cases: readonly ParameterisedContractCase<AgentProjectionContractSubject>[] = [
  {
    name: "EF-S08-C1 snapshot precedes buffered events",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      const before = await subject.sink.publishEvent(event(owner, 1, 1));
      assert(!before.ok && before.error.certainty === "not_applied", "event before snapshot must be rejected");
      assert((await subject.sink.publishSnapshot(snapshot(owner, 1, 1))).ok, "snapshot must establish generation");
      assert((await subject.sink.publishEvent(event(owner, 1, 2))).ok, "buffered event after snapshot must publish");
      assert(subject.transportCalls().map((value) => value.type).join(",") === "agent_snapshot,assistant_delta", "transport order must be snapshot then event");
    },
  },
  {
    name: "EF-S08-C2 reconnect generation rejects stale callbacks",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      await subject.sink.publishEvent(event(owner, 1, 2));
      assert((await subject.sink.publishSnapshot(snapshot(owner, 2, 1))).ok, "newer snapshot must reset generation cursor");
      const stale = await subject.sink.publishEvent(event(owner, 1, 3));
      assert(!stale.ok && stale.error._tag === "stale_generation", "old generation callback must fail");
      assert((await subject.sink.publishEvent(event(owner, 2, 2))).ok, "new generation event must publish");
    },
  },
  {
    name: "EF-S08-C3 non-increasing receipt sequence is dropped",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      await subject.sink.publishSnapshot(snapshot(owner, 1, 4));
      for (const seq of [4, 3]) {
        const result = await subject.sink.publishEvent(event(owner, 1, seq));
        assert(!result.ok && result.error._tag === "stale_sequence", "duplicate or decreasing sequence must fail");
      }
      assert(subject.transportCalls().length === 1, "sequence rejection must not call transport");
    },
  },
  {
    name: "EF-S08-C4 cross-chat and cross-operation identity cannot mix",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      const foreign = { ...owner, operationId: "operation-other" }; subject.authorize(foreign);
      const foreignEvent = await subject.sink.publishEvent(event(foreign, 1, 2));
      assert(!foreignEvent.ok && foreignEvent.error._tag === "stale_generation", "a different owner needs its own snapshot cursor");
      const unauthorized = { ...owner, chatJid: "web:other" };
      const rejected = await subject.sink.publishSnapshot(snapshot(unauthorized, 1, 1));
      assert(!rejected.ok && rejected.error._tag === "owner_conflict", "authority must reject cross-owner projection");
    },
  },
  {
    name: "EF-S08-C5 terminal projection requires committed reference and closes generation",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      const value = terminal(owner, 1, 2);
      const before = await subject.sink.publishTerminal(value);
      assert(!before.ok && before.error._tag === "terminal_not_committed", "uncommitted terminal must fail");
      subject.commit(owner, value.terminalCommitRef);
      assert((await subject.sink.publishTerminal(value)).ok, "committed terminal must publish");
      const later = await subject.sink.publishEvent(event(owner, 1, 3));
      assert(!later.ok && later.error._tag === "generation_closed", "terminal must close exact generation");
    },
  },
  {
    name: "EF-S08-C6 protected or unknown payload keys are rejected",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      const unsafe = { ...snapshot(owner, 1, 1), prompt: "must-not-project" } as PublicAgentSnapshot;
      const result = await subject.sink.publishSnapshot(unsafe);
      assert(!result.ok && result.error._tag === "protected_payload", "closed DTO must reject unknown/protected key");
      assert(subject.transportCalls().length === 0, "payload validation failure must not call transport");
    },
  },
  {
    name: "EF-S08-C7 transport throw reports unknown without advancing cursor",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner); subject.rejectTransportOnce();
      const failed = await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      assert(!failed.ok && failed.error._tag === "transport_unavailable" && failed.error.certainty === "unknown", "partial fanout throw must be unknown");
      assert((await subject.sink.publishSnapshot(snapshot(owner, 1, 1))).ok, "failed transport must not advance cursor");
    },
  },
];

export function projectionOwner(): ProjectionOwner { return { chatJid: "web:chat", operationId: "operation-1", harnessOperationId: "harness-1" }; }
export function snapshot(owner: ProjectionOwner, generation: number, receiptSeq: number): PublicAgentSnapshot {
  return { ...owner, watchGeneration: generation, receiptSeq, type: "agent_snapshot", phase: "running", modelLabel: "model", activeToolNames: [], cancellationRequested: false };
}
export function event(owner: ProjectionOwner, generation: number, receiptSeq: number): PublicAgentEvent {
  return { ...owner, watchGeneration: generation, receiptSeq, type: "assistant_delta", textDelta: "public delta" };
}
export function terminal(owner: ProjectionOwner, generation: number, receiptSeq: number): PublicTerminalProjection {
  return { ...owner, watchGeneration: generation, receiptSeq, type: "agent_terminal", terminalCommitRef: "terminal:1", disposition: "completed", messageRowId: 1, errorCode: null };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
