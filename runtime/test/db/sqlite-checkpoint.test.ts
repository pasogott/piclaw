import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSqliteCheckpoint } from "../../src/db/sqlite-checkpoint.js";
import { waitFor } from "../helpers.js";
function fixture() {
  const base = join(process.env.PICLAW_WORKSPACE || tmpdir(), "piclaw/tests/checkpoint"); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "run-")), path = join(root, "test.db"), db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE fixture(value BLOB)");
  return { root, path, db, close() { db.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("checkpoint coordinator retains FULL durability and shares a worker across writers", async () => {
  const f = fixture(), second = new Database(f.path);
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!, stopSecond = registerSqliteCheckpoint(second, f.path, true)!;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    expect(second.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    expect(second.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    f.db.query("INSERT INTO fixture VALUES (zeroblob(5000000))").run();
    expect(second.query("SELECT length(value) n FROM fixture").get()).toEqual({ n: 5000000 });
    stop(); f.db.close();
    expect(second.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    await Bun.sleep(1200);
    expect(second.query("SELECT length(value) n FROM fixture").get()).toEqual({ n: 5000000 });
  } finally { stop(); stopSecond(); second.close(); f.close(); }
});
test("checkpoint worker performs PASSIVE IO off-thread and preserves a live reader", async () => {
  const f = fixture(), identity = statSync(f.path), reader = new Database(f.path);
  const worker = new Worker(new URL("../../src/db/sqlite-checkpoint-worker.ts", import.meta.url).href);
  const messages: any[] = [];
  worker.addEventListener("message", event => messages.push(event.data));
  try {
    worker.postMessage({ path: f.path, dev: identity.dev, ino: identity.ino });
    await waitFor(() => messages.some(m => m.type === "ready"), 3000);
    f.db.exec("PRAGMA wal_autocheckpoint=0");
    reader.exec("BEGIN"); reader.query("SELECT count(*) FROM fixture").get();
    f.db.query("INSERT INTO fixture VALUES (zeroblob(5000000))").run();
    await waitFor(() => messages.some(m => m.type === "checkpoint"), 3000);
    const result = messages.find(m => m.type === "checkpoint").result;
    expect(result.log).toBeGreaterThan(result.checkpointed);
    expect(reader.query("SELECT count(*) n FROM fixture").get()).toEqual({ n: 0 });
    reader.exec("ROLLBACK");
    await waitFor(() => messages.some(m => m.type === "checkpoint" && m.result.log === m.result.checkpointed), 3000);
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  } finally { worker.terminate(); reader.close(); f.close(); }
});
test("worker failure restores safe built-in checkpointing", async () => {
  const f = fixture(), stop = registerSqliteCheckpoint(f.db, f.path, true)!;
  let moved = false;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    renameSync(f.path, f.path + ".moved"); moved = true;
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 1000, 3000);
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  } finally { if (moved) renameSync(f.path + ".moved", f.path); stop(); f.close(); }
});
test("non-ZFS policy leaves built-in checkpoint unchanged", () => {
  const f = fixture(); try { expect(registerSqliteCheckpoint(f.db, f.path, false)).toBeUndefined();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
  } finally { f.close(); }
});
