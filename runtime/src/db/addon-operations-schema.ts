import type { Database } from "bun:sqlite";

/** Additive schema. No operations exist until a verified host policy admits one. */
export function initializeAddonOperationsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS addon_operations (
      id TEXT PRIMARY KEY, addon_id TEXT NOT NULL, principal_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL, target TEXT NOT NULL,
      text TEXT NOT NULL, grant_json TEXT NOT NULL, chat_jid TEXT NOT NULL UNIQUE,
      work_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, output TEXT, reason TEXT,
      UNIQUE(addon_id, principal_id, idempotency_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS addon_operation_events (
      operation_id TEXT NOT NULL REFERENCES addon_operations(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
      PRIMARY KEY(operation_id, sequence)
    ) STRICT;
  `);
}
