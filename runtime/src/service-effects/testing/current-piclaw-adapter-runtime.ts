import type { NormalisedEffectTrace, NormalisedTraceInput } from "../contracts/common.js";
import type {
  CurrentPiclawAdapterFaultPoint,
  CurrentPiclawAdapterRuntime,
} from "../current-piclaw/adapter-runtime.js";
import type { ContractTestContext } from "./contract-suite.js";
import { EffectTraceRecorder } from "./trace-recorder.js";

export class TestingCurrentPiclawAdapterRuntime implements CurrentPiclawAdapterRuntime {
  readonly trace = new EffectTraceRecorder();

  constructor(private readonly context: ContractTestContext) {}

  nextId(): string {
    return this.context.ids.nextId();
  }

  hitFault(point: CurrentPiclawAdapterFaultPoint): boolean {
    return this.context.faults.hit(point);
  }

  recordTrace(input: NormalisedTraceInput): void {
    if (input.resultTag === undefined) this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }

  snapshot(): readonly NormalisedEffectTrace[] {
    return this.trace.snapshot();
  }
}
