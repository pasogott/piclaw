import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHostOperationAuthority } from "../../runtime/durable-engine/src/host-operation-authority.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";

async function fixture() {
  const root = new Database(":memory:");
  installTerminalSettlementCompositionSchema(root);
  const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {} }));
  const chatJid = "web:authority";
  const source = value(await work.acceptSource(sealed({ effect: effect("authority:accept"), chatJid,
    sourceId: "authority:source", kind: "message" as const, payloadRef: "authority:payload",
    targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("authority:claim"), chatJid,
    expectedFrontier: 0, newOperationId: "authority:operation", claimedAt: at })))!;
  const inputs = [{ incarnation: "authority:copy", conversationId: 2 as never, chatJid, branchId: "main",
    operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId,
    payloadRef: source.payloadRef, requestId: "authority:request", requestHash: "a".repeat(64), submissionId: 42 as never }];
  const before = { operation: claimed.operation, inputs };
  const operation = value(await work.bindHarness(sealed({ effect: effect("authority:bind", claimed.operation.operationId, source.sourceSeq),
    expectedVersion: claimed.operation.version, sessionId: "authority:session", lane: "main",
    harnessOperationId: "42", state: "running" as const, watchGeneration: 1 })));
  root.exec("CREATE TABLE authority_probe (value TEXT)");
  return { root, before, captured: { operation, inputs } };
}

test("host authority requires a bound write harness; pre-ACK readonly checks remain valid without SQL writes", async () => {
  const { root, before } = await fixture();
  try {
    // Roll back the real binding to its committed pre-ACK operation evidence.
    root.query(`UPDATE service_effect_s01_operations SET version=?, harness_state=NULL, harness_operation_id=NULL,
      harness_session_id=NULL, harness_lane=NULL, harness_watch_generation=NULL WHERE operation_id=?`)
      .run(before.operation.version, before.operation.operationId);
    expect(() => createHostOperationAuthority(root, before, () => {})).toThrow("Bound host harness required for writes");
    const readonly = createHostOperationAuthority(root, before, () => {}, true);
    readonly.assertCurrent();
    let called = false;
    const changes = root.query("SELECT total_changes() AS n").get();
    expect(() => readonly.write(() => { called = true; })).toThrow("Read-only host operation authority");
    expect(called).toBe(false);
    expect(root.query("SELECT total_changes() AS n").get()).toEqual(changes);
  } finally { root.close(); }
});

test("host authority checks exact operation, harness and claimed source evidence", async () => {
  const { root, captured } = await fixture();
  try {
    const authority = createHostOperationAuthority(root, captured, () => {});
    const readonly = createHostOperationAuthority(root, captured, () => {}, true);
    authority.assertCurrent(); readonly.assertCurrent();
    const mutations = [
      "UPDATE service_effect_s01_operations SET version=version+1",
      "UPDATE service_effect_s01_operations SET phase='cancelling'",
      "UPDATE service_effect_s01_operations SET cancellation_source_id='revoked'",
      "UPDATE service_effect_s01_chats SET active_operation_id=NULL",
      "UPDATE service_effect_s01_operations SET harness_watch_generation=harness_watch_generation+1",
      "UPDATE service_effect_s01_operations SET harness_session_id='other'",
      "UPDATE service_effect_s01_operations SET harness_operation_id='other'",
      "UPDATE service_effect_s01_operations SET harness_lane='other'",
      "UPDATE service_effect_s01_sources SET payload_ref='other'",
      "UPDATE service_effect_s01_sources SET source_id='other'",
      "DELETE FROM service_effect_s01_operation_sources",
    ];
    for (const sql of mutations) {
      root.exec("SAVEPOINT mutation");
      try {
        root.exec(sql);
        expect(() => authority.assertCurrent()).toThrow(/Stale host (operation|source) authority/);
        expect(() => readonly.assertCurrent()).toThrow(/Stale host (operation|harness|source) authority/);
        let called = false;
        expect(() => authority.write(() => { called = true; })).toThrow(/Stale host/);
        expect(called).toBe(false);
      } finally { root.exec("ROLLBACK TO mutation; RELEASE mutation"); }
    }
  } finally { root.close(); }
});

test("host writes use root IMMEDIATE transaction and roll back callback work when post-check or callback fails", async () => {
  const { root, captured } = await fixture();
  let allowed = true;
  try {
    const authority = createHostOperationAuthority(root, captured, () => { if (!allowed) throw Error("Owner revoked"); });
    expect(() => authority.write(() => {})).toThrow('Admitted host write transaction required');
    expect(await authority.admitWrite(() => authority.write(() => { expect(root.inTransaction).toBe(true); root.exec("INSERT INTO authority_probe VALUES ('kept')"); return 7; }))).toBe(7);
    await expect(authority.admitWrite(() => {
      root.exec("INSERT INTO authority_probe VALUES ('rollback'); UPDATE service_effect_s01_operations SET version=version+1");
    })).rejects.toThrow("Stale host operation authority");
    authority.assertCurrent();
    await expect(authority.admitWrite(() => { root.exec("INSERT INTO authority_probe VALUES ('owner')"); allowed = false; })).rejects.toThrow("Owner revoked");
    allowed = true;
    await expect(authority.admitWrite(() => { root.exec("INSERT INTO authority_probe VALUES ('throw')"); throw Error("Callback failed"); })).rejects.toThrow("Callback failed");
    expect(root.query("SELECT * FROM authority_probe").all()).toEqual([{ value: "kept" }]);
    allowed = false;
    expect(() => authority.assertCurrent()).toThrow("Owner revoked");
  } finally { root.close(); }
});
