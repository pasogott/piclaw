import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeHostSchema, initializeHostDurableBindings, createHostDurableBindings, HostCutoverController } from "../../runtime/durable-engine/src/index.js";
import { acceptedPayloadRecoveryIndex, migrateHostAcceptedPayloadLookup } from '../../runtime/durable-engine/src/host-schema.js';
import { acceptedPayloadRecoverySql, readApplicationMessagePayload } from '../../runtime/durable-engine/src/accepted-payload-recovery.js';
import { acceptedSteerFixture } from './src/accepted-steer-recovery-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

test("host schema: FK, exact synchronous guard, atomic DDL and incompatible shapes fail closed", () => {
  const db = new Database(":memory:");
  const tables = () => db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  try {
    expect(() => initializeHostSchema(db, () => {})).toThrow("foreign_keys ON");
    db.exec("PRAGMA foreign_keys=ON");
    for (const guard of [() => true, () => Promise.resolve()]) {
      expect(() => initializeHostSchema(db, guard as () => void)).toThrow("owner guard");
      expect(tables()).toEqual([]);
    }
    let calls = 0;
    expect(() => initializeHostSchema(db, () => { if (++calls === 3) throw Error("Owner lost"); })).toThrow("Owner lost");
    expect(tables()).toEqual([]);
    db.exec("CREATE TABLE qualification_cutover_work_v1 (domain TEXT)");
    expect(() => initializeHostSchema(db, () => {})).toThrow("Unsupported host schema");
    expect(tables()).toEqual([{ name: "qualification_cutover_work_v1" }]);
  } finally { db.close(); }
});

test("host schema: existing primary/submission identity preserved; missing intents unsupported on reads", async () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostDurableBindings(db, () => {});
    db.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("d", "i", 1, "chat", "main", "op", 1, "source", "payload", "request", "a".repeat(64), 42);
    const rows = () => db.query("SELECT * FROM piclaw_durable_bindings_v1").all();
    const before = rows(); initializeHostSchema(db, () => {}); expect(rows()).toEqual(before);
    const drift = new Database(":memory:");
    try {
      drift.exec("PRAGMA foreign_keys=ON");
      const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name='piclaw_durable_bindings_v1'").get() as { sql: string }).sql;
      drift.exec(ddl.replace("UNIQUE(domain,incarnation,submission_id),", ""));
      expect(() => initializeHostSchema(drift, () => {})).toThrow("Unsupported host schema");
      expect(drift.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: "piclaw_durable_bindings_v1" }]);
    } finally { drift.close(); }
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    db.exec("DROP TABLE piclaw_durable_intent_bindings_v1");
    const store = createHostDurableBindings(db, { domain: "d", incarnation: "i", manifest: [], assertOwner() {}, async resolveContent() { return ""; } });
    await expect(store.findSource("chat", 1)).rejects.toThrow("Unsupported host schema");
    expect(rows()).toEqual(before);
    expect(db.query("SELECT name FROM sqlite_master WHERE name='piclaw_durable_intent_bindings_v1'").get()).toBeNull();
  } finally { db.close(); }
});

test("cutover: stale JSON count cannot override existing work rows on inspect, record or rollback", () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostSchema(db, () => {});
    const identity = { domain: "d", incarnation: "i", ownerGeneration: 1, sourceEngineId: "source", candidateStoreRef: "candidate" };
    const digest = "a".repeat(64);
    const manifest = { phase: "active", revision: 0, writer: "candidate", postCutoverCount: 999,
      request: { requestKey: "r", sourceDigest: digest, importHash: digest }, receipt: null };
    db.query("INSERT INTO qualification_cutover_v1 VALUES (?,?,?,?)").run("d", JSON.stringify(identity), digest, JSON.stringify(manifest));
    const controller = new HostCutoverController(db, identity, { assertOwner() {}, assertCurrentWriter() {},
      checkDrained() { return { sourceDigest: digest, pending: 0, inflight: 0 }; } });
    expect(controller.inspect()!.postCutoverCount).toBe(0);
    db.query("INSERT INTO qualification_cutover_work_v1 VALUES (?,?,?)").run("d", "op", digest);
    expect(controller.inspect()!.postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(0, { operationId: "op", contentHash: digest }).postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(1, { operationId: "op2", contentHash: digest }).postCutoverCount).toBe(2);
    expect(controller.prepareRollback(2).reasons).toContain("recorded_work");
  } finally { db.close(); }
});

const lookupReceipt = (db: Database) => db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.native-bindings' ORDER BY migration_order").all();
function removeLookupStep(db: Database) {
  db.exec(`DROP INDEX ${acceptedPayloadRecoveryIndex}`);
  db.exec("DELETE FROM piclaw_schema_migrations WHERE owner='host.native-bindings'");
}

test('host binding lookup migration is owned, atomic, exact and idempotent without row changes', () => {
  const db = new Database(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  try {
    initializeHostSchema(db, () => {});
    expect(lookupReceipt(db)).toHaveLength(1);
    expect(db.query(`PRAGMA index_info(${acceptedPayloadRecoveryIndex})`).all().map(row => (row as {name:string}).name))
      .toEqual(['incarnation', 'chat_jid', 'source_id', 'payload_ref']);
    db.query('INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('d','i',1,'chat','main','op',1,'source','payload','request','a'.repeat(64),null);
    const rows = db.query('SELECT * FROM piclaw_durable_bindings_v1').all();
    removeLookupStep(db);
    let calls = 0;
    expect(() => migrateHostAcceptedPayloadLookup(db, () => { if (++calls === 3) throw Error('owner lost'); })).toThrow('owner lost');
    expect(lookupReceipt(db)).toEqual([]);
    expect(db.query('SELECT 1 FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toBeNull();
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
    migrateHostAcceptedPayloadLookup(db, () => {});
    const receipt = lookupReceipt(db);
    const index = db.query('SELECT sql,rootpage FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex);
    migrateHostAcceptedPayloadLookup(db, () => {}); initializeHostSchema(db, () => {});
    expect(lookupReceipt(db)).toEqual(receipt);
    expect(db.query('SELECT sql,rootpage FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toEqual(index);
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
    // A receipt without its index is drift, never a silently successful reopen.
    db.exec(`DROP INDEX ${acceptedPayloadRecoveryIndex}`);
    expect(() => migrateHostAcceptedPayloadLookup(db, () => {})).toThrow('Unsupported host schema');
    expect(lookupReceipt(db)).toEqual(receipt);
    expect(db.query('SELECT 1 FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toBeNull();
    db.exec((index as {sql:string}).sql);
    removeLookupStep(db);
    db.exec(`CREATE INDEX ${acceptedPayloadRecoveryIndex} ON piclaw_durable_bindings_v1(chat_jid)`);
    expect(() => migrateHostAcceptedPayloadLookup(db, () => {})).toThrow('Unsupported host schema');
    expect(lookupReceipt(db)).toEqual([]);
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
  } finally { db.close(); }
});

test('real accepted-payload fallback searches retained bindings and preserves SDK provenance/hash checks', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'binding-recovery-index-'));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const f = await acceptedSteerFixture(dir, 'before-submit', undefined, true, { sharedDatabase: true });
  try {
    const { primary } = await f.prepare();
    const db = f.db;
    const params = [primary.chatJid, primary.sourceId, primary.payloadRef, f.incarnation];
    const original = db.query(acceptedPayloadRecoverySql).get(...params);
    expect(original).not.toBeNull();
    const insert = db.query('INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction(() => {
      for (let i = 0; i < 4000; i++) insert.run('retained', f.incarnation, f.base.root.id,
        `retained-chat-${i % 20}`, 'main', `retained-op-${i}`, i + 1000, `retained-source-${i}`,
        `retained-payload-${i}`, `retained-request-${i}`, 'a'.repeat(64), null);
    }).immediate();
    const rows = () => db.query('SELECT * FROM piclaw_durable_bindings_v1 ORDER BY domain,operation_id').all();
    const retained = rows(); removeLookupStep(db);
    const plan = () => (db.query(`EXPLAIN QUERY PLAN ${acceptedPayloadRecoverySql}`).all(...params) as {detail:string}[]).map(row => row.detail);
    expect(plan().some(detail => /SCAN b\b/.test(detail))).toBe(true);
    migrateHostAcceptedPayloadLookup(db, () => f.owner.assert());
    const indexed = plan();
    expect(indexed.some(detail => detail.includes(`SEARCH b USING INDEX ${acceptedPayloadRecoveryIndex}`))).toBe(true);
    for (const alias of ['s','e']) expect(indexed.some(detail => detail.startsWith(`SEARCH ${alias} `) && /PRIMARY KEY|rowid/.test(detail))).toBe(true);
    expect(rows()).toEqual(retained);
    expect(db.query(acceptedPayloadRecoverySql).get(...params)).toEqual(original);
    const bindings = createHostDurableBindings(db, { domain: f.incarnation, incarnation: f.incarnation,
      manifest: [{chatJid:f.chatJid,branchId:'main',conversationId:f.base.root.id}], assertOwner() { f.owner.assert(); },
      async resolveContent(ref, input) { return readApplicationMessagePayload(db, f.incarnation, input, ref); } });
    expect(await bindings.getOrBind(primary)).toEqual({ content: 'primary A' });
    expect(db.query('UPDATE messages SET content=? WHERE id=? AND chat_jid=? RETURNING id').all('edited projection', primary.sourceId, primary.chatJid)).toEqual([{id:primary.sourceId}]);
    // Preserve production selection: an existing same-identity edit fails its hash.
    await expect(bindings.getOrBind(primary)).rejects.toThrow('Host payload hash conflict');
    // A changed projection identity or missing row takes the actual SDK fallback.
    const editedId = `${primary.sourceId}:edited-projection`;
    expect(db.query('UPDATE messages SET id=? WHERE id=? AND chat_jid=? RETURNING id').all(editedId, primary.sourceId, primary.chatJid)).toEqual([{id:editedId}]);
    expect(await bindings.getOrBind(primary)).toEqual({ content: 'primary A' });
    expect(db.query('DELETE FROM messages WHERE id=? AND chat_jid=? RETURNING id').all(editedId, primary.chatJid)).toEqual([{id:editedId}]);
    expect(await bindings.getOrBind(primary)).toEqual({ content: 'primary A' });
    expect(() => readApplicationMessagePayload(db, f.incarnation, { ...primary, sourceId:'wrong' }, primary.payloadRef)).toThrow('Unverified application payload');
    db.query('UPDATE piclaw_durable_bindings_v1 SET request_hash=? WHERE domain=? AND request_id=?').run('b'.repeat(64),f.incarnation,primary.requestId);
    expect(() => readApplicationMessagePayload(db, f.incarnation, primary, primary.payloadRef)).toThrow('Unverified SDK accepted payload');
    db.query('UPDATE piclaw_durable_bindings_v1 SET request_hash=? WHERE domain=? AND request_id=?').run(primary.requestHash,f.incarnation,primary.requestId);
    const accepted = db.query(`SELECT e.id,e.record FROM piclaw_durable_bindings_v1 b JOIN submissions s ON s.id=b.submission_id
      JOIN entries e ON e.id=json_extract(s.record,'$.entry') WHERE b.domain=? AND b.request_id=?`).get(f.incarnation, primary.requestId) as {id:number;record:string};
    const changed = JSON.parse(accepted.record); changed.model[0].content = 'forged SDK bytes';
    db.query('UPDATE entries SET record=? WHERE id=?').run(JSON.stringify(changed), accepted.id);
    await expect(bindings.getOrBind(primary)).rejects.toThrow('Host payload hash conflict');
    db.query('UPDATE entries SET record=? WHERE id=?').run(accepted.record, accepted.id);
    expect(await bindings.getOrBind(primary)).toEqual({ content: 'primary A' });
    expect(rows()).toEqual(retained);
  } finally {
    await f.close(); process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive:true, force:true });
  }
});
