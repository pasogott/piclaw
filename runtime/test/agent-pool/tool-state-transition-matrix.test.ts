import { expect, test } from "bun:test";

import { runAgentRecoveryPhase, type PromptAttemptResult, type SessionWithToolControl } from "../../src/agent-pool/run-agent-recovery-phase.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";

function output(status: AgentOutput["status"], error?: string, result: string | null = null): AgentOutput {
  return status === "error" ? { status, result: null, error: error ?? "failed" } : { status, result };
}

function attempt(partial: Partial<PromptAttemptResult>): PromptAttemptResult {
  return {
    output: output("error", "failed"),
    snapshot: { hadToolActivity: false, hadPartialOutput: false, hadCompletedTurnOutput: false, hadTerminalTurnOutput: false },
    promptWasPersisted: true,
    timedOut: false,
    toolExecutionCount: 0,
    ...partial,
  };
}

const baseRecoveryConfig = {
  enabled: true,
  transientRecoveryEnabled: true,
  transientRecoveryToolsEnabled: false,
  maxAttempts: 2,
  totalBudgetMs: 1_000,
  baseDelayMs: 0,
  maxDelayMs: 0,
};

const cases = [
  { name: "generic tool-active retry", needsFinalize: false, toolsEnabled: false, terminalStatus: "success", expectHandoff: true },
  { name: "generic tool-active retry ending tool_complete", needsFinalize: false, toolsEnabled: false, terminalStatus: "tool_complete", expectHandoff: true },
  { name: "explicit tool-free finalization", needsFinalize: true, toolsEnabled: false, terminalStatus: "success", expectHandoff: false },
  { name: "tool-enabled generic retry", needsFinalize: false, toolsEnabled: true, terminalStatus: "success", expectHandoff: false },
] as const;

test.each(cases)("tool-state recovery matrix: $name", async ({ name, needsFinalize, toolsEnabled, terminalStatus, expectHandoff }) => {
  let activeTools = ["read", "bash"];
  const sessionCtrl: SessionWithToolControl = {
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName: (names) => { activeTools = [...names]; },
  };
  let calls = 0;
  const result = await runAgentRecoveryPhase({
    prompt: "continue",
    chatJid: `web:matrix:${name}`,
    session: {} as any,
    sessionCtrl,
    timeoutMs: 0,
    startTime: Date.now(),
    modelLabel: "test/model",
    recoveryConfig: { ...baseRecoveryConfig, transientRecoveryToolsEnabled: toolsEnabled },
    runOptions: {},
    logsDir: "/tmp/nonexistent-piclaw-test-logs",
    clearAttachments: () => {},
    runPromptAttempt: async () => {
      calls += 1;
      if (calls === 1) {
        return attempt({
          output: output("error", "503 temporarily unavailable"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
            needsToolFreeFinalization: needsFinalize,
            sawAssistantToolCall: needsFinalize,
          },
        });
      }
      expect(activeTools.length === 0).toBe(!toolsEnabled || needsFinalize);
      return attempt({ output: output(terminalStatus, undefined, terminalStatus === "success" ? "final prose" : null) });
    },
  });

  expect(Boolean(result.requiresToolEnabledContinuation)).toBe(expectHandoff);
  expect(result.status).toBe(expectHandoff ? "error" : "success");
  expect(result.recovery?.recovered).toBe(!expectHandoff);
  expect(activeTools).toEqual(["read", "bash"]);
});
