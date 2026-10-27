import type { RecoveryDecision, RecoveryDecisionInput } from "./recovery-decision-types.js";

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
