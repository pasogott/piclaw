import assert from 'node:assert/strict';
import { existsSync, renameSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { spyOn } from 'bun:test';
import * as checkpoints from '../../src/db/sqlite-checkpoint.js';
import { getRuntimeConfigPaths } from '../../src/core/config-context.js';
import { initDatabase, getDb, closeDatabase, getDatabaseBinding } from '../../src/db/connection.js';
import { RuntimeStartupCleanupError } from '../../src/runtime/startup-cleanup-error.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const scenario = process.argv[2];
const paths = getRuntimeConfigPaths(), file = paths.databasePath;
assert.notEqual(file, ':memory:');
assertPathWithinTestFilesystemIsolation(file, process.env, { allowRoot: false });
const exec = Database.prototype.exec, close = Database.prototype.close;
const primary = Error('injected schema failure'), restoration = Error('injected FK restoration failure'), disposal = Error('injected close failure');
let candidate: Database | undefined;
let closed = 0;
let registration: ReturnType<typeof spyOn> | undefined;
function failSchema() {
  Database.prototype.exec = function(sql: string) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS chats')) {
      candidate = this;
      assert.throws(() => getDb(), /not initialized/);
      assert.equal(getDatabaseBinding(), null);
      exec.call(this, sql);
      throw primary;
    }
    if (scenario === 'restoration-failure' && sql === 'PRAGMA foreign_keys = OFF;') throw restoration;
    return exec.call(this, sql);
  };
  Database.prototype.close = function(throwOnError?: boolean) {
    if (this === candidate) { closed++; if (scenario === 'schema-and-close-failure') throw disposal; }
    return close.call(this, throwOnError);
  };
}
try {
  if (['schema-failure', 'restoration-failure', 'schema-and-close-failure'].includes(scenario)) {
    failSchema();
    let failure: unknown;
    try { initDatabase(paths); } catch (error) { failure = error; }
    assert(failure);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.equal(closed, 1);
    if (scenario === 'schema-failure') assert.equal(failure, primary);
    else {
      assert(failure instanceof RuntimeStartupCleanupError);
      assert.deepEqual(failure.errors, [primary, scenario === 'restoration-failure' ? restoration : disposal]);
    }
    Database.prototype.exec = exec; Database.prototype.close = close;
    if (scenario === 'schema-and-close-failure') {
      assert.throws(() => initDatabase(paths), error => error === failure);
      close.call(candidate!, true);
    } else {
      assert.throws(() => candidate!.query('SELECT 1'), /closed/);
      const inspect = new Database(file, { readonly: true });
      try { assert.deepEqual(inspect.query("SELECT name FROM sqlite_schema WHERE type='table'").all(), []); }
      finally { inspect.close(true); }
      initDatabase(paths); assert(getDb()); assert(getDatabaseBinding());
    }
  } else if (scenario === 'reuse-behind-writer') {
    initDatabase(paths); const db = getDb(), binding = getDatabaseBinding();
    db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0');
    const blocker = new Database(file, { create: false }); blocker.exec('BEGIN IMMEDIATE');
    const transaction = db.transaction, execute = db.exec;
    db.transaction = (() => { throw Error('unexpected schema transaction on reuse'); }) as typeof db.transaction;
    db.exec = (() => { throw Error('unexpected policy write on reuse'); }) as typeof db.exec;
    try {
      initDatabase(paths); assert.equal(getDb(), db); assert.deepEqual(getDatabaseBinding(), binding);
      assert.deepEqual(db.query('PRAGMA foreign_keys').get(), { foreign_keys: 1 });
      assert.deepEqual(db.query('PRAGMA busy_timeout').get(), { timeout: 0 });
    } finally { db.transaction = transaction; db.exec = execute; blocker.exec('ROLLBACK'); blocker.close(true); }
  } else if (scenario === 'inspection-failure') {
    initDatabase(paths); const db = getDb(), binding = getDatabaseBinding(), prepare = db.prepare;
    const io = Error('injected inspection IO failure');
    db.prepare = function(sql: string, ...args: any[]) { if (sql === 'SELECT 1;') throw io; return prepare.call(this, sql, ...args); } as typeof db.prepare;
    try { assert.throws(() => initDatabase(paths), error => error === io); assert.equal(getDb(), db); assert.deepEqual(getDatabaseBinding(), binding); }
    finally { db.prepare = prepare; }
  } else if (scenario === 'replacement' || scenario === 'missing') {
    initDatabase(paths); const db = getDb(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (scenario === 'replacement') {
      const replacement = new Database(file + '.replacement');
      replacement.exec('CREATE TABLE sentinel(value);INSERT INTO sentinel VALUES(42)'); replacement.close(true);
      renameSync(file, file + '.old'); renameSync(file + '.replacement', file);
    } else renameSync(file, file + '.old');
    assert.throws(() => initDatabase(paths), /identity changed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    if (scenario === 'replacement') {
      const inspect = new Database(file, { readonly: true });
      try { assert.deepEqual(inspect.query("SELECT name FROM sqlite_schema WHERE type='table'").all(), [{ name: 'sentinel' }]); }
      finally { inspect.close(true); }
    } else assert.equal(existsSync(file), false);
  } else if (scenario === 'prepared-close') {
    initDatabase(paths); const db = getDb(), statement = db.prepare('SELECT 1 AS retained');
    let maintenance = 0;
    db.exec = ((sql: string) => {
      if (/VACUUM|optimize|shrink_memory/i.test(sql)) { maintenance++; throw Error('unexpected close maintenance'); }
      assert.throws(() => getDb(), /not initialized/); // Checkpoint policy release follows unpublication.
      return exec.call(db, sql);
    }) as typeof db.exec;
    closeDatabase();
    assert.equal(maintenance, 0);
    assert.throws(() => statement.get(), /closed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    initDatabase(paths); assert.notEqual(getDb(), db);
  } else if (scenario === 'registration-failure') {
    registration = spyOn(checkpoints, 'registerSqliteCheckpoint').mockImplementation((db: Database) => { candidate = db; throw primary; });
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) closed++; return close.call(this, throwOnError); };
    assert.throws(() => initDatabase(paths), error => error === primary);
    assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => candidate!.query('SELECT 1'), /closed/);
    registration.mockRestore(); Database.prototype.close = close;
    initDatabase(paths); assert(getDb()); assert(getDatabaseBinding());
  } else if (scenario === 'disposer-failure') {
    registration = spyOn(checkpoints, 'registerSqliteCheckpoint').mockImplementation((db: Database) => {
      candidate = db;
      return () => { assert.throws(() => getDb(), /not initialized/); throw disposal; };
    });
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) closed++; return close.call(this, throwOnError); };
    initDatabase(paths);
    let failure: unknown;
    try { closeDatabase(); } catch (error) { failure = error; }
    assert(failure instanceof RuntimeStartupCleanupError); assert.deepEqual(failure.errors, [disposal]);
    assert.equal(closed, 1); assert.throws(() => candidate!.query('SELECT 1'), /closed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => initDatabase(paths), error => error === failure);
  } else if (scenario === 'published-close-failure') {
    initDatabase(paths); candidate = getDb();
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) { closed++; throw disposal; } return close.call(this, throwOnError); };
    let failure: unknown;
    try { closeDatabase({ shrinkMemory: false }); } catch (error) { failure = error; }
    assert(failure instanceof RuntimeStartupCleanupError); assert.deepEqual(failure.errors, [disposal]);
    assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => initDatabase(paths), error => error === failure);
    Database.prototype.close = close; close.call(candidate, true);
  } else throw Error('Unknown lifecycle scenario');
  console.log(JSON.stringify({ scenario, privatePublicationAndLifetime: true }));
} finally {
  registration?.mockRestore();
  Database.prototype.exec = exec; Database.prototype.close = close;
  closeDatabase({ shrinkMemory: false });
}
