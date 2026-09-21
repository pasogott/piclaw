import { useCallback, useEffect, useRef } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import { getChatJid } from "../../api/chat-jid";
import type { AgentStatus, AgentContext, ModelInfo, ProviderUsage } from "./types";
import { addonHealthSignal } from "./addonHealthSignal";
import { providerConfigured } from "../../app/providerState";
import { safeGetItem, safeSetItem } from "../../utils/storage";
import { mergeVisualLiveContext } from "./telemetry";
import { AGENT_UI_POLL_MS, getAgentUiSnapshot, invalidateAgentUiSnapshot } from "../../../../../../src/ui/agent-ui-snapshot";

import { createLogger } from "../../utils/logger";
import { updateAgentDisplayName } from "../../api/agent-identity";
const log = createLogger("ModelContextBar");


export interface UseStatusPollingResult {
  agentStatus: ReturnType<typeof useSignal<AgentStatus | null>>;
  agentContext: ReturnType<typeof useSignal<AgentContext | null>>;
  error: ReturnType<typeof useSignal<boolean>>;
  isStale: ReturnType<typeof useComputed<boolean>>;
  currentModel: ReturnType<typeof useSignal<string | null>>;
  currentThinkingLevel: ReturnType<typeof useSignal<string>>;
  modelContextWindow: ReturnType<typeof useSignal<number>>;
  providerUsage: ReturnType<typeof useSignal<ProviderUsage | null>>;
  systemMetrics: ReturnType<typeof useSignal<any>>;
  metricsError: ReturnType<typeof useSignal<boolean>>;
  fetchStatus: () => Promise<void>;
  fetchContext: () => Promise<void>;
}

function loadCachedContext(): AgentContext | null {
  const jid = getChatJid();
  const cached = safeGetItem(`piclaw:context-cache:${jid}`) || safeGetItem("piclaw:context-cache");
  if (!cached) return null;
  try { return JSON.parse(cached) as AgentContext; } catch { return null; }
}

export function useStatusPolling(): UseStatusPollingResult {
  const agentStatus = useSignal<AgentStatus | null>(null);
  const agentContext = useSignal<AgentContext | null>(loadCachedContext());
  const error = useSignal<boolean>(false);
  const lastSuccessAt = useSignal<number>(0);
  const pollTick = useSignal(0);
  const isStale = useComputed(() => {
    void pollTick.value; // subscribe to poll ticks for reactivity
    return error.value && lastSuccessAt.value > 0 && Date.now() - lastSuccessAt.value > 30000;
  });
  const currentModel = useSignal<string | null>(null);
  const currentThinkingLevel = useSignal<string>("");
  // #60: store model's context_window from /agent/models as fallback
  const modelContextWindow = useSignal<number>(0);
  const providerUsage = useSignal<ProviderUsage | null>(null);
  const systemMetrics = useSignal<any>(null);
  const metricsError = useSignal(false);

  // Anti-race refs: versioning, abort controllers, and in-flight guards
  const statusVersion = useRef(0);
  const mounted = useRef(true);
  const isFetchingStatus = useRef(false);
  const statusRefresh = useRef<ReturnType<typeof setTimeout>>();
  const contextRefresh = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => {
    mounted.current = false;
    statusVersion.current++;
    clearTimeout(statusRefresh.current);
    clearTimeout(contextRefresh.current);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (isFetchingStatus.current) return;
    isFetchingStatus.current = true;
    // A shared request outlives individual consumers; versions reject stale results
    const myVersion = ++statusVersion.current;
    try {
      const snapshot = await getAgentUiSnapshot(getChatJid());
      if (statusVersion.current !== myVersion) return;
      const statusData = snapshot.status as AgentStatus;
      agentStatus.value = statusData;
      addonHealthSignal.value = statusData.addon_api ?? null;
      error.value = false;
      lastSuccessAt.value = Date.now();
      if (snapshot.model) {
        const info = snapshot.model as ModelInfo;
        currentModel.value = info.current ?? null;
        currentThinkingLevel.value = info.thinking_level_label ?? info.thinking_level ?? '';
        const currentOpt = info.model_options?.find((m: Record<string, unknown>) => m.label === info.current || m.id === info.current);
        if (currentOpt?.context_window) modelContextWindow.value = currentOpt.context_window as number;
        const oobeReady = info.oobe?.provider_ready_completed_instance;
        providerConfigured.value = oobeReady !== undefined ? !!oobeReady : !!info.current;
        providerUsage.value = info.provider_usage ?? null;
      }
      if (snapshot.context) {
        const data = snapshot.context as AgentContext;
        if (data.tokens !== null || data.cacheUsage?.latest) {
          const next = mergeVisualLiveContext(agentContext.value, data);
          if (JSON.stringify(next) !== JSON.stringify(agentContext.value)) {
            agentContext.value = next;
            safeSetItem(`piclaw:context-cache:${getChatJid()}`, JSON.stringify(next));
          }
        }
      }
      metricsError.value = snapshot.errors.includes("metrics");
      if (snapshot.metrics) systemMetrics.value = snapshot.metrics;
      updateAgentDisplayName(snapshot.agent_name);
      pollTick.value += 1;


    } catch (err) {
      if (statusVersion.current !== myVersion) return;
      if (err instanceof Error && err.name === "AbortError") return;
      log.warn("status fetch failed:", err);
      error.value = true;
      pollTick.value += 1;
    } finally {
      isFetchingStatus.current = false;
      // A model event during a pending body supersedes the local view; its
      // timeout may have joined this request. Apply the replacement immediately.
      if (mounted.current && statusVersion.current !== myVersion) void fetchStatus();
    }
  }, []);

  const fetchContext = fetchStatus;

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, AGENT_UI_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Immediately refresh model/context when SSE connects (first load + reconnects)
  useEffect(() => {
    const onConnect = () => {
      invalidateAgentUiSnapshot(getChatJid());
      void fetchStatus();
    };
    window.addEventListener("piclaw:sse-connected", onConnect);
    return () => window.removeEventListener("piclaw:sse-connected", onConnect);
  }, [fetchStatus, fetchContext]);

  useEffect(() => {
    const onModelStateChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ chatJid?: string; payload?: ModelInfo }>).detail;
      if (detail?.chatJid && detail.chatJid !== getChatJid()) return;
      const payload = detail?.payload;
      if (payload?.current) {
        currentModel.value = payload.current;
        agentStatus.value = {
          ...(agentStatus.value ?? { status: "idle" }),
          data: { ...agentStatus.value?.data, model: payload.current },
        };
        const currentOpt = payload.model_options?.find((option) => {
          const id = typeof option.id === "string" ? option.id : "";
          const key = id.includes("/") || !option.provider ? id : `${option.provider}/${id}`;
          return key === payload.current || option.label === payload.current;
        });
        if (typeof currentOpt?.context_window === "number") {
          modelContextWindow.value = currentOpt.context_window;
          const tokens = agentContext.value?.tokens ?? null;
          agentContext.value = {
            ...(agentContext.value ?? { tokens: null, percent: null }),
            contextWindow: currentOpt.context_window,
            percent: tokens === null ? null : (tokens / currentOpt.context_window) * 100,
          };
        }
      }
      if (payload?.thinking_level_label || payload?.thinking_level) {
        currentThinkingLevel.value = payload.thinking_level_label ?? payload.thinking_level!;
        if (agentStatus.value) {
          agentStatus.value = {
            ...agentStatus.value,
            data: {
              ...agentStatus.value.data,
              thinking_level: payload.thinking_level_label ?? payload.thinking_level ?? undefined,
            },
          };
        }
      }
      if (payload?.provider_usage) providerUsage.value = payload.provider_usage;
      invalidateAgentUiSnapshot(getChatJid());
      statusVersion.current += 1;
      clearTimeout(statusRefresh.current);
      statusRefresh.current = setTimeout(() => void fetchStatus(), 0);
    };
    window.addEventListener("piclaw:model-state-changed", onModelStateChanged);
    return () => window.removeEventListener("piclaw:model-state-changed", onModelStateChanged);
  }, [fetchStatus]);

  // Listen for agent_status events — extract context_usage from done events
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.chat_jid && detail.chat_jid !== getChatJid()) return;
      // Extract context_usage from done event (pushed by backend after each turn)
      if (detail?.context_usage && detail.context_usage.tokens !== null && detail.context_usage.tokens !== undefined) {
        const cu = detail.context_usage;
        agentContext.value = mergeVisualLiveContext(agentContext.value, cu);
        safeSetItem(`piclaw:context-cache:${getChatJid()}`, JSON.stringify(agentContext.value));
      }
      // Always refresh context after a turn completes
      if (detail?.type === "done" || detail?.type === "error" || detail?.status === "idle") {
        clearTimeout(contextRefresh.current);
        contextRefresh.current = setTimeout(() => { void fetchContext(); }, 500);
      }
    };
    window.addEventListener("piclaw:agent-status", onStatus);
    return () => window.removeEventListener("piclaw:agent-status", onStatus);
  }, [fetchContext]);

  return {
    agentStatus,
    agentContext,
    error,
    isStale,
    currentModel,
    currentThinkingLevel,
    modelContextWindow,
    providerUsage,
    systemMetrics,
    metricsError,
    fetchStatus,
    fetchContext,
  };
}
