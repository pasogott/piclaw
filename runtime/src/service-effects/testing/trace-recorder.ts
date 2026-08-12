import {
  normaliseEffectTrace,
  type NormalisedEffectTrace,
  type NormalisedTraceInput,
} from "../contracts/common.js";

export class EffectTraceRecorder {
  #entries: NormalisedEffectTrace[] = [];

  static fromSnapshot(snapshot: readonly NormalisedEffectTrace[]): EffectTraceRecorder {
    const recorder = new EffectTraceRecorder();
    for (const entry of snapshot) recorder.append({ ...entry });
    return recorder;
  }

  recordCall(input: NormalisedTraceInput): NormalisedEffectTrace {
    return this.append({ ...input, certainty: null, resultTag: "call" });
  }

  recordResult(input: NormalisedTraceInput): NormalisedEffectTrace {
    return this.append(input);
  }

  append(input: NormalisedTraceInput): NormalisedEffectTrace {
    const entry = normaliseEffectTrace(input);
    this.#entries.push(entry);
    return entry;
  }

  inspect(): readonly NormalisedEffectTrace[] {
    return Object.freeze([...this.#entries]);
  }

  snapshot(): readonly NormalisedEffectTrace[] {
    return structuredClone(this.#entries);
  }
}
