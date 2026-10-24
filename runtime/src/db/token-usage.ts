/**
 * db/token-usage.ts – Token/cost reporting projections.
 *
 * Actual request settlement commits the immutable event payload and report in
 * one frame. Compatibility session callbacks retain their weaker event identity
 * or unlinked legacy provenance. Replay repairs from the stored event.
 *
 * Consumers:
 *   - agent-pool/usage.ts calls storeTokenUsage() after every agent run.
 *   - agent-control/handlers/info.ts queries the table for `/usage` reports.
 *   - The token-chart skill reads the table to generate usage visualisations.
 */

import type Database from 'bun:sqlite';
import { getDb } from "./connection.js";
import { insertBudgetUsageEvent } from "./budget-limits.js";
import { decodeUsageReport, encodeUsageReport, projectUsageEvent, readUsageProjectionEvent, tokenReportColumns, usageReportRecord, type UsageReportOrigin, unlinkedUsageReportPredicate } from "./usage-report-projection.js";

/** Overall token/cost totals for a chat across all runs. */
export interface TokenUsageTotalsSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_total: number;
  runs: number;
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}

/** Source category for a persisted usage record. */
export type TokenUsageSource = "assistant" | "tool" | "compaction" | "branch_summary" | "unknown";

/** Provenance for the effective per-run total cost. */
export type TokenUsageCostProvenance = "provider_reported" | "catalogue_estimate" | "unavailable";

/** Latest token/cost record for a chat, including cache-hit telemetry. */
export interface LatestTokenUsageSummary extends TokenUsageTotalsSummary {
  output_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cache_read_reported: number | null;
  cache_write_reported: number | null;
  provider_cost_total: number | null;
  catalogue_cost_total: number | null;
  cost_provenance: TokenUsageCostProvenance | null;
  model: string | null;
  response_model: string | null;
  provider: string | null;
  api: string | null;
  usage_source: string | null;
  turns: number | null;
  run_at: string | null;
}

/** Aggregated token/cost totals grouped by provider for a chat. */
export interface TokenUsageByProviderSummary extends TokenUsageTotalsSummary {
  provider: string | null;
}

/** Aggregated token/cost totals grouped by model for a chat. */
export interface TokenUsageByModelSummary extends TokenUsageTotalsSummary {
  model: string | null;
}

/** Aggregated token/cost totals grouped by usage source for a chat. */
export interface TokenUsageBySourceSummary extends TokenUsageTotalsSummary {
  usage_source: string | null;
}

/** Latest model metadata recorded for a chat's token-usage stream. */
export interface LatestTokenUsageModelSummary {
  model: string | null;
  response_model: string | null;
  provider: string | null;
  run_at: string | null;
}

/**
 * Shape of a single token-usage record to be persisted.
 * Maps 1:1 to the `token_usage` table columns.
 */
export interface TokenUsageRecord {
  /** Chat JID the agent run belonged to. */
  chat_jid: string;
  /** ISO-8601 timestamp of the agent run. */
  run_at: string;
  /** Number of input (prompt) tokens consumed. */
  input_tokens: number;
  /** Number of output (completion) tokens generated. */
  output_tokens: number;
  /** Reasoning tokens reported by providers when available. Included in output tokens by OpenAI-compatible usage. */
  reasoning_tokens?: number;
  /** Tokens served from the provider's prompt cache. */
  cache_read_tokens: number;
  /** Tokens written into the provider's prompt cache. */
  cache_write_tokens: number;
  /** Whether the provider explicitly reported cache-read tokens. Null means legacy/unknown. */
  cache_read_reported?: boolean | null;
  /** Whether the provider explicitly reported cache-write tokens. Null means legacy/unknown. */
  cache_write_reported?: boolean | null;
  /** Sum of all token categories. */
  total_tokens: number;
  /** Dollar cost attributed to input tokens. */
  cost_input: number;
  /** Dollar cost attributed to output tokens. */
  cost_output: number;
  /** Dollar cost attributed to cache-read tokens. */
  cost_cache_read: number;
  /** Dollar cost attributed to cache-write tokens. */
  cost_cache_write: number;
  /** Effective dollar cost for the run. */
  cost_total: number;
  /** Provider-reported total cost, when available. */
  provider_cost_total?: number | null;
  /** Catalogue-calculated total cost, when available. */
  catalogue_cost_total?: number | null;
  /** Provenance for cost_total. Null means a legacy row. */
  cost_provenance?: TokenUsageCostProvenance | null;
  /** Requested model identifier (e.g. "auto" or "claude-sonnet-4-20250514"). */
  model?: string | null;
  /** Concrete upstream model returned by a router/gateway when it differs from the requested model. */
  response_model?: string | null;
  /** Provider name (e.g. "anthropic"). */
  provider?: string | null;
  /** API variant used (e.g. "messages", "chat"). */
  api?: string | null;
  /** Usage source category, such as assistant turn, tool execution, or compaction summary. */
  usage_source?: TokenUsageSource | string | null;
  /** Number of conversational turns in the run. */
  turns?: number | null;
  /** Owning request/goal/scheduled-run identity for budget attribution. */
  work_id?: string | null;
  /** Billable provider invocation identity when available. */
  invocation_id?: string | null;
  /** Stable event identity used to make recovery replay idempotent. */
  usage_event_id?: string | null;
  /** API-equivalent catalogue valuation in millionths of one US dollar. */
  api_equivalent_cost_microusd?: number | null;
  /** Whether the API-equivalent valuation is complete, including documented zero. */
  api_equivalent_cost_known?: boolean | null;
  valuation_provenance?: "catalogue_estimate" | "documented_free" | "unavailable" | null;
  api_equivalent_known_subtotal_microusd?: number | null;
  api_equivalent_unknown_categories?: string | null;
  pricing_currency?: string | null;
  pricing_source?: string | null;
  pricing_version?: string | null;
  pricing_context_tier?: string | null;
  pricing_cache_fallbacks?: string | null;
  execution_kind?: import("../budget/types.js").BudgetExecutionKind | null;
}

/** Commit a reporting observation once; existing event bytes own replay. */
export function storeTokenUsage(record: TokenUsageRecord, db: Database = getDb(), origin: UsageReportOrigin = { kind: "recorder_event" }): void {
  db.transaction(() => {
    const existing = record.usage_event_id ? readUsageProjectionEvent(db, record.usage_event_id) : null;
    // Replayed parent/tool observations retain the original charge owner and
    // provider valuation. Caller text is never repair authority.
    if (existing) { projectUsageEvent(db, existing); return; }
    const values = usageReportRecord(record);
    const result = db.query(`INSERT OR IGNORE INTO main.token_usage (${tokenReportColumns.join(",")})
      VALUES (${tokenReportColumns.map(() => "?").join(",")})`).run(...tokenReportColumns.map(column => values[column]));
    if (result.changes !== 1 || !record.usage_event_id) return;
    const payload = encodeUsageReport(record, origin);
    if (origin.kind === "host_request") {
      const request = db.query("SELECT binding_sha256,state,work_id,chat_jid,provider_id,model_id FROM main.budget_request_reservations WHERE id=?").get(origin.request_id) as { binding_sha256: string; state: string; work_id: string; chat_jid: string; provider_id: string; model_id: string } | null;
      if (!request || !["dispatched","unresolved"].includes(request.state) || request.binding_sha256 !== origin.binding_sha256 || request.work_id !== record.work_id
        || request.chat_jid !== record.chat_jid || request.provider_id !== record.provider || request.model_id !== record.model) throw Error("Usage request binding mismatch");
    }
    insertBudgetUsageEvent({ workId: record.work_id ?? null, invocationId: record.invocation_id ?? null, usageEventId: record.usage_event_id,
      executionKind: record.execution_kind ?? null, tokenUsageId: Number(result.lastInsertRowid), chatJid: record.chat_jid, accountedAt: record.run_at,
      apiUsdMicros: record.api_equivalent_cost_microusd ?? null, apiUsdKnown: record.api_equivalent_cost_known === true,
      valuationProvenance: record.valuation_provenance ?? "unavailable", usageSource: record.usage_source ?? "assistant",
      reportPayloadJson: payload.json, reportPayloadSha256: payload.hash }, db);
    const event = readUsageProjectionEvent(db, record.usage_event_id);
    if (!event || !decodeUsageReport(event)) throw Error("Usage event was not committed");
  }).immediate();
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
}

/** Return overall token and cost totals for a chat. */
export function getTokenUsageTotals(chatJid: string): TokenUsageTotalsSummary {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?`
  ).get(chatJid) as TokenUsageTotalsSummary | undefined;

  return row ?? {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 0,
    cost_total: 0,
    runs: 0,
    provider_reported_cost_runs: 0,
    catalogue_estimate_cost_runs: 0,
    unavailable_cost_runs: 0,
    legacy_cost_runs: 0,
  };
}

/** Return the most recent token-usage row for a chat, if any. */
export function getLatestTokenUsage(chatJid: string): LatestTokenUsageSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      input_tokens,
      output_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_read_reported,
      cache_write_reported,
      total_tokens,
      cost_input,
      cost_output,
      cost_cache_read,
      cost_cache_write,
      cost_total,
      provider_cost_total,
      catalogue_cost_total,
      cost_provenance,
      model,
      response_model,
      provider,
      api,
      usage_source,
      turns,
      run_at,
      1 AS runs
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageSummary | undefined;

  return row ?? null;
}

/** Return per-provider token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByProvider(chatJid: string, limit = 5): TokenUsageByProviderSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      provider,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY provider
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByProviderSummary[];
}

/** Return per-model token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByModel(chatJid: string, limit = 5): TokenUsageByModelSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      COALESCE(response_model, model) AS model,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY COALESCE(response_model, model)
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByModelSummary[];
}

/** Return per-source token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageBySource(chatJid: string, limit = 5): TokenUsageBySourceSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      usage_source,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY usage_source
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageBySourceSummary[];
}

/** Return the most recent token-usage model metadata for a chat, if any. */
export function getLatestTokenUsageModel(chatJid: string): LatestTokenUsageModelSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      model,
      response_model,
      provider,
      run_at
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageModelSummary | undefined;

  return row ?? null;
}

/**
 * Delete only unlinked legacy reports older than the retention period.
 * Event/request references retain accounting and replay evidence until their
 * owners explicitly retire it. This function never releases a request hold.
 *
 * @returns Number of deleted rows.
 */
export function pruneOldTokenUsage(retentionDays = 90): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = db.prepare(`DELETE FROM token_usage
    WHERE run_at < ? AND ${unlinkedUsageReportPredicate("token_usage")}`).run(cutoff);
  return result.changes;
}
