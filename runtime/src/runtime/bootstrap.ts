/**
 * runtime/bootstrap.ts – Runtime bootstrap orchestration and default dependency wiring.
 */

import { AgentPool } from "../agent-pool.js";
import assert from "node:assert/strict";
import { WebChannel } from "../channels/web.js";
import { AgentQueue } from "../queue.js";
import { getDb, getNewMessages } from "../db.js";
import { SESSIONS_DIR } from "../core/config.js";
import { getInstalledAddonRuntimeEntries } from "../addons/runtime-contributions.js";
import type { RuntimeLockHandle } from "./single-instance.js";
import { getChatTransport } from "../extensions/chat-transport-registry.js";
import type { LegacyCaptureCoordinator } from "../agent-pool/legacy-authority-capture.js";

export interface RuntimeMigrationPreparation {
  coordinator: LegacyCaptureCoordinator;
  capture(): ReturnType<AgentPool["captureLegacyUpgradeBindings"]>;
  /** Invalidates the capability, but never resumes the old application. */
  release(): void;
}
export interface RuntimeBootstrapContext {
  prepareLegacyMigration(migrationIncarnation: string): Promise<RuntimeMigrationPreparation>;
}
import { createRuntimeModelServices } from "../agent-pool/model-services.js";
import { installRuntimeModelExecutor } from "../extensions/model-execution-runtime.js";
import { registerGitHubCopilotDynamicModels } from "../extensions/github-copilot-dynamic-models.js";
import {
  getIdentityConfig,
  getRoutingConfig,
  getRuntimeTimingConfig,
  WORKSPACE_DIR,
} from "../core/config.js";
import { stopIpcWatcher } from "../ipc.js";
import {
  clearHydratedMcpCredentials,
  hydrateMcpKeychainCredentials,
  type HydratedMcpCredential,
} from "../secure/mcp-keychain.js";
import type { SchedulerDeps } from "../task-scheduler.js";
import { stopSchedulerLoop } from "../task-scheduler.js";
import { createLogger } from "../utils/logger.js";
import type { RuntimeSignalRegistrar } from "./composition.js";
import { registerRuntimeShutdownSignals } from "./composition.js";
import { startRuntimeLoop, type StartRuntimeLoopDeps } from "./coordinator.js";
import { ModelRefreshCoordinator, type ModelRefreshResult } from "./model-refresh.js";
import { registerOptionalProviders, stopOptionalProviders } from "./provider-bootstrap.js";
import { createShutdownHandler, type ShutdownDeps } from "./shutdown.js";
import { createShutdownCompletion, registerShutdownHandler } from "./shutdown-registry.js";
import {
  initializeRuntimeEnvironment,
  queueStartupResumePendingIpc,
  startOptionalPushoverChannel,
  startWebChannel,
} from "./startup.js";
import {
  createRuntimeSenders,
  startRuntimeWorkers,
  type RuntimeModelResolver,
  type RuntimePushoverWorkerChannel,
  type RuntimeSenders,
  type RuntimeWebWorkerChannel,
} from "./wiring.js";

const log = createLogger("runtime.bootstrap");

export type RuntimeBootstrapQueue =
  & StartRuntimeLoopDeps["queue"]
  & SchedulerDeps["queue"]
  & ShutdownDeps["queue"];

export type RuntimeBootstrapAgentPool =
  & StartRuntimeLoopDeps["agentPool"]
  & SchedulerDeps["agentPool"]
  & RuntimeModelResolver
  & ShutdownDeps["agentPool"];

export type RuntimeBootstrapState = StartRuntimeLoopDeps["state"];
export type RuntimeBootstrapWeb = RuntimeWebWorkerChannel & ShutdownDeps["web"];
export type RuntimeBootstrapPushover = RuntimePushoverWorkerChannel & NonNullable<ShutdownDeps["pushover"]>;

export interface RuntimeBootstrapBaseServices {
  queue: RuntimeBootstrapQueue;
  state: RuntimeBootstrapState;
}

export interface RuntimeBootstrapDefaultBaseServices extends RuntimeBootstrapBaseServices {
  queue: Parameters<typeof startWebChannel>[0];
}

export interface RuntimeBootstrapDeps {
  base: RuntimeBootstrapBaseServices;
  /** Internal inspection only; absent in production composition. No source selector. */
  migrationInspection?: { onReady(context: RuntimeBootstrapContext): void };
  assistantName: string;
  triggerPattern: RegExp;
  pollIntervalMs: number;
  signalRegistrar: RuntimeSignalRegistrar;
  initializeRuntimeEnvironment(state: RuntimeBootstrapState): { effectiveMode: "single-user" | "family-shared" } | void;
  hydrateMcpCredentials(): Promise<HydratedMcpCredential[]>;
  clearMcpCredentials(entries: HydratedMcpCredential[]): void;
  createAgentPool(): Promise<RuntimeBootstrapAgentPool>;
  startWebChannel(queue: RuntimeBootstrapQueue, agentPool: RuntimeBootstrapAgentPool): Promise<RuntimeBootstrapWeb>;
  startBackgroundModelRefresh(agentPool: RuntimeBootstrapAgentPool): void;
  startOptionalPushoverChannel(): Promise<RuntimeBootstrapPushover | null>;
  createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void>;
  registerRuntimeShutdownSignals(
    registrar: RuntimeSignalRegistrar,
    shutdown: (signal: string) => Promise<void>
  ): void;
  createRuntimeSenders(
    web: RuntimeBootstrapWeb,
    pushover: RuntimeBootstrapPushover | null
  ): RuntimeSenders;
  startRuntimeWorkers(
    queue: RuntimeBootstrapQueue,
    agentPool: RuntimeBootstrapAgentPool,
    web: RuntimeBootstrapWeb,
    senders: RuntimeSenders
  ): void;
  queueStartupResumePendingIpc(): void;
  startRuntimeLoop(deps: StartRuntimeLoopDeps): Promise<void>;
  waitForFamilyShutdown?(): Promise<void>;
  /** Synchronous certificate, before shutdown's process.exit can bypass main's finally. */
  onShutdownComplete?(): void;
  log(message: string): void;
  stopIpcWatcher(): Promise<void>;
  stopSchedulerLoop(): void | Promise<void>;
  stopOptionalProviders(): void;
}

function logBackgroundRefreshResult(result: ModelRefreshResult): void {
  const errors = [...result.errors.entries()].map(([provider, error]) => ({ provider, error: error.message }));
  const details = {
    operation: "model_runtime.background_refresh",
    status: result.status,
    providerErrors: errors,
    error: result.error?.message,
  };
  if (result.status === "completed" && errors.length === 0) log.info("Background model catalogs refreshed", details);
  else log.warn("Background model catalog refresh completed with diagnostics", details);
}

/** Build default runtime bootstrap dependencies from production modules. */
export function createDefaultRuntimeBootstrapDeps(base: RuntimeBootstrapDefaultBaseServices): RuntimeBootstrapDeps {
  let refreshCoordinator: ModelRefreshCoordinator | null = null;
  return {
    base,
    assistantName: getIdentityConfig().assistantName,
    triggerPattern: getRoutingConfig().triggerPattern,
    pollIntervalMs: getRuntimeTimingConfig().pollIntervalMs,
    signalRegistrar: process,
    initializeRuntimeEnvironment: () => initializeRuntimeEnvironment(base.state),
    hydrateMcpCredentials: () => hydrateMcpKeychainCredentials(WORKSPACE_DIR),
    clearMcpCredentials: clearHydratedMcpCredentials,
    createAgentPool: async () => {
      const modelServices = await createRuntimeModelServices();
      installRuntimeModelExecutor(modelServices.modelRuntime);
      registerGitHubCopilotDynamicModels(modelServices.modelRuntime);
      const agentPool = new AgentPool({
        credentialStore: modelServices.credentialStore,
        modelRuntime: modelServices.modelRuntime,
        modelRegistry: modelServices.modelRegistry,
      });
      refreshCoordinator = new ModelRefreshCoordinator({
        modelRuntime: modelServices.modelRuntime,
        onComplete: logBackgroundRefreshResult,
      });
      return agentPool;
    },
    startWebChannel: (queue, agentPool) => startWebChannel(queue as Parameters<typeof startWebChannel>[0], agentPool as Parameters<typeof startWebChannel>[1]),
    startBackgroundModelRefresh: (agentPool) => {
      void (async () => {
        await registerOptionalProviders(agentPool);
        await refreshCoordinator?.queue();
      })().catch((error) => {
        log.warn("Background provider/model bootstrap failed", {
          operation: "model_runtime.background_bootstrap",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    startOptionalPushoverChannel: () => startOptionalPushoverChannel(),
    createShutdownHandler,
    registerRuntimeShutdownSignals,
    createRuntimeSenders,
    startRuntimeWorkers,
    queueStartupResumePendingIpc,
    startRuntimeLoop,
    waitForFamilyShutdown: () => new Promise<void>(() => {}),
    log: (message) => log.info(message, { operation: "bootstrap.banner" }),
    stopIpcWatcher,
    stopSchedulerLoop,
    stopOptionalProviders,
  };
}

/** Bootstrap and run all runtime subsystems in production order. */
export async function bootstrapRuntime(deps: RuntimeBootstrapDeps, runtimeOwner?: RuntimeLockHandle): Promise<void> {
  const { queue, state } = deps.base;
  // Owned by this bootstrap instance, not by the forever-awaited coordinator.
  const shutdownCompletion = createShutdownCompletion();
  const messageLoopController = new AbortController();
  let messageLoop: Promise<void> | undefined;
  let messageLoopStop: Promise<void> | undefined;
  let migrationHold = false;
  const stopMessageLoop = (): Promise<void> => {
    messageLoopController.abort();
    return messageLoopStop ??= messageLoop ?? Promise.resolve();
  };

  const access = deps.initializeRuntimeEnvironment(state);
  const familyMode = access?.effectiveMode === "family-shared";
  const hydratedMcpCredentials = familyMode ? [] : await deps.hydrateMcpCredentials();
  try {
    const agentPool = await deps.createAgentPool();
    deps.log("=== Piclaw - Pi Coding Agent Assistant ===");

    const web = await deps.startWebChannel(queue, agentPool);
    const pushover = familyMode ? null : await deps.startOptionalPushoverChannel();
    if (!familyMode) deps.startBackgroundModelRefresh(agentPool);

    const baseShutdown = deps.createShutdownHandler({
      queue,
      agentPool,
      web,
      pushover,
      stopIpcWatcher: deps.stopIpcWatcher,
      stopMessageLoop,
      stopSchedulerLoop: deps.stopSchedulerLoop,
      stopOptionalProviders: deps.stopOptionalProviders,
      onShutdownComplete: () => {
        deps.onShutdownComplete?.();
        shutdownCompletion.complete();
      },
    });
    const shutdown = async (signal: string): Promise<void> => {
      try {
        await baseShutdown(signal);
      } finally {
        deps.clearMcpCredentials(hydratedMcpCredentials);
      }
    };
    registerShutdownHandler(shutdown);
    deps.registerRuntimeShutdownSignals(deps.signalRegistrar, shutdown);

    const senders = deps.createRuntimeSenders(web, pushover);
    if (familyMode) {
      await Promise.race([
        deps.waitForFamilyShutdown?.() ?? new Promise<void>(() => {}),
        shutdownCompletion.promise,
      ]);
      if (messageLoopController.signal.aborted) await shutdownCompletion.promise;
      return;
    }
    deps.startRuntimeWorkers(queue, agentPool, web, senders);

    if (messageLoopController.signal.aborted) {
      await shutdownCompletion.promise;
      return;
    }
    messageLoop = deps.startRuntimeLoop({
      queue,
      state,
      agentPool,
      assistantName: deps.assistantName,
      triggerPattern: deps.triggerPattern,
      pollIntervalMs: deps.pollIntervalMs,
      signal: messageLoopController.signal,
    });
    if (deps.migrationInspection) {
      let preparation: Promise<RuntimeMigrationPreparation> | undefined;
      const context: RuntimeBootstrapContext = Object.freeze({
        prepareLegacyMigration(migrationIncarnation: string): Promise<RuntimeMigrationPreparation> {
          if (preparation) return preparation;
          // Preflight has no sealing effects. The owner is main's actual acquired
          // handle, never a caller's certificate or a second ownership ledger.
          try {
            assert(runtimeOwner?.enabled && runtimeOwner.strictOwnership, "Strict runtime owner required");
            runtimeOwner.assertCurrentOwner();
            assert(!familyMode, "Family ingress is not migration-qualified");
            const installedChannels = [web, ...(pushover ? [pushover] : [])];
            assert(installedChannels.every(channel => channel === web && channel instanceof WebChannel),
              "Unsupported installed channel");
            // Autonomous add-on writers/transports are outside Web's admission
            // contract. Production add-on compatibility is NOT certified here.
            assert(getInstalledAddonRuntimeEntries().length === 0, "Installed add-ons are not migration-qualified");
            assert(!getChatTransport("bang") && (!getChatTransport("local") || getChatTransport("local")!.id === "local"),
              "Unsupported registered transport");
            assert(queue instanceof AgentQueue && agentPool instanceof AgentPool, "Installed capture services required");
            assert(migrationIncarnation && migrationIncarnation.trim() === migrationIncarnation, "Missing migration controller identity");
          } catch (error) { return Promise.reject(error); }
          const owner = runtimeOwner!;
          const installedQueue = queue as AgentQueue;
          const installedPool = agentPool as AgentPool;
          const installedWeb = web as WebChannel;
          // Set before initiating any stop: even failed migration must keep the
          // application lifetime/global owner held until certified shutdown.
          migrationHold = true;
          let valid = true, drained = false;
          const checkOwner = () => { owner.assertCurrentOwner(); assert(valid, "Migration capability released"); };
          const checkFrontier = () => {
            checkOwner();
            assert(getInstalledAddonRuntimeEntries().length === 0 && !getChatTransport("bang") &&
              (!getChatTransport("local") || getChatTransport("local")!.id === "local"), "Ingress registry changed");
            const root = getDb();
            assert(!root.inTransaction, "Root DB transaction active");
            assert(!root.query("SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed') LIMIT 1").get(), "Pending S01 sources");
            assert(!root.query("SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal' LIMIT 1").get(), "Nonterminal S01 operations");
            assert(!root.query("SELECT 1 FROM chat_cursors WHERE preflight_message_id IS NOT NULL OR inflight_message_id IS NOT NULL OR (queued_followups_json IS NOT NULL AND queued_followups_json <> '[]') LIMIT 1").get(), "Unsettled legacy chat cursors");
            const jids = (root.query("SELECT jid FROM chats UNION SELECT chat_jid AS jid FROM messages").all() as { jid: string }[]).map(row => row.jid);
            assert(getNewMessages(jids, state.lastTimestamp, deps.assistantName).messages.length === 0, "Unread accepted legacy messages");
            installedPool.assertLegacyCaptureIdle();
            checkOwner();
          };
          const coordinator: LegacyCaptureCoordinator = Object.freeze({
            assertSealedAndDrained() { checkOwner(); assert(drained, "Migration ingress has not drained"); installedQueue.assertLegacyCaptureDrained(); checkFrontier(); },
            migrationIncarnation() { checkOwner(); return migrationIncarnation; },
          });
          preparation = (async () => {
            checkOwner();
            // sealAdmissions closes synchronously, before any producer stops.
            const webJoin = installedWeb.sealAdmissions();
            const pollerJoin = stopMessageLoop();
            const schedulerJoin = Promise.resolve(deps.stopSchedulerLoop());
            const ipcJoin = deps.stopIpcWatcher();
            checkOwner();
            await Promise.all([webJoin, pollerJoin, schedulerJoin, ipcJoin]);
            checkOwner();
            // Accepted producer callbacks may enqueue until their joins finish.
            const queueJoin = installedQueue.sealAndDrain();
            checkOwner();
            await queueJoin.joined;
            checkOwner();
            checkFrontier();
            drained = true;
            coordinator.assertSealedAndDrained();
            return Object.freeze({ coordinator,
              capture: () => installedPool.captureLegacyUpgradeBindings({ root: getDb(), legacySessionRoot: SESSIONS_DIR,
                owner, queue: installedQueue, coordinator }),
              release() { valid = false; },
            });
          })();
          return preparation;
        },
      });
      deps.migrationInspection.onReady(context);
    }
    await messageLoop;
    // A joined producer is not a disposed application. In particular, an
    // injected process.exit may return while shutdown is still unwinding.
    if (migrationHold || messageLoopController.signal.aborted) await shutdownCompletion.promise;
  } catch (error) {
    deps.clearMcpCredentials(hydratedMcpCredentials);
    // Rejection here would run main's finally and release the global owner.
    // An uncertain shutdown must remain owned until certified safe cleanup.
    if (migrationHold || messageLoopController.signal.aborted) await shutdownCompletion.promise;
    throw error;
  }
}
