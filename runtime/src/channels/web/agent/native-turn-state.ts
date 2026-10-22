import type Database from "bun:sqlite";

/** Read execution and pending-input state without consulting legacy inflight markers. */
export function readNativeTurnState(database: Database, chat: string) {
  const operation = database.query("SELECT operation_id,phase FROM service_effect_s01_operations WHERE chat_jid=? AND phase<>'terminal' LIMIT 1")
    .get(chat) as { operation_id: string; phase: string } | null;
  const pending = database.query("SELECT COUNT(*) n FROM service_effect_s01_sources WHERE chat_jid=? AND kind='message' AND state='pending'").get(chat) as { n: number };
  return { operation, queued: pending.n };
}
