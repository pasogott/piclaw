import type Database from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type GoalState = { status: string };
export function createHostGoalPrompt(addon: {
  loadThreadGoal(chat: string): GoalState | null;
  buildGoalSystemPrompt(goal: any): string;
}, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureRunSource">;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const load = addon.loadThreadGoal.bind(addon), build = addon.buildGoalSystemPrompt.bind(addon);
  const beforeRequest: NonNullable<GenerationHooks["beforeRequest"]> = async (request, api) => {
    try {
    options.assertOwner();
    const captured = await options.runtime().captureRunSource(api.conversationId, api.taskId);
    const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
    return withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid,
      assertCurrent: authority.assertCurrent, write: authority.write }, () => {
      authority.assertCurrent();
      const goal = load(captured.operation.chatJid);
      if (!goal || (goal.status !== "active" && goal.status !== "budget_limited")) return request;
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
