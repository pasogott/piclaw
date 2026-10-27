/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { ExtensionFactory, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { getSshConfig } from "../db.js";
import { readAccessConfig } from '../core/config-access.js';
import { createChatSshCoreExtension, resolveSshCoreConfigFromChatConfig } from "../extensions/ssh-core.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import { AgentSessionBinder } from "./session-binder.js";
import { AgentSessionManager, type PoolEntry } from "./session-manager.js";
import { AgentToolFactory } from "./tool-factory.js";
import { AgentTurnCoordinator } from "./turn-coordinator.js";
import { installSessionUsageRecorder } from "./usage.js";
import type { AgentPoolOptions } from "./contracts.js";
import type { AgentBashOperations } from "./tool-factory.js";
import type { PiclawCredentialStore } from "./credential-store.js";
import { McpCodemodeController } from "./mcp-codemode-runtime.js";

const DURABLE_LEGACY_MESSAGE = "Durable application does not construct legacy sessions";

/** Shared logger callbacks used across extracted AgentPool services. */
export interface AgentPoolLogHooks {
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/** Inputs required to assemble the extracted AgentPool helper services. */
export interface AgentPoolServiceFactoryOptions extends AgentPoolLogHooks {
  pool: Map<string, PoolEntry>;
  activeForkBaseLeafByChat: Map<string, string | null>;
  authStorage: PiclawCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  workspaceDir: string;
  mainSessionMaxSize?: number | null;
  bashOperations?: AgentBashOperations;
  getDurableSession?: AgentPoolOptions["getDurableSession"];
  createSession?: AgentPoolOptions["createSession"];
}

type SessionBinderService = Pick<AgentSessionBinder, "setBinder" | "bindSession">;
type ToolFactoryService = Pick<AgentToolFactory, "createDefaultTools" | "createCustomToolOverrides">;
type TurnCoordinatorService = Pick<AgentTurnCoordinator, "createTracker" | "subscribe" | "startPromptTimeout">;
type SessionManagerService = Pick<AgentSessionManager,
  "assertLegacyCaptureIdle" | "blockMcpAdmissions" | "fenceMcpAndSnapshot" | "resumeMcpAdmissions" | "quarantineMcpRuntime"
  | "acquireEvictionProtection" | "getOrCreate" | "refreshRuntime" | "prewarm" | "cancelPrewarm" | "hasPendingSessionWork"
  | "recreate" | "hasProtectedRun" | "hasActiveMemoryReclamationWork" | "getInstrumentationSnapshot" | "evictIdle" | "shutdown">;
type BranchManagerService = Pick<AgentBranchManager,
  "ensureBranchRegistration" | "renameChatBranch" | "pruneChatBranch" | "mergeChatBranchIntoParent" | "renameChatJid"
  | "restoreChatBranch" | "permanentPurgeChatBranch" | "createForkedChatBranch" | "createRootChatSession"
  | "listActiveChats" | "listKnownChats" | "findActiveChatByAgentName" | "findChatByAgentName" | "getAgentHandleForChat">;

/** Concrete helper instances composed into AgentPool. */
export interface AgentPoolServices {
  mcpSettings: McpCodemodeController;
  attachments: ReturnType<typeof getAttachmentRegistry>;
  sessionBinder: SessionBinderService;
  toolFactory: ToolFactoryService;
  turnCoordinator: TurnCoordinatorService;
  sessionManager: SessionManagerService;
  runtimeFacade: AgentRuntimeFacade;
  branchManager: BranchManagerService;
}

async function resolveSessionExtensionFactories(chatJid: string): Promise<ExtensionFactory[]> {
  // Only single-user sessions may load instance SSH credentials.
  if (readAccessConfig().mode !== 'single-user') return [];
  let sshConfig: ReturnType<typeof getSshConfig> | undefined;
  try {
    sshConfig = getSshConfig(chatJid);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error.message !== "Database not initialized" && error.message !== "Cannot use a closed database")
    ) {
      throw error;
    }
  }
  return [createChatSshCoreExtension(chatJid, sshConfig ? resolveSshCoreConfigFromChatConfig(sshConfig) : null)];
}

/**
 * Assemble the extracted helper services used by AgentPool.
 * Keeps constructor wiring in one place so AgentPool itself remains a thin façade.
 */
export function createAgentPoolServices(options: AgentPoolServiceFactoryOptions): AgentPoolServices {
  const getDurableSession = options.getDurableSession?.bind(options);
  const attachments = getAttachmentRegistry();

  const durable = getDurableSession !== undefined;
  const unavailable = () => { throw new Error(DURABLE_LEGACY_MESSAGE); };

  const sessionBinder: SessionBinderService = durable ? {
    setBinder: () => undefined,
    bindSession: async () => undefined,
  } : new AgentSessionBinder({
    pool: options.pool,
    onError: options.onError,
  });

  const toolFactory: ToolFactoryService = durable ? {
    createDefaultTools: unavailable,
    createCustomToolOverrides: () => [],
  } : new AgentToolFactory({
    workspaceDir: options.workspaceDir,
    bashOperations: options.bashOperations,
  });

  const turnCoordinator: TurnCoordinatorService = durable ? {
    createTracker: unavailable,
    subscribe: unavailable,
    startPromptTimeout: unavailable,
  } : new AgentTurnCoordinator({
    takeAttachments: (chatJid) => attachments.take(chatJid),
    touchSession: (chatJid) => {
      const entry = options.pool.get(chatJid);
      if (entry) entry.lastUsed = Date.now();
    },
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  let sessionManager: SessionManagerService;
  let branchManager: BranchManagerService;
  const runtimeFacade = new AgentRuntimeFacade({
    pool: options.pool,
    getDurableSession,
    acquireCommandProtection: chatJid => sessionManager.acquireEvictionProtection(chatJid),
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    modelRegistry: options.modelRegistry,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    authPath: options.authStorage.authPath,
    clearAttachments: (chatJid) => attachments.clear(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    listKnownChats: () => branchManager.listKnownChats(),
    onWarn: options.onWarn,
    onError: options.onError,
  });

  sessionManager = durable ? {
    assertLegacyCaptureIdle: () => undefined,
    blockMcpAdmissions: () => undefined,
    fenceMcpAndSnapshot: async () => [],
    resumeMcpAdmissions: () => undefined,
    quarantineMcpRuntime: async () => undefined,
    acquireEvictionProtection: () => () => undefined,
    getOrCreate: async () => { throw new Error(DURABLE_LEGACY_MESSAGE); },
    refreshRuntime: async () => undefined,
    prewarm: () => false,
    cancelPrewarm: () => false,
    hasPendingSessionWork: () => false,
    recreate: async () => { throw new Error(DURABLE_LEGACY_MESSAGE); },
    hasProtectedRun: () => false,
    hasActiveMemoryReclamationWork: () => false,
    getInstrumentationSnapshot: () => ({
      branchSeedRealizationsInFlight: 0,
      createInFlight: 0,
      evictionProtectedChats: 0,
      invalidDeferredSeedErrors: 0,
      prewarmInFlight: 0,
      queuedPrewarms: 0,
      prewarmQueueLength: 0,
      prewarmCooldowns: 0,
    }),
    evictIdle: () => undefined,
    shutdown: async () => undefined,
  } : new AgentSessionManager({
    getDurableSession,
    modelRegistry: options.modelRegistry,
    pool: options.pool,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    mainSessionMaxSize: options.mainSessionMaxSize,
    createSession: options.createSession,
    createDefaultTools: () => toolFactory.createDefaultTools(),
    createCustomToolOverrides: (chatJid) => toolFactory.createCustomToolOverrides(chatJid),
    getSessionExtensionFactories: (chatJid) => resolveSessionExtensionFactories(chatJid),
    bindSession: async (runtime, chatJid) => {
      installSessionUsageRecorder(runtime.session, chatJid, options.onWarn);
      await sessionBinder.bindSession(runtime, chatJid);
    },
    ensureBranchRegistration: (chatJid, session) => {
      branchManager.ensureBranchRegistration(chatJid, session);
    },
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  branchManager = new AgentBranchManager({
    pool: options.pool,
    activeForkBaseLeafByChat: options.activeForkBaseLeafByChat,
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    isActive: (chatJid) => runtimeFacade.isActive(chatJid),
    scheduleSessionWarmup: (chatJid) => sessionManager.prewarm(chatJid),
    cancelSessionWarmup: (chatJid) => sessionManager.cancelPrewarm(chatJid),
    hasPendingSessionWork: (chatJid) => sessionManager.hasPendingSessionWork(chatJid),
    onWarn: options.onWarn,
  });

  return {
    mcpSettings: new McpCodemodeController(sessionManager),
    attachments,
    sessionBinder,
    toolFactory,
    turnCoordinator,
    sessionManager,
    runtimeFacade,
    branchManager,
  };
}
