import { expect, test } from 'bun:test';
import { handleAgentContextRequest, type AgentStatusContext } from '../../../src/channels/web/agent/agent-status.js';
import { publicContextUsage } from '../../../src/channels/web/context-usage.js';
import { executeDeferredControlCommand, type DeferredControlCommandRuntime } from '../../../src/channels/web/runtime/process-chat-control-runtime.js';
import { createWebChannelEndpointContexts } from '../../../src/channels/web/endpoints/channel-endpoint-context-factory.js';

function context(overrides: Partial<AgentStatusContext> = {}): AgentStatusContext {
  return {
    defaultChatJid: 'web:test', json: payload => Response.json(payload),
    getAgentStatus: () => null, getExtensionWorkingState: () => null,
    recoverStaleInflightRun: () => false, getBuffer: () => undefined,
    getContextUsageForChat: async () => null, getTokenUsageForChat: () => null,
    getAvailableModels: async () => ({ models: [] }), getProviderReadyCompletedForInstance: () => false,
    ...overrides,
  };
}

test('full public snapshots replace null/known counts without exposing private authority hints', async () => {
  for (const tokens of [null, 0, 42]) {
    const usage = { tokens, contextWindow: 10000, percent: tokens === null ? null : tokens / 100,
      sessionGeneration: 'stable-session', tokensAreAuthoritative: true, futurePrivateField: 'private' };
    const projected = publicContextUsage(usage);
    expect(projected).toMatchObject({ tokens, contextUpdate: 'replace' });
    expect(projected).not.toHaveProperty('tokensAreAuthoritative');
    const response = await handleAgentContextRequest(new Request('https://fixture/agent/context'),
      context({ getContextUsageForChat: async () => usage }));
    const payload = await response.json();
    expect(payload).toMatchObject({ ...projected, cacheUsage: null });
    expect(JSON.stringify(payload)).not.toMatch(/tokensAreAuthoritative|futurePrivateField/);
  }
});

test('ordinary meter polling performs zero full-tree reads, including empty sessions', async () => {
  let reads = 0;
  const ctx = context({
    getSessionTreeSummaryForChat: async () => { reads++; throw Error('A meter poll must not project history'); },
  });
  for (let i = 0; i < 25; i++) {
    const response = await handleAgentContextRequest(new Request(`https://fixture/agent/context${i % 2 ? '?include_tree=0' : ''}`), ctx);
    expect(await response.json()).toEqual({ tokens: null, contextWindow: null, percent: null,
      sessionGeneration: null, contextUpdate: 'replace', cacheUsage: null });
  }
  expect(reads).toBe(0);
});

test('explicit tree summary remains exact and opt-in; no second tree cache is introduced', async () => {
  let reads = 0;
  const ctx = context({ getSessionTreeSummaryForChat: async () => {
    reads++; return { leafId: `public-head-${reads}`, total: 900000 + reads };
  } });
  for (let i = 1; i <= 2; i++) {
    const response = await handleAgentContextRequest(new Request('https://fixture/agent/context?include_tree=1'), ctx);
    expect((await response.json()).sessionTree).toEqual({ leafId: `public-head-${i}`, total: 900000 + i });
  }
  expect(reads).toBe(2);
});

test('failed native display reads retain identity and clear estimates without reading stored usage', async () => {
  let storedReads = 0;
  const channel: any = {
    getContextUsage: () => { storedReads++; return { tokens: 777 }; },
    agentPool: { getContextUsageForChat: async () => { throw Error('reader revoked'); }, getSessionGenerationForChat: () => 'stable-session' },
  };
  const contexts = createWebChannelEndpointContexts(channel, {
    defaultChatJid: 'web:test', defaultAgentId: 'default', getIdentitySnapshot: () => ({} as any),
  });
  expect(publicContextUsage(await contexts.agentStatus().getContextUsageForChat('web:test'))).toEqual({
    tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable-session', contextUpdate: 'replace',
  });
  expect(storedReads).toBe(0);
});

for (const command of ['compact'] as const) {
  for (const tokens of [null, 0, 42]) {
    test(`deferred native ${command} publishes stable-identity replacement for ${tokens} counts without a stale fallback`, async () => {
      const events: any[] = [], writes: any[] = [], activity: any[] = [];
      let fallbackReads = 0;
      const channel: DeferredControlCommandRuntime = {
        agentPool: {
          applyControlCommand: async () => ({ status: 'success', message: 'Context updated.',
            sessionGeneration: 'stable-session', sessionGenerationChanged: false,
            contextUsage: { tokens, contextWindow: 10000, percent: tokens === null ? null : tokens / 100,
              sessionGeneration: 'stable-session', tokensAreAuthoritative: true } }),
          getAvailableModels: async () => ({ models: [] } as any), getCurrentModelLabel: async () => null,
          getSessionGenerationForChat: () => 'stable-session',
          getContextUsageForChat: async () => { fallbackReads++; return { tokens: 777, contextWindow: 10000, percent: 7.77 }; },
        },
        sendMessage: async () => {}, setContextUsage: (_chat, usage) => { writes.push(usage); },
        updateAgentStatus: (_chat, status) => { activity.push(status); },
        broadcastEvent: (event, payload) => { events.push({ event, payload }); },
        saveState() {}, retryFailedOnModelSwitch: () => false, resumeChat() {},
      };
      await executeDeferredControlCommand({ channel, chatJid: 'web:test', agentId: 'default',
        command: { type: command, raw: '/compact' },
        message: { rowId: 20, messageId: 'command', content: '/command', timestamp: '2026-10-23T00:00:00Z', threadId: 20 },
        effectiveThreadRootId: 20, assistantName: 'Smith',
        cursorStore: { getChatCursor: () => '', setChatCursor() {}, getMessagesSince: () => [] },
      });
      expect(fallbackReads).toBe(0);
      expect(writes).toEqual([]);
      const snapshot = events.filter(event => event.payload.type === 'context_usage');
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].payload.context_usage).toMatchObject({tokens,contextWindow:10000,percent:tokens===null?null:tokens/100,sessionGeneration:'stable-session',contextUpdate:'replace'});
      expect(snapshot[0].payload).not.toHaveProperty('context_reset');
      expect(JSON.stringify(events)).not.toContain('tokensAreAuthoritative');
    });
  }
}
