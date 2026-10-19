import type Database from "bun:sqlite";
import { getDeferredQueuedFollowups } from "../../src/db.js";
import { accountCommittedGoalBatch } from "./host-goal-usage.js";
import type { AcceptedInput, HostConversationRuntime } from "./host-runtime.js";
import type { TerminalDatabaseEffect, TerminalCommit } from "../../src/service-effects/contracts/terminal-settlement-store.js";
import { withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";

/** Only usable inside applyTerminalEffects, after the exact terminal record was
 * inserted on this connection. Never grants authority from an old receipt alone. */
export function withGoalSettlementAuthority<T>(root: Database, commit: Readonly<TerminalCommit>, assertTerminalScope: (expected: Readonly<TerminalCommit>) => void,
  body: (authority: ExtensionKvAuthority) => T): T {
  let chatJid: string;
  const assertCurrent = () => {
    assertTerminalScope(commit);
    if (!root.inTransaction) throw Error("Goal settlement transaction required");
    const row = root.query(`SELECT c.chat_jid,c.operation_id,c.operation_version,c.disposition,o.phase FROM service_effect_s02_commits c
      JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id WHERE c.operation_id=?`).get(commit.operationId) as
      { chat_jid: string; operation_id: string; operation_version: number; disposition: string; phase: string } | null;
    if (!row || row.operation_id !== commit.operationId || row.operation_version !== commit.operationVersion || row.disposition !== commit.disposition || row.phase !== "terminal")
      throw Error("Exact Goal terminal commit required");
    chatJid = row.chat_jid;
  };
  assertCurrent();
  const authority: ExtensionKvAuthority = { extensionId: "goal", chatJid: chatJid!, assertCurrent,
    write(run) { assertCurrent(); const result = run(); assertCurrent(); return result; } };
  assertCurrent();
  const result = withExtensionKvAuthority(authority, () => body(authority));
  assertCurrent();
  return result;
}

/** Recovery accounting bound to the original input and committed tool evidence.
 * Never infer terminal permission from current Goal status alone. */
type GoalContinuationState = { goal_id: string; lifecycle_generation: number; status: string; chat_jid: string };
type GoalPlanState = { available: boolean; total: number; allCompleted: boolean; fingerprint: string; plan: { step: string; status: string }[] };
interface GoalContinuationAddon {
  shouldContinueGoalAfterMessage(message: unknown): boolean;
  applyGoalPlanProgress(goal: any, plan: GoalPlanState, hadToolActivity: boolean): { goal: any; decision: { action: string; completionProbeCount?: number } };
  prepareGoalInput(text: string, chat: string): { decision: { action: string; text?: string } };
}
export function createHostGoalSettlement(addon: Parameters<typeof accountCommittedGoalBatch>[0], options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "readAcceptedInputText" | "readSettledUsage" | "hasSettledGoalTerminalResult">;
  assertOwner(): void;
  /** Trusted host reads existing persisted Plan and verified committed activity.
   * Queue admission must be synchronous, SQL-only and use the existing source port. */
  continuation?: {
    addon: GoalContinuationAddon;
    prepare(input: AcceptedInput): Promise<{ message: unknown; plan: GoalPlanState; hadToolActivity: boolean }>;
    admit(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }): number | null;
  };
}): (input: AcceptedInput) => Promise<TerminalDatabaseEffect | undefined> {
  return async input => {
    const captured = Object.freeze({ ...input });
    options.assertOwner();
    const runtime = options.runtime();
    const text = await runtime.readAcceptedInputText(captured);
    options.assertOwner();
    const identity = addon.goalInputIdentity(text);
    if (identity === null) return undefined;
    if (!identity) throw Error("Invalid accepted Goal identity");
    const goal = withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.chatJid,
      assertCurrent: options.assertOwner, write() { throw Error("Goal preparation is read-only"); } }, () => addon.loadThreadGoal(captured.chatJid));
    let proof: { goalId: string; generation: number; status: "complete" | "stopped" } | undefined;
    if (goal && (goal.status === "complete" || goal.status === "stopped")) {
      proof = { goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status };
      if (identity.goalId !== goal.goal_id || identity.generation + 1 !== goal.lifecycle_generation ||
        !await runtime.hasSettledGoalTerminalResult(captured, proof)) throw Error("Goal terminal operation proof required");
    }
    const receipts = await runtime.readSettledUsage(captured);
    options.assertOwner();
    if (!receipts?.length) throw Error("Missing committed Goal usage");
    // Detach public evidence before crossing the asynchronous payload boundary
    // in commitTerminal; the transaction still rechecks lifecycle and ownership.
    const usage = Object.freeze(receipts.map(receipt => Object.freeze({ ...receipt })));
    const progress = options.continuation ? structuredClone(await options.continuation.prepare(captured)) : undefined;
    options.assertOwner();
    return (commit, scope) => {
      options.assertOwner();
      if (commit.operationId !== captured.operationId || commit.disposition !== "completed") throw Error("Exact Goal operation completion required");
      withGoalSettlementAuthority(options.root, commit, scope, authority => {
        if (authority.chatJid !== captured.chatJid) throw Error("Goal settlement chat conflict");
        accountCommittedGoalBatch(addon, authority, [text], usage, proof);
        if (!options.continuation || !progress || !options.continuation.addon.shouldContinueGoalAfterMessage(progress.message)) return;
        const current = addon.loadThreadGoal(captured.chatJid) as GoalContinuationState | null;
        if (!current || current.status !== "active") return;
        // This check and the guard mutation/admission share the terminal write.
        if (getDeferredQueuedFollowups(captured.chatJid).length || options.root.query(
          "SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed') LIMIT 1",
        ).get(captured.chatJid)) return;
        const next = options.continuation.addon.applyGoalPlanProgress(current, progress.plan, progress.hadToolActivity);
        if (next.decision.action === "stop") return;
        const prompt = `${next.decision.action === "finalize" ? "🎯 Finalize goal:" : "🎯 Continue goal:"} ${next.goal.objective}`;
        const prepared = options.continuation.addon.prepareGoalInput(prompt, captured.chatJid).decision;
        if (prepared.action === "handled") throw Error("Goal continuation lifecycle changed");
        const queued = options.continuation.admit({ sourceId: `goal-continuation:${captured.operationId}`,
          chatJid: captured.chatJid, text: prepared.text ?? prompt, queuedAt: commit.committedAt });
        if (queued === null) throw Error("Goal continuation admission changed");
        authority.assertCurrent();
      });
      return undefined;
    };
  };
}
