/** Internal timeline metadata that public callers must not be allowed to forge. */
const INTERNAL_CONTENT_BLOCK_TYPES = new Set([
  "restart_handoff",
  "self_continuation",
]);

/** Strip agent-owned metadata from public user-controlled content blocks. */
export function sanitizePublicInboundContentBlocks(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return true;
    const type = typeof (block as { type?: unknown }).type === "string"
      ? (block as { type: string }).type
      : "";
    return !INTERNAL_CONTENT_BLOCK_TYPES.has(type);
  });
}

/** Strict persistence validation for already-resolved service-effect blocks. */
export function validateServiceEffectContentBlocks(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((block) => !block || typeof block !== "object" || Array.isArray(block))) return null;
  if (sanitizePublicInboundContentBlocks(value)?.length !== value.length) return null;
  return Object.freeze(value.map((block) => Object.freeze({ ...(block as Record<string, unknown>) })));
}
