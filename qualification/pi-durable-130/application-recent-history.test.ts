import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { captureLegacyTimeline } from "../../runtime/durable-engine/src/application-legacy-timeline.js";
import { selectApplicationRecentHistory, validateRecentHistoryScopes, recentHistoryHash, recordApplicationMigration } from "../../runtime/durable-engine/src/application-recent-history.js";
import { openFixture, context } from "./src/fixture.js";
import { CompactionEntry } from "../../runtime/durable-engine/qualification/durable.ts";
const scope = { chatJid: "web:fixture", branchId: "branch", owner: "fixture operator" };
const assistant = { role: "assistant" as const, content: [{ type: "text" as const, text: "answer" }], api: "openai-completions" as const, provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as const, timestamp: 2 };
function source() {
  const session = SessionManager.inMemory();
  session.appendMessage({ role: "system", content: "never import recorded policy" });
  session.appendMessage({ role: "user", content: "question", timestamp: 1 });
  session.appendMessage(assistant);
  return session;
}
test("typed public native branch selection and bounded complete turns", () => {
  const session = source(), item = selectApplicationRecentHistory(session, scope);
  expect(item.messages.map(m => m.role)).toEqual(["user", "assistant"]);
  expect(item.sourceSessionId).toBe(session.getSessionId());
  expect(item.sourceLeafId).toBe(session.getLeafId());
  for (const messages of [[assistant], [...item.messages, { role: "user" as const, content: "pending", timestamp: 3 }], [{ role: "user" as const, content: "x".repeat(8 * 1024 * 1024), timestamp: 1 }, assistant], Array(501).fill(item.messages).flat()]) {
    expect(() => validateRecentHistoryScopes([{ ...item, messages, sourceHash: recentHistoryHash(messages) }], [scope])).toThrow();
  }
  expect(() => validateRecentHistoryScopes([item, item], [scope])).toThrow();
  expect(() => validateRecentHistoryScopes([item], [])).toThrow();
});
test("public atomic migration marker exact replay survives actual disk reopen", async () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "recent-history-")), path = join(dir, "sdk.sqlite");
  const db = new Database(join(dir, "host.sqlite"));
  db.exec("CREATE TABLE messages(id TEXT,content TEXT); INSERT INTO messages VALUES('old','unchanged')");
  const timeline = captureLegacyTimeline(db, () => {}), recent = selectApplicationRecentHistory(source(), scope);
  const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
  let fixture = await open();
  try {
    const child = await fixture.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const bindings = [{ ...scope, conversationId: child.id }], migration = { timeline, recentHistory: [recent] };
    await expect(fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, db, { ...migration, recentHistory: [{ ...recent, branchId: "foreign" }] }, bindings, () => {}), context)).rejects.toThrow();
    expect((await child.entries({}, 10, undefined, context)).items).toHaveLength(0);
    await fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, db, migration, bindings, () => {}), context);
    expect((await child.context(context)).messages).toEqual(recent.messages);
    await fixture.harness.close(context);
    fixture = await open();
    await fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, db, migration, bindings, () => {}), context);
    const reopened = (await fixture.harness.conversation(child.id, context))!;
    expect((await reopened.entries({}, 10, undefined, context)).items).toHaveLength(recent.messages.length);
    await expect(fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, db, { ...migration, recentHistory: [{ ...recent, owner: "different" }] }, bindings, () => {}), context)).rejects.toThrow();
    db.exec("UPDATE messages SET content='tampered'");
    await expect(fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, db, migration, bindings, () => {}), context)).rejects.toThrow();
  } finally { await fixture.harness.close(context); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("completed boundaries preserve summaries and reject malformed tool rounds", () => {
  const item = selectApplicationRecentHistory(source(), scope);
  const user = item.messages[0];
  const call = { ...assistant, content: [{ type: "toolCall" as const, id: "call", name: "read", arguments: {} }], stopReason: "toolUse" as const };
  const result = { role: "toolResult" as const, toolCallId: "call", toolName: "read", content: [{ type: "text" as const, text: "result" }], isError: false, timestamp: 3 };
  const check = (messages: any[]) => validateRecentHistoryScopes([{ ...item, messages, sourceHash: recentHistoryHash(messages) }], [scope]);
  expect(() => check([user, user, assistant])).not.toThrow();
  expect(() => check([user, call, result, assistant])).not.toThrow();
  for (const messages of [
    [user, { ...assistant, stopReason: "deferred" }],
    [user, { ...assistant, stopReason: "toolUse" }],
    [user, { ...call, stopReason: "stop" }, result, assistant],
    [user, call, { ...result, toolName: "bash" }, assistant],
    [user, call, assistant, result],
    [user, call, user, result, assistant],
    [user, { ...assistant, api: undefined }],
  ]) expect(() => check(messages)).toThrow();
});
test("copied message entries support public compaction heads without retaining old turns", async () => {
  const host = new Database(":memory:");
  host.exec("CREATE TABLE messages(id TEXT, content TEXT)");
  const fixture = await openFixture({ acquired: true });
  try {
    const child = await fixture.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const base = selectApplicationRecentHistory(source(), scope);
    const messages = [...base.messages, { role: "user" as const, content: "recent question", timestamp: 3 }, { ...assistant, content: [{ type: "text" as const, text: "recent answer" }], timestamp: 4 }];
    const recent = { ...base, messages, sourceHash: recentHistoryHash(messages) };
    const migration = { timeline: captureLegacyTimeline(host, () => {}), recentHistory: [recent] };
    const bindings = [{ ...scope, conversationId: child.id }];
    await fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, host, migration, bindings, () => {}), context);
    const entries = (await child.entries({}, 10, undefined, context)).items.sort((a, b) => a.id - b.id);
    expect(entries).toHaveLength(4);
    const summary = { role: "user" as const, content: "Earlier turn summarised", timestamp: 5 };
    await child.commit(tx => tx.appendEntry(CompactionEntry, child.id, { head: entries[2]!.id, data: { reason: "manual" }, model: [summary] }), context);
    expect((await child.context(context)).messages).toEqual([summary, ...messages.slice(2)]);
    await fixture.root.commit(tx => recordApplicationMigration(tx, fixture.root.id, host, migration, bindings, () => {}), context);
    expect((await child.context(context)).messages).toEqual([summary, ...messages.slice(2)]);
  } finally { await fixture.harness.close(context); host.close(); }
});
