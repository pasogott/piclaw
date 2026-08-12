import { createHash } from "node:crypto";

import type { EffectPayloadResolver, ResolvedEffectPayload } from "../../contracts/payload-resolver.js";

const RESERVED_BLOCK_TYPES = new Set(["restart_handoff", "self_continuation"]);

export function fakeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fakeResolveVerifiedPayload(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<ResolvedEffectPayload | null> {
  const payload = await resolver.resolve(ref);
  if (!payload || payload.ref !== ref) return null;
  if (payload.byteLength !== payload.bytes.byteLength) return null;
  if (payload.sha256 !== fakeSha256(payload.bytes)) return null;
  return payload;
}

export async function fakeResolveVerifiedText(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<string | null> {
  const payload = await fakeResolveVerifiedPayload(resolver, ref);
  if (!payload) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes);
  } catch {
    return null;
  }
}

export async function fakeResolveVerifiedJson(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<unknown | null> {
  const payload = await fakeResolveVerifiedPayload(resolver, ref);
  if (!payload || payload.mediaType !== "application/json") return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function fakeValidateContentBlocks(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const type = (block as { type?: unknown }).type;
    return typeof type !== "string" || !RESERVED_BLOCK_TYPES.has(type);
  });
}
