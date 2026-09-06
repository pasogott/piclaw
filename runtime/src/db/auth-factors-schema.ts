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
    CREATE TABLE IF NOT EXISTS user_auth_invitations (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      issuer_user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('issued','claimed')),
      browser_hash TEXT,
      enrolment_hash TEXT,
      origin TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_user_auth_invitation_expiry ON user_auth_invitations(expires_at);
    CREATE TABLE IF NOT EXISTS user_passkey_registrations (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      session_id TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_user_passkey_registration_expiry ON user_passkey_registrations(expires_at);
    CREATE TABLE IF NOT EXISTS user_totp_registrations (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      registration_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      token_hash TEXT,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS user_totp_registration_cleanup
      AFTER DELETE ON user_totp_registrations BEGIN
        DELETE FROM user_totp_enrolments WHERE user_id=OLD.user_id AND token_hash=OLD.token_hash;
      END;
    CREATE TABLE IF NOT EXISTS account_recovery_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      target_user_id TEXT NOT NULL REFERENCES users(id),
      event TEXT NOT NULL CHECK (event = 'admin_reset'),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS user_auth_attempts (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_user_totp_enrolment_expiry ON user_totp_enrolments(expires_at);
  `);
  // Standalone factor tests initialise this schema without browser-session storage.
  if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_sessions'").get()) {
    database.exec(`CREATE TRIGGER IF NOT EXISTS user_totp_registration_logout
      AFTER DELETE ON web_sessions BEGIN
        DELETE FROM user_totp_registrations WHERE user_id=OLD.user_id AND session_id=OLD.session_id;
      END;`);
  }
}
