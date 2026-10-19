import type Database from "bun:sqlite";
import type { JsonValue } from "@earendil-works/chord";
import type { ExtensionContext, ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { HostConversationRuntime } from "./host-runtime.js";

type GoalFactory = (resolveChat: (context: ExtensionContext) => string) => ToolDefinition<any, JsonValue>[];
const names = ["get_goal", "create_goal", "goal_complete", "goal_stop", "update_goal"];

/** The caller must qualify the exact installed factory before application adoption. */
export function createHostGoalTools(factory: GoalFactory, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
}) {
  const declarations = factory(() => { throw Error("Goal chat authority unavailable"); });
  if (declarations.length !== names.length || new Set(declarations.map(tool => tool.name)).size !== names.length ||
    names.some(name => !declarations.some(tool => tool.name === name))) throw Error("Unqualified Goal tool set");
  return declarations.map(declaration => createHostTool(declaration, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, invocation) {
      if (!args || Object.getPrototypeOf(args) !== Object.prototype) throw Error("Plain Goal arguments required");
      const cloned = structuredClone(args);
      const captured = await options.runtime().captureToolSource(invocation.conversationId, invocation.taskId, invocation.toolCallId);
      const chatJid = captured.operation.chatJid;
      const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, declaration.name === "get_goal");
      const tool = factory(() => chatJid).find(tool => tool.name === declaration.name);
      if (!tool) throw Error("Goal tool changed");
      return withExtensionKvAuthority({ extensionId: "goal", chatJid, assertCurrent: authority.assertCurrent, write: authority.write }, async () => {
        authority.assertCurrent();
        const result = await tool.execute(invocation.toolCallId, cloned as never, invocation.signal, undefined, undefined as never);
        authority.assertCurrent();
        return result as unknown as { content: never; details: JsonValue };
      });
    },
  }, { callers: ["model"] }));
}
