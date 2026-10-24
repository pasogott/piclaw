import { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";

declare const self: Worker;
let started = false;
self.addEventListener("message", event => {
  if (started) return;
  started = true;
  const { path, dev, ino } = event.data;
  const assertFile = () => {
    const current = statSync(path);
    if (realpathSync(path) !== path || current.nlink !== 1 || current.dev !== dev || current.ino !== ino)
      throw Error("Checkpoint database identity changed");
  };
  assertFile();
  const db = new Database(path, { create: false, strict: true });
  try {
    assertFile();
    if ((db.query("PRAGMA journal_mode").get() as any).journal_mode !== "wal") throw Error("Checkpoint requires WAL");
    db.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; PRAGMA mmap_size=0;");
    self.postMessage({ type: "ready" });
    setInterval(() => {
      try {
        assertFile();
        const walBytes = statSync(path + "-wal").size;
        // PASSIVE never waits for readers/writers or truncates retained allocation.
        const result = db.query("PRAGMA wal_checkpoint(PASSIVE)").get();
        self.postMessage({ type: "checkpoint", result, walBytes });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ENOENT") {
          // Missing main file is fatal; an absent WAL merely means no work yet.
          assertFile();
          return;
        }
        if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
          self.postMessage({ type: "checkpoint", result: { busy: 1, log: -1, checkpointed: -1 }, error: code });
          return;
        }
        db.close();
        throw error; // Coordinator restores every writer's original policy.
      }
    }, 1000);
  } catch (error) { db.close(); throw error; }
});
