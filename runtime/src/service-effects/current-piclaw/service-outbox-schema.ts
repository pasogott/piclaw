import type Database from "bun:sqlite";

const PREFIX = "service_effect_s05_";

/** Install the latent EF-S05 schema on an explicitly supplied isolated database. */
export function installServiceOutboxSchema(database: Database): void {
	database.exec("PRAGMA foreign_keys = ON");
	const foreignKeys = database.query("PRAGMA foreign_keys").get() as
		| { foreign_keys?: number }
		| undefined;
	if (foreignKeys?.foreign_keys !== 1)
		throw new Error("EF-S05 requires SQLite foreign-key enforcement.");
	database
		.transaction(() =>
			database.exec(`
    CREATE TABLE IF NOT EXISTS ${PREFIX}outbox (
      outbox_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('wake_chat','timeline_broadcast','channel_delivery','notification','scheduler_run_log','maintenance')),
      state TEXT NOT NULL CHECK(state IN ('pending','started','completed','failed','unknown','cancelled')),
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash=lower(request_hash) AND request_hash NOT GLOB '*[^0-9a-f]*'),
      operation_id TEXT,
      source_seq INTEGER CHECK(source_seq IS NULL OR source_seq >= 0),
      provenance_ref TEXT NOT NULL,
      redaction_class TEXT NOT NULL CHECK(redaction_class IN ('public','private','secret')),
      payload_ref TEXT NOT NULL,
      destination_ref TEXT,
      available_at TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      state_changed_at TEXT NOT NULL,
      repeatability TEXT NOT NULL CHECK(repeatability IN ('repeatable','reconciliation_required')),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
      worker_id TEXT,
      claimed_at TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      certainty TEXT CHECK(certainty IS NULL OR certainty IN ('not_applied','applied','unknown')),
      retry_at TEXT,
      receipt_ref TEXT,
      last_error_tag TEXT,
      result_at TEXT,
      reconciliation_ref TEXT,
      reconciled_at TEXT,
      cancellation_reason_tag TEXT,
      UNIQUE(kind,idempotency_key),
      CHECK(
        (state='pending' AND certainty='not_applied' AND attempt=0 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NULL AND reconciliation_ref IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='started' AND certainty IS NULL AND attempt>=1 AND worker_id IS NOT NULL AND claimed_at IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='completed' AND certainty='applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND last_error_tag IS NULL AND result_at IS NOT NULL AND cancellation_reason_tag IS NULL)
        OR (state='failed' AND certainty='not_applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NOT NULL AND result_at IS NOT NULL AND cancellation_reason_tag IS NULL)
        OR (state='unknown' AND certainty='unknown' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NOT NULL AND result_at IS NOT NULL AND reconciliation_ref IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='cancelled' AND certainty='not_applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NOT NULL AND reconciliation_ref IS NOT NULL AND reconciled_at IS NOT NULL AND cancellation_reason_tag IS NOT NULL)
      )
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}decisions (
      decision_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash=lower(request_hash) AND request_hash NOT GLOB '*[^0-9a-f]*'),
      result_json TEXT NOT NULL CHECK(json_valid(result_json)),
      outbox_id TEXT,
      protected_lease_token TEXT,
      CHECK((method='cleanupTerminal' AND outbox_id IS NULL) OR method='claimNext' OR (method NOT IN ('cleanupTerminal','claimNext') AND outbox_id IS NOT NULL))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ${PREFIX}pending_claim ON ${PREFIX}outbox(available_at,outbox_id) WHERE state='pending';
    CREATE INDEX IF NOT EXISTS ${PREFIX}failed_claim ON ${PREFIX}outbox(retry_at,outbox_id) WHERE state='failed' AND retry_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ${PREFIX}expired_started ON ${PREFIX}outbox(lease_expires_at,outbox_id) WHERE state='started';
    CREATE INDEX IF NOT EXISTS ${PREFIX}unknown_list ON ${PREFIX}outbox(state_changed_at,outbox_id) WHERE state='unknown';
    CREATE INDEX IF NOT EXISTS ${PREFIX}terminal_cleanup ON ${PREFIX}outbox(state_changed_at,outbox_id) WHERE state='cancelled' OR (state='failed' AND retry_at IS NULL);
    CREATE INDEX IF NOT EXISTS ${PREFIX}operation_lookup ON ${PREFIX}outbox(operation_id,outbox_id);
    CREATE INDEX IF NOT EXISTS ${PREFIX}decision_outbox ON ${PREFIX}decisions(outbox_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ${PREFIX}decision_lease_token ON ${PREFIX}decisions(protected_lease_token) WHERE protected_lease_token IS NOT NULL;
  `),
		)
		.immediate();
}
