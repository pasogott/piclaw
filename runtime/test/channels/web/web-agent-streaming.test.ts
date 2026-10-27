import {test, expect} from "bun:test";
import {buildAgentStatusPhaseKey} from "../../../src/channels/web/handlers/agent.js";

test("agent status phase identity ignores presentation text", () => {
  expect(buildAgentStatusPhaseKey({
    type: "intent",
    intent_key: "recovery",
    classifier: "timeout",
    title: "First recovery title",
  })).toBe(buildAgentStatusPhaseKey({
    type: "intent",
    intent_key: "recovery",
    classifier: "network",
    title: "Completely different presentation",
  }));

  expect(buildAgentStatusPhaseKey({
    type: "tool_status",
    tool_call_id: "tool-1",
    tool_name: "bash",
    title: "bash: first command",
  })).toBe(buildAgentStatusPhaseKey({
    type: "tool_status",
    tool_call_id: "tool-1",
    tool_name: "bash",
    title: "renamed tool presentation",
  }));
});
