import { createHash } from "node:crypto";

import type { RedactionClass } from "../contracts/common.js";
import type { EffectPayloadResolver, ResolvedEffectPayload } from "../contracts/payload-resolver.js";

export class InMemoryEffectPayloadResolver implements EffectPayloadResolver {
  readonly #definitions = new Map<string, ResolvedEffectPayload>();
  readonly #unavailable = new Set<string>();
  readonly #holds = new Map<string, Promise<void>>();
  readonly #arrivals = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  putBytes(
    ref: string,
    bytes: Uint8Array,
    mediaType = "application/octet-stream",
    redactionClass: RedactionClass = "private",
  ): ResolvedEffectPayload {
    const copy = new Uint8Array(bytes);
    const payload = Object.freeze({
      ref,
      sha256: createHash("sha256").update(copy).digest("hex"),
      byteLength: copy.byteLength,
      mediaType,
      redactionClass,
      bytes: copy,
    });
    const existing = this.#definitions.get(ref);
    if (existing) {
      if (!samePayload(existing, payload)) throw new Error(`payload reference ${ref} is immutable`);
      this.#unavailable.delete(ref);
      return Object.freeze({ ...existing, bytes: new Uint8Array(existing.bytes) });
    }
    this.#definitions.set(ref, payload);
    return Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) });
  }

  putText(ref: string, text: string, mediaType = "text/plain"): ResolvedEffectPayload {
    return this.putBytes(ref, new TextEncoder().encode(text), mediaType);
  }

  putJson(ref: string, value: unknown): ResolvedEffectPayload {
    return this.putText(ref, JSON.stringify(value), "application/json");
  }

  hold(ref: string): () => void {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.#holds.set(ref, pending);
    let arrivedResolve!: () => void;
    const arrived = new Promise<void>((resolve) => { arrivedResolve = resolve; });
    this.#arrivals.set(ref, { promise: arrived, resolve: arrivedResolve });
    return () => {
      if (this.#holds.get(ref) === pending) this.#holds.delete(ref);
      this.#arrivals.delete(ref);
      release();
    };
  }

  async waitUntilHeld(ref: string): Promise<void> {
    const arrival = this.#arrivals.get(ref);
    if (!arrival) throw new Error(`payload ${ref} is not held`);
    await arrival.promise;
  }

  makeTemporarilyUnavailable(ref: string): void {
    if (this.#definitions.has(ref)) this.#unavailable.add(ref);
  }

  peek(ref: string): ResolvedEffectPayload | null {
    if (this.#unavailable.has(ref)) return null;
    const payload = this.#definitions.get(ref);
    return payload ? Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) }) : null;
  }

  async resolve(ref: string): Promise<ResolvedEffectPayload | null> {
    const hold = this.#holds.get(ref);
    if (hold) {
      this.#holds.delete(ref);
      this.#arrivals.get(ref)?.resolve();
      await hold;
    }
    return this.peek(ref);
  }
}

function samePayload(left: ResolvedEffectPayload, right: ResolvedEffectPayload): boolean {
  if (
    left.sha256 !== right.sha256 || left.byteLength !== right.byteLength ||
    left.mediaType !== right.mediaType || left.redactionClass !== right.redactionClass ||
    left.bytes.byteLength !== right.bytes.byteLength
  ) return false;
  return left.bytes.every((byte, index) => byte === right.bytes[index]);
}
