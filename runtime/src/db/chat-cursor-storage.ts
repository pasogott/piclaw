import type { Database } from 'bun:sqlite';
import { applyOwnedMigrations, type OwnedSchemaMigration } from './migrations.js';

export const legacyCursorArchive = 'host_legacy_chat_cursor_state_v1';
const owner = 'host.chat-cursors';
// Recognition only. Neither migration nor native dispatch interprets these values.
const retired: Record<string, 'TEXT' | 'INTEGER'> = {
  preflight_prev_ts: 'TEXT', preflight_message_id: 'TEXT', preflight_started_at: 'TEXT',
  inflight_prev_ts: 'TEXT', inflight_message_id: 'TEXT', inflight_started_at: 'TEXT',
  failed_prev_ts: 'TEXT', failed_ts: 'TEXT', failed_message_id: 'TEXT', failed_thread_root: 'INTEGER', failed_created_at: 'TEXT',
  compaction_active_started_at: 'TEXT', compaction_active_reason: 'TEXT',
  auto_compaction_window_ordinal: 'INTEGER', auto_compaction_baseline_tokens: 'INTEGER', auto_compaction_prefill_tokens: 'INTEGER',
  auto_compaction_success_count: 'INTEGER', auto_compaction_warned_count: 'INTEGER', auto_compaction_updated_at: 'TEXT',
  compaction_failure_count: 'INTEGER', compaction_last_failed_at: 'TEXT', compaction_backoff_until: 'TEXT', compaction_last_error: 'TEXT',
};
// Physical generations in c8c502cd4, 79f2a7b52, 44d036256 and 35e443fc6;
// the four backoff ALTERs were independently additive from 3fbe834cc onward.
const historicalShapes = [['inflight_', 'failed_'], ['preflight_', 'inflight_', 'failed_'],
  ['preflight_', 'inflight_', 'failed_', 'compaction_active_'],
  ['preflight_', 'inflight_', 'failed_', 'compaction_active_', 'auto_compaction_']]
  .flatMap(prefixes => [prefixes, [...prefixes, 'compaction_failure_', 'compaction_last_', 'compaction_backoff_']])
  .map(prefixes => Object.keys(retired).filter(name => prefixes.some(prefix => name.startsWith(prefix))).sort().join(','));
const activeCursorSql = "CREATE TABLE main.chat_cursors (chat_jid TEXT PRIMARY KEY, cursor_ts TEXT NOT NULL DEFAULT '', queued_followups_json TEXT)";
const fresh: OwnedSchemaMigration = { owner, id: 'polling-frontier-v1', order: 1, sql: activeCursorSql };
/** Exact pre-queue/current historical variants. ALTER retains original schema,
 * column order, rowids and every value; copy advances no execution frontier. */
function retirement(hadQueue: boolean): OwnedSchemaMigration {
  return { owner, id: hadQueue ? 'native-frontier-v1' : 'native-frontier-prequeue-v1', order: 1,
    sql: `ALTER TABLE main.chat_cursors RENAME TO ${legacyCursorArchive};
${activeCursorSql};
INSERT INTO main.chat_cursors(rowid,chat_jid,cursor_ts,queued_followups_json)
  SELECT rowid,chat_jid,cursor_ts,${hadQueue ? 'queued_followups_json' : 'NULL'} FROM main.${legacyCursorArchive} ORDER BY rowid;` };
}
interface Column { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function fail(): never { throw Error('Unsupported chat cursor retirement schema or receipt'); }
function columns(db: Database, name: string): Column[] {
  return db.query(`PRAGMA main.table_xinfo(${quote(name)})`).all() as Column[];
}
function sql(db: Database, name: string): string | null {
  const row = db.query('SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE').get(name) as { type: string; sql: string } | null;
  if (!row) return null;
  if (row.type !== 'table' || typeof row.sql !== 'string') fail();
  return row.sql;
}
/** Bounded declaration recognition, not SQL equivalence. Comments and quoted
 * identifiers are accepted; string literals and every constraint stay exact. */
function normalise(text: string): string {
  const tokens = (text.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9$]*|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => token.startsWith("'") ? token : /^["`\[]/.test(token) ? token.slice(1, -1).toLowerCase() : token.toLowerCase());
  if (tokens[2] === 'if' && tokens[3] === 'not' && tokens[4] === 'exists') tokens.splice(2, 3);
  if (tokens.at(-1) === ';') tokens.pop();
  return tokens.join(' ');
}
function assertShape(db: Database, name: string, active: boolean): Column[] {
  const definition = sql(db, name);
  if (!definition) fail();
  const rows = columns(db, name);
  if (rows.length < 2 || new Set(rows.map(row => row.name)).size !== rows.length) fail();
  const expected = rows.map(row => {
    const type = row.name === 'chat_jid' || row.name === 'cursor_ts' || row.name === 'queued_followups_json' ? 'TEXT' : retired[row.name];
    if (!type || row.type.toUpperCase() !== type || row.hidden !== 0 || row.pk !== (row.name === 'chat_jid' ? 1 : 0) ||
      row.notnull !== (row.name === 'cursor_ts' ? 1 : 0) || row.dflt_value !== (row.name === 'cursor_ts' ? "''" : null)) fail();
    return row.name === 'chat_jid' ? 'chat_jid TEXT PRIMARY KEY' : row.name === 'cursor_ts' ? "cursor_ts TEXT NOT NULL DEFAULT ''" : `${row.name} ${type}`;
  });
  if (!rows.some(row => row.name === 'chat_jid') || !rows.some(row => row.name === 'cursor_ts')) fail();
  if (!active && !historicalShapes.includes(rows.filter(row => Object.hasOwn(retired, row.name)).map(row => row.name).sort().join(','))) fail();
  if (active && rows.map(row => row.name).join(',') !== 'chat_jid,cursor_ts,queued_followups_json') fail();
  if (normalise(definition) !== normalise(`CREATE TABLE ${name} (${expected.join(',')})`)) fail();
  const indexes = db.query(`PRAGMA main.index_list(${quote(name)})`).all() as { origin: string }[];
  if (indexes.some(index => index.origin !== 'pk')) fail();
  return rows;
}
function assertNoDependents(db: Database): void {
  for (const schema of ['main', 'temp']) {
    const objects = schema === 'main' ? 'main.sqlite_schema' : 'sqlite_temp_schema';
    if (db.query(`SELECT 1 FROM ${objects} WHERE type IN ('trigger','view') AND
      (tbl_name='chat_cursors' COLLATE NOCASE OR instr(lower(coalesce(sql,'')),'chat_cursors')>0 OR instr(lower(coalesce(sql,'')),?)>0) LIMIT 1`).get(legacyCursorArchive)) fail();
    if (db.query(`SELECT 1 FROM ${objects} s,pragma_foreign_key_list(s.name,?) f
      WHERE s.type='table' AND lower(f."table") IN ('chat_cursors',?) LIMIT 1`).get(schema, legacyCursorArchive)) fail();
  }
}
/** Caller owns the root connection. A nested call is a savepoint; failed
 * recognition, copy, receipt or postcondition rolls back all retirement work.
 * Fresh roots create only active storage, never obsolete fields or an archive. */
export function initializeChatCursorStorage(db: Database): void {
  db.transaction(() => {
    if (db.query("SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN ('chat_cursors',?, 'piclaw_schema_migrations') LIMIT 1").get(legacyCursorArchive)) fail();
    const archive = sql(db, legacyCursorArchive), current = sql(db, 'chat_cursors');
    const ledger = db.query("SELECT 1 FROM main.sqlite_schema WHERE name='piclaw_schema_migrations' COLLATE NOCASE").get();
    const receipt = ledger ? db.query('SELECT id FROM main.piclaw_schema_migrations WHERE owner=?').all(owner) as { id: string }[] : [];
    assertNoDependents(db);
    if (receipt.length) {
      if (receipt.length !== 1) fail();
      assertShape(db, 'chat_cursors', true);
      const migration = archive ? retirement(assertShape(db, legacyCursorArchive, false).some(row => row.name === 'queued_followups_json')) : fresh;
      if (receipt[0]?.id !== migration.id) fail();
      applyOwnedMigrations(db, [migration]);
      return;
    }
    if (archive) fail(); // Unreceipted evidence is never overwritten or adopted.
    const original = current ? assertShape(db, 'chat_cursors', false) : null;
    applyOwnedMigrations(db, [original ? retirement(original.some(row => row.name === 'queued_followups_json')) : fresh]);
    assertShape(db, 'chat_cursors', true);
    if (original) assertShape(db, legacyCursorArchive, false);
  }).immediate();
}
/** Explicit historical capture only. Archived markers never drive native
 * execution; they can refuse capture of unsettled legacy evidence. */
export function hasUnsettledLegacyCursorEvidence(db: Database): boolean {
  if (!sql(db, legacyCursorArchive)) return false;
  const names = new Set(columns(db, legacyCursorArchive).map(row => row.name));
  const markers = ['preflight_message_id', 'inflight_message_id'].filter(name => names.has(name));
  return markers.length > 0 && !!db.query(`SELECT 1 FROM main.${legacyCursorArchive} WHERE ${markers.map(name => `${name} IS NOT NULL`).join(' OR ')} LIMIT 1`).get();
}
