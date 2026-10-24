import "./src/test-guard.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { assertSchemaInventory, readSchemaInventory, type SchemaContract } from "../../runtime/scripts/lib/schema-ownership.js";
import { openNativeSchemaFixture, seedHistoricalSchemaFixture } from "./schema-ownership-fixture.js";
const applicationTest = isolatedApplicationTest(import.meta.url);
const contract = JSON.parse(readFileSync(new URL("../../runtime/scripts/schema-ownership.json", import.meta.url), "utf8")) as SchemaContract;
function inventory(database: ReturnType<typeof getDb>, profile: string) {
  const result = assertSchemaInventory(readSchemaInventory(database), contract, profile);
  expect(result.objects.every(object => object.owner !== null)).toBe(true);
  if (process.env.PICLAW_SCHEMA_INVENTORY_JSON === "1") console.log("SCHEMA_INVENTORY=" + JSON.stringify({ sources: contract.sources, ...result }));
  return result;
}

applicationTest("fresh core inventory owns every object and exact FTS shadow without creating optional schemas", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  try {
    const db = getDb(), before = db.query("SELECT * FROM sqlite_schema ORDER BY type,name").all();
    const receipts = db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order").all();
    const result = inventory(db, "core");
    expect(result.objects.some(object => object.storageKind === "virtual")).toBe(true);
    expect(result.objects.filter(object => object.storageKind === "shadow").every(object => object.category === "projection-cache")).toBe(true);
    expect(result.objects.some(object => object.owner === "sdk:storage")).toBe(false);
    expect(result.objects.some(object => object.owner === "addon:code-review")).toBe(false);
    expect(result.objects.some(object => object.owner === "archive:session-store")).toBe(false);
    expect(db.query("SELECT * FROM sqlite_schema ORDER BY type,name").all()).toEqual(before);
    expect(db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order").all()).toEqual(receipts);
    expect(readSchemaInventory(db)).toEqual(readSchemaInventory(db));
  } finally { closeDatabase(); }
});

for (const addons of [false, true]) applicationTest(`complete native startup inventory, approved add-ons present=${addons}`, async () => {
  const fixture = await openNativeSchemaFixture(addons);
  try {
    const db = fixture.database;
    const documents = db.query("SELECT * FROM documents ORDER BY id").all();
    const receipts = db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order").all();
    const schema = db.query("SELECT * FROM sqlite_schema ORDER BY type,name").all();
    const result = inventory(db, addons ? "native-addons" : "native");
    expect(result.objects.some(object => object.owner === "sdk:storage")).toBe(true);
    expect(result.objects.some(object => object.owner === "core:native-settlement")).toBe(true);
    expect(result.objects.some(object => object.owner === "core:native-timeline-media")).toBe(true);
    expect(result.objects.some(object => object.owner === "addon:code-review")).toBe(addons);
    expect(result.objects.some(object => object.owner === "archive:session-store")).toBe(false);
    const kinds = db.query("SELECT DISTINCT json_extract(record,'$.kind') AS kind FROM documents").all() as { kind: string }[];
    for (const { kind } of kinds) expect(contract.documents.some(document => document.kind === kind)).toBe(true);
    expect(db.query("SELECT * FROM documents ORDER BY id").all()).toEqual(documents);
    expect(db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order").all()).toEqual(receipts);
    expect(db.query("SELECT * FROM sqlite_schema ORDER BY type,name").all()).toEqual(schema);
    db.exec("SAVEPOINT inventory_negative; DROP INDEX entries_by_conversation");
    try { expect(() => inventory(db, addons ? "native-addons" : "native")).toThrow("Missing required object index:entries_by_conversation"); }
    finally { db.exec("ROLLBACK TO inventory_negative; RELEASE inventory_negative"); }
    expect(inventory(db, addons ? "native-addons" : "native").objects).toEqual(result.objects);
  } finally { await fixture.close(); }
});

applicationTest("historical core upgrade classifies its one approved spelling difference and retained archive", async () => {
  const before = await seedHistoricalSchemaFixture();
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  try {
    const db = getDb();
    const result = inventory(db, "core");
    const archive = result.objects.filter(object => object.owner === "archive:session-store");
    expect(archive.some(object => object.kind === "table" && object.name === "piclaw_agent_sessions")).toBe(true);
    expect(archive.some(object => object.storageKind === "shadow")).toBe(true);
    expect(archive.every(object => object.presence === "optional-preserved")).toBe(true);
    expect(db.query("SELECT * FROM piclaw_agent_sessions").all()).toEqual(before.sessions);
    expect(db.query("SELECT * FROM piclaw_agent_entries ORDER BY entry_seq").all()).toEqual(before.entries);
    expect(db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='piclaw-agent-sessions'").all()).toEqual(before.receipts);
    expect(db.query("SELECT name FROM chats WHERE jid='web:historical'").get()).toEqual({ name: "Retained label" });
    expect(db.query("SELECT branch_id,agent_name FROM chat_branches WHERE chat_jid='web:historical'").get()).toEqual({ branch_id: "retained-branch", agent_name: "retained-agent" });
    expect(db.query("SELECT input_tokens,output_tokens,total_tokens,model,provider FROM token_usage WHERE chat_jid='web:historical'").get())
      .toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120, model: "retained-model", provider: "retained-provider" });
    // Retained optional components still require their own exact indexes.
    db.exec("SAVEPOINT archive_negative; DROP INDEX idx_piclaw_agent_entries_parent");
    try { expect(() => inventory(db, "core")).toThrow("Missing required object index:idx_piclaw_agent_entries_parent"); }
    finally { db.exec("ROLLBACK TO archive_negative; RELEASE archive_negative"); }
    db.exec("SAVEPOINT archive_fts_negative; DROP TABLE piclaw_agent_entries_fts");
    try { expect(() => inventory(db, "core")).toThrow("Missing required object table:piclaw_agent_entries_fts"); }
    finally { db.exec("ROLLBACK TO archive_fts_negative; RELEASE archive_fts_negative"); }
    const child = Bun.spawnSync([process.execPath, new URL("../../runtime/scripts/schema-inventory.ts", import.meta.url).pathname,
      join(process.env.PICLAW_STORE!, "messages.db"), "core"], { env: process.env, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(0);
    const cli = JSON.parse(new TextDecoder().decode(child.stdout));
    expect(cli.errors).toEqual([]);
    expect(cli.objects).toEqual(result.objects);
    expect(db.query("SELECT * FROM piclaw_agent_entries ORDER BY entry_seq").all()).toEqual(before.entries);
    closeDatabase(); initDatabase();
    const reopened = inventory(getDb(), "core");
    // Existing close-time PRAGMA optimize may create optional sqlite_stat1.
    // Every new object still needs an exact declared owner/shape.
    const beforeKeys = new Set(result.objects.map(object => `${object.kind}:${object.name}`));
    expect(reopened.objects.filter(object => !beforeKeys.has(`${object.kind}:${object.name}`))
      .every(object => object.owner === "sqlite:planner-statistics")).toBe(true);
    const persistent = (objects: typeof result.objects) => objects.filter(object => object.owner !== "sqlite:planner-statistics");
    expect(persistent(reopened.objects)).toEqual(persistent(result.objects));
    expect(getDb().query("SELECT * FROM piclaw_schema_migrations WHERE owner='piclaw-agent-sessions'").all()).toEqual(before.receipts);
  } finally { closeDatabase(); }
});
