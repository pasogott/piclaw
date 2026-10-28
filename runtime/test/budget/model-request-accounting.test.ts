import { expect, test } from 'bun:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { isolateBudgetTestDatabase } from './fixture.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { getDb } from '../../src/db/connection.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { getBudgetRequest } from '../../src/db/budget-request-reservations.js';
import { modelRequestAccounting } from '../../src/budget/model-request-accounting.js';
isolateBudgetTestDatabase();

function seed() {
  ensureBudgetWork({ id: 'parent', chatJid: 'web:fixture', executionKind: 'interactive' });
  for (const [id, kind] of [['side', 'side_prompt'], ['child', 'delegate']] as const) {
    ensureBudgetWork({ id, chatJid: 'web:fixture', executionKind: kind, parentWorkId: 'parent' });
  }
  saveBudgetCap({ scope: 'task', workId: 'parent', metric: 'api_usd_micros', amount: 100 });
}
function message(): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: 'synthetic' }], api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } };
}
function binding(id: string, workId = 'side') {
  return { id, workId, chatJid: 'web:fixture', providerId: 'fixture', modelId: 'fixture', accountRef: 'generation', amountMicros: 60 };
}

// These two contracts previously lived beside the retired inactive stream
// adapter but exercised this still-shipping primitive directly. Keep all assertions.
test('shared settlement retry preserves host accounting time and exact usage payload', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('stable-settlement'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  const terminal = message(); expect((await accounting.settle(request, terminal)).state).toBe('settled');
  await Bun.sleep(2);
  expect((await accounting.settle(request, structuredClone(terminal))).state).toBe('settled');
  expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
  await expect(accounting.settle(request, { ...terminal, usage: { ...terminal.usage, cost: { ...terminal.usage.cost, input: 0.000031, total: 0.000041 } } })).rejects.toThrow('conflict');
});

test('accounting rejects disclosed response-model changes and keeps the dispatched hold', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('response-model-conflict', 'parent'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  await expect(accounting.settle(request, { ...message(), responseModel: 'other' })).rejects.toThrow('identity changed');
  expect(getBudgetRequest(request.id)?.state).toBe('dispatched');
});

test('captured native accounting charges once and releases shared capacity', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('known-charge'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal); await accounting.settle(request, message());
  expect(getBudgetRequest(request.id)?.state).toBe('settled');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(getDb().query('SELECT work_id,invocation_id FROM budget_usage_events').get()).toEqual({ work_id: 'side', invocation_id: request.id });
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('allow');
  // Preserve the host-calendar invariant despite the synthetic provider's epoch timestamp.
  const row = getDb().query('SELECT run_at FROM token_usage').get() as { run_at: string };
  expect(row.run_at.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
});

test('unknown zero telemetry retains the native dispatched hold and cap blocker', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('unknown-charge'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  const terminal = message(); terminal.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  expect((await accounting.settle(request, terminal)).state).toBe('unresolved');
  expect(getBudgetRequest(request.id)?.state).toBe('unresolved');
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
});

test('definitely unsent native request releases its hold without a usage event', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('unsent-request'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.abandon(request);
  expect(getBudgetRequest(request.id)?.state).toBe('released');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
});
