import { createHash } from "node:crypto";
import { createLogger } from "../../src/utils/logger.js";

type Snapshot = { hashes: string[] };
export type PromptCacheAudit = Record<string, string | number | boolean>;
const MAX_SESSIONS = 16;
const MAX_ITEMS = 4096;
const MAX_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value: unknown) => hash(JSON.stringify(value) ?? "undefined");

/** Opt-in diagnosis only: retain hashes, never prompts, tool arguments or reasoning.
 * Bound both retained sessions and sampled input; diagnostics must not affect dispatch.
 */
export function createPromptCacheAuditor(emit: (record: PromptCacheAudit) => void) {
  const previous = new Map<string, Snapshot>();
  return (sessionId: string, payload: unknown): void => {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const body = payload as Record<string, unknown>;
      if (!Array.isArray(body.input)) return;
      const sessionHash = hash(sessionId);
      const hashes: string[] = [], bytes: number[] = [];
      let sampledBytes = 0;
      for (const item of body.input.slice(0, MAX_ITEMS)) {
        const json = JSON.stringify(item) ?? "null";
        const size = Buffer.byteLength(json);
        if (sampledBytes + size > MAX_BYTES) break;
        hashes.push(hash(json)); bytes.push(size); sampledBytes += size;
      }
      const prior = previous.get(sessionHash);
      let commonItems = 0, commonBytes = 0;
      while (prior && commonItems < Math.min(prior.hashes.length, hashes.length)
        && prior.hashes[commonItems] === hashes[commonItems]) {
        commonBytes += bytes[commonItems]!; commonItems++;
      }
      // Keep all non-input settings in one digest, including model/reasoning/include.
      const settings = Object.fromEntries(Object.entries(body).filter(([key]) =>
        !["input", "instructions", "tools", "prompt_cache_key"].includes(key)));
      const record: PromptCacheAudit = {
        sessionHash,
        cacheKeyPresent: typeof body.prompt_cache_key === "string" && body.prompt_cache_key.length > 0,
        cacheKeyHash: jsonHash(body.prompt_cache_key),
        instructionsHash: jsonHash(body.instructions), toolsHash: jsonHash(body.tools),
        settingsHash: jsonHash(settings), inputHash: jsonHash(hashes),
        inputItems: body.input.length, sampledItems: hashes.length, sampledBytes,
        sampleComplete: hashes.length === body.input.length,
        hadPrevious: prior !== undefined, commonItems, commonBytes,
        previousSampleItems: prior?.hashes.length ?? 0,
      };
      previous.delete(sessionHash);
      previous.set(sessionHash, { hashes });
      if (previous.size > MAX_SESSIONS) previous.delete(previous.keys().next().value!);
      emit(record);
    } catch { /* An optional audit must never reject a provider request. */ }
  };
}

const log = createLogger("durable.prompt-cache");
const audit = createPromptCacheAuditor(record => log.info("Codex prompt cache fingerprint", record));
export function auditCodexPromptCache(sessionId: string, payload: unknown): void {
  if (process.env.PICLAW_PROMPT_CACHE_AUDIT === "1") audit(sessionId, payload);
}
