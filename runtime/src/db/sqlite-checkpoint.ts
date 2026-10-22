import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
const log = createLogger("db.checkpoint");

/** SQLite's default WAL checkpoint runs inside COMMIT on the HTTP thread. On
 * ZFS, move only checkpoint IO to a worker; retain FULL commit durability. */
export function isZfsFilesystem(path: string): boolean {
  try {
    const target = resolve(path);
    let best = "", zfs = false;
    for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
      const [mount, fs] = line.split(" - ");
      if (!mount || !fs) continue;
      const point = mount.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
      if (point && (target === point || target.startsWith(point.endsWith("/") ? point : point + "/")) && point.length >= best.length) {
        best = point; zfs = fs.split(" ")[0] === "zfs";
      }
    }
    return zfs;
  } catch { return false; }
}
interface CheckpointGroup { worker: Worker; handles: Set<Database>; ready: boolean; }
const groups = new Map<string, CheckpointGroup>();
export function registerSqliteCheckpoint(database: Database, path: string, enabled = isZfsFilesystem(path)): (() => void) | undefined {
  if (!enabled || path === ":memory:") return;
  const journal = database.query("PRAGMA journal_mode").get() as { journal_mode: string };
  // A checkpoint worker is a second reader. On a rollback-journal database it
  // serves no purpose and can prevent the writer's COMMIT from taking its lock.
  if (journal.journal_mode.toLowerCase() !== "wal") return;
  const file = resolve(path), identity = statSync(file), key = `${file}:${identity.dev}:${identity.ino}`;
  let group = groups.get(key);
  if (!group) {
    let worker: Worker;
    try { worker = new Worker(new URL("./sqlite-checkpoint-worker.ts", import.meta.url).href, { smol: true, ref: false }); }
    catch { return; } // Keep SQLite's safe built-in checkpoint on startup failure.
    group = { worker, handles: new Set(), ready: false };
    groups.set(key, group);
    const current = group;
    const fallback = () => {
      if (groups.get(key) !== current) return;
      current.ready = false;
      for (const handle of current.handles) {
        try { handle.exec("PRAGMA wal_autocheckpoint=1000"); } catch (error) {
          debugSuppressedError(log, "Could not restore automatic checkpoints on an unavailable SQLite handle.", error, { operation: "sqlite_checkpoint.restore_unavailable_handle" });
        }
      }
    };
    worker.addEventListener("message", event => {
      if (groups.get(key) !== current || event.data?.type !== "ready") return;
      current.ready = true;
      for (const handle of current.handles) handle.exec("PRAGMA wal_autocheckpoint=0");
      log.info("ZFS WAL checkpoint worker ready; FULL commit durability retained", { operation: "sqlite_checkpoint.ready", path: file, connections: current.handles.size });
    });
    worker.addEventListener("error", event => {
      event.preventDefault(); fallback();
      log.warn("SQLite checkpoint worker failed; restored built-in checkpointing", { operation: "sqlite_checkpoint.fallback", path: file });
    });
    worker.addEventListener("close", fallback);
    worker.postMessage({ path: file, dev: identity.dev, ino: identity.ino });
  }
  group.handles.add(database);
  if (group.ready) database.exec("PRAGMA wal_autocheckpoint=0");
  const current = group;
  return () => {
    if (current.handles.delete(database)) {
      try { database.exec("PRAGMA wal_autocheckpoint=1000"); } catch (error) {
        debugSuppressedError(log, "Could not restore automatic checkpoints while unregistering a SQLite handle.", error, { operation: "sqlite_checkpoint.unregister_unavailable_handle" });
      }
    }
    if (!current.handles.size && groups.get(key) === current) {
      groups.delete(key);
      current.worker.terminate();
    }
  };
}
