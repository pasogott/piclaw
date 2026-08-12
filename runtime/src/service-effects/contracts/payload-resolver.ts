import type { PayloadReference } from "./common.js";

export interface ResolvedEffectPayload extends PayloadReference {
  readonly bytes: Uint8Array;
}

/**
 * Injected content lookup only; it owns no lifecycle or external effect.
 * A reference is immutable: every successful resolution must return the same
 * `(sha256, byteLength, mediaType, redactionClass, bytes)` tuple. A reference
 * may be temporarily unavailable, but must never resolve to another payload.
 * Callers defensively snapshot mutable byte arrays after verification.
 */
export interface EffectPayloadResolver {
  resolve(ref: string): Promise<ResolvedEffectPayload | null> | ResolvedEffectPayload | null;
}
