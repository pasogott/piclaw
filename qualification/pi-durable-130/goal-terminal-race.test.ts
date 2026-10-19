import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createHostGoalTerminalFence } from "../../runtime/durable-engine/src/host-goal-terminal.js";
import { value, effect, sealed, at } from "./src/host-handoff.js";
import { context } from "./src/fixture.js";

for (const change of ["none", "replace", "generation", "status", "delete"] as const) test(`Goal terminal tool fence rechecks lifecycle after proof: ${change}`, async () => {
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const chatJid = `web:goal-race-${change}`;
  const source = value(await work.acceptSource(sealed({ effect: effect("accept"), chatJid, sourceId: "race", kind: "message", payloadRef: "race", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("claim"), chatJid, expectedFrontier: 0, newOperationId: "race-op", claimedAt: at })))!;
  const operation = value(await work.bindHarness(sealed({ effect: effect("bind", claimed.operation.operationId, source.sourceSeq), expectedVersion: claimed.operation.version,
    sessionId: "race-session", lane: "main", harnessOperationId: "42", state: "running", watchGeneration: 1 })));
  const captured = { operation, inputs: [{ incarnation: "race-copy", conversationId: 2 as never, chatJid, branchId: "main", operationId: operation.operationId,
    sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: "race", requestHash: "a".repeat(64), submissionId: 42 as never }], runTaskId: 9 as never };
  let goal: { goal_id: string; lifecycle_generation: number; status: string } | null = { goal_id: "original", lifecycle_generation: 2, status: "complete" };
  const extension = createHostGoalTerminalFence({ loadThreadGoal() { return goal && { ...goal }; } }, { root: db, assertOwner() {}, runtime: () => ({
    async capturePendingToolSource() { return captured; },
    async hasGoalTerminalResult() {
      await Promise.resolve();
      if (change === "replace") goal!.goal_id = "replacement";
      if (change === "generation") goal!.lifecycle_generation++;
      if (change === "status") goal!.status = "active";
      if (change === "delete") goal = null;
      return false; // Old operation may not block a later turn, unless lifecycle changed during proof.
    },
  }) });
  try {
    const hook = extension.hooks![0]!.handlers.beforeTool!;
    const invoke = () => hook({ id: "pending", name: "get_goal", arguments: {} }, { conversationId: 2, taskId: 10 } as never, context);
    if (change === "none") expect(await invoke()).toBeUndefined();
    else await expect(invoke()).rejects.toThrow("Goal tool lifecycle changed");
  } finally { closeDatabase(); }
});
