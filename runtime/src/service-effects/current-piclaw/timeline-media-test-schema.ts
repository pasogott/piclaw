import type Database from "bun:sqlite";

/** Private WP-1A test schema. Never register this with Piclaw migrations/startup. */
export function installTimelineMediaAdapterTestSchema(database: Database): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      screen_hint TEXT,
      content_blocks TEXT,
      link_previews TEXT,
      annotations TEXT,
      thread_id INTEGER,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      is_terminal_agent_reply INTEGER DEFAULT 0,
      is_steering_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      chat_jid UNINDEXED,
      sender UNINDEXED,
      sender_name UNINDEXED,
      timestamp UNINDEXED,
      is_bot_message UNINDEXED,
      content='messages',
      content_rowid='rowid'
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES (new.rowid, new.content, new.chat_jid, new.sender, new.sender_name, new.timestamp, new.is_bot_message);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES ('delete', old.rowid, old.content, old.chat_jid, old.sender, old.sender_name, old.timestamp, old.is_bot_message);
    END;
    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES ('delete', old.rowid, old.content, old.chat_jid, old.sender, old.sender_name, old.timestamp, old.is_bot_message);
      INSERT INTO messages_fts(rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES (new.rowid, new.content, new.chat_jid, new.sender, new.sender_name, new.timestamp, new.is_bot_message);
    END;
    CREATE TABLE media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      thumbnail BLOB,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE message_media (
      message_rowid INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (message_rowid, media_id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );

    CREATE TABLE service_effect_timeline_writes (
      idempotency_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      write_type TEXT NOT NULL CHECK(write_type IN ('draft', 'notice')),
      operation_id TEXT,
      draft_kind TEXT,
      revision INTEGER,
      notice_kind TEXT,
      source_id TEXT,
      message_rowid INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      written_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX service_effect_draft_revision
      ON service_effect_timeline_writes(operation_id, draft_kind, revision)
      WHERE write_type = 'draft';
    CREATE UNIQUE INDEX service_effect_notice_source
      ON service_effect_timeline_writes(notice_kind, source_id)
      WHERE write_type = 'notice';

    CREATE TABLE service_effect_media_uploads (
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      upload_id TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      data_ref TEXT NOT NULL,
      thumbnail_ref TEXT,
      metadata_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE service_effect_operation_media (
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      PRIMARY KEY (operation_id, media_id, role),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE service_effect_outbox_media_refs (
      outbox_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (outbox_id, media_id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE service_effect_media_deletions (
      idempotency_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      expected_sha256 TEXT NOT NULL,
      deleted INTEGER NOT NULL
    );
    CREATE INDEX service_effect_timeline_operation
      ON service_effect_timeline_writes(operation_id, draft_kind, revision);
    CREATE INDEX service_effect_operation_media_id
      ON service_effect_operation_media(media_id);
    CREATE INDEX service_effect_outbox_media_id
      ON service_effect_outbox_media_refs(media_id);
  `);
}
