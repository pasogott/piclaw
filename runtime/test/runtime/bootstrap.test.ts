import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/runtime.js";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";
import { createShutdownHandler } from "../../src/runtime/shutdown.js";
import {
  bootstrapRuntime,
  createDefaultRuntimeBootstrapDeps,
  type RuntimeBootstrapAgentPool,
  type RuntimeBootstrapDeps,
  type RuntimeBootstrapPushover,
  type RuntimeBootstrapQueue,
  type RuntimeBootstrapState,
  type RuntimeBootstrapWeb,
  type RuntimeBootstrapDefaultBaseServices,
} from "../../src/runtime/bootstrap.js";
import type { RuntimeSenders } from "../../src/runtime/wiring.js";

function bootstrapDepsForFailure(overrides: Partial<RuntimeBootstrapDeps> = {}): RuntimeBootstrapDeps {
  const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
  const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
  const web = { stop: async () => {} } as RuntimeBootstrapWeb;
  return {
    base: { queue, state: {} as RuntimeBootstrapState },
    assistantName: "Pi",
    triggerPattern: /@pi/i,
    pollIntervalMs: 1,
    signalRegistrar: { on: () => {} },
    initializeRuntimeEnvironment: () => {},
    hydrateMcpCredentials: async () => [{ serverName: "mcp", envName: "PICLAW_MCP_SECRET", keychainName: "mcp/test" }],
    clearMcpCredentials: () => {},
    createAgentPool: async () => agentPool,
    startWebChannel: async () => web,
    startBackgroundModelRefresh: () => {},
    startOptionalPushoverChannel: async () => null,
    createShutdownHandler: () => async () => {},
    registerRuntimeShutdownSignals: () => {},
    createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
    startRuntimeWorkers: () => {},
    queueStartupResumePendingIpc: () => {},
    startRuntimeLoop: async () => {},
    log: () => {},
    stopIpcWatcher: async () => {},
    stopSchedulerLoop: () => {},
    stopOptionalProviders: () => {},
    ...overrides,
  };
}

describe("runtime bootstrap", () => {
  test("stop joins only its own coordinator, is stable, and cannot stop a replacement", async () => {
    const startInstance = async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let stop!: () => void | Promise<void>;
      let signal!: AbortSignal;
      let complete!: () => void;
      const running = bootstrapRuntime(bootstrapDepsForFailure({
        createShutdownHandler: (deps) => { stop = deps.stopMessageLoop!; complete = deps.onShutdownComplete!; return async () => {}; },
        startRuntimeLoop: async (deps) => {
          signal = deps.signal!;
          entered.resolve();
          await release.promise; // Includes any asynchronous poll/notification tail.
        },
      }));
      await entered.promise;
      return { stop, signal, running, release, complete };
    };
    const old = await startInstance();
    let joined = false;
    const stopping = old.stop() as Promise<void>;
    void stopping.then(() => { joined = true; });
    expect(old.stop()).toBe(stopping);
    expect(old.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(joined).toBe(false);
    old.release.resolve();
    await stopping;
    old.complete();
    await old.running;
    const next = await startInstance();
    expect(old.stop()).toBe(stopping);
    expect(next.signal.aborted).toBe(false);
    const nextStop = next.stop();
    next.release.resolve();
    await nextStop;
    next.complete();
    await next.running;
  });

  test("stop registered before workers prevents later loop admission", async () => {
    let stop!: () => void | Promise<void>;
    let started = false;
    let complete!: () => void;
    await bootstrapRuntime(bootstrapDepsForFailure({
      createShutdownHandler: (deps) => { stop = deps.stopMessageLoop!; complete = deps.onShutdownComplete!; return async () => {}; },
      startRuntimeWorkers: () => { void stop(); complete(); },
      startRuntimeLoop: async () => { started = true; },
    }));
    expect(started).toBe(false);
  });

  test("applies environment before AgentPool creation and starts refresh after channels", async () => {
    const events: string[] = [];

    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;

    const web = {
      stop: async () => {},
      sendMessage: async () => {},
      resumeChat: () => {},
      resumePendingChats: () => {},
    } as RuntimeBootstrapWeb;

    const pushover = {
      stop: async () => {},
      sendMessage: async () => {},
    } as RuntimeBootstrapPushover;
    const senders = {
      sendMessage: async () => {},
      sendNudge: async () => {},
    } as RuntimeSenders;

    let capturedShutdownDeps: { stopIpcWatcher: () => void; stopSchedulerLoop: () => void; stopOptionalProviders: () => void } | null = null;

    const deps: RuntimeBootstrapDeps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 123,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => events.push("init-runtime-env"),
      hydrateMcpCredentials: async () => {
        events.push("hydrate-mcp-credentials");
        return [];
      },
      clearMcpCredentials: () => events.push("clear-mcp-credentials"),
      createAgentPool: async () => {
        events.push("create-agent-pool");
        return agentPool;
      },
      startWebChannel: async () => {
        events.push("start-web");
        return web;
      },
      startBackgroundModelRefresh: (received) => {
        expect(received).toBe(agentPool);
        events.push("start-model-refresh");
      },
      startOptionalPushoverChannel: async () => {
        events.push("start-pushover");
        return pushover;
      },
      createShutdownHandler: (shutdownDeps) => {
        events.push("create-shutdown");
        capturedShutdownDeps = {
          stopIpcWatcher: shutdownDeps.stopIpcWatcher,
          stopSchedulerLoop: shutdownDeps.stopSchedulerLoop,
          stopOptionalProviders: shutdownDeps.stopOptionalProviders,
        };
        return async () => {};
      },
      registerRuntimeShutdownSignals: () => events.push("register-shutdown-signals"),
      createRuntimeSenders: () => {
        events.push("create-senders");
        return senders;
      },
      startRuntimeWorkers: (_queue, _agentPool, _web, runtimeSenders) => {
        events.push("start-workers");
        expect(runtimeSenders).toBe(senders);
      },
      queueStartupResumePendingIpc: () => events.push("queue-startup-resume"),
      startRuntimeLoop: async (loopDeps) => {
        events.push("start-runtime-loop");
        expect(loopDeps.agentPool).toBe(agentPool);
        expect(loopDeps.assistantName).toBe("Pi");
        expect(loopDeps.pollIntervalMs).toBe(123);
      },
      log: () => events.push("log-banner"),
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    };

    await bootstrapRuntime(deps);

    expect(capturedShutdownDeps).not.toBeNull();
    expect(events).toEqual([
      "init-runtime-env",
      "hydrate-mcp-credentials",
      "create-agent-pool",
      "log-banner",
      "start-web",
      "start-pushover",
      "start-model-refresh",
      "create-shutdown",
      "register-shutdown-signals",
      "create-senders",
      "start-workers",
      "start-runtime-loop",
    ]);
  });

  test("family mode starts only the web runtime and waits without legacy workers", async () => {
    const events: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const deps = bootstrapDepsForFailure({
      initializeRuntimeEnvironment: () => ({ effectiveMode: "family-shared" }),
      hydrateMcpCredentials: async () => { events.push("mcp"); return []; },
      createAgentPool: async () => { events.push("agent-pool"); return { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool; },
      startWebChannel: async () => { events.push("web"); return { stop: async () => {} } as RuntimeBootstrapWeb; },
      startOptionalPushoverChannel: async () => { events.push("pushover"); return null; },
      startBackgroundModelRefresh: () => events.push("model-refresh"),
      startRuntimeWorkers: () => events.push("workers"),
      startRuntimeLoop: async () => { events.push("loop"); },
      waitForFamilyShutdown: () => wait,
    });
    const running = bootstrapRuntime(deps); await Bun.sleep(1);
    expect(events).toEqual(["agent-pool", "web"]);
    release(); await running;
  });

  test("clears hydrated MCP credentials when AgentPool creation fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      createAgentPool: async () => { throw new Error("agent pool failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("agent pool failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("clears hydrated MCP credentials when web startup fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      startWebChannel: async () => { throw new Error("web failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("web failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("background refresh is queued and not awaited by bootstrap", async () => {
    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;
    let refreshFinished = false;

    const deps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 1,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => {},
      hydrateMcpCredentials: async () => [],
      clearMcpCredentials: () => {},
      createAgentPool: async () => agentPool,
      startWebChannel: async () => ({ stop: async () => {} } as RuntimeBootstrapWeb),
      startBackgroundModelRefresh: () => {
        void Bun.sleep(100).then(() => { refreshFinished = true; });
      },
      startOptionalPushoverChannel: async () => null,
      createShutdownHandler: () => async () => {},
      registerRuntimeShutdownSignals: () => {},
      createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
      startRuntimeWorkers: () => {},
      queueStartupResumePendingIpc: () => {},
      startRuntimeLoop: async () => {},
      log: () => {},
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    } as RuntimeBootstrapDeps;

    await bootstrapRuntime(deps);
    expect(refreshFinished).toBe(false);
  });

  test("createDefaultRuntimeBootstrapDeps preserves provided runtime base", () => {
    const base = {
      queue: {} as RuntimeBootstrapDefaultBaseServices["queue"],
      state: {} as RuntimeBootstrapDefaultBaseServices["state"],
    };

    const deps = createDefaultRuntimeBootstrapDeps(base);

    expect(deps.base).toBe(base);
    expect(deps.assistantName.length).toBeGreaterThan(0);
    expect(typeof deps.pollIntervalMs).toBe("number");
    expect(deps.triggerPattern).toBeInstanceOf(RegExp);
    expect(typeof deps.hydrateMcpCredentials).toBe("function");
    expect(typeof deps.clearMcpCredentials).toBe("function");
    expect(typeof deps.createAgentPool).toBe("function");
    expect(typeof deps.startRuntimeLoop).toBe("function");
  });
});

for (const failure of ["none", "scheduler", "producer", "queue"] as const) {
  test(`main retains strict global owner through producer stop (${failure})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "poller-owner-"));
    const lockPath = join(dir, "runtime.lock");
    const acquire = () => acquireRuntimeLock({ lockPath, strictOwnership: true, disabled: false });
    const owner = acquire();
    const entered = Promise.withResolvers<void>();
    const scheduler = Promise.withResolvers<void>();
    const queueEntered = Promise.withResolvers<void>(), queue = Promise.withResolvers<void>();
    const poolEntered = Promise.withResolvers<void>(), pool = Promise.withResolvers<void>();
    const webEntered = Promise.withResolvers<void>(), web = Promise.withResolvers<void>();
    let shutdown!: (signal: string) => Promise<void>;
    let settled = false;
    const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
    const deps = bootstrapDepsForFailure({
      createShutdownHandler,
      registerRuntimeShutdownSignals: (_registrar, handler) => { shutdown = handler; },
      startRuntimeLoop: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
        if (failure === "producer") throw new Error("uncertain producer join");
      },
      stopSchedulerLoop: () => scheduler.promise,
      createAgentPool: async () => ({ shutdown: async () => { poolEntered.resolve(); await pool.promise; } }) as RuntimeBootstrapAgentPool,
      startWebChannel: async () => ({ stop: async () => { webEntered.resolve(); await web.promise; } }) as RuntimeBootstrapWeb,
    });
    deps.base.queue = { shutdown: async () => {
      queueEntered.resolve(); await queue.promise;
      if (failure === "queue") throw new Error("queue cleanup failed");
    } } as RuntimeBootstrapQueue;
    const running = main({ acquireLock: () => owner, createBootstrapDeps: () => deps });
    void running.then(() => { settled = true; }, () => { settled = true; });
    const assertHeld = async () => {
      await Bun.sleep(0);
      expect(settled).toBe(false);
      owner.assertCurrentOwner();
      expect(acquire).toThrow("refuses existing lock");
    };
    try {
      await entered.promise;
      const stopping = shutdown("test");
      // Observe rejection immediately, including a producer join failure.
      const stopped = stopping.catch((error: unknown) => error);
      await assertHeld(); // Producer has resolved, scheduler join is still held.
      if (failure === "scheduler" || failure === "producer") {
        if (failure === "scheduler") scheduler.reject(new Error("uncertain scheduler join"));
        const error = await stopped;
        expect(error).toBeInstanceOf(Error);
        await assertHeld();
        expect(exit).not.toHaveBeenCalled();
      } else {
        scheduler.resolve();
        await queueEntered.promise; await assertHeld(); queue.resolve();
        if (failure === "queue") {
          expect(await stopped).toBeInstanceOf(Error);
          await assertHeld();
          expect(exit).not.toHaveBeenCalled();
        } else {
          await poolEntered.promise; await assertHeld(); pool.resolve();
          await webEntered.promise; await assertHeld(); web.resolve();
          await stopping;
          await running;
          expect(exit).toHaveBeenCalledWith(0);
          const replacement = acquire();
          replacement.assertCurrentOwner();
          replacement.release();
        }
      }
    } finally {
      scheduler.resolve(); queue.resolve(); pool.resolve(); web.resolve();
      owner.release(); // Offline fixture cleanup only, including fail-closed case.
      exit.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("main preserves lock release on startup failure before producer stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poller-startup-owner-"));
  const acquire = () => acquireRuntimeLock({ lockPath: join(dir, "runtime.lock"), strictOwnership: true, disabled: false });
  try {
    await expect(main({ acquireLock: acquire, createBootstrapDeps: () => bootstrapDepsForFailure({
      createAgentPool: async () => { throw new Error("startup failed"); },
    }) })).rejects.toThrow("startup failed");
    acquire().release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
