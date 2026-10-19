import type Database from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { accountCommittedGoalBatch, isGoalBudgetWrapup } from "./host-goal-usage.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type GoalState = { status: string; goal_id: string; lifecycle_generation: number; deadline_checkpoint?: unknown; budget_limit_reported: boolean };
export function createHostGoalPrompt(addon: {
  loadThreadGoal(chat: string): GoalState | null;
  buildGoalSystemPrompt(goal: any): string;
  buildGoalBudgetLimitPrompt(goal: any): string;
  claimGoalBudgetWrapup(chat: string, expected: { goalId: string; generation: number }): unknown;
  isGoalBudgetInput(text: string): boolean;
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  resolveGoalInput(text: string, chat: string): { action: string };
  accountGoalProgress(chat: string, tokens: number): unknown;
  accountTerminalGoalProgress(chat: string, expected: { goalId: string; generation: number }, tokens: number): unknown;
}, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureRunSource" | "readCapturedInputText" | "hasGoalTerminalResult" | "readCommittedRunUsage">;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const load = addon.loadThreadGoal.bind(addon), build = addon.buildGoalSystemPrompt.bind(addon);
  const beforeRequest: NonNullable<GenerationHooks["beforeRequest"]> = async (request, api) => {
    try {
    options.assertOwner();
    const runtime = options.runtime();
    const captured = await runtime.captureRunSource(api.conversationId, api.taskId);
    const source = { operationId: captured.operation.operationId, conversationId: api.conversationId as number };
    const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
    const scope = <T>(body: () => T) => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid,
      assertCurrent: authority.assertCurrent, write: authority.write }, () => { authority.assertCurrent(); return body(); });
    const texts = await runtime.readCapturedInputText(captured.inputs);
    authority.assertCurrent();
    const autonomous = texts.some(text => addon.goalInputIdentity(text) !== null);
    const budgetWrapup = () => scope(() => isGoalBudgetWrapup(addon, captured.operation.chatJid, texts, source));
    const executable = () => scope(() => {
      const goal = load(captured.operation.chatJid);
      if (goal?.deadline_checkpoint) throw Error("Native Goal deadline checkpoint recovery unavailable");
      if (goal?.status === "usage_limited") throw Error("Native Goal usage-limit recovery unavailable");
      if (goal?.status === "budget_limited" && autonomous && !budgetWrapup()) throw Error("Goal budget input authority unavailable");
    });
    executable();
    let terminalProof: { goalId: string; generation: number; status: "complete" | "stopped" } | undefined;
    for (const text of texts) {
      const denied = scope(() => addon.resolveGoalInput(text, captured.operation.chatJid).action === "handled");
      if (!denied) continue;
      if (budgetWrapup()) continue;
      const identity = addon.goalInputIdentity(text);
      const goal = scope(() => load(captured.operation.chatJid));
      if (!identity || !goal || identity.goalId !== goal.goal_id || identity.generation + 1 !== goal.lifecycle_generation ||
        (goal.status !== "complete" && goal.status !== "stopped") ||
        !await runtime.hasGoalTerminalResult(api.conversationId, api.taskId, {
          goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status,
        })) throw Error("Goal input lifecycle changed");
      authority.assertCurrent();
      terminalProof = { goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status };
      const current = scope(() => load(captured.operation.chatJid));
      if (!current || current.goal_id !== goal.goal_id || current.lifecycle_generation !== goal.lifecycle_generation || current.status !== goal.status)
        throw Error("Goal input lifecycle changed");
    }
    // Ordinary input does not acquire autonomous Goal accounting authority.
    if (texts.length && texts.every(text => addon.goalInputIdentity(text))) {
      const receipts = await runtime.readCommittedRunUsage(api.conversationId, api.taskId);
      authority.assertCurrent();
      if (receipts.length) {
        const writer = createHostOperationAuthority(options.root, captured, options.assertOwner);
        accountCommittedGoalBatch(addon, { extensionId: "goal", chatJid: captured.operation.chatJid, ...writer }, texts, receipts, terminalProof, source);
        if (!terminalProof && !budgetWrapup() && texts.some(text => scope(() => addon.resolveGoalInput(text, captured.operation.chatJid).action === "handled")))
          throw Error("Goal usage changed input lifecycle");
      }
    }
    executable();
    if (budgetWrapup()) {
      const goal = scope(() => load(captured.operation.chatJid))!;
      if (!goal.budget_limit_reported) {
        const writer = createHostOperationAuthority(options.root, captured, options.assertOwner);
        writer.write(() => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid, ...writer }, () =>
          addon.claimGoalBudgetWrapup(captured.operation.chatJid, { goalId: goal.goal_id, generation: goal.lifecycle_generation })));
      }
    }
    return scope(() => {
      const goal = load(captured.operation.chatJid);
      if (goal?.status === "budget_limited" && budgetWrapup()) {
        const prompt = addon.buildGoalBudgetLimitPrompt(goal) + "\nThe goal is already budget_limited. Give the final wrap-up without calling further tools.";
        return { messages: [...request.messages, { role: "user" as const, content: prompt, timestamp: 0 }] };
      }
      if (!goal || (goal.status !== "active")) return request;
      const prompt = build(goal);
      authority.assertCurrent();
      return { messages: [...request.messages, { role: "user" as const, content: prompt, timestamp: 0 }] };
    });
    } catch (error) {
      options.failClosed(error);
      throw Error("Goal request authority unavailable");
    }
  };
  return defineExtension({ name: "app.host-goal-prompt", hooks: [{ task: "pi.generation", handlers: { beforeRequest } }] });
}
