import type { RedactionClass } from "../contracts/common.js";
import type { EffectPayloadResolver, ResolvedEffectPayload } from "../contracts/payload-resolver.js";
import { sha256Bytes } from "../payloads.js";

export class InMemoryEffectPayloadResolver implements EffectPayloadResolver {
  readonly #payloads = new Map<string, ResolvedEffectPayload>();

  putBytes(
    ref: string,
    bytes: Uint8Array,
    mediaType = "application/octet-stream",
    redactionClass: RedactionClass = "private",
  ): ResolvedEffectPayload {
    const copy = new Uint8Array(bytes);
    const payload = Object.freeze({
      ref,
      sha256: sha256Bytes(copy),
      byteLength: copy.byteLength,
      mediaType,
      redactionClass,
      bytes: copy,
    });
    this.#payloads.set(ref, payload);
    return payload;
  }

  putText(ref: string, text: string, mediaType = "text/plain"): ResolvedEffectPayload {
    return this.putBytes(ref, new TextEncoder().encode(text), mediaType);
  }

  putJson(ref: string, value: unknown): ResolvedEffectPayload {
    return this.putText(ref, JSON.stringify(value), "application/json");
  }

  resolve(ref: string): ResolvedEffectPayload | null {
    const payload = this.#payloads.get(ref);
    return payload ? Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) }) : null;
  }
}
