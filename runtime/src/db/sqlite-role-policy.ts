import { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";
import { enableSqliteWal } from "./sqlite-journal.js";
import { isZfsFilesystem } from "./sqlite-checkpoint.js";
import { RuntimeStartupCleanupError } from "../runtime/startup-cleanup-error.js";

export type SqliteConnectionRole = "root" | "sdk" | "scheduler";
export interface SqliteRoleOptions {
  role: SqliteConnectionRole;
  create?: boolean;
  expectedIdentity?: string;
  expectedPath?: string;
  assertOwner?: () => void;
  /** Internal platform classification; not a runtime setting. */
  zfs?: boolean;
}
const identity = (path: string) => { const file = statSync(path); return `${file.dev}:${file.ino}`; };
const pragma = (db: Database, sql: string, key: string) =>
  (db.query(`PRAGMA ${sql}`).get() as Record<string, unknown> | null)?.[key];

function assertFile(database: Database, path: string, options: SqliteRoleOptions): void {
  if (path === ":memory:") return;
  const opened = (database.query("PRAGMA database_list").all() as { name: string; file: string }[])
    .find(row => row.name === "main")?.file;
  if (!opened || identity(opened) !== identity(path) ||
      options.expectedIdentity && identity(path) !== options.expectedIdentity ||
      options.expectedPath && realpathSync(opened) !== realpathSync(options.expectedPath)) {
    throw Error("SQLite role database identity changed");
  }
}

/** Apply connection-local policy; the caller still owns schema and lifecycle.
 * Root preserves its existing FK policy. Its schema batch borrows FK=ON itself. */
export function configureSqliteRole(database: Database, path: string, options: SqliteRoleOptions): void {
  options.assertOwner?.();
  assertFile(database, path, options);
  const memory = path === ":memory:", root = options.role === "root";
  const foreignKeys = root ? pragma(database, "foreign_keys", "foreign_keys") : 1;
  const timeout = options.role === "sdk" ? 0 : 5000;
  const zfs = !memory && (options.zfs ?? isZfsFilesystem(path));
  const cache = root && !memory ? zfs ? -8000 : -1000 : -2000;
  const mmap = root && !memory && !zfs ? 268435456 : 0;
  database.exec(`PRAGMA busy_timeout=${timeout}`);
  if (!memory && pragma(database, "journal_mode", "journal_mode") !== "wal") {
    // SDK admission must not inherit a synchronous writer-wait loop.
    if (options.role === "sdk") {
      if (pragma(database, "journal_mode=WAL", "journal_mode") !== "wal") throw Error("SQLite did not enable WAL journal mode.");
    } else enableSqliteWal(database);
  }
  if (memory) database.exec("PRAGMA journal_mode=MEMORY");
  database.exec(`PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA cache_size=${cache}; PRAGMA mmap_size=${mmap}`);
  if (!root) database.exec("PRAGMA foreign_keys=ON");
  const expected: [string, string, unknown][] = [
    ["busy_timeout", "timeout", timeout], ["synchronous", "synchronous", 2],
    ["secure_delete", "secure_delete", 1], ["cache_size", "cache_size", cache],
    ["foreign_keys", "foreign_keys", foreignKeys], ["journal_mode", "journal_mode", memory ? "memory" : "wal"],
  ];
  if (!memory) expected.push(["mmap_size", "mmap_size", mmap]);
  for (const [sql, key, value] of expected) if (pragma(database, sql, key) !== value) throw Error(`SQLite ${options.role} policy mismatch: ${sql}`);
  assertFile(database, path, options);
  options.assertOwner?.();
}

/** Open one owned handle. Failed configuration never publishes that handle. */
export function openSqliteRole(path: string, options: SqliteRoleOptions): Database {
  options.assertOwner?.();
  let before = options.expectedIdentity;
  if (path !== ":memory:") {
    try {
      const current = identity(path);
      if (before && current !== before) throw Error("SQLite role database identity changed");
      before = current;
      if (options.expectedPath && realpathSync(path) !== realpathSync(options.expectedPath)) throw Error("SQLite role database path alias is unsupported");
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT" || options.create === false || before) throw error;
    }
  }
  const database = new Database(path, { create: options.create ?? options.role !== "scheduler", strict: options.role === "sdk" });
  try {
    configureSqliteRole(database, path, { ...options, expectedIdentity: before });
    return database;
  } catch (error) {
    try { database.close(); }
    catch (cleanupError) { throw new RuntimeStartupCleanupError([error, cleanupError], "SQLite role opening cleanup uncertain"); }
    throw error;
  }
}
