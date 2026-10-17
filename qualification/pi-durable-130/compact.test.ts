import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BunSqliteDatabase, HostConversationRuntime } from "../../runtime/durable-engine/src/index.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { Harness, InboxDoc } from "../../runtime/durable-engine/qualification/durable.ts";
import { TestOwner } from "./src/ownership.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { installServiceWorkSchema } from "../../runtime/src/service-effects/current-piclaw/service-work-schema.js";
import { createDurableConversationAdapter } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { AgentRuntimeFacade } from "../../runtime/src/agent-pool/runtime-facade.js";

test("public manual compact: real model summary, idle admission, observer detach, host acceptance, facade and reopen continuation", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "compact-"));
  const path = join(dir, "shared.db"), owner = TestOwner.acquire(path), root = new Database(path);
  installServiceWorkSchema(root);
  let sql!: BunSqliteDatabase, stale = false, beforeGuard: (() => void) | undefined;
  const openStorage = () => { sql = new BunSqliteDatabase(path, { root, assertOwner() { owner.assert(); if (stale) throw Error("stale owner"); } }); return SqliteStorage.open(sql); };
  const f = await openFixture(owner, () => {}, openStorage), id = f.root.id;
  await f.close();
  const unused = async () => { throw Error("legacy/effect forbidden"); };
  const binding = { incarnation: "compact", chatJid: "web:compact", branchId: "main", conversationId: id };
  let runtime!: HostConversationRuntime, approvals = 0;
  const config = { incarnation: "compact", owner: { assert: () => owner.assert(), release() {} }, openStorage,
    withIdleModelGuard: <T>(body: () => Promise<T>) => { beforeGuard?.(); return sql.withIdleModelGuard(body); },
    harnessOptions: { models: f.models, registry: f.registry, settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } },
    work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
    terminal: { getTerminal: unused, commitTerminal: unused } as any,
    bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
    conversationFor: () => id, existingConversationIds: [id],
    authorizeScheduling: async () => { approvals++; expect((await runtime.inspectAuthority()).inspection.tasks).toHaveLength(0); },
    putAnswer: unused, sessionId: "original-session", lane: "compact", generation: 1, now: () => new Date(0).toISOString() };
  const app = () => {
    const adapter = createDurableConversationAdapter({ incarnation: "compact", manifest: [binding], runtime });
    return new AgentRuntimeFacade({ pool: new Map(), durableSessions: new Map([[binding.chatJid, adapter.sessionPosition(binding.chatJid, "main", "original-session")]]),
      getOrCreateRuntime: unused, modelRegistry: { getAll: () => f.models.getModels() } as any, modelRuntime: {} as any,
      authPath: "unused", clearAttachments() {}, refreshRuntime: unused });
  };
  const command = { type: "compact" as const, raw: "/compact" };
  try {
    runtime = await HostConversationRuntime.open(config, context);
    expect((await app().applyControlCommand(binding.chatJid, command)).message).toBe("Nothing to compact.");
    expect(f.host.modelCalls).toBe(0);
    stale = true;
    expect(() => runtime.compactSession(binding)).toThrow(); stale = false;
    root.exec("BEGIN");
    await expect(runtime.compactSession(binding)).rejects.toThrow("Root connection transaction active");
    root.exec("ROLLBACK");
    // A failed guard transaction seals the public storage; reopen before continuing.
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('pending',NULL)").run();
    root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='pending'").run();
    root.query("INSERT INTO service_effect_s01_sources VALUES ('pending',1,'source',?,'message','disposed','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
    beforeGuard = () => root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    await expect(runtime.compactSession(binding)).rejects.toThrow("not idle"); beforeGuard = undefined;
    expect(f.host.modelCalls).toBe(0);
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    await runtime.close();
    let harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    let conversation = (await harness.conversation(id, context))!;
    for (let i = 0; i < 3; i++) {
      const submission = await conversation.submit({ type: "input", content: `history-${i} ` + "detail ".repeat(100), requestId: `history-${i}` }, context);
      expect((await submission.wait(context)).status).toBe("done");
    }
    const before = await conversation.context(context);
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    const entered = barrier(); f.host.modelHold = barrier(); f.host.onModelEnter = () => entered.release();
    f.host.finalContent = [{ type: "text", text: "REAL MODEL CHECKPOINT: retain history and continue" }];
    const abort = new AbortController();
    const observer = runtime.compactSession(binding, "retain decisions", abort.signal);
    await entered.promise;
    abort.abort(); await expect(observer).rejects.toThrow();
    expect(() => runtime.compactSession(binding)).toThrow("not idle");
    await expect(runtime.setSessionModel(binding, { provider: "qualification", modelId: "synthetic" })).rejects.toThrow("not idle");
    // Host acceptance remains writable after task admission. It must not poison SDK summary writes.
    root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    const accepted = { incarnation: "compact", conversationId: id, chatJid: binding.chatJid, branchId: "main",
      operationId: "accepted-during-compact", sourceSeq: 1, sourceId: "same-source", payloadRef: "same-payload",
      requestId: "same-request", requestHash: "a".repeat(64) };
    // Neither entry may escape when only the compact observer was cancelled.
    let admissionsFinished = 0;
    const waiting = [runtime.submit(accepted), runtime.submitIntent(accepted)].map(p => p.then(
      () => { admissionsFinished++; return "submitted"; }, error => { admissionsFinished++; return error.message; }));
    await Bun.sleep(10);
    expect(admissionsFinished).toBe(0);
    const closing = runtime.close(); // Seals waiting admissions before joining compaction.
    f.host.modelHold.release();
    await closing; // Joins actual maintenance, not the cancelled observer.
    expect(await Promise.all(waiting)).toEqual(["Runtime closed", "Runtime closed"]);
    expect(root.query("SELECT state FROM service_effect_s01_sources").get()).toEqual({ state: "pending" });
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    f.host.modelHold = undefined; f.host.onModelEnter = undefined;
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    conversation = (await harness.conversation(id, context))!;
    const after = await conversation.context(context);
    expect(after.head?.kind).toBe("pi.compaction");
    expect(JSON.stringify(after.messages)).toContain("REAL MODEL CHECKPOINT");
    expect(after.entries.length).toBeLessThan(before.entries.length);
    const rows = await conversation.entries({ order: "ascending" }, 100, undefined, context);
    expect(rows.items.filter(e => e.kind === "pi.compaction")).toHaveLength(1);
    const follow = await conversation.submit({ type: "input", content: "continue", requestId: "follow" }, context);
    await follow.wait(context);
    expect(JSON.stringify(f.host.admissions.at(-1))).toContain("requestHash");
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    expect(await runtime.readSessionModel(binding)).toBe("qualification/synthetic");
    // Provider failure is terminal failure, never a false success.
    f.host.modelAllowed = false;
    await expect(runtime.compactSession(binding)).rejects.toThrow("did not complete");
    f.host.modelAllowed = true;
    const result = await app().applyControlCommand(binding.chatJid, command);
    expect(result.status).toBe("success"); expect(result.sessionGeneration).toBe("original-session");
    expect(result.contextUsage?.tokens).toBeNull();
    expect(f.host.credentialLookups).toBe(0); expect(approvals).toBeGreaterThan(0);
    await runtime.close();
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    conversation = (await harness.conversation(id, context))!;
    await conversation.commit(async tx => { (await tx.doc(InboxDoc, id)).items.push({ id: 999 as any, mode: "write", entry: { kind: "qualification.pending" } }); }, context);
    await harness.close(context); runtime = await HostConversationRuntime.open(config, context);
    await expect(runtime.compactSession(binding)).rejects.toThrow("not idle");
  } finally { if (root.inTransaction) root.exec("ROLLBACK"); if (runtime) await runtime.close(); root.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true }); }
}, 20000);
