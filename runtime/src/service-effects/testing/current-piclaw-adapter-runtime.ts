import type { NormalisedEffectTrace, NormalisedTraceInput } from "../contracts/common.js";
import type {
  CurrentPiclawAdapterFaultPoint,
  CurrentPiclawAdapterRuntime,
} from "../current-piclaw/adapter-runtime.js";
import type { ContractTestContext } from "./contract-suite.js";
import { EffectTraceRecorder } from "./trace-recorder.js";

export class TestingCurrentPiclawAdapterRuntime implements CurrentPiclawAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  #beforeDeleteTransaction: (() => void) | null = null;

  constructor(
    private readonly context: ContractTestContext,
    traceSnapshot: readonly NormalisedEffectTrace[] = [],
  ) {
    this.trace = EffectTraceRecorder.fromSnapshot(traceSnapshot);
  }

  nextId(): string {
    return this.context.ids.nextId();
  }

  hitFault(point: CurrentPiclawAdapterFaultPoint): boolean {
    if (point === "before_delete_transaction") {
      if (this.#beforeDeleteTransaction) {
        const run = this.#beforeDeleteTransaction;
        this.#beforeDeleteTransaction = null;
        run();
      }
      return false;
    }
    return this.context.faults.hit(point);
  }

  beforeDeleteTransactionOnce(run: () => void): void {
    this.#beforeDeleteTransaction = run;
  }

  recordTrace(input: NormalisedTraceInput): void {
    if (input.resultTag === undefined) this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }

  snapshot(): readonly NormalisedEffectTrace[] {
    return this.trace.snapshot();
  }

  restore(): TestingCurrentPiclawAdapterRuntime {
    return new TestingCurrentPiclawAdapterRuntime(this.context, this.snapshot());
  }
}
