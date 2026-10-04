import type Database from 'bun:sqlite';
import type { ChildRequestHostDependencies } from './child-request-scope.js';
import type { BudgetProviderEvidence } from '../budget/types.js';
import { admitBudgetRequest, admitBudgetRequestDispatch } from '../budget/request-reservation-admission.js';
import { abandonBudgetRequest, settleBudgetRequest, type BudgetRequestBinding } from '../db/budget-request-reservations.js';
import { getDb } from '../db/connection.js';
import { valueApiEquivalentCost } from '../budget/valuation.js';

/** Captured host authority/database only. Caller never supplies charge amounts.
 * Admission checks the singleton remains this connection; late settlement uses
 * the captured handle and identity even after the parent work is cancelled. */
export function childRequestAccounting(input: {
  authorise(): void;
  providerEvidence?: BudgetProviderEvidence[];
  documentedFree: boolean;
}, database: Database = getDb()): Pick<ChildRequestHostDependencies, 'reserve' | 'dispatch' | 'abandon' | 'settle'> {
  const authorise = input.authorise;
  const evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const documentedFree = input.documentedFree;
  const current = () => { if (getDb() !== database) throw Error('Child request database binding changed.'); authorise(); };
  const options = (signal: AbortSignal) => ({ signal, authorise: current, providerEvidence: evidence });
  return {
    async reserve(binding, signal) { await admitBudgetRequest(binding, options(signal)); },
    async dispatch(binding, signal) { await admitBudgetRequestDispatch(binding, options(signal)); },
    async abandon(binding: BudgetRequestBinding) { abandonBudgetRequest(binding, database); },
    async settle(binding, terminal) {
      const message = terminal.type === 'done' ? terminal.message : terminal.error;
      const usage = message.usage;
      const valued = valueApiEquivalentCost({
        tokens: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
        costs: usage.cost, documentedFree,
      });
      // Catalogue zero from an error/abort cannot prove no-charge even when
      // the selected model is ordinarily documented free.
      const known = valued.known && (terminal.type === 'done' || valued.amountMicros !== 0);
      const row = settleBudgetRequest(binding, {
        chat_jid: binding.chatJid, run_at: new Date().toISOString(),
        input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite,
        total_tokens: usage.totalTokens, cost_input: usage.cost.input, cost_output: usage.cost.output,
        cost_cache_read: usage.cost.cacheRead, cost_cache_write: usage.cost.cacheWrite, cost_total: usage.cost.total,
        model: binding.modelId, response_model: message.model, provider: message.provider, api: message.api, usage_source: 'assistant',
        api_equivalent_cost_known: known, api_equivalent_cost_microusd: known ? valued.amountMicros : null,
        valuation_provenance: known ? valued.provenance : 'unavailable',
      }, database);
      if (row.state !== 'settled') throw Error('Child request usage is unresolved.');
    },
  };
}
