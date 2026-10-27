/**
 * automatic-recovery.ts – Compatibility export surface for recovery helpers.
 *
 * Runtime decision/policy/classification/summary ownership is split into
 * dedicated modules while this file preserves legacy import paths.
 */

export { formatRecoverySummary } from "./recovery-summary.js";
export {
  classifyOpaqueAgentFailure,
  isContextPressureFailure,
  isLengthStopFailure,
  isNonRecoverableFailure,
  isProviderAuthConfigFailure,
  isTransientFailure,
} from "./recovery-classification.js";
export {
  DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
  DEFAULT_RETRY_BACKOFF_SETTINGS,
  getAutomaticRecoveryConfig,
  getAutomaticRecoveryDelayMs,
  MAX_AUTOMATIC_RECOVERY_BUDGET_MS,
  MIN_AUTOMATIC_RECOVERY_BUDGET_MS,
  normalizeRetryBackoffSettings,
  resolveAutomaticRecoveryBudgetMs,
  AUTOMATIC_RECOVERY_TIMEOUT_DIVISOR,
  type AutomaticRecoveryConfig,
  type RetryBackoffSettings,
} from "./recovery-policy.js";
export {
  decideAutomaticRecovery,
} from "./recovery-decision.js";
export type {
  RecoveryAttemptSnapshot,
  RecoveryClassifier,
  RecoveryDecision,
  RecoveryDecisionInput,
  RecoveryStrategy,
} from "./recovery-decision-types.js";
