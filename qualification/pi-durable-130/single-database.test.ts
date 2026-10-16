import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { TestOwner } from "./src/ownership.js";
import { context } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { CURRENT_SQLITE_SCHEMA_VERSION } from "../../runtime/durable-engine/qualification/sqlite.ts";
import type { DocumentId } from "../../runtime/durable-engine/qualification/durable.ts";
import type { DurableConversationOperation } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";

// Multiple owned connections to ONE physical file. This is NOT a claim that host
// and SDK transactions are atomic together; binding ACK recovery remains necessary.
test("single physical database: accepted primary + attached intent, terminal idempotence and new-owner reopen", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "single-database-"));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const f = await acceptedSteerFixture(dir, "before-submit", undefined, false, { sharedDatabase: true });
  try {
    expect(resolve(f.path)).toBe(resolve(f.hostPath));
    expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
    const rootLedger = () => f.db.query("SELECT * FROM core_schema_migrations ORDER BY name").all();
    const ledger = f.rootSchemaMigrations;
    expect(rootLedger()).toEqual(ledger);
    expect(ledger.length).toBeGreaterThan(0);
    const checkConnections = async () => {
      f.owner.assert();
      const sdk = f.candidateDatabase;
        for (const rows of [f.db.query("PRAGMA database_list").all(), await sdk.all("PRAGMA database_list")]) {
          const databases = rows as { name: string; file: string }[];
          expect(databases.filter(r => r.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.hostPath }]);
        }
        expect(f.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
        expect(await sdk.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
        expect(f.db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
        expect(await sdk.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
        expect(f.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(await sdk.all("PRAGMA foreign_key_check")).toEqual([]);
    };
    const { primary, primaryId, b, adapter } = await f.prepare();
    const captured = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as { input: string }).input) as DurableConversationOperation;
    const sid = await adapter.submitIntent(captured);
    expect(await adapter.submitIntent(captured)).toBe(sid);
    expect(await f.runtime!.submit(primary)).toBe(primaryId);
    f.base.host.finalContent = [{ type: "text", text: "single database answer" }];
    f.base.host.modelHold!.release();
    await f.runtime!.resume(primary, primaryId);
    let terminal = await f.runtime!.settle(primary);
    for (let n = 0; !terminal && n < 200; n++) { await Bun.sleep(5); terminal = await f.runtime!.settle(primary); }
    expect(terminal?.disposition).toBe("completed");
    expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(b.sourceSeq);
    const docId = await f.candidateStorage!.mintId<DocumentId>();
    await f.candidateStorage!.commit([{ type: "document.create", record: { id: docId, kind: "qualification.single-database", scope: { kind: "session" } }, content: { kind: "base", version: 1, value: { outcome: "same-file" } } }], context);
    for (const table of ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits", "piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"]) {
      expect((f.db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBeGreaterThan(0);
    }
    expect(f.db.query("SELECT version FROM durable_schema").get()).toEqual({ version: CURRENT_SQLITE_SCHEMA_VERSION });
    expect(rootLedger()).toEqual(ledger);
    await checkConnections();
    const snapshot = f.snapshot();
    const bindings = { primary: await f.ports.bindings.get(primary), intents: await f.ports.bindings.intents!.list(primary) };
    const generation = f.owner.token.generation;
    const calls = f.base.host.modelCalls;
    await f.runtime!.close();
    closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
    f.owner = TestOwner.acquire(f.hostPath); // Same file, fresh exclusive owner; no live-writer takeover.
    expect(f.owner.token.generation).toBe(generation + 1);
    f.owner.assert(); initDatabase(); f.db = getDb(); f.ports = f.stores();
    const reopened = await f.open();
    expect(await f.candidateStorage!.conversation(f.base.root.id, context)).toBeDefined();
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context))?.id).toBe(primaryId);
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context))?.id).toBe(sid);
    expect((await f.candidateStorage!.document(docId, "current", context))?.value.outcome).toBe("same-file");
    expect(await f.ports.bindings.get(primary)).toEqual(bindings.primary);
    expect(await f.ports.bindings.intents!.list(primary)).toEqual(bindings.intents);
    expect(await reopened.submitIntent(captured)).toBe(sid);
    expect(await f.runtime!.submit(primary)).toBe(primaryId);
    expect((await f.runtime!.settle(primary))?.disposition).toBe("completed");
    expect(f.snapshot()).toEqual(snapshot);
    expect(f.base.host.modelCalls).toBe(calls);
    expect(f.base.host.effects).toBe(0);
    expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([{ content: "single database answer" }]);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(f.incarnation)).toHaveLength(1);
    expect(rootLedger()).toEqual(ledger);
    await checkConnections();
    const files: string[] = [];
    async function scan(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const next = join(path, entry.name);
        if (entry.isDirectory()) await scan(next); else files.push(next);
      }
    }
    await scan(dir); await scan(dirname(f.hostPath));
    expect(files.filter(p => /\.jsonl$/i.test(p))).toEqual([]);
    // WAL/SHM are SQLite sidecars, not additional stores. Ownership is a table
    // in this very file: no separate lease DB or session files are permitted.
    expect(files.filter(p => ![f.hostPath, `${f.hostPath}-wal`, `${f.hostPath}-shm`].includes(p))).toEqual([]);
    expect((await stat(f.path)).ino).toBe((await stat(f.hostPath)).ino);
  } finally {
    await f.close(); process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
