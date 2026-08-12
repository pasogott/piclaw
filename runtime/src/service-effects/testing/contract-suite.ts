import type { EffectClock, EffectIdSource, NormalisedEffectTrace } from "../contracts/common.js";
import type { DeterministicFaultPlan } from "./fault-plan.js";

export interface ContractTestContext {
  readonly clock: EffectClock;
  readonly ids: EffectIdSource;
  readonly faults: DeterministicFaultPlan;
}

export interface ContractSubjectFactory<TSubject> {
  readonly name: string;
  create(context: ContractTestContext): Promise<TSubject> | TSubject;
  crashAndRestore(subject: TSubject): Promise<TSubject> | TSubject;
  inspectTrace(subject: TSubject): readonly NormalisedEffectTrace[];
}

export interface ContractCaseFixture<TSubject> {
  readonly context: ContractTestContext;
  readonly subject: TSubject;
  crashAndRestore(): Promise<TSubject>;
  inspectTrace(): readonly NormalisedEffectTrace[];
}

export interface ParameterisedContractCase<TSubject> {
  readonly name: string;
  run(fixture: ContractCaseFixture<TSubject>): Promise<void> | void;
}

export interface ContractCaseResult {
  readonly factoryName: string;
  readonly caseName: string;
  readonly trace: readonly NormalisedEffectTrace[];
}

/** Execute each case against a fresh subject; assertion failures propagate. */
export async function runParameterisedContractSuite<TSubject>(
  factory: ContractSubjectFactory<TSubject>,
  cases: readonly ParameterisedContractCase<TSubject>[],
  createContext: () => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  if (!factory.name) throw new Error("Contract factory name must be non-empty.");
  const names = new Set<string>();
  for (const contractCase of cases) {
    if (!contractCase.name || names.has(contractCase.name)) {
      throw new Error(`Contract case names must be non-empty and unique: ${contractCase.name}`);
    }
    names.add(contractCase.name);
  }

  const results: ContractCaseResult[] = [];
  for (const contractCase of cases) {
    const context = createContext();
    let subject = await factory.create(context);
    const fixture: ContractCaseFixture<TSubject> = {
      context,
      get subject() {
        return subject;
      },
      async crashAndRestore() {
        subject = await factory.crashAndRestore(subject);
        return subject;
      },
      inspectTrace() {
        return factory.inspectTrace(subject);
      },
    };
    await contractCase.run(fixture);
    results.push(Object.freeze({
      factoryName: factory.name,
      caseName: contractCase.name,
      trace: fixture.inspectTrace(),
    }));
  }

  return Object.freeze(results);
}
