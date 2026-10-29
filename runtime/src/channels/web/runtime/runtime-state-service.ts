/**
 * channels/web/runtime-state-service.ts – WebChannel pending-input resume and local UI observations.
 *
 * Accepted input/queue stores own resume work. Native watches rebuild bounded
 * process-local status and streamed model buffers; these observations are never
 * persisted as execution or recovery authority.
 */

import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";

const RECOVERY_REPLAY_DELAY_MS = 2000;
import { registerPreShutdownHook } from "../../../runtime/shutdown-registry.js";
import { AgentBuffers } from "../agent/agent-buffers.js";
import { AgentStatusStore } from "../agent/agent-status-store.js";
import { getThreadRootId as getThreadRootIdForChat, resumeChat as resumeWebChat, type ChatRunControlStore } from "./chat-run-control.js";
import { resumePendingChats as resumeWebPendingChats, type WebPendingResumeStore } from "./recovery.js";

/** Runtime callbacks required to bridge recovery/resume helpers back into WebChannel orchestration. */
export interface WebChannelRuntimeStateCallbacks {
  isNativeRuntime?(): boolean;
  isChatLaneBusy?(chatJid: string): boolean;
  readNativeTurnState?(chatJid: string): { operation: { operation_id: string; phase: string } | null; queued: number };
  getAssistantName(): string;
  enqueue(task: () => Promise<void>, key: string, laneKey?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
}

/** Fixed options for a WebChannel runtime-state service instance. */
export interface WebChannelRuntimeStateOptions {
  defaultAgentId: string;
}

interface AgentStatusStoreLike {
  update(chatJid: string, status: Record<string, unknown>): void;
  get(chatJid: string): Record<string, unknown> | null;
  dispose(): void;
}

interface AgentBuffersLike {
  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean;
  updateBuffer(turnId: string, panel: "thought" | "draft", text: string, totalLines: number): void;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
}

/** Optional injected stores for seam-level tests. */
export interface WebChannelRuntimeStateServiceDeps {
  agentStatusStore?: AgentStatusStoreLike;
  agentBuffers?: AgentBuffersLike;
}

/** Surviving WebChannel methods delegate pending-input resume and local UI observations here. */
export class WebChannelRuntimeStateService {
  private readonly agentStatusStore: AgentStatusStoreLike;
  private readonly agentBuffers: AgentBuffersLike;
  private readonly unregisterShutdown: () => void;
  private disposed = false;

  constructor(
    private readonly callbacks: WebChannelRuntimeStateCallbacks,
    private readonly options: WebChannelRuntimeStateOptions,
    deps: WebChannelRuntimeStateServiceDeps = {}
  ) {
    this.agentStatusStore = deps.agentStatusStore ?? new AgentStatusStore();
    this.agentBuffers = deps.agentBuffers ?? new AgentBuffers();
    this.unregisterShutdown = registerPreShutdownHook(() => this.dispose());
  }

  dispose(): void {
    if (this.disposed) return;
    this.agentStatusStore.dispose();
    this.unregisterShutdown();
    this.disposed = true;
  }

  getThreadRootId(chatJid: string, messageId: string, store?: ChatRunControlStore): number | null {
    return getThreadRootIdForChat(chatJid, messageId, store);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    if (this.disposed) return;
    resumeWebChat(chatJid, threadRootId, {
      defaultAgentId: this.options.defaultAgentId,
      enqueue: this.callbacks.enqueue.bind(this.callbacks),
      processChat: this.callbacks.processChat.bind(this.callbacks),
    });
  }

  resumePendingChats(chatJid?: string, store?: WebPendingResumeStore): void {
    if (this.disposed) return;
    resumeWebPendingChats({
      assistantName: this.callbacks.getAssistantName(),
      defaultAgentId: this.options.defaultAgentId,
      enqueue: this.callbacks.enqueue.bind(this.callbacks),
      processChat: (chat, agent, thread) => this.callbacks.processChat(chat, agent, thread ?? undefined),
      recoveryDelayMs: RECOVERY_REPLAY_DELAY_MS,
      sleep: (ms) => Bun.sleep(ms),
    }, chatJid, store);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    if (!this.disposed) this.agentStatusStore.update(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    if (this.disposed) return null;
    const saved = this.agentStatusStore.get(chatJid);
    if (this.callbacks.isNativeRuntime?.() !== true || !this.callbacks.readNativeTurnState) return saved;
    const { operation, queued } = this.callbacks.readNativeTurnState(chatJid);
    const laneBusy = this.callbacks.isChatLaneBusy?.(chatJid) === true;
    // Worker cleanup can outlive terminal publication. A busy lane alone is
    // not an active durable model turn and must not resurrect Stop/Working.
    const nativeTaskRunning = laneBusy && saved?.type === "intent" && ["native_task", "compaction", "session_rotation"].includes(String(saved.intent_key));
    if (operation || queued || nativeTaskRunning) {
      const active = saved && saved.type !== "done" && saved.type !== "error"
        && (nativeTaskRunning || (operation && saved.operation_id === operation.operation_id)) ? saved : {};
      return { ...active, chat_jid: chatJid, type: active.type ?? "thinking", state: "active", source: "durable_runtime",
        title: active.title ?? (operation ? "Working" : laneBusy ? "Running queued work" : "Queued"),
        operation_id: operation?.operation_id ?? null, operation_phase: operation?.phase ?? null, queued_count: queued };
    }
    return saved && saved.type !== "done" && saved.type !== "error" ? { ...saved, type: "done", state: "idle", title: "Idle", queued_count: 0 } : saved;
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.agentBuffers.setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.agentBuffers.isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.agentBuffers.updateBuffer(turnId, "thought", text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.agentBuffers.updateBuffer(turnId, "draft", text, totalLines);

  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.agentBuffers.getBuffer(turnId, panel);
  }
}
