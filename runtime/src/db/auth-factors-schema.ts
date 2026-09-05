import type Database from "bun:sqlite";

/** Auth secrets never enter the generic keychain table or shell-injection catalogue. */
export function initializeAuthFactorSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_totp_factors (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      ciphertext BLOB NOT NULL,
      salt BLOB NOT NULL,
      nonce BLOB NOT NULL,
      revision TEXT NOT NULL,
      last_used_step INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS user_totp_enrolments (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      ciphertext BLOB NOT NULL,
      salt BLOB NOT NULL,
      nonce BLOB NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS user_auth_attempts (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_user_totp_enrolment_expiry ON user_totp_enrolments(expires_at);
  `);
}
