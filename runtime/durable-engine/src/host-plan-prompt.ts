import type { Database } from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { PlanPromptExports } from "./host-extension-catalog.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createPlanKvAuthority } from "./host-plan-tool.js";

/** Immutable hidden context snapshots, refreshed after changes (including tools).
 * The native bridge persists them before dispatch and repairs only its own
 * trailing snapshots omitted by the SDK's pinned beforeRequest cutoff. */
export function createHostPlanPrompt(addon: PlanPromptExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureRunSource" | "preparePlanContext">;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const hooks: Pick<GenerationHooks, "beforeRequest"> = {
    async beforeRequest(request, api, context) {
      try {
        options.assertOwner();
        const captured = await options.runtime().captureRunSource(api.conversationId, api.taskId);
        const authority = createPlanKvAuthority(options.root, captured, options.assertOwner, true);
        const { system, content } = withExtensionKvAuthority(authority, () => {
          authority.assertCurrent();
          const plan = addon.loadSessionPlan(captured.operation.chatJid);
          // Capability guidance stays stable when a checklist is cleared. The
          // placeholder is used only by the pure guidance builder, never as state.
          const system = addon.buildPlanSystemPrompt({ ...plan, markdown: plan.markdown.trim() || "(empty)" });
          const content = addon.buildPlanTurnMessage(plan)?.content ?? [{ type: "text" as const,
            text: `Current Plan Sidebar checklist for ${plan.chat_jid}:\n\n(empty)` }];
          authority.assertCurrent();
          return { system, content };
        });
        const messages = await options.runtime().preparePlanContext(api.conversationId, api.taskId, captured.inputs,
          request.messages, content, () => {
            options.assertOwner();
            if (options.root.inTransaction) throw Error("Root connection transaction active");
          }, context);
        return { messages: [...messages,
          ...(system ? [{ role: "system" as const, content: system, timestamp: 0 }] : []),
        ] };
      } catch (error) {
        // SDK hook diagnostics must never turn missing provenance into an
        // unqualified provider dispatch. The shared model lifetime is fenced.
        options.failClosed(error);
        throw Error("Plan request authority unavailable");
      }
    },
  };
  return defineExtension({ name: "app.host-plan-prompt", hooks: [{ task: "pi.generation", handlers: hooks }] });
}
