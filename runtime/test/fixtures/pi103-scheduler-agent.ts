/** Retired entrypoint refusal over real scheduler/queue/AgentPool services and an offline provider. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ModelRuntime, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Provider } from '@earendil-works/pi-ai';
import { AgentPool } from '../../src/agent-pool.js';
import { createSessionInDir } from '../../src/agent-pool/session.js';
import { createTestCredentialStore } from '../model-services-fixture.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { createTask, getTaskRunLogs } from '../../src/db/tasks.js';
import { AgentQueue } from '../../src/queue.js';
import { startSchedulerLoop, stopSchedulerLoop } from '../../src/task-scheduler.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const root = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(root, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, '0');
const guard = (globalThis as any).__ADMISSION_ENFORCEMENT__ as { networkAttempts: number; childProcessAttempts: number };
assert(guard, 'Offline guard preload required');
mkdirSync(join(root, '.piclaw'), { recursive: true });
writeFileSync(join(root, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }), { mode: 0o600 });
initDatabase();
const credentials = createTestCredentialStore();
const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: null, allowModelNetwork: false, refreshOnCreate: false });
const model: Model<'openai-completions'> = { id: 'scheduled-v1', provider: 'synthetic-scheduler-local', name: 'Synthetic scheduler', api: 'openai-completions', baseUrl: 'https://unused.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
let providerCalls = 0;
const stream = () => {
  providerCalls++; assert(providerCalls <= 6, 'Unexpected provider continuation');
  const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text', text: 'Synthetic scheduler response ' + providerCalls }], timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const events = createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'stop', message }); return events;
};
const provider: Provider = { id: model.provider, name: 'Synthetic scheduler', getModels: () => [model], auth: { apiKey: { name: 'No credential', resolve: async () => ({ auth: {}, source: 'synthetic' }) } }, stream, streamSimple: stream };
runtime.registerNativeProvider(provider); await runtime.refresh({ allowNetwork: false });
const settings = SettingsManager.inMemory({ defaultProvider: model.provider, defaultModel: model.id, defaultThinkingLevel: 'off', compaction: { enabled: false }, retry: { enabled: false } });
const pool = new AgentPool({ credentialStore: credentials, modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime), createSession: (chatJid, sessionDir) => createSessionInDir(sessionDir, { chatJid, modelRuntime: runtime, settingsManager: settings, tools: [] }) });
const queue = new AgentQueue(), deliveries: Array<{ jid: string; text: string }> = [];
const chat = 'web:synthetic-real-scheduler', prompt = 'Synthetic scheduled branch fixture';
try {
  const baseline = await pool.runAgent('Synthetic baseline conversation', chat, { timeoutMs: 0 });
  assert.equal(baseline.status, 'error');
  assert.equal(baseline.error, 'Native execution requires an admitted operation');
  assert.equal(providerCalls, 0, 'Retired entrypoint must not invoke even an offline provider');
  const due = new Date(Date.now() - 60000).toISOString();
  createTask({ id:'real-agent-task',chat_jid:chat,prompt,schedule_type:'interval',schedule_value:'3600000',next_run:due,status:'active',notify_on_complete:false,created_at:due });
  startSchedulerLoop({ queue, agentPool: pool, sendMessage: async (jid,text) => { deliveries.push({jid,text}); } });
  const deadline=performance.now()+15000;
  while(!getTaskRunLogs('real-agent-task').length && performance.now()<deadline)await Bun.sleep(5);
  await stopSchedulerLoop();
  const logs=getTaskRunLogs('real-agent-task');assert.equal(logs.length,1);assert.equal(logs[0].status,'error');
  assert.equal(providerCalls,0);assert.equal(guard.networkAttempts,0);assert.equal(guard.childProcessAttempts,0);
  assert.deepEqual(getDb().query('PRAGMA quick_check').get(),{quick_check:'ok'});
  console.log(JSON.stringify({retiredRunnerDenied:true,unadmittedScheduleDenied:true,providerCalls,networkAttempts:guard.networkAttempts,childProcessAttempts:guard.childProcessAttempts,
    scope:'Fail-closed host compatibility regression only. Positive real-native scheduler/SDK/lease/accounting coverage remains mandatory in default-application-runtime.test.ts native-scheduler, native-scheduler-definition and accounting cases.'}));

} finally {
  await stopSchedulerLoop();
  try { await queue.shutdown(); }
  finally {
    try { await pool.shutdown(); }
    finally { runtime.unregisterProvider(model.provider); closeDatabase(); }
  }
}
