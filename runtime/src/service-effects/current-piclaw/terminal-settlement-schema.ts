import type Database from "bun:sqlite";

import { installServiceOutboxSchema } from "./service-outbox-schema.js";
import { installServiceWorkSchema } from "./service-work-schema.js";
import { installTimelineMediaAdapterTestSchema } from "./timeline-media-test-schema.js";

const HASH = "length(request_hash)=64 AND request_hash=lower(request_hash) AND request_hash NOT GLOB '*[^0-9a-f]*'";
const INSTANT = "length(committed_at)=24 AND substr(committed_at,11,1)='T' AND substr(committed_at,24,1)='Z'";

/**
 * Install the complete latent EF-S02 composition on a caller-owned isolated
 * database. This function is test/setup infrastructure and is never registered
 * with Piclaw startup or production migrations.
 */
export function installTerminalSettlementCompositionSchema(
  database: Database,
): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S02 requires SQLite foreign-key enforcement.");
  }

  const install = () => {
    installServiceWorkSchema(database);
    installTimelineMediaAdapterTestSchema(database);
    installServiceOutboxSchema(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS service_effect_s02_commits (
        idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key) BETWEEN 1 AND 512),
        request_hash TEXT NOT NULL CHECK(${HASH}),
        operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id) BETWEEN 1 AND 512),
        chat_jid TEXT NOT NULL CHECK(length(chat_jid) BETWEEN 1 AND 512),
        operation_version INTEGER NOT NULL CHECK(operation_version BETWEEN 2 AND 9007199254740991),
        disposition TEXT NOT NULL CHECK(disposition IN ('completed','cancelled','failed','skipped','superseded')),
        message_row_id INTEGER CHECK(message_row_id IS NULL OR message_row_id >= 1),
        consumed_through_source_seq INTEGER NOT NULL CHECK(consumed_through_source_seq BETWEEN 0 AND 9007199254740991),
        committed_at TEXT NOT NULL CHECK(${INSTANT}),
        terminal_authority_ref TEXT CHECK(terminal_authority_ref IS NULL OR length(terminal_authority_ref) BETWEEN 1 AND 2048),
        FOREIGN KEY(operation_id) REFERENCES service_effect_s01_operations(operation_id),
        FOREIGN KEY(chat_jid, operation_id) REFERENCES service_effect_s01_operations(chat_jid, operation_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS service_effect_s02_commit_outbox (
        operation_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 1000),
        outbox_id TEXT NOT NULL UNIQUE CHECK(length(outbox_id) BETWEEN 1 AND 512),
        PRIMARY KEY(operation_id, ordinal),
        FOREIGN KEY(operation_id) REFERENCES service_effect_s02_commits(operation_id),
        FOREIGN KEY(outbox_id) REFERENCES service_effect_s05_outbox(outbox_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS service_effect_s02_commit_chat
        ON service_effect_s02_commits(chat_jid, operation_id);
    `);
  };

  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}
