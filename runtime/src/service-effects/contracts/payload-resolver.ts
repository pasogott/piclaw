import type { PayloadReference } from "./common.js";

export interface ResolvedEffectPayload extends PayloadReference {
  readonly bytes: Uint8Array;
}

/** Injected content lookup only; it owns no lifecycle or external effect. */
export interface EffectPayloadResolver {
  resolve(ref: string): Promise<ResolvedEffectPayload | null> | ResolvedEffectPayload | null;
}
