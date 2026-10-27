/**
 * automatic-recovery.ts – Shared mid-turn recovery policy for agent runs.
 */

import { getRecoveryPolicyConfig } from "../core/config.js";
import type { AgentFailureCategory } from "./contracts.js";
import { formatRecoverySummary } from "./recovery-summary.js";
import {
  classifyOpaqueAgentFailure,
  isContextPressureFailure,
  isLengthStopFailure,
  isNonRecoverableFailure,
  isProviderAuthConfigFailure,
  isTransientFailure,
} from "./recovery-classification.js";

export interface RetryBackoffSettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface AutomaticRecoveryConfig {
  /** Legacy master switch for non-context automatic recovery. */
  enabled: boolean;
  /** Whether failures classified as transient may retry automatically. */
  transientRecoveryEnabled: boolean;
  /** Whether transient continuation attempts may use tools. */
  transientRecoveryToolsEnabled: boolean;
  maxAttempts: number;
  totalBudgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type RecoveryStrategy = "retry" | "compact_then_retry" | "finalize";
export type RecoveryClassifier =
  | "disabled"
  | "budget_exhausted"
  | "auth_config"
  | "credential_storage"
  | "recovery_suppressed"
  | "stale_progress_watchdog"
  | "session_corruption"
  | "non_recoverable"
  | "tool_activity"
  | "completed_turn_output"
  | "context_pressure"
  | "tool_history_pressure"
  | "thinking_only_stop"
  | "length_stop"
  | "provider_budget"
  | "transient"
  | "compaction_failure"
  | "unknown";

export interface RecoveryAttemptSnapshot {
  hadToolActivity: boolean;
  hadPartialOutput: boolean;
  hadCompletedTurnOutput?: boolean;
  hadTerminalTurnOutput?: boolean;
  compactionErrorMessage?: string | null;
  sawCompactionIntent?: boolean;
  sawAssistantToolCall?: boolean;
  sawThinkingOnlyStop?: boolean;
  onlyReadOnlyToolActivity?: boolean;
  canDisableToolsForRecovery?: boolean;
  /** True when a tool execution started without a matching terminal event. */
  hasUnresolvedToolExecution?: boolean;
  hadToolFailure?: boolean;
  sawTerminalSideEffectToolActivity?: boolean;
  needsToolFreeFinalization?: boolean;
  toolUseBudgetExceeded?: boolean;
  assistantToolUseMessageCount?: number;
  toolExecutionCount?: number;
  toolUseMessageBudget?: number;
}

export interface RecoveryDecision {
  recover: boolean;
  classifier: RecoveryClassifier;
  strategy: RecoveryStrategy | null;
  reason: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
export const MIN_AUTOMATIC_RECOVERY_BUDGET_MS = 6 * 60_000;
export const MAX_AUTOMATIC_RECOVERY_BUDGET_MS = 60 * 60_000;
export const AUTOMATIC_RECOVERY_TIMEOUT_DIVISOR = 3;
const DEFAULT_TOTAL_BUDGET_MS = MIN_AUTOMATIC_RECOVERY_BUDGET_MS;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;

export const DEFAULT_RETRY_BACKOFF_SETTINGS: Readonly<RetryBackoffSettings> = Object.freeze({
  enabled: true,
  maxRetries: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
});

export const DEFAULT_AUTOMATIC_RECOVERY_CONFIG: Readonly<AutomaticRecoveryConfig> = Object.freeze({
  enabled: true,
  transientRecoveryEnabled: true,
  transientRecoveryToolsEnabled: false,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
  baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
});

export function normalizeRetryBackoffSettings(settings?: Partial<RetryBackoffSettings> | null): RetryBackoffSettings {
  return {
    enabled: typeof settings?.enabled === "boolean" ? settings.enabled : DEFAULT_RETRY_BACKOFF_SETTINGS.enabled,
    maxRetries: Number.isFinite(settings?.maxRetries) && (settings?.maxRetries ?? 0) > 0
      ? Number(settings?.maxRetries)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.maxRetries,
    baseDelayMs: Number.isFinite(settings?.baseDelayMs) && (settings?.baseDelayMs ?? 0) > 0
      ? Number(settings?.baseDelayMs)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.baseDelayMs,
    maxDelayMs: Number.isFinite(settings?.maxDelayMs) && (settings?.maxDelayMs ?? 0) > 0
      ? Number(settings?.maxDelayMs)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.maxDelayMs,
  };
}

export function resolveAutomaticRecoveryBudgetMs(configuredBudgetMs: number, timeoutMs: number): number {
  if (Number.isFinite(configuredBudgetMs) && configuredBudgetMs > 0) {
    const explicit = Math.max(1, Math.round(configuredBudgetMs));
    return timeoutMs > 0 ? Math.min(explicit, Math.round(timeoutMs)) : explicit;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return MIN_AUTOMATIC_RECOVERY_BUDGET_MS;
  const derived = Math.round(timeoutMs / AUTOMATIC_RECOVERY_TIMEOUT_DIVISOR);
  return Math.min(Math.round(timeoutMs), Math.max(MIN_AUTOMATIC_RECOVERY_BUDGET_MS, Math.min(MAX_AUTOMATIC_RECOVERY_BUDGET_MS, derived)));
}

export function getAutomaticRecoveryConfig(
  retrySettings?: Partial<RetryBackoffSettings> | null,
  timeoutMs = 0,
): Readonly<AutomaticRecoveryConfig> {
  const normalizedRetry = normalizeRetryBackoffSettings(retrySettings);
  const policy = getRecoveryPolicyConfig();
  return Object.freeze({
    // The SDK retry toggle controls provider/request retries. Piclaw turn recovery
    // is a separate safety mechanism for genuine context pressure and bounded
    // transient retries. Tool-history ceilings are terminal and require an
    // explicit continue instead of automatic compaction/replay.
    enabled: policy.automaticRecoveryEnabled,
    transientRecoveryEnabled: policy.transientRecoveryEnabled,
    transientRecoveryToolsEnabled: policy.transientRecoveryToolsEnabled,
    maxAttempts: policy.automaticRecoveryMaxAttempts > 0
      ? policy.automaticRecoveryMaxAttempts
      : normalizedRetry.maxRetries,
    totalBudgetMs: resolveAutomaticRecoveryBudgetMs(policy.automaticRecoveryTotalBudgetMs, timeoutMs),
    baseDelayMs: normalizedRetry.baseDelayMs,
    maxDelayMs: normalizedRetry.maxDelayMs,
  });
}

export function getAutomaticRecoveryDelayMs(config: Pick<AutomaticRecoveryConfig, "baseDelayMs" | "maxDelayMs">, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.max(0, Math.round(config.baseDelayMs * 2 ** exponent));
  return Math.min(raw, Math.max(config.baseDelayMs, config.maxDelayMs));
}

export interface RecoveryDecisionInput {
  config: AutomaticRecoveryConfig;
  failureCategory: AgentFailureCategory;
  recoveryAttemptsUsed: number;
  elapsedMs: number;
  snapshot: RecoveryAttemptSnapshot;
}

export {
  classifyOpaqueAgentFailure,
  formatRecoverySummary,
  isContextPressureFailure,
  isLengthStopFailure,
  isNonRecoverableFailure,
  isProviderAuthConfigFailure,
  isTransientFailure,
};

export function decideAutomaticRecovery(input: RecoveryDecisionInput): RecoveryDecision {
  const failureCategory = input.failureCategory;
  const toolHistoryPressure = Boolean(input.snapshot.toolUseBudgetExceeded);
  const transientFailure = failureCategory === "rate_limit"
    || failureCategory === "network"
    || failureCategory === "timeout";
  const nonRecoverableFailure = failureCategory === "aborted"
    || failureCategory === "provider_budget"
    || failureCategory === "session_corruption"
    || failureCategory === "non_recoverable";

  if (failureCategory === "credential_storage") {
    return {
      recover: false,
      classifier: "credential_storage",
      strategy: null,
      reason: "Credentials could not be read/resolved; local storage/configuration needs attention",
    };
  }

  if (failureCategory === "stalled_work") {
    return {
      recover: false,
      classifier: "stale_progress_watchdog",
      strategy: null,
      reason: "Stale-progress watchdog already interrupted the active run; do not retry automatically.",
    };
  }

  if (failureCategory === "session_corruption") {
    return {
      recover: false,
      classifier: "session_corruption",
      strategy: null,
      reason: "Provider rejected an orphan function-call output; unchanged automatic retries cannot repair the payload.",
    };
  }

  if (input.recoveryAttemptsUsed >= input.config.maxAttempts || input.elapsedMs >= input.config.totalBudgetMs) {
    return {
      recover: false,
      classifier: "budget_exhausted",
      strategy: null,
      reason: "Automatic recovery budget exhausted.",
    };
  }

  if (failureCategory === "output_limit") {
    return {
      recover: false,
      classifier: "length_stop",
      strategy: null,
      reason: "Provider hit the output length limit; preserve the partial answer and wait for an explicit continue.",
    };
  }

  if (failureCategory === "auth_config") {
    return {
      recover: false,
      classifier: "auth_config",
      strategy: null,
      reason: "Provider authentication/configuration failure; automatic recovery suppressed until credentials or login are fixed.",
    };
  }

  if (input.snapshot.compactionErrorMessage) {
    if (transientFailure) {
      return {
        recover: true,
        classifier: "compaction_failure",
        strategy: "retry",
        reason: "Transient compaction failure; retrying once without another compaction first.",
      };
    }
    return {
      recover: false,
      classifier: "compaction_failure",
      strategy: null,
      reason: failureCategory === "context_pressure" || input.snapshot.sawCompactionIntent
        ? "Compaction itself exceeded the context window; refusing to compact-and-retry again. Start a shorter branch or compact with a larger model."
        : "Compaction failed; refusing automatic retry to avoid re-entering the same failed compaction path.",
    };
  }

  if (input.snapshot.hadToolActivity) {
    if (input.snapshot.needsToolFreeFinalization) {
      if (!input.config.enabled || !input.config.transientRecoveryEnabled) {
        return { recover: false, classifier: "disabled", strategy: null, reason: "Tools-disabled finalization is disabled." };
      }
      if (!input.snapshot.canDisableToolsForRecovery) {
        return { recover: false, classifier: "tool_activity", strategy: null, reason: "Closing reply requires tool control that this session does not expose." };
      }
      return {
        recover: true,
        classifier: "transient",
        strategy: "finalize",
        reason: "Resolved tool work ended without a terminal assistant reply; requesting one tools-disabled closing reply.",
      };
    }
    // A terminal assistant reply is the only prior output that can make a
    // tool-bearing failure complete. Text emitted before a tool call is an
    // intermediate lead-in; if the provider later stops or times out, resume
    // from persisted tool results unless execution state is still unresolved.
    const hadTerminalTurnOutput = input.snapshot.hadTerminalTurnOutput
      ?? Boolean(input.snapshot.hadCompletedTurnOutput);
    if (hadTerminalTurnOutput) {
      return {
        recover: false,
        classifier: "completed_turn_output",
        strategy: null,
        reason: "Automatic recovery skipped because a terminal assistant reply already completed during the failed run.",
      };
    }
    if (input.snapshot.hadToolFailure && input.snapshot.sawTerminalSideEffectToolActivity) {
      return {
        recover: false,
        classifier: "tool_activity",
        strategy: null,
        reason: "A terminal side-effect tool completed after another tool failed; preserve the mixed outcome instead of converting it to recovery success.",
      };
    }
    const canSafelyCompactTimedOutToolWork = input.recoveryAttemptsUsed === 0
      && failureCategory === "timeout"
      && input.snapshot.hasUnresolvedToolExecution === false
      && input.snapshot.hadToolFailure === false
      && input.snapshot.sawTerminalSideEffectToolActivity !== true
      && input.snapshot.toolUseBudgetExceeded !== true
      && input.snapshot.canDisableToolsForRecovery === true;
    if (failureCategory === "context_pressure" || canSafelyCompactTimedOutToolWork || input.snapshot.sawCompactionIntent) {
      return {
        recover: true,
        classifier: "context_pressure",
        strategy: "compact_then_retry",
        reason: canSafelyCompactTimedOutToolWork
          ? "Tool-dependent turn timed out with resolved tool state; compacting before one bounded tools-enabled continuation."
          : "Failure looks context-related despite tool activity; compacting before retrying.",
      };
    }
    if (toolHistoryPressure) {
      return {
        recover: false,
        classifier: "tool_history_pressure",
        strategy: null,
        reason: "Turn exceeded the tool-history budget before finalization without context pressure; wait for an explicit continue instead of compacting.",
      };
    }
    if (nonRecoverableFailure) {
      return {
        recover: false,
        classifier: "non_recoverable",
        strategy: null,
        reason: "Failure classified as non-recoverable.",
      };
    }
    const transientCandidate = transientFailure
      || Boolean(input.snapshot.hadPartialOutput)
      || Boolean(input.snapshot.sawAssistantToolCall);
    if (transientCandidate) {
      if (!input.config.enabled || !input.config.transientRecoveryEnabled) {
        return {
          recover: false,
          classifier: "disabled",
          strategy: null,
          reason: "Transient automatic recovery is disabled.",
        };
      }
      const mustDisableTools = !input.config.transientRecoveryToolsEnabled
        || Boolean(input.snapshot.hasUnresolvedToolExecution);
      return {
        recover: true,
        classifier: "transient",
        strategy: "retry",
        reason: mustDisableTools
          ? "Transient failure after tool activity requires one ordinary tool-enabled continuation."
          : "Transient failure after resolved tool work; continuing from the persisted tool results with tools available.",
      };
    }
    return {
      recover: false,
      classifier: "tool_activity",
      strategy: null,
      reason: "Automatic recovery skipped because tool activity occurred and the failure was not safely continuable.",
    };
  }

  const hadTerminalTurnOutput = input.snapshot.hadTerminalTurnOutput
    ?? Boolean(input.snapshot.hadCompletedTurnOutput);
  if (hadTerminalTurnOutput) {
    return {
      recover: false,
      classifier: "completed_turn_output",
      strategy: null,
      reason: "Automatic recovery skipped because a terminal assistant reply already completed during the failed run.",
    };
  }

  if (input.snapshot.sawThinkingOnlyStop && !input.snapshot.hadToolActivity) {
    if (input.recoveryAttemptsUsed === 0) {
      if (!input.config.enabled) {
        return {
          recover: false,
          classifier: "disabled",
          strategy: null,
          reason: "Automatic turn recovery is disabled.",
        };
      }
      return {
        recover: true,
        classifier: "thinking_only_stop",
        strategy: "retry",
        reason: "Provider stopped after emitting thinking only; retrying once before escalating.",
      };
    }
    if (input.snapshot.sawCompactionIntent) {
      return {
        recover: true,
        classifier: "context_pressure",
        strategy: "compact_then_retry",
        reason: "Thinking-only stop repeated under context pressure; compacting before one more retry.",
      };
    }
    return {
      recover: false,
      classifier: "thinking_only_stop",
      strategy: null,
      reason: "Provider stopped after emitting thinking only again after a bounded retry.",
    };
  }

  // Context pressure must be checked before tool-history/non-recoverable
  // classification. Tool-count exhaustion alone is terminal, but a turn that
  // independently crossed the model-aware threshold is recoverable by
  // compaction even when it reached the tool ceiling at the same time.
  if (failureCategory === "context_pressure" || input.snapshot.sawCompactionIntent) {
    return {
      recover: true,
      classifier: "context_pressure",
      strategy: "compact_then_retry",
      reason: "Failure looks context-related; compacting before retrying.",
    };
  }

  if (toolHistoryPressure) {
    return {
      recover: false,
      classifier: "tool_history_pressure",
      strategy: null,
      reason: "Turn exceeded the tool-history budget before finalization without context pressure; wait for an explicit continue instead of compacting.",
    };
  }

  if (nonRecoverableFailure) {
    return {
      recover: false,
      classifier: "non_recoverable",
      strategy: null,
      reason: "Failure classified as non-recoverable.",
    };
  }

  if (transientFailure || input.snapshot.hadPartialOutput || failureCategory === "unknown") {
    if (!input.config.enabled || !input.config.transientRecoveryEnabled) {
      return {
        recover: false,
        classifier: "disabled",
        strategy: null,
        reason: "Transient automatic recovery is disabled.",
      };
    }
    return {
      recover: true,
      classifier: "transient",
      strategy: "retry",
      reason: "Failure looks transient or interrupted mid-turn; retrying before compaction.",
    };
  }

  if (!input.config.enabled) {
    return {
      recover: false,
      classifier: "disabled",
      strategy: null,
      reason: "Automatic turn recovery is disabled.",
    };
  }

  return {
    recover: true,
    classifier: "unknown",
    strategy: "retry",
    reason: "Unknown mid-turn failure without context pressure; retrying without compaction.",
  };
}
