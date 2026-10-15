import { h, render, useRef, useState } from '../../../web/src/vendor/preact-htm.js';
import { useAgentStatusLifecycle } from '../../../web/src/ui/app-agent-status-lifecycle.js';
import { handleAppSseEvent } from '../../../web/src/ui/app-sse-events.js';

// Real lifecycle hook, same bundled Preact as Classic. Only transport is gated.
function Fixture() {
  const [status, setStatus] = useState<any>(null);
  const [draft, setDraft] = useState({ text: '', totalLines: 0 });
  const [thought, setThought] = useState({ text: '', totalLines: 0 });
  const [connection, setConnection] = useState('connected');
  const agentStatusRef = useRef<any>(null);
  const pendingRequestRef = useRef<any>(null);
  const draftBufferRef = useRef('');
  const thoughtBufferRef = useRef('');
  const currentTurnIdRef = useRef<string | null>(null);
  const requests = useRef<Array<(value: any) => void>>([]);
  const noop = () => {};
  const lifecycle = useAgentStatusLifecycle({
    currentChatJid: 'web:hook-fixture', activeChatJidRef: useRef('web:hook-fixture'),
    queueRefreshGenRef: useRef(0), dismissedQueueRowIdsRef: useRef(new Set()),
    getAgentQueueState: async () => ({}), setFollowupQueueItems: noop, clearQueuedSteerStateIfStale: noop,
    getAgentContext: null, setContextUsage: noop, getAutoresearchStatus: null,
    setExtensionStatusPanels: noop, setPendingExtensionPanelActions: noop,
    getAgentStatus: () => new Promise(resolve => { requests.current.push(resolve); }),
    wasAgentActiveRef: useRef(false), viewStateRef: useRef(null), refreshTimeline: async () => {},
    clearAgentRunState: () => {
      agentStatusRef.current = null; currentTurnIdRef.current = null;
      draftBufferRef.current = ''; thoughtBufferRef.current = '';
    },
    agentStatusRef, pendingRequestRef, draftBufferRef, thoughtBufferRef,
    setAgentStatus: next => { agentStatusRef.current = next; setStatus(next); },
    setAgentDraft: setDraft, setAgentPlan: noop, setAgentThought: setThought,
    setPendingRequest: noop, setExtensionWorkingState: noop,
    setActiveTurn: turn => { currentTurnIdRef.current = turn || null; },
    noteAgentActivity: noop, clearLastActivityFlag: noop,
    isAgentRunningRef: useRef(false), currentTurnIdRef,
    silentRecoveryRef: useRef({ inFlight: false, lastAttemptAt: 0, turnId: null }),
    silenceRefreshMs: 2000, lastAgentEventRef: useRef(null), lastSilenceNoticeRef: useRef(0),
    silenceWarningMs: 8000, silenceFinalizeMs: 60000, isCompactionStatus: () => false,
    serverVersionContext: {} as any, setConnectionStatus: setConnection, setStateAccessFailed: noop,
    setPendingRequestForConnection: noop, hasConnectedOnceRef: useRef(true),
  });
  const eventRefs = useRef<any>({
    previewResyncPendingRef: { current: false }, previewResyncGenerationRef: { current: 0 },
    steerQueuedTurnIdRef: { current: null }, thoughtExpandedRef: { current: false }, draftExpandedRef: { current: false },
    draftThrottleRef: { current: 0 }, thoughtThrottleRef: { current: 0 }, viewStateRef: { current: null },
    followupQueueItemsRef: { current: [] }, dismissedQueueRowIdsRef: { current: new Set() },
    scrollToBottomRef: { current: null }, hasMoreRef: { current: false }, loadMoreRef: { current: null },
    lastAgentResponseRef: { current: null }, wasAgentActiveRef: { current: false },
  });
  const event = (type: string, data: any) => handleAppSseEvent(type, data, new Proxy({
    ...eventRefs.current, currentChatJid: 'web:hook-fixture', activeChatJidRef: { current: 'web:hook-fixture' },
    currentTurnIdRef, pendingRequestRef, draftBufferRef, thoughtBufferRef,
    setActiveTurn: (turn: string) => { currentTurnIdRef.current = turn; },
    setAgentStatus: (next: any) => { agentStatusRef.current = next; setStatus(next); },
    setAgentDraft: setDraft, setAgentThought: setThought,
    clearAgentRunState: () => { agentStatusRef.current = null; currentTurnIdRef.current = null; },
  }, { get: (target, key) => key in target ? target[key] : noop }) as any);
  (window as any).statusLifecycleFixture = {
    event,
    async manual(content = '/compact') {
      const response = await fetch('/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      return response.json();
    },
    refresh: lifecycle.refreshAgentStatus,
    connection: lifecycle.handleConnectionStatusChange,
    count: () => requests.current.length,
    release(index: number, payload: any) { requests.current[index](payload); },
  };
  return h('div', {},
    h('output', { id: 'state' }, JSON.stringify({ status, draft, thought, connection })),
    status && status.type !== 'error' ? h('button', { id: 'stop', onClick: () => (window as any).statusLifecycleFixture.manual('/abort') }, 'Stop') : null);
  // Stop is a fixture control, not the production compose component.

}
render(h(Fixture, {}), document.getElementById('app')!);
