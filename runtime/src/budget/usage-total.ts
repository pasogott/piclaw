import type Database from "bun:sqlite";
import { unlinkedUsageReportPredicate } from "../db/usage-report-projection.js";

export interface UsageTotal { known_usage: number; unknown_events: number }

/** Settled event valuation plus explicitly unlinked legacy history. Reporting
 * mutations never change a linked native charge. Pending holds stay in evaluator. */
export function readBudgetUsageTotal(input: { workIds?: string[]; startsAt?: string; endsAt?: string }, database: Database): UsageTotal {
  const where: string[] = [];
  const values: unknown[] = [];
  if (input.workIds) {
    if (input.workIds.length === 0) return { known_usage: 0, unknown_events: 0 };
    where.push(`work_id IN (${input.workIds.map(() => "?").join(",")})`);
    values.push(...input.workIds);
  }
  if (input.startsAt) { where.push("run_at >= ?"); values.push(input.startsAt); }
  if (input.endsAt) { where.push("run_at < ?"); values.push(input.endsAt); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = database.prepare(`SELECT
    COALESCE(SUM(CASE
      WHEN api_equivalent_cost_known=1 AND api_equivalent_cost_microusd IS NOT NULL THEN api_equivalent_cost_microusd
      WHEN valuation_provenance IS NULL AND catalogue_cost_total>0 THEN CAST(ROUND(catalogue_cost_total*1000000) AS INTEGER)
      ELSE 0 END),0) AS known_usage,
    COALESCE(SUM(CASE
      WHEN total_tokens>0 AND NOT (
        (api_equivalent_cost_known=1 AND api_equivalent_cost_microusd IS NOT NULL) OR (valuation_provenance IS NULL AND catalogue_cost_total>0)
      ) THEN 1 ELSE 0 END),0) AS unknown_events
    FROM (
      SELECT e.work_id,e.accounted_at AS run_at,e.api_usd_known AS api_equivalent_cost_known,e.api_usd_micros AS api_equivalent_cost_microusd,
        json_extract(e.report_payload_json,'$.record.valuation_provenance') AS valuation_provenance,
        json_extract(e.report_payload_json,'$.record.catalogue_cost_total') AS catalogue_cost_total,
        COALESCE(json_extract(e.report_payload_json,'$.record.total_tokens'),1) AS total_tokens
      FROM main.budget_usage_events e
      UNION ALL
      SELECT t.work_id,t.run_at,t.api_equivalent_cost_known,t.api_equivalent_cost_microusd,t.valuation_provenance,t.catalogue_cost_total,t.total_tokens
      FROM main.token_usage t WHERE ${unlinkedUsageReportPredicate("t")}
    ) ${clause}`).get(...values as any[]) as UsageTotal;
  return { known_usage: Number(row.known_usage), unknown_events: Number(row.unknown_events) };
}

