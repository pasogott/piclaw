import { expect, test } from "bun:test";

import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import { runWithProtectedRecoveryHandoff } from "../../src/agent-pool/protected-recovery-handoff.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";

const protectedOutput = (): AgentOutput => ({
  status: "error",
  result: null,
  error: "Protected recovery needs an ordinary turn.",
  requiresToolEnabledContinuation: true,
});

test("protected recovery runs exactly one ordinary continuation at the AgentPool boundary", async () => {
  const prompts: string[] = [];
  const observed: AgentOutput[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? protectedOutput()
        : { status: "success", result: "finished with tools" };
    },
    (output) => observed.push(output),
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(observed).toHaveLength(2);
  expect(final).toMatchObject({ status: "success", result: "finished with tools" });
});

test("protected handoff preserves pre-tool progress but hides unauthoritative terminal prose", async () => {
  const delivered: string[] = [];
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (prompt, options) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        options.onTurnComplete?.({ text: "committed tool progress", attachments: [], followedByToolUse: true });
        options.onTurnComplete?.({ text: "protected terminal prose", attachments: [] });
        return protectedOutput();
      }
      options.onTurnComplete?.({ text: "ordinary result", attachments: [] });
      return { status: "success", result: "ordinary result" };
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(delivered).toEqual(["committed tool progress", "ordinary result"]);
  expect(final.result).toBe("ordinary result");
});

test("initial turns flush normally when no handoff is required", async () => {
  const delivered: string[] = [];
  await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (_prompt, options) => {
      options.onTurnComplete?.({ text: "normal result", attachments: [] });
      return { status: "success", result: "normal result" };
    },
  );

  expect(delivered).toEqual(["normal result"]);
});

test("web can defer protected recovery to its durable continuation queue", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    { deferToolEnabledContinuation: true },
    async (prompt) => {
      prompts.push(prompt);
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task"]);
  expect(final.requiresToolEnabledContinuation).toBe(true);
});

test("the generated ordinary continuation cannot chain another continuation", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
});

test("an already-generated continuation is never handed off again", async () => {
  let calls = 0;
  const final = await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    {},
    async () => {
      calls += 1;
      return protectedOutput();
    },
  );

  expect(calls).toBe(1);
  expect(final.requiresToolEnabledContinuation).toBe(true);
});
