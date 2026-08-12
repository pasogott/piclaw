import "../helpers.js";

import { describe, expect, test } from "bun:test";

import type { ProjectionAuthority, ProjectionOwner, ProjectionTransport, PublicAgentProjection } from "../../src/service-effects/contracts/agent-projection-sink.js";
import type { DeliveryBoundary, DeliveryBoundarySuccess, DeliveryDriverError, DeliveryKind } from "../../src/service-effects/contracts/delivery-driver.js";
import { CurrentPiclawAgentProjectionSink } from "../../src/service-effects/current-piclaw/agent-projection-sink.js";
import { CurrentPiclawDeliveryDriver } from "../../src/service-effects/current-piclaw/delivery-driver.js";
import { defineAgentProjectionSinkContract, type AgentProjectionContractSubject } from "../../src/service-effects/testing/contract-suites/agent-projection-sink-contract.js";
import { defineDeliveryDriverContract, type DeliveryDriverContractSubject } from "../../src/service-effects/testing/contract-suites/delivery-driver-contract.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { FakeAgentProjectionSink } from "../../src/service-effects/testing/fakes/fake-agent-projection-sink.js";
import { FakeDeliveryDriver, type ScriptedDeliveryStep } from "../../src/service-effects/testing/fakes/fake-delivery-driver.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";

function createContext(): ContractTestContext {
  return { clock: new ManualEffectClock("2026-08-12T00:00:00.000Z"), ids: new SequenceEffectIdSource("contract"), faults: new DeterministicFaultPlan() };
}

for (const kind of ["timeline_broadcast", "channel_delivery", "web_push", "pushover", "wake_chat"] as const) {
  describe(`EF-S06 DeliveryDriver shared contract: ${kind}`, () => {
    test("current-Piclaw adapter", async () => {
      expect(await defineDeliveryDriverContract(currentDeliveryFactory(kind), createContext)).toHaveLength(7);
    });
    test("independent scripted fake", async () => {
      expect(await defineDeliveryDriverContract(fakeDeliveryFactory(kind), createContext)).toHaveLength(7);
    });
  });
}

describe("EF-S08 AgentProjectionSink shared contract", () => {
  test("current-Piclaw adapter", async () => {
    expect(await defineAgentProjectionSinkContract(currentProjectionFactory, createContext)).toHaveLength(7);
  });
  test("independent captured-DTO fake", async () => {
    expect(await defineAgentProjectionSinkContract(fakeProjectionFactory, createContext)).toHaveLength(7);
  });
});

function currentDeliveryFactory(kind: DeliveryKind): ContractSubjectFactory<DeliveryDriverContractSubject> {
  return {
    name: `current-piclaw-delivery-${kind}`,
    create(context) { return currentDeliverySubject(kind, context); },
    crashAndRestore(subject, context) { return { subject, context }; },
    inspectTrace(subject) { return (subject as CurrentDeliverySubject).runtime.snapshot(); },
  };
}

function fakeDeliveryFactory(kind: DeliveryKind): ContractSubjectFactory<DeliveryDriverContractSubject> {
  return {
    name: `fake-delivery-${kind}`,
    create() { return fakeDeliverySubject(kind); },
    crashAndRestore(subject, context) { return { subject, context }; },
    inspectTrace(subject) { return (subject.driver as FakeDeliveryDriver).trace.snapshot(); },
  };
}

interface CurrentDeliverySubject extends DeliveryDriverContractSubject { readonly runtime: TestingCurrentPiclawAdapterRuntime; }
function currentDeliverySubject(kind: DeliveryKind, context: ContractTestContext): CurrentDeliverySubject {
  const runtime = new TestingCurrentPiclawAdapterRuntime(context);
  const payloads = new InMemoryEffectPayloadResolver(); payloads.putText("payload:delivery", "safe payload");
  const queue: Array<DeliveryBoundarySuccess | DeliveryDriverError | DelayedBoundary> = [];
  let attempts = 0;
  const boundary: DeliveryBoundary = {
    async attempt() {
      attempts += 1;
      const next = queue.shift();
      if (!next) throw new Error("unscripted");
      if ("gate" in next) { next.startedResolve(); await next.gate; return next.success; }
      if ("certainty" in next) throw next;
      return next;
    },
    classifyError(value) { return isDeliveryError(value) ? value : null; },
  };
  const driver = new CurrentPiclawDeliveryDriver(kind, payloads, (expected, request, payload) => expected === kind && request.destinationRef !== null && payload.mediaType === "text/plain", boundary, runtime);
  return {
    runtime, driver,
    scriptOutcome(value) { queue.push({ acceptedAt: value.acceptedAt, receiptRef: value.receiptRef, detail: value.detail }); },
    scriptError(value) { queue.push(value); },
    scriptDelayed(value) {
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let startedResolve!: () => void; const startedPromise = new Promise<void>((resolve) => { startedResolve = resolve; });
      queue.push({ gate, startedResolve, success: { acceptedAt: value.acceptedAt, receiptRef: value.receiptRef, detail: value.detail } });
      return { release, started: () => startedPromise };
    },
    countAttempts() { return attempts; },
  };
}
interface DelayedBoundary { gate: Promise<void>; startedResolve(): void; success: DeliveryBoundarySuccess; }
function isDeliveryError(value: unknown): value is DeliveryDriverError { return Boolean(value && typeof value === "object" && "certainty" in value && "_tag" in value); }

function fakeDeliverySubject(kind: DeliveryKind): DeliveryDriverContractSubject {
  const driver = new FakeDeliveryDriver(kind);
  const push = (step: ScriptedDeliveryStep) => { driver.script(step); };
  return {
    driver,
    scriptOutcome(value) { push({ _tag: "outcome", outcome: value }); },
    scriptError(value) { push({ _tag: "error", error: value }); },
    scriptDelayed(value) {
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let startedResolve!: () => void; const startedPromise = new Promise<void>((resolve) => { startedResolve = resolve; });
      push({ _tag: "delay", gate: (async () => { startedResolve(); await gate; })(), next: { _tag: "outcome", outcome: value } });
      return { release, started: () => startedPromise };
    },
    countAttempts() { return driver.countAttempts(); },
  };
}

class TestAuthority implements ProjectionAuthority {
  readonly owners = new Set<string>(); readonly commits = new Set<string>();
  isCurrentOwner(owner: ProjectionOwner): boolean { return this.owners.has(ownerKey(owner)); }
  isCommittedTerminalRef(owner: ProjectionOwner, ref: string): boolean { return this.commits.has(`${ownerKey(owner)}:${ref}`); }
}
class TestTransport implements ProjectionTransport {
  readonly calls: PublicAgentProjection[] = []; failNext = false;
  publish(value: PublicAgentProjection): void { if (this.failNext) { this.failNext = false; throw new Error("partial fanout"); } this.calls.push(value); }
}
function ownerKey(owner: ProjectionOwner): string { return JSON.stringify([owner.chatJid, owner.operationId, owner.harnessOperationId]); }

const currentProjectionFactory: ContractSubjectFactory<AgentProjectionContractSubject> = {
  name: "current-piclaw-agent-projection",
  create(context) {
    const authority = new TestAuthority(); const transport = new TestTransport(); const runtime = new TestingCurrentPiclawAdapterRuntime(context);
    return projectionSubject(new CurrentPiclawAgentProjectionSink(authority, transport, runtime), authority, transport, runtime);
  },
  crashAndRestore(subject, context) { return { subject, context }; },
  inspectTrace(subject) { return (subject as ProjectionSubject).runtime.snapshot(); },
};
const fakeProjectionFactory: ContractSubjectFactory<AgentProjectionContractSubject> = {
  name: "fake-agent-projection",
  create() { const authority = new TestAuthority(); const transport = new TestTransport(); return projectionSubject(new FakeAgentProjectionSink(authority), authority, transport); },
  crashAndRestore(subject, context) { return { subject, context }; },
  inspectTrace(subject) { return (subject.sink as FakeAgentProjectionSink).trace.snapshot(); },
};
interface ProjectionSubject extends AgentProjectionContractSubject { runtime: TestingCurrentPiclawAdapterRuntime; }
function projectionSubject(sink: AgentProjectionContractSubject["sink"], authority: TestAuthority, transport: TestTransport, runtime = new TestingCurrentPiclawAdapterRuntime(createContext())): ProjectionSubject {
  const fake = sink instanceof FakeAgentProjectionSink;
  return {
    sink, runtime,
    authorize(owner) { authority.owners.add(ownerKey(owner)); }, commit(owner, ref) { authority.commits.add(`${ownerKey(owner)}:${ref}`); },
    rejectTransportOnce() { if (fake) (sink as FakeAgentProjectionSink).rejectTransportOnce(); else transport.failNext = true; },
    transportCalls() { return fake ? (sink as FakeAgentProjectionSink).published : transport.calls; },
  };
}
