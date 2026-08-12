import { createHash } from "node:crypto";

import type { EffectPayloadResolver, ResolvedEffectPayload } from "./contracts/payload-resolver.js";

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function resolveVerifiedPayload(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<ResolvedEffectPayload | null> {
  const payload = await resolver.resolve(ref);
  if (!payload || payload.ref !== ref) return null;
  if (payload.byteLength !== payload.bytes.byteLength) return null;
  if (payload.sha256 !== sha256Bytes(payload.bytes)) return null;
  const bytes = new Uint8Array(payload.bytes);
  return Object.freeze({ ...payload, bytes });
}

export async function resolveVerifiedText(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<string | null> {
  const payload = await resolveVerifiedPayload(resolver, ref);
  if (!payload) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes);
  } catch {
    return null;
  }
}

export async function resolveVerifiedJson(
  resolver: EffectPayloadResolver,
  ref: string,
): Promise<unknown | null> {
  const payload = await resolveVerifiedPayload(resolver, ref);
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
