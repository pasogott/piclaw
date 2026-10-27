import { getRecoveryPolicyConfig } from "../core/config.js";

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
