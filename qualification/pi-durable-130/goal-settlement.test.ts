import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { requireExtensionKvAuthority, withExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { createHostGoalSettlement, withGoalSettlementAuthority } from "../../runtime/durable-engine/src/host-goal-settlement.js";
import { QueuedFollowupLifecycleService } from "../../runtime/src/channels/web/runtime/queued-followup-lifecycle-service.js";
import { getDeferredQueuedFollowups } from "../../runtime/src/db.js";
import { accountCommittedGoalBatch } from "../../runtime/durable-engine/src/host-goal-usage.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { value, effect, sealed, at } from "./src/host-handoff.js";

for (const mode of ["continue", "pending", "error", "stalled", "finalize"] as const) test(`actual Goal terminal continuation is atomic and policy scoped: ${mode}`, async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const chatJid = "web:goal-settlement";
  const setup = { extensionId: "goal", chatJid, assertCurrent() {}, write<T>(run: () => T) { return db.transaction(run).immediate(); } };
  const text = withExtensionKvAuthority(setup, () => { addon.createThreadGoal(chatJid, "Terminal usage");
    if (mode === "stalled") {
      const plan = { available: true, total: 1, allCompleted: false, fingerprint: "native-plan", plan: [{ step: "Continue work", status: "pending" }] };
      addon.applyGoalPlanProgress(addon.loadThreadGoal(chatJid), plan, false);
      addon.applyGoalPlanProgress(addon.loadThreadGoal(chatJid), plan, false);
    }
    return addon.prepareGoalInput("🎯 Continue goal: Terminal usage", chatJid).decision.text; });
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const source = value(await work.acceptSource(sealed({ effect: effect("accept"), chatJid, sourceId: "input", kind: "message", payloadRef: "input", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("claim"), chatJid, expectedFrontier: 0, newOperationId: "op", claimedAt: at })))!;
  const bound = value(await work.bindHarness(sealed({ effect: effect("bind", "op", source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: "session", lane: "main", harnessOperationId: "1", state: "running", watchGeneration: 1 })));
  const finish = sealed({ effect: effect("finish", "op", source.sourceSeq), expectedVersion: bound.version, expectedHarness: bound.harness! });
  const finished = value(await work.finishHarness({ ...finish, effect: { ...finish.effect, requestHash: hashCanonicalRequest({ method: "finishHarness.v1", ...finish }) } }));
  const queue = new QueuedFollowupLifecycleService();
  if (mode === "pending") value(await work.acceptSource(sealed({ effect: effect("pending-user"), chatJid, sourceId: "pending-user", kind: "message", payloadRef: "pending-user", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const continuationId = "goal-continuation:op";
  let planFingerprint = "stale-preparation-plan", planReads = 0;
  const prepare = createHostGoalSettlement(addon, { root: db, assertOwner() {}, runtime: () => ({
    async readAcceptedInputText() { return text; },
    async readSettledUsage() { return [{ conversationId: 1, entryId: 5, tokens: 7 }]; },
    async hasSettledGoalTerminalResult() { return false; },
  }), continuation: {
    addon,
    async prepare() { return { message: { role: "assistant", stopReason: mode === "error" ? "error" : "stop" }, hadToolActivity: false }; },
    readPlan(chat, assertCurrent) {
      assertCurrent(); expect(db.inTransaction).toBe(true); expect(chat).toBe(chatJid); planReads++;
      return { available: true, total: 1, allCompleted: mode === "finalize", fingerprint: planFingerprint,
        plan: [{ step: "Continue work", status: mode === "finalize" ? "completed" : "pending" }] };
    },
    admit(next) { return queue.enqueueAcceptedFollowupOnce(next.sourceId, next.chatJid, next.text, next.queuedAt,
      { source: "goal.continuation" }, ({ chatJid, item, database }) => {
        work.acceptSourceInTransaction(sealed({ effect: effect(`accept:${item.source_id}`), chatJid, sourceId: item.source_id,
          kind: "message", payloadRef: `queued-source:${item.source_id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false }), database);
      }, true); },
  } });
  const apply = await prepare({ incarnation: "fixture", conversationId: 1, chatJid, branchId: "main", operationId: "op", sourceSeq: source.sourceSeq,
    sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: "request", requestHash: "a".repeat(64) });
  planFingerprint = "native-plan"; // Change AFTER evidence preparation, BEFORE terminal transaction.
  expect(planReads).toBe(0);
  let fail = true, calls = 0, retained: (() => void) | undefined;
  const terminal = value(createCurrentPiclawTerminalSettlementStore(db, new InMemoryEffectPayloadResolver(), {
    hitFault: () => false, recordTrace() {}, validateOwnership: () => true,
    applyTerminalEffects(commit, scope) {
      calls++;
      expect(() => withGoalSettlementAuthority(db, { ...commit, operationId: "other-op" }, scope, () => undefined)).toThrow("Exact terminal effect commit required");
      expect(() => withGoalSettlementAuthority(db, { ...commit }, scope, () => undefined)).toThrow("Exact terminal effect commit required");
      withGoalSettlementAuthority(db, commit, scope, authority => {
        retained = authority.assertCurrent;
      });
      apply!(commit, scope);
      if (fail) throw Error("rollback after Goal mutation");
      return undefined;
    },
  }));
  try {
    const request = sealed({ effect: effect("terminal", "op", source.sourceSeq), expectedChatJid: chatJid, expectedVersion: finished.version, expectedHarness: finished.harness!, disposition: "completed" as const,
      errorCode: null, terminalAuthorityRef: null,
      timeline: { mode: "none" as const, chatJid, placeholderRowId: null, contentRef: null, threadId: null, mediaIds: [], contentBlocksRef: null }, sourceDispositions: [{ sourceSeq: source.sourceSeq, state: "consumed" as const, reason: "completed" }], outboxIntents: [], committedAt: at });
    expect((await terminal.commitTerminal(request)).ok).toBe(false);
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: 0 });
    expect(extensionKvGet("goal", "committed-usage:1", "chat", chatJid)).toBeNull();
    expect(getDeferredQueuedFollowups(chatJid)).toHaveLength(0);
    expect(db.query("SELECT * FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toHaveLength(0);
    fail = false;
    value(await terminal.commitTerminal(request));
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: 7 });
    value(await terminal.commitTerminal(request));
    expect(calls).toBe(2);
    expect(planReads).toBe(mode === "pending" || mode === "error" ? 0 : 2); // Replay never re-reads.
    const queued = getDeferredQueuedFollowups(chatJid);
    const continues = mode === "continue" || mode === "finalize";
    expect(queued).toHaveLength(continues ? 1 : 0);
    if (continues) {
    expect(queued[0]).toMatchObject({ source_id: continuationId, source_accepted: true });
    expect(queued[0]!.queuedContent).toContain("Terminal usage");
    expect(queued[0]!.queuedContent).toContain("<piclaw_goal_input>");
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject(mode === "finalize"
      ? { status: "active", completion_probe_count: 1, completion_plan_fingerprint: "native-plan" }
      : { no_progress_turns: 1, last_auto_continue_fingerprint: "native-plan" });
    expect(db.query("SELECT source_id,state FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toEqual([{ source_id: continuationId, state: "pending" }]);
    } else {
      expect(db.query("SELECT * FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toHaveLength(0);
      expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject(mode === "stalled"
        ? { status: "stopped", stop_reason: "no_progress", lifecycle_generation: 2 }
        : { status: "active", no_progress_turns: 0 });
    }
    expect(() => retained!()).toThrow("scope ended");
    expect(() => db.transaction(() => retained!()).immediate()).toThrow("scope ended");
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); }
});
