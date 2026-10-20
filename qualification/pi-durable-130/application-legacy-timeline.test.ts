import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { captureLegacyTimeline, verifyLegacyTimeline, assertLegacyTimelineReceipt, recordLegacyTimeline, ApplicationLegacyTimeline } from "../../runtime/durable-engine/src/application-legacy-timeline.js";
import { openFixture, context } from "./src/fixture.js";
const owner = () => {};
function database() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE messages(id TEXT, chat_jid TEXT, content TEXT, attachments BLOB, extra TEXT); INSERT INTO messages VALUES ('old','chat','hello',X'0102',NULL)");
  return db;
}
test("immutable full-row capture, closed receipt, deletion and new-native policy", () => {
  const db = database();
  try {
    const receipt = captureLegacyTimeline(db, owner);
    expect(Object.isFrozen(receipt.rows[0])).toBe(true);
    expect(captureLegacyTimeline(db, owner)).toEqual(receipt);
    expect(() => assertLegacyTimelineReceipt({ ...receipt, authority: true })).toThrow();
    expect(() => assertLegacyTimelineReceipt({ ...receipt, rows: [...receipt.rows, ...receipt.rows] })).toThrow();
    expect(() => assertLegacyTimelineReceipt({ ...receipt, rows: [{ rowid: 0, sha256: receipt.rows[0].sha256 }] })).toThrow();
    db.exec("INSERT INTO messages VALUES ('native','chat','new',NULL,NULL)");
    expect([...verifyLegacyTimeline(db, receipt)]).toEqual([1]);
    db.exec("DELETE FROM messages WHERE rowid=1");
    expect([...verifyLegacyTimeline(db, receipt)]).toEqual([]);
    db.exec("INSERT INTO messages(rowid,id,chat_jid,content) VALUES(1,'forged','chat','hello')");
    expect(() => verifyLegacyTimeline(db, receipt)).toThrow();
  } finally { db.close(); }
});
for (const assignment of ["content='changed'", "chat_jid='moved'", "attachments=X'03'", "extra='changed'", "id='reused'"]) {
  test(`reject retained row mutation: ${assignment}`, () => {
    const db = database();
    try {
      const receipt = captureLegacyTimeline(db, owner);
      db.exec(`UPDATE messages SET ${assignment}`);
      expect(() => verifyLegacyTimeline(db, receipt)).toThrow();
    } finally { db.close(); }
  });
}
test("owner assertion is mandatory; >1000 historical rows are metadata", () => {
  const db = database();
  try {
    expect(() => captureLegacyTimeline(db, () => { throw Error("not owner"); })).toThrow("not owner");
    db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1100) INSERT INTO messages(id,content) SELECT x,'history' FROM n");
    expect(captureLegacyTimeline(db, owner).rows.length).toBe(1101);
  } finally { db.close(); }
});
test("public SDK one-shot commit, exact replay and full initial equality", async () => {
  const db = database();
  const fixture = await openFixture({ acquired: true });
  const { root, harness } = fixture;
  try {
    const receipt = captureLegacyTimeline(db, owner);
    db.exec("INSERT INTO messages VALUES ('later','chat','new',NULL,NULL)");
    await expect(root.commit(tx => recordLegacyTimeline(tx, root.id, db, receipt, owner), context)).rejects.toThrow();
    db.exec("DELETE FROM messages WHERE id='later'");
    await root.commit(tx => recordLegacyTimeline(tx, root.id, db, receipt, owner), context);
    db.exec("DELETE FROM messages");
    await root.commit(tx => recordLegacyTimeline(tx, root.id, db, receipt, owner), context);
    await root.commit(async tx => { expect((await tx.doc(ApplicationLegacyTimeline, root.id)).receipt).toEqual(receipt); }, context);
    const changed = captureLegacyTimeline(db, owner);
    await expect(root.commit(tx => recordLegacyTimeline(tx, root.id, db, changed, owner), context)).rejects.toThrow();
    await expect(root.commit(tx => recordLegacyTimeline(tx, root.id, db, receipt, () => { throw Error("lost"); }), context)).rejects.toThrow();
  } finally { await harness.close(context); db.close(); }
});
