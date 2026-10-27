/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { AgentSession, AgentSessionRuntime, ExtensionFactory, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { getSshConfig } from "../db.js";
import { readAccessConfig } from '../core/config-access.js';
import { createChatSshCoreExtension, resolveSshCoreConfigFromChatConfig } from "../extensions/ssh-core.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import type { AgentSessionBinder } from "./session-binder.js";
import type { AgentSessionManager, PoolEntry } from "./session-manager.js";
import type { AgentToolFactory, AgentBashOperations } from "./tool-factory.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentPoolOptions } from "./contracts.js";
import type { PiclawCredentialStore } from "./credential-store.js";
import { McpCodemodeController } from "./mcp-codemode-runtime.js";
import { createRequire } from "node:module";

const DURABLE_LEGACY_MESSAGE = "Durable application does not construct legacy sessions";
const require = createRequire(import.meta.url);

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
  if (options.getDurableSession !== undefined && typeof options.getDurableSession !== "function") {
    throw new Error("Durable service factory lookup must be callable");
  }
  const getDurableSession = options.getDurableSession?.bind(options);
  const attachments = getAttachmentRegistry();

  const durable = getDurableSession !== undefined;
  const unavailable = () => { throw new Error(DURABLE_LEGACY_MESSAGE); };

  const sessionBinder: SessionBinderService = durable ? {
    setBinder: () => undefined,
    bindSession: async () => undefined,
  } : new (require("./session-binder.js") as { AgentSessionBinder: new (...args: any[]) => SessionBinderService }).AgentSessionBinder({
    pool: options.pool,
    onError: options.onError,
  });

  const toolFactory: ToolFactoryService = durable ? {
    createDefaultTools: unavailable,
    createCustomToolOverrides: () => [],
  } : new (require("./tool-factory.js") as { AgentToolFactory: new (...args: any[]) => ToolFactoryService }).AgentToolFactory({
    workspaceDir: options.workspaceDir,
    bashOperations: options.bashOperations,
  });

  const turnCoordinator: TurnCoordinatorService = durable ? {
    createTracker: unavailable,
    subscribe: unavailable,
    startPromptTimeout: unavailable,
  } : new (require("./turn-coordinator.js") as { AgentTurnCoordinator: new (...args: any[]) => TurnCoordinatorService }).AgentTurnCoordinator({
    takeAttachments: (chatJid: string) => attachments.take(chatJid),
    touchSession: (chatJid: string) => {
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
  } : new (require("./session-manager.js") as { AgentSessionManager: new (...args: any[]) => SessionManagerService }).AgentSessionManager({
    getDurableSession,
    modelRegistry: options.modelRegistry,
    pool: options.pool,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    mainSessionMaxSize: options.mainSessionMaxSize,
    createSession: options.createSession,
    createDefaultTools: () => toolFactory.createDefaultTools(),
    createCustomToolOverrides: (chatJid: string) => toolFactory.createCustomToolOverrides(chatJid),
    getSessionExtensionFactories: (chatJid: string) => resolveSessionExtensionFactories(chatJid),
    bindSession: async (runtime: AgentSessionRuntime, chatJid: string) => {
      (require("./usage.js") as { installSessionUsageRecorder: (session: unknown, chatJid: string, onWarn?: AgentPoolLogHooks["onWarn"]) => void })
        .installSessionUsageRecorder(runtime.session, chatJid, options.onWarn);
      await sessionBinder.bindSession(runtime, chatJid);
    },
    ensureBranchRegistration: (chatJid: string, session?: AgentSession | null) => {
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
