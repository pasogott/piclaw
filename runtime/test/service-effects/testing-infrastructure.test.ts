import { describe, expect, test } from "bun:test";

import {
  hashCanonicalRequest,
  type NormalisedEffectTrace,
} from "../../src/service-effects/contracts/common.js";
import {
  runParameterisedContractSuite,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../../src/service-effects/testing/contract-suite.js";
import {
  ControlledBarrier,
  crashAndRestore,
  DelayedCompletion,
  EffectInterleavingController,
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import {
  assertCompleteEffectorCaseCatalogue,
  EFFECTOR_CASE_CATALOGUE,
  EFFECTOR_CONTRACT_IDS,
  SHARED_EFFECTOR_CASE_CATALOGUE,
  type SharedEffectorCase,
  type SharedEffectorCaseId,
} from "../../src/service-effects/testing/effector-case-catalogue.js";
import {
  DeterministicFaultPlan,
  STANDARD_FAULT_POINTS,
  type PlannedFault,
} from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

describe("latent deterministic effect testing controls", () => {
  test("manual clock and sequence IDs are deterministic", () => {
    const clock = new ManualEffectClock("2026-02-03T04:05:06.000Z");
    const ids = new SequenceEffectIdSource("case", 3);

    expect(clock.now().toISOString()).toBe("2026-02-03T04:05:06.000Z");
    expect(clock.advance(250).toISOString()).toBe("2026-02-03T04:05:06.250Z");
    expect([ids.nextId(), ids.nextId()]).toEqual(["case-001", "case-002"]);
  });

  test("every standard fault can be injected at an exact occurrence", () => {
    for (const point of STANDARD_FAULT_POINTS) {
      const plan = new DeterministicFaultPlan([{ point, occurrence: 2 }]);
      expect(plan.hit(point)).toBeFalse();
      expect(plan.hit(point)).toBeTrue();
      expect(plan.hit(point)).toBeFalse();
    }
  });

  test("fault consumption survives deterministic crash and restore", () => {
    const plan = new DeterministicFaultPlan([{ point: "lease_expiry", occurrence: 2 }]);
    expect(plan.hit("lease_expiry")).toBeFalse();
    const snapshot = crashAndRestore(plan);
    expect(snapshot.consumed.lease_expiry).toBe(1);
    expect(plan.hit("lease_expiry")).toBeTrue();
  });

  test("controlled barrier releases current and future waiters without timers", async () => {
    const barrier = new ControlledBarrier();
    let passed = false;
    const waiting = barrier.wait().then(() => { passed = true; });
    await Promise.resolve();
    expect(passed).toBeFalse();
    barrier.release();
    await waiting;
    expect(passed).toBeTrue();
    await barrier.wait();
  });

  test("effect interleaving controller releases every effect and acknowledgement boundary independently", async () => {
    const controls = new EffectInterleavingController();
    const points = ["before_effect", "after_effect", "after_acknowledgement"] as const;
    for (const point of points) {
      let passed = false;
      const waiting = controls.waitAt(point).then(() => { passed = true; });
      await Promise.resolve();
      expect(passed).toBeFalse();
      expect(controls.isReleased(point)).toBeFalse();
      controls.release(point);
      await waiting;
      expect(passed).toBeTrue();
      expect(controls.isReleased(point)).toBeTrue();
    }
  });

  test("delayed completion exposes deterministic resolve, late-ignore, and reject controls", async () => {
    const resolved = new DelayedCompletion<string>();
    expect(resolved.resolveIfCurrent("owner:1", "owner:2", "protected-value")).toBe("late_ignored");
    expect(resolved.settled).toBeFalse();
    expect(resolved.ignoredLateResults).toBe(1);
    expect(resolved.resolveIfCurrent("owner:2", "owner:2", "receipt-1")).toBe("resolved");
    expect(await resolved.promise).toBe("receipt-1");
    expect(resolved.settled).toBeTrue();
    expect(() => resolved.resolve("receipt-2")).toThrow("already settled");

    const rejected = new DelayedCompletion<never>();
    rejected.reject(new Error("disconnected"));
    expect(rejected.promise).rejects.toThrow("disconnected");
  });

  test("trace recorder preserves ordered immutable call/results and rejects protected fields", () => {
    const trace = new EffectTraceRecorder();
    trace.recordCall({
      contract: "sample",
      method: "increment",
      effectId: "effect-1",
      operationId: null,
      sourceSeq: null,
      version: 1,
    });
    trace.recordResult({
      contract: "sample",
      method: "increment",
      effectId: "effect-1",
      operationId: null,
      sourceSeq: null,
      version: 1,
      certainty: "applied",
      resultTag: "ok",
    });
    const inspected = trace.inspect();
    expect(inspected.map((entry) => entry.resultTag)).toEqual(["call", "ok"]);
    expect(Object.isFrozen(inspected)).toBeTrue();
    expect(Object.isFrozen(inspected[0])).toBeTrue();
    const restored = EffectTraceRecorder.fromSnapshot(trace.snapshot());
    expect(restored.inspect()).toEqual(inspected);
    expect(() => trace.recordResult({
      contract: "sample",
      method: "increment",
      effectId: "effect-3",
      resultTag: "rejected",
      toolArguments: "protected",
    })).toThrow("Protected trace field rejected");
    expect(trace.inspect()).toHaveLength(2);
  });
});

interface SampleSnapshot {
  readonly value: number;
  readonly trace: ReturnType<EffectTraceRecorder["snapshot"]>;
}

class SampleCounterContract {
  value = 0;
  trace = new EffectTraceRecorder();

  constructor(private readonly context: ContractTestContext) {}

  increment(): void {
    if (this.context.faults.hit("before_effect")) throw new Error("before effect");
    this.value += 1;
    this.trace.append({
      contract: "sample-counter",
      method: "increment",
      effectId: this.context.ids.nextId(),
      operationId: null,
      sourceSeq: null,
      version: this.value,
      certainty: "applied",
      resultTag: "ok",
    });
  }

  snapshot(): SampleSnapshot {
    return { value: this.value, trace: this.trace.snapshot() };
  }

  restore(snapshot: SampleSnapshot): void {
    this.value = snapshot.value;
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot.trace);
  }
}

function createSampleContext(faults: readonly PlannedFault[] = []): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-02-03T04:05:06.000Z"),
    ids: new SequenceEffectIdSource("sample", 2),
    faults: new DeterministicFaultPlan(faults),
  };
}

describe("generic parameterised contract-suite lifecycle", () => {
  test("runs a tiny test-local contract with fresh state and crash restore", async () => {
    const factory: ContractSubjectFactory<SampleCounterContract> = {
      name: "sample-counter",
      create: (context) => new SampleCounterContract(context),
      crashAndRestore: (subject, context) => {
        const snapshot = structuredClone(subject.snapshot());
        const restored = new SampleCounterContract(context);
        restored.restore(snapshot);
        return { subject: restored, context };
      },
      inspectTrace: (subject) => subject.trace.inspect(),
    };
    const cases: readonly ParameterisedContractCase<SampleCounterContract>[] = [
      {
        name: "ordinary effect",
        run: ({ subject }) => {
          subject.increment();
          expect(subject.value).toBe(1);
        },
      },
      {
        name: "crash restore",
        run: async (fixture) => {
          const originalContext = fixture.context;
          fixture.subject.increment();
          expect(fixture.context.faults.snapshot().consumed.before_effect).toBe(1);
          const restored = await fixture.crashAndRestore();
          expect(fixture.context).toBe(originalContext);
          expect(restored.value).toBe(1);
          restored.increment();
          expect(restored.value).toBe(2);
          expect(fixture.context.faults.snapshot().consumed.before_effect).toBe(2);
          expect(fixture.inspectTrace().map((entry) => entry.effectId)).toEqual(["sample-01", "sample-02"]);
        },
      },
    ];

    const results = await runParameterisedContractSuite(factory, cases, createSampleContext);
    expect(results.map((result) => result.caseName)).toEqual(["ordinary effect", "crash restore"]);
    expect(results[0].trace).toHaveLength(1);
    expect(results[1].trace).toHaveLength(2);
    expect(Object.isFrozen(results)).toBeTrue();
    expect(Object.isFrozen(results[1])).toBeTrue();
    expect(Object.isFrozen(results[1].trace)).toBeTrue();
    expect(Object.isFrozen(results[1].trace[0])).toBeTrue();
    expect(() => (results[1].trace as unknown as NormalisedEffectTrace[]).push(results[1].trace[0]))
      .toThrow();
  });

  test("rejects duplicate case names before creating a subject", async () => {
    let createCount = 0;
    const factory: ContractSubjectFactory<SampleCounterContract> = {
      name: "sample-counter",
      create: (context) => {
        createCount += 1;
        return new SampleCounterContract(context);
      },
      crashAndRestore: (subject, context) => ({ subject, context }),
      inspectTrace: (subject) => subject.trace.inspect(),
    };
    const duplicateCases: readonly ParameterisedContractCase<SampleCounterContract>[] = [
      { name: "duplicate", run: () => undefined },
      { name: "duplicate", run: () => undefined },
    ];
    expect(runParameterisedContractSuite(factory, duplicateCases, createSampleContext))
      .rejects.toThrow("non-empty and unique");
    expect(createCount).toBe(0);
  });
});

describe("typed effector case catalogue", () => {
  test("covers EF-S01 through EF-S08 and EF-H01 exactly once", () => {
    expect(() => assertCompleteEffectorCaseCatalogue()).not.toThrow();
    expect(EFFECTOR_CASE_CATALOGUE.map((entry) => entry.contractId)).toEqual(EFFECTOR_CONTRACT_IDS);
  });

  test("maps every entry to unique named cases, prerequisites, faults, and one crash oracle", () => {
    const caseIds = new Set<string>();
    const oracleIds = new Set<string>();
    for (const entry of EFFECTOR_CASE_CATALOGUE) {
      expect(entry.suiteEntryPoint).toMatch(/^define[A-Z].+Contract$/);
      expect(entry.requiredCases.length).toBeGreaterThanOrEqual(6);
      expect(entry.faultPoints.length).toBeGreaterThan(0);
      expect(entry.crashOracle.description.length).toBeGreaterThan(20);
      expect(entry.crashOracle.oracleId).toBe(`${entry.contractId}-R01`);
      expect(oracleIds.has(entry.crashOracle.oracleId)).toBeFalse();
      oracleIds.add(entry.crashOracle.oracleId);
      expect(entry.futureIssue).toBeGreaterThanOrEqual(972);
      for (const requiredCase of entry.requiredCases) {
        expect(requiredCase.caseId).toStartWith(`${entry.contractId}-C`);
        expect(requiredCase.description.length).toBeGreaterThan(10);
        expect(caseIds.has(requiredCase.caseId)).toBeFalse();
        caseIds.add(requiredCase.caseId);
      }
      for (const prerequisite of entry.prerequisites) {
        expect(EFFECTOR_CONTRACT_IDS).toContain(prerequisite);
      }
    }
    expect(oracleIds.size).toBe(EFFECTOR_CONTRACT_IDS.length);
  });

  test("catalogue collectively maps every standard fault point", () => {
    const mapped = new Set(EFFECTOR_CASE_CATALOGUE.flatMap((entry) => entry.faultPoints));
    expect([...mapped].sort()).toEqual([...STANDARD_FAULT_POINTS].sort());
  });

  test("rejects duplicate catalogue entries, case IDs, and crash oracles", () => {
    const first = EFFECTOR_CASE_CATALOGUE[0];
    expect(() => assertCompleteEffectorCaseCatalogue([...EFFECTOR_CASE_CATALOGUE, first]))
      .toThrow("exactly once");
    expect(() => assertCompleteEffectorCaseCatalogue([
      { ...first, requiredCases: [first.requiredCases[0], first.requiredCases[0]] },
      ...EFFECTOR_CASE_CATALOGUE.slice(1),
    ])).toThrow("misplaced or duplicated");
    expect(() => assertCompleteEffectorCaseCatalogue([
      first,
      { ...EFFECTOR_CASE_CATALOGUE[1], crashOracle: first.crashOracle },
      ...EFFECTOR_CASE_CATALOGUE.slice(2),
    ])).toThrow("misplaced or duplicated");
  });

  test("all shared links resolve through a closed registry and are unique per entry", () => {
    const registered = new Set(SHARED_EFFECTOR_CASE_CATALOGUE.map((entry) => entry.caseId));
    for (const entry of EFFECTOR_CASE_CATALOGUE) {
      expect(new Set(entry.sharedCaseLinks).size).toBe(entry.sharedCaseLinks.length);
      for (const link of entry.sharedCaseLinks) expect(registered.has(link)).toBeTrue();
    }
  });

  test("rejects unknown or duplicate shared links and duplicate registry IDs", () => {
    const first = EFFECTOR_CASE_CATALOGUE[0];
    const unknownLink = "shared:unknown" as SharedEffectorCaseId;
    expect(() => assertCompleteEffectorCaseCatalogue([
      { ...first, sharedCaseLinks: [...first.sharedCaseLinks, unknownLink] },
      ...EFFECTOR_CASE_CATALOGUE.slice(1),
    ])).toThrow("link is unknown");
    expect(() => assertCompleteEffectorCaseCatalogue([
      { ...first, sharedCaseLinks: [...first.sharedCaseLinks, first.sharedCaseLinks[0]] },
      ...EFFECTOR_CASE_CATALOGUE.slice(1),
    ])).toThrow("link is duplicated");
    expect(() => assertCompleteEffectorCaseCatalogue(
      EFFECTOR_CASE_CATALOGUE,
      [...SHARED_EFFECTOR_CASE_CATALOGUE, SHARED_EFFECTOR_CASE_CATALOGUE[0]] as readonly SharedEffectorCase[],
    )).toThrow("case is duplicated");
  });

  test("catalogue has stable semantic content without protected payloads", () => {
    const digest = hashCanonicalRequest(EFFECTOR_CASE_CATALOGUE.map((entry) => ({
      contractId: entry.contractId,
      futureIssue: entry.futureIssue,
      suiteEntryPoint: entry.suiteEntryPoint,
      requiredCases: entry.requiredCases,
      faultPoints: entry.faultPoints,
      crashOracle: entry.crashOracle,
    })));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(EFFECTOR_CASE_CATALOGUE)).not.toMatch(/message body|media bytes|tool arguments|tool results|secret value/i);
  });
});
