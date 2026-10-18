import type { Database } from "bun:sqlite";
import { enableSqliteWal } from "../../../runtime/src/db/sqlite-journal.js";
import { BunSqliteDatabase } from "../../../runtime/durable-engine/src/bun-sqlite.js";

// Qualification policy only: copied host and standalone candidate fixtures remain
// separate databases, unlike the already-qualified shared application root.
export function configureHostWalFixtureDatabase(db: Database): void {
  const before = db.query("PRAGMA synchronous").get() as { synchronous: number };
  if (before.synchronous !== 2) throw new Error("Host fixture requires existing synchronous=FULL (2)");
  enableSqliteWal(db); // Verifies returned WAL mode and preserves the owner's busy_timeout.
  db.exec("PRAGMA synchronous=FULL");
  const after = db.query("PRAGMA synchronous").get() as { synchronous: number };
  if (after.synchronous !== 2) throw new Error("Host fixture did not retain synchronous=FULL (2)");
}

export async function openWalFixtureDatabase(path: string): Promise<BunSqliteDatabase> {
  const db = new BunSqliteDatabase(path);
  try {
    const before = await db.get<{ synchronous: number }>("PRAGMA synchronous");
    if (before?.synchronous !== 2) throw new Error("Candidate fixture requires existing synchronous=FULL (2)");
    await db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    const journal = await db.get<{ journal_mode: string }>("PRAGMA journal_mode");
    const after = await db.get<{ synchronous: number }>("PRAGMA synchronous");
    if (journal?.journal_mode.toLowerCase() !== "wal" || after?.synchronous !== 2)
      throw new Error("Candidate fixture requires WAL and synchronous=FULL (2)");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
