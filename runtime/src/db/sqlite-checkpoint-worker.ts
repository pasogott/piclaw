import { Database } from "bun:sqlite";
import { statSync } from "node:fs";

declare const self: Worker;
let started = false;
self.addEventListener("message", event => {
  if (started) return;
  started = true;
  const { path, dev, ino } = event.data;
  const assertFile = () => {
    const current = statSync(path);
    if (current.dev !== dev || current.ino !== ino) throw Error("Checkpoint database identity changed");
  };
  assertFile();
  const db = new Database(path, { create: false, strict: true });
  try {
    assertFile();
    db.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; PRAGMA mmap_size=0;");
    self.postMessage({ type: "ready" });
    setInterval(() => {
      assertFile();
      try {
        // WAL allocation is retained after a checkpoint. PASSIVE is bounded by
        // current readers and never waits for writer/reader locks or truncates.
        if (statSync(path + "-wal").size < 4 * 1024 * 1024) return;
        const result = db.query("PRAGMA wal_checkpoint(PASSIVE)").get();
        self.postMessage({ type: "checkpoint", result });
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT" || (error as { code?: string }).code === "SQLITE_BUSY") return;
        throw error; // Worker error restores normal autocheckpoint on all writers.
      }
    }, 1000);
  } catch (error) { db.close(); throw error; }
});
