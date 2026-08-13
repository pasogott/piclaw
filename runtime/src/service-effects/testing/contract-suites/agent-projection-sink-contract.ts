import type { AgentProjectionSink, ProjectionOwner, PublicAgentEvent, PublicAgentProjection, PublicAgentSnapshot, PublicTerminalProjection } from "../../contracts/agent-projection-sink.js";
import { runParameterisedContractSuite, type ContractCaseResult, type ContractSubjectFactory, type ContractTestContext, type ParameterisedContractCase } from "../contract-suite.js";

export interface AgentProjectionContractSubject {
  readonly sink: AgentProjectionSink;
  authorize(owner: ProjectionOwner): void;
  commit(owner: ProjectionOwner, terminalCommitRef: string): void;
  rejectTransportOnce(): void;
  returnAsyncTransportOnce(): void;
  throwAuthorityOnce(predicate: "owner" | "terminal"): void;
  returnAuthorityOnce(predicate: "owner" | "terminal", value: unknown): void;
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
      const reopen = await subject.sink.publishSnapshot(snapshot(owner, 1, 4));
      assert(!reopen.ok && reopen.error._tag === "generation_closed", "same-generation snapshot cannot reopen terminal cursor");
      assert((await subject.sink.publishSnapshot(snapshot(owner, 2, 0))).ok, "newer authorized snapshot may establish a fresh generation");
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
  {
    name: "EF-S08-C8 malformed DTO values are rejected before authority and transport",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      for (const malformed of [
        { ...snapshot(owner, 1, 1), chatJid: "" },
        { ...snapshot(owner, 1, 1), receiptSeq: -1 },
        { ...snapshot(owner, 1, 1), activeToolNames: [1] },
        { ...snapshot(owner, 1, 1), phase: "bogus" },
      ] as unknown as PublicAgentSnapshot[]) {
        const result = await subject.sink.publishSnapshot(malformed);
        assert(!result.ok && result.error._tag === "protected_payload", "malformed closed DTO must fail runtime validation");
      }
      assert(subject.transportCalls().length === 0, "malformed DTO must not call transport");
    },
  },
  {
    name: "EF-S08-C9 reconstructed sink requires a fresh snapshot",
    async run(fixture) {
      const owner = projectionOwner(); fixture.subject.authorize(owner);
      await fixture.subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      const traceBefore = fixture.inspectTrace().length;
      const restored = await fixture.crashAndRestore(); restored.authorize(owner);
      const eventFirst = await restored.sink.publishEvent(event(owner, 1, 2));
      assert(!eventFirst.ok && eventFirst.error._tag === "stale_generation", "cursor is intentionally in-memory after restart");
      assert((await restored.sink.publishSnapshot(snapshot(owner, 2, 0))).ok, "fresh snapshot re-establishes projection after restart");
      assert(fixture.inspectTrace().length > traceBefore, "restored observer must retain and append trace continuity");
    },
  },
  {
    name: "EF-S08-C10 same-generation snapshot cannot reset an established cursor",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner);
      await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      const duplicate = await subject.sink.publishSnapshot(snapshot(owner, 1, 2));
      assert(!duplicate.ok && duplicate.error._tag === "stale_generation", "same-generation snapshot must be rejected");
    },
  },
  {
    name: "EF-S08-C11 non-void transport is unknown and does not advance cursor",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner); subject.returnAsyncTransportOnce();
      const invalid = await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      assert(!invalid.ok && invalid.error.certainty === "unknown", "async transport violates synchronous contract");
      assert((await subject.sink.publishSnapshot(snapshot(owner, 1, 1))).ok, "invalid transport return must not advance cursor");
    },
  },
  {
    name: "EF-S08-C12 authority predicate faults remain bounded",
    async run({ subject }) {
      const owner = projectionOwner(); subject.authorize(owner); subject.throwAuthorityOnce("owner");
      const ownerFault = await subject.sink.publishSnapshot(snapshot(owner, 1, 1));
      assert(!ownerFault.ok && ownerFault.error._tag === "transport_unavailable" && ownerFault.error.certainty === "not_applied", "owner predicate fault must be bounded");
      await subject.sink.publishSnapshot(snapshot(owner, 1, 1)); const value = terminal(owner, 1, 2); subject.commit(owner, value.terminalCommitRef); subject.throwAuthorityOnce("terminal");
      const terminalFault = await subject.sink.publishTerminal(value);
      assert(!terminalFault.ok && terminalFault.error._tag === "transport_unavailable" && terminalFault.error.certainty === "not_applied", "terminal predicate fault must be bounded");
      for (const malformed of ["yes", 1, null]) {
        subject.returnAuthorityOnce("owner", malformed); const ownerResult = await subject.sink.publishSnapshot(snapshot(owner, 2, 0));
        assert(!ownerResult.ok && ownerResult.error._tag === "transport_unavailable" && ownerResult.error.certainty === "not_applied", "owner authority requires exact boolean");
        subject.returnAuthorityOnce("terminal", malformed); const terminalResult = await subject.sink.publishTerminal(value);
        assert(!terminalResult.ok && terminalResult.error._tag === "transport_unavailable" && terminalResult.error.certainty === "not_applied", "terminal authority requires exact boolean");
      }
    },
  },
  {
    name: "EF-S08-C13 arbitrary malformed inputs resolve typed errors",
    async run({ subject }) {
      const throwingProxy = new Proxy({}, { ownKeys() { throw new Error("ownKeys trap"); }, get() { throw new Error("get trap"); } });
      const throwingGetter = Object.defineProperty({}, "type", { enumerable: true, get() { throw new Error("type getter"); } });
      const identityGetter = Object.defineProperty({ ...snapshot(projectionOwner(), 1, 1) }, "chatJid", { enumerable: true, get() { throw new Error("identity getter"); } });
      const payloadGetter = Object.defineProperty({ ...snapshot(projectionOwner(), 1, 1) }, "activeToolNames", { enumerable: true, get() { throw new Error("payload getter"); } });
      const changing = [
        changingProjection(snapshot(projectionOwner(), 1, 1), "chatJid"), changingProjection(snapshot(projectionOwner(), 1, 1), "watchGeneration"), changingProjection(snapshot(projectionOwner(), 1, 1), "receiptSeq"),
        changingProjection(terminal(projectionOwner(), 1, 2), "terminalCommitRef"), changingProjection(snapshot(projectionOwner(), 1, 1), "activeToolNames"),
      ];
      for (const malformed of [null, 1, Symbol("bad"), throwingProxy, throwingGetter, identityGetter, payloadGetter, ...changing, { type: "agent_snapshot", chatJid: Symbol("bad") }, { ...snapshot(projectionOwner(), 1, 1), activeToolNames: null }, { ...snapshot(projectionOwner(), 1, 1), modelLabel: 3 }, { ...snapshot(projectionOwner(), 1, 1), watchGeneration: Number.MAX_SAFE_INTEGER + 1 }] as unknown[]) {
        const result = await subject.sink.publishSnapshot(malformed as PublicAgentSnapshot);
        assert(!result.ok && result.error._tag === "protected_payload", "malformed input must resolve protected_payload");
      }
      assert(subject.transportCalls().length === 0, "hostile/changing projections must not reach transport");
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
function changingProjection<T extends PublicAgentProjection>(value: T, field: keyof T): T {
  let reads = 0; const original = value[field];
  return Object.defineProperty({ ...value }, field, { enumerable: true, get() { reads += 1; if (reads === 1) return original; throw new Error(`changing ${String(field)} getter`); } }) as T;
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
