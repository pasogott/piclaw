import type { NativeTurnViewChannel } from "../channels/web/agent/native-turn-view.js";
/**
 * runtime/bootstrap.ts – Runtime bootstrap orchestration and default dependency wiring.
 */

import { AgentPool } from "../agent-pool.js";
import { assertDurableEngineDependencies } from "./durable-engine-dependencies.js";
import type { AgentPoolOptions } from "../agent-pool.js";
import type { DurableAbortScope } from "../agent-pool/durable-runtime-adapter.js";
import type { WebChannelOpts } from "../channels/web.js";

/** One prepared backend, owned by bootstrap from construction through queue join. */
export interface RuntimeBackend {
  /** Resolves only after a failed public SDK session has closed its storage. */
  readonly storageFailure?: Promise<unknown>;
  readonly sessionOptions: Readonly<Pick<AgentPoolOptions, "getDurableSession" | "dispatchScheduledAgent" | "dispatchSidePrompt" | "dispatchHostCommand" | "prepareAddonOperation" | "dispatchAddonOperation" | "reconcileAddonOperation">>;
  readonly bind: (options: Pick<WebChannelOpts, "queue" | "agentPool">) => Readonly<WebChannelOpts>;
  /** Attach the actual constructed channel, never a global channel lookup. */
  attachChannel?(channel: NativeTurnViewChannel & { resumePendingChats?(chatJid?: string): void; requestWorkspaceFileOpen?(chatJid: string, path: string, label: string): Promise<unknown> }): void;
  /** Wake queue-owned observers before queue join; do not dispose storage yet. */
  stop(): void;
  /** Close the borrowed scope after queue join, never the application's global owner. */
  close(): Promise<void>;
}
/** Recreate only a backend whose public SDK session has finished failed-storage cleanup. */
export async function createRecoverableRuntimeBackend(prepare: () => Promise<RuntimeBackend>): Promise<RuntimeBackend> {
  let current = await prepare();
  let recovery: Promise<void> | undefined;
  let failed: RuntimeBackend | undefined;
  let stopping = false;
  let closing: Promise<void> | undefined;
  let binding: Parameters<RuntimeBackend["bind"]>[0] | undefined;
  let channelBindings: Readonly<WebChannelOpts> | undefined;
  let channel: Parameters<NonNullable<RuntimeBackend["attachChannel"]>>[0] | undefined;
  const log = createLogger("runtime.storage-recovery");
  const assertLive = () => { if (stopping) throw Error("Native runtime closing"); };
  const ready = async () => { assertLive(); if (recovery) await recovery; assertLive(); };
  const observe = (backend: RuntimeBackend) => {
    if (!backend.storageFailure) return;
    void backend.storageFailure.then(error => {
      if (stopping || current !== backend) return;
      failed = backend;
      log.error("Native session failed; reopening after confirmed storage closure", { operation: "native_storage.recover", err: error });
      recovery = Promise.resolve().then(async () => {
        backend.stop();
        // Cleanup uncertainty retains ownership and prevents a replacement from opening.
        await backend.close();
        if (stopping) return;
        const next = await prepare();
        if (stopping) { next.stop(); await next.close(); return; }
        current = next;
        try {
          if (binding) channelBindings = next.bind(binding);
          if (channel) await next.attachChannel?.(channel);
        } catch (error) {
          next.stop();
          try { await next.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native recovery cleanup uncertain"); }
          throw error;
        }
        observe(next);
        log.info("Native session reopened from persisted work", { operation: "native_storage.recovered" });
      });
      void recovery.catch(error => log.error("Native recovery failed; automatic retry disabled", { operation: "native_storage.recovery_failed", err: error }));
    }).catch(error => log.error("Invalid native storage-failure notification", { operation: "native_storage.notification_failed", err: error }));
  };
  observe(current);
  const getDurableSession: NonNullable<RuntimeBackend["sessionOptions"]["getDurableSession"]> = chat => {
    assertLive();
    const backend = current;
    const port = backend.sessionOptions.getDurableSession?.(chat);
    if (!port) return undefined;
    const abort = (method: "abort" | "abortRetry") => port[method] ? async (expected?: DurableAbortScope) => {
      assertLive();
      const live = await port.readAbortScope?.();
      if (live === null) return false;
      if (expected && (!live || expected.operationId !== live.operationId || expected.conversationId !== live.conversationId || expected.sourceSeq !== live.sourceSeq)) return false;
      const scope = live && Object.freeze({ operationId: live.operationId, conversationId: live.conversationId, sourceSeq: live.sourceSeq });
      if (scope && (typeof scope.operationId !== "string" || !scope.operationId || !Number.isSafeInteger(scope.conversationId) || scope.conversationId <= 0 || !Number.isSafeInteger(scope.sourceSeq) || scope.sourceSeq <= 0)) throw Error("Invalid abort recovery scope");
      try { return await port[method]!(scope); }
      catch (error) {
        // Never replay arbitrary controls, tools, dispatches or a newer operation.
        if (!scope || failed !== backend || !recovery) throw error;
        await ready();
        const next = current.sessionOptions.getDurableSession?.(chat);
        if (!next || next.sessionId !== port.sessionId || next.branchId !== port.branchId || !next[method]) throw error;
        return next[method]!(scope);
      }
    } : undefined;
    return Object.freeze({ ...port, abort: abort("abort"), abortRetry: abort("abortRetry") });
  };
  const sessionOptions: RuntimeBackend["sessionOptions"] = Object.freeze({
    getDurableSession,
    prepareAddonOperation: current.sessionOptions.prepareAddonOperation ? async (...args) => {
      await ready();
      if(!current.sessionOptions.prepareAddonOperation)throw Error("Native add-on admission unavailable");
      return current.sessionOptions.prepareAddonOperation(...args); // No automatic replay after uncertain admission.
    } : undefined,
    dispatchAddonOperation: current.sessionOptions.dispatchAddonOperation ? async (...args) => {
      await ready();
      if(!current.sessionOptions.dispatchAddonOperation)throw Error('Native add-on execution unavailable');
      return current.sessionOptions.dispatchAddonOperation(...args); // Same accepted ID; no automatic retry after uncertainty.
    } : undefined,
    reconcileAddonOperation: current.sessionOptions.reconcileAddonOperation ? async (...args) => {
      await ready();
      if(!current.sessionOptions.reconcileAddonOperation)throw Error('Native add-on recovery unavailable');
      return current.sessionOptions.reconcileAddonOperation(...args); // Observation only; no replay on failure.
    } : undefined,
    dispatchScheduledAgent: current.sessionOptions.dispatchScheduledAgent ? async (...args) => {
      await ready();
      if (!current.sessionOptions.dispatchScheduledAgent) throw Error("Native scheduled dispatch unavailable");
      return current.sessionOptions.dispatchScheduledAgent(...args);
    } : undefined,
    dispatchSidePrompt: current.sessionOptions.dispatchSidePrompt ? async (...args) => {
      await ready();
      if (!current.sessionOptions.dispatchSidePrompt) throw Error("Native side dispatch unavailable");
      return current.sessionOptions.dispatchSidePrompt(...args);
    } : undefined,
    dispatchHostCommand: current.sessionOptions.dispatchHostCommand ? async (...args) => {
      await ready();
      if (!current.sessionOptions.dispatchHostCommand) throw Error("Native command dispatch unavailable");
      return current.sessionOptions.dispatchHostCommand(...args);
    } : undefined,
  });
  return Object.freeze({ sessionOptions,
    bind(options: Parameters<RuntimeBackend["bind"]>[0]) {
      assertLive(); binding = { queue: options.queue, agentPool: options.agentPool };
      channelBindings = current.bind(binding);
      // The channel captures callbacks during construction. Future calls must use
      // freshly prepared admission scopes, never the closed backend callbacks.
      const forward = (key: string, member?: "waitForPending") => (...args: unknown[]) => {
        assertLive();
        const callback = (channelBindings as unknown as Record<string, unknown>)[key];
        if (typeof callback !== "function") throw Error("Native channel binding unavailable: " + key);
        if (member) {
          const method = (callback as unknown as Record<string, unknown>)[member];
          if (typeof method !== "function") throw Error("Native channel binding method unavailable: " + key + "." + member);
          return Reflect.apply(method, callback, args);
        }
        return Reflect.apply(callback, channelBindings, args);
      };
      return Object.freeze(Object.fromEntries(Object.entries(channelBindings).map(([key, value]) => {
        if (typeof value !== "function") return [key, value];
        const callback = forward(key);
        // Dispatch is callable and owns a pending observer. Both must follow the
        // replacement backend; copying its old method would retain closed ownership.
        if (key === "dispatchAcceptedInput") Object.assign(callback, { waitForPending: forward(key, "waitForPending") });
        return [key, callback];
      }))) as Readonly<WebChannelOpts>;
    },
    async attachChannel(value: Parameters<NonNullable<RuntimeBackend["attachChannel"]>>[0]) { await ready(); channel = value; await current.attachChannel?.(value); },
    stop() { if (stopping) return; stopping = true; current.stop(); },
    close() { return closing ??= (async () => {
      stopping = true; current.stop();
      if (recovery) await recovery;
      await current.close();
    })(); },
  });
}

export { RuntimeStartupCleanupError } from "./shutdown.js";
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
  /** Transaction-safe admission/owner check; no filesystem or frontier SQL. */
  assertAdmissionGuard(): void;
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
import { createShutdownHandler, RuntimeStartupCleanupError, type ShutdownDeps } from "./shutdown.js";
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
  /** Production durable preparation; absence is reserved for explicitly injected legacy test dependencies. */
  prepareApplicationBackend?: (owner: RuntimeLockHandle) => Promise<RuntimeBackend>;
  /** Internal inspection only; absent in production composition. No source selector. */
  migrationInspection?: { onReady(context: RuntimeBootstrapContext): void };
  assistantName: string;
  triggerPattern: RegExp;
  pollIntervalMs: number;
  signalRegistrar: RuntimeSignalRegistrar;
  initializeRuntimeEnvironment(state: RuntimeBootstrapState): { effectiveMode: "single-user" } | void;
  hydrateMcpCredentials(): Promise<HydratedMcpCredential[]>;
  clearMcpCredentials(entries: HydratedMcpCredential[]): void;
  createAgentPool(sessionOptions?: RuntimeBackend["sessionOptions"]): Promise<RuntimeBootstrapAgentPool>;
  startWebChannel(queue: RuntimeBootstrapQueue, agentPool: RuntimeBootstrapAgentPool, bind?: RuntimeBackend["bind"]): Promise<RuntimeBootstrapWeb>;
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
// Trusted package boundary: never a user-configurable plugin or source selector.
const MODULE_PATH = new URL("../../durable-engine/src/default-application-runtime.ts", import.meta.url).href;
async function prepareDefaultApplicationBackend(owner: RuntimeLockHandle, models: () => ReturnType<typeof createRuntimeModelServices>): Promise<RuntimeBackend> {
  assertDurableEngineDependencies();
  let engine: { createDefaultApplicationRuntime?: unknown };
  try { engine = await import(MODULE_PATH); }
  catch (cause) {
    // Only diagnose missing candidate packages. Evaluation failures retain their exact identity.
    if (cause instanceof Error && /Cannot find package ['"]@earendil-works\/(?:pi-durable|chord|pi-codemode|pi-telemetry|pi-ai)['"]/.test(cause.message))
      throw new Error("Durable engine unavailable. Install runtime/durable-engine dependencies before starting Piclaw; legacy fallback is disabled.", { cause });
    throw cause;
  }
  if (typeof engine.createDefaultApplicationRuntime !== "function") throw new Error("Durable engine contract missing createDefaultApplicationRuntime");
  const prepare = engine.createDefaultApplicationRuntime;
  return createRecoverableRuntimeBackend(() => prepare(owner, models));
}

export function createDefaultRuntimeBootstrapDeps(
  base: RuntimeBootstrapDefaultBaseServices,
  prepareApplicationBackend?: RuntimeBootstrapDeps["prepareApplicationBackend"],
): RuntimeBootstrapDeps {
  let refreshCoordinator: ModelRefreshCoordinator | null = null;
  let modelServicesPromise: ReturnType<typeof createRuntimeModelServices> | undefined;
  const models = () => modelServicesPromise ??= createRuntimeModelServices();
  return {
    base,
    prepareApplicationBackend: prepareApplicationBackend ?? (async owner => {
      // Engine performs history/ownership preflight before realizing the host model stack.
      return prepareDefaultApplicationBackend(owner, models);
    }),
    assistantName: getIdentityConfig().assistantName,
    triggerPattern: getRoutingConfig().triggerPattern,
    pollIntervalMs: getRuntimeTimingConfig().pollIntervalMs,
    signalRegistrar: process,
    initializeRuntimeEnvironment: () => initializeRuntimeEnvironment(base.state),
    hydrateMcpCredentials: () => hydrateMcpKeychainCredentials(WORKSPACE_DIR),
    clearMcpCredentials: clearHydratedMcpCredentials,
    createAgentPool: async (sessionOptions) => {
      const modelServices = await models();
      installRuntimeModelExecutor(modelServices.modelRuntime);
      registerGitHubCopilotDynamicModels(modelServices.modelRuntime);
      const agentPool = new AgentPool({
        credentialStore: modelServices.credentialStore,
        modelRuntime: modelServices.modelRuntime,
        modelRegistry: modelServices.modelRegistry,
        ...sessionOptions,
      });
      refreshCoordinator = new ModelRefreshCoordinator({
        modelRuntime: modelServices.modelRuntime,
        onComplete: logBackgroundRefreshResult,
      });
      return agentPool;
    },
    startWebChannel: (queue, agentPool, bind) => startWebChannel(queue as Parameters<typeof startWebChannel>[0], agentPool as Parameters<typeof startWebChannel>[1], bind),
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
    log: (message) => log.info(message, { operation: "bootstrap.banner" }),
    stopIpcWatcher,
    stopSchedulerLoop,
    stopOptionalProviders,
  };
}

/** Bootstrap and run all runtime subsystems in production order. */
export async function bootstrapRuntime(deps: RuntimeBootstrapDeps, runtimeOwner?: RuntimeLockHandle): Promise<void> {
  const { queue, state } = deps.base;
  const prepareApplicationBackend = deps.prepareApplicationBackend;
  let backend: RuntimeBackend | undefined;
  let partialPool: RuntimeBootstrapAgentPool | undefined;
  let partialWeb: RuntimeBootstrapWeb | undefined;
  let published = false;
  // Owned by this bootstrap instance, not by the forever-awaited coordinator.
  const shutdownCompletion = createShutdownCompletion();
  const messageLoopController = new AbortController();
  let messageLoop: Promise<void> | undefined;
  let messageLoopStop: Promise<void> | undefined;
  let migrationHold = false;
  const stopMessageLoop = (): Promise<void> => {
    messageLoopController.abort();
    backend?.stop();
    return messageLoopStop ??= messageLoop ?? Promise.resolve();
  };

  const access = deps.initializeRuntimeEnvironment(state);
  const hydratedMcpCredentials = await deps.hydrateMcpCredentials();
  try {
    if (prepareApplicationBackend) {
      assert(runtimeOwner?.enabled && runtimeOwner.strictOwnership, "Strict runtime owner required");
      runtimeOwner.assertCurrentOwner();
      backend = await prepareApplicationBackend(runtimeOwner);
    }
    const agentPool = partialPool = await deps.createAgentPool(backend?.sessionOptions);
    deps.log("=== Piclaw - Pi Coding Agent Assistant ===");

    const web = partialWeb = await deps.startWebChannel(queue, agentPool, backend?.bind);
    if (backend?.attachChannel) {
      if (!("broadcastEvent" in web) || typeof web.broadcastEvent !== "function") throw Error("Backend requires channel publisher");
      backend.attachChannel(web as unknown as Parameters<NonNullable<RuntimeBackend["attachChannel"]>>[0]);
    }
    const pushover = await deps.startOptionalPushoverChannel();
    deps.startBackgroundModelRefresh(agentPool);

    const baseShutdown = deps.createShutdownHandler({
      queue,
      agentPool,
      web,
      pushover,
      stopIpcWatcher: deps.stopIpcWatcher,
      stopMessageLoop,
      stopSchedulerLoop: deps.stopSchedulerLoop,
      stopOptionalProviders: deps.stopOptionalProviders,
      closeApplicationBackend: backend ? () => backend!.close() : undefined,
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
    published = true;
    registerShutdownHandler(shutdown);
    deps.registerRuntimeShutdownSignals(deps.signalRegistrar, shutdown);

    const senders = deps.createRuntimeSenders(web, pushover);
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
              assertAdmissionGuard() {
                checkOwner(); assert(drained, "Migration ingress has not drained");
                assert(getInstalledAddonRuntimeEntries().length === 0 && !getChatTransport("bang") &&
                  (!getChatTransport("local") || getChatTransport("local")!.id === "local"), "Ingress registry changed");
                installedQueue.assertLegacyCaptureDrained(); installedPool.assertLegacyCaptureIdle(); checkOwner();
              },
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
    if (backend && !published) {
      try {
        if (error instanceof RuntimeStartupCleanupError) throw error;
        backend.stop();
        await partialWeb?.stop();
        await queue.shutdown();
        await partialPool?.shutdown();
        await backend.close();
      } catch (cleanupError) {
        throw new RuntimeStartupCleanupError([error, cleanupError], "Application backend startup cleanup uncertain");
      }
    }
    // Rejection here would run main's finally and release the global owner.
    // An uncertain shutdown must remain owned until certified safe cleanup.
    if (migrationHold || messageLoopController.signal.aborted) await shutdownCompletion.promise;
    if (backend && published) throw new RuntimeStartupCleanupError([error], "Published application backend cleanup uncertain");
    throw error;
  }
}
