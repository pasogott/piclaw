import type { AgentFailureCategory } from "./contracts.js";
import type { AutomaticRecoveryConfig } from "./recovery-policy.js";

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

export interface RecoveryDecisionInput {
  config: AutomaticRecoveryConfig;
  failureCategory: AgentFailureCategory;
  recoveryAttemptsUsed: number;
  elapsedMs: number;
  snapshot: RecoveryAttemptSnapshot;
}
