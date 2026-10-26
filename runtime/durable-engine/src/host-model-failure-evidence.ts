import { randomUUID, createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { previewSessionRecordingRedaction } from "../../src/session-recordings/session-recordings.js";
import type { ModelFailure } from "./host-model-failure.js";

export type ModelFailureEvidence = {
  provider: string; model: string; requestId?: string;
  scope?: { conversationId: number; taskId: number; kind: string };
  failure: ModelFailure; providerFailure?: ModelFailure;
  error: unknown; providerError?: unknown;
};

/** Keep error fields only: never serialize the provider message, prompt, partial
 * answer, headers, credentials or opaque thinking/signature fields. */
function errorFields(error: unknown): Record<string, unknown> {
  try {
    if (typeof error === "string") return { message: error.slice(0, 8192) };
    if (!error || typeof error !== "object") return { message: String(error).slice(0, 1024) };
    const input = error as Record<string, unknown>, output: Record<string, unknown> = {};
    for (const key of ["name", "code", "status", "statusCode", "stopReason", "errorMessage", "message", "stack"]) {
      const value = input[key];
      if (typeof value === "string") output[key] = value.slice(0, key === "stack" ? 4096 : 8192);
      else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    }
    return output;
  } catch { return { message: "Error fields could not be read" }; }
}

function redact(value: unknown): unknown {
  const { data } = previewSessionRecordingRedaction(value, { mode: "redacted", redaction: { mode: "redacted", redaction: { maxRedactedStringLength: 8192 } } });
  function visit(item: unknown): unknown {
    if (typeof item === "string") return item
      .replace(/https?:\/\/[^\s"<>]+/gi, "[URL redacted]")
      .replace(/((?:signature|api[_-]?key|access[_-]?token|refresh[_-]?token|password)"?\s*[:=]\s*")[^"]*/gi, "$1[REDACTED]");
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item;
  }
  return visit(data);
}

/** Private durable diagnostic receipts. This is not a usage settlement and must
 * never release a reservation or authorize/replay provider/tool work. */
export function retainModelFailureEvidence(directory: string, input: ModelFailureEvidence): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error("Model failure evidence directory is not private");
  const id = randomUUID();
  const errors = { error: errorFields(input.error), ...(input.providerError === undefined ? {} : { providerError: errorFields(input.providerError) }) };
  const body = JSON.stringify({ schema: 1, id, at: new Date().toISOString(), provider: input.provider, model: input.model,
    requestId: input.requestId ?? null, scope: input.scope ?? null, failure: input.failure,
    providerFailure: input.providerFailure ?? null, errors: redact(errors),
    originalErrorSha256: createHash("sha256").update(JSON.stringify(errors)).digest("hex") });
  const fd = openSync(join(directory, `${id}.json`), "wx", 0o600);
  try { writeFileSync(fd, body + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  return id;
}
