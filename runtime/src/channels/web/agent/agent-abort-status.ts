/** A settled native abort may clear only the status observed before cancellation.
 * Never clear durable inflight markers or overwrite a successor turn. */
export function settledAbortStatus(
  captured: string,
  current: Record<string, unknown> | null,
  message: string,
): Record<string, unknown> | null {
  // Recovery statuses are synthesized on reads, so object identity is not enough.
  if (JSON.stringify(current) !== captured) return null;
  // Compaction owns its lifecycle through awaited result publication.
  // Its command, not /abort, must emit the terminal status.
  if (current?.intent_key === "compaction") return null;
  return { ...current, type: "done", title: "Idle", detail: message, source: "operator_abort" };
}
