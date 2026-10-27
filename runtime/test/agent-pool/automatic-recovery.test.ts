import { expect, test } from "bun:test";

import { classifyOpaqueAgentFailure, isContextPressureFailure, isLengthStopFailure, isNonRecoverableFailure, isProviderAuthConfigFailure, isTransientFailure } from "../../src/agent-pool/recovery-classification.js";
import { MAX_AUTOMATIC_RECOVERY_BUDGET_MS, MIN_AUTOMATIC_RECOVERY_BUDGET_MS, DEFAULT_AUTOMATIC_RECOVERY_CONFIG, getAutomaticRecoveryConfig, resolveAutomaticRecoveryBudgetMs } from "../../src/agent-pool/recovery-policy.js";

test("keeps turn auto-recovery enabled while disabling transient tools by default", () => {
  const previousAutoRecovery = process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  const previousTransientRecovery = process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED;
  const previousTransientTools = process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED;
  delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED;
  delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED;
  try {
    const config = getAutomaticRecoveryConfig({ enabled: false, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.enabled).toBe(true);
    expect(config.transientRecoveryEnabled).toBe(true);
    expect(config.transientRecoveryToolsEnabled).toBe(false);
    expect(config.maxAttempts).toBe(7);
    expect(config.baseDelayMs).toBe(1234);
    expect(config.maxDelayMs).toBe(5678);
  } finally {
    if (previousAutoRecovery === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = previousAutoRecovery;
    if (previousTransientRecovery === undefined) delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED = previousTransientRecovery;
    if (previousTransientTools === undefined) delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED;
    else process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED = previousTransientTools;
  }
});

test("honors explicit turn auto-recovery env disable", () => {
  const previous = process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = "0";
  try {
    const config = getAutomaticRecoveryConfig({ enabled: true, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.enabled).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = previous;
  }
});

test("automatic recovery default budget derives from the effective turn timeout", () => {
  expect(DEFAULT_AUTOMATIC_RECOVERY_CONFIG.totalBudgetMs).toBe(MIN_AUTOMATIC_RECOVERY_BUDGET_MS);
  expect(resolveAutomaticRecoveryBudgetMs(0, 0)).toBe(MIN_AUTOMATIC_RECOVERY_BUDGET_MS);
  expect(resolveAutomaticRecoveryBudgetMs(0, 3 * 60_000)).toBe(3 * 60_000);
  expect(resolveAutomaticRecoveryBudgetMs(0, 30 * 60_000)).toBe(10 * 60_000);
  expect(resolveAutomaticRecoveryBudgetMs(0, 3 * 60 * 60_000)).toBe(MAX_AUTOMATIC_RECOVERY_BUDGET_MS);
});

test("explicit recovery budgets remain exact but never exceed a positive turn timeout", () => {
  expect(resolveAutomaticRecoveryBudgetMs(120_000, 3_600_000)).toBe(120_000);
  expect(resolveAutomaticRecoveryBudgetMs(7_200_000, 3_600_000)).toBe(3_600_000);
  expect(resolveAutomaticRecoveryBudgetMs(120_000, 0)).toBe(120_000);
});

test("honors transient recovery and transient tool env controls", () => {
  const previousRecovery = process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED;
  const previousTools = process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED;
  process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED = "0";
  process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED = "true";
  try {
    const config = getAutomaticRecoveryConfig();
    expect(config.transientRecoveryEnabled).toBe(false);
    expect(config.transientRecoveryToolsEnabled).toBe(true);
  } finally {
    if (previousRecovery === undefined) delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED = previousRecovery;
    if (previousTools === undefined) delete process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED;
    else process.env.PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED = previousTools;
  }
});

test("turn auto-recovery numeric env rejects malformed suffixes", () => {
  const previousAttempts = process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS;
  const previousBudget = process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS;
  process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS = "12abc";
  process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS = "4000oops";
  try {
    const config = getAutomaticRecoveryConfig({ enabled: true, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.maxAttempts).toBe(7);
    expect(config.totalBudgetMs).toBe(MIN_AUTOMATIC_RECOVERY_BUDGET_MS);
  } finally {
    if (previousAttempts === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS = previousAttempts;
    if (previousBudget === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS = previousBudget;
  }
});
