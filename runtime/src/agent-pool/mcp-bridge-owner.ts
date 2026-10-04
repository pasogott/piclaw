import type { AgentSession, ExtensionFactory, LoadExtensionsResult, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { acquireMcpSessionBridge, type McpSessionBridgeLease } from "../secure/mcp-keychain.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
const log = createLogger("mcp-bridge-owner");

const OWNER_NAME = "piclaw-mcp-owner";
const OWNER_PATH = `<inline:${OWNER_NAME}>`;

export interface McpOwnerLifecycle {
  shutdown(reason?: string): Promise<void>;
}

/**
 * One bridge lease per extension-load generation, not per AgentSession lifetime.
 * The owner's public shutdown handlers run before our release handler. Dispose
 * is a fallback for failed construction/direct session disposal; it cannot
 * certify transport cleanup when the SDK or owner suppresses shutdown errors.
 */
export function createMcpBridgeOwner(
  createOwner: (bridge: McpSessionBridgeLease, onLifecycle: (lifecycle: McpOwnerLifecycle) => void) => ExtensionFactory,
  acquire: () => McpSessionBridgeLease = acquireMcpSessionBridge,
  options: { requireLifecycle?: boolean; shutdownTimeoutMs?: number } = {},
) {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) throw new Error("Invalid MCP owner cleanup deadline.");
  let active: { release(): void; dispose(): void; shutdown(reason?: string): Promise<void>; loaded: boolean } | null = null;
  let disposed = false;
  let cleanupFailed = false;
  const factory: ExtensionFactory = async pi => {
    if (disposed || cleanupFailed || active) throw new Error("MCP bridge owner is not ready for a new generation.");
    const bridge = acquire();
    let released = false;
    let lifecycle: McpOwnerLifecycle | undefined;
    let shutdownPromise: Promise<void> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const generation = {
      loaded: false,
      shutdown(reason = "Piclaw MCP owner shutdown") {
        if (!shutdownPromise) {
          let timer: ReturnType<typeof setTimeout>;
          const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MCP owner cleanup deadline exceeded")), shutdownTimeoutMs); });
          cleanupPromise = Promise.resolve().then(() => lifecycle?.shutdown(reason));
          shutdownPromise = Promise.race([cleanupPromise, deadline]).catch(error => {
            cleanupFailed = true;
            throw new Error("MCP owner cleanup failed; replacement remains blocked.", { cause: error });
          }).finally(() => clearTimeout(timer!));
        }
        return shutdownPromise;
      },
      dispose() {
        if (!lifecycle) { generation.release(); return; }
        void generation.shutdown().catch(error => debugSuppressedError(log, "MCP disposal acknowledgement failed; replacement remains blocked.", error));
        // Deadline/rejection blocks replacement but does not certify raw cleanup.
        void cleanupPromise!.then(() => generation.release(), () => generation.release());
      },
      release() {
        if (released) return;
        released = true;
        try { bridge.release(); }
        finally { if (active === generation) active = null; }
      },
    };
    active = generation;
    try {
      await createOwner(bridge, handle => {
        if (lifecycle) throw new Error("MCP owner supplied duplicate lifecycle handles.");
        lifecycle = handle;
      })(pi);
      if (options.requireLifecycle && !lifecycle) throw new Error("MCP adapter did not supply its public shutdown lifecycle.");
      if (disposed || released) throw new Error("MCP bridge owner was disposed during loading.");
      // Registered last so the adapter retains its scoped environment until
      // its earlier shutdown handlers settle through the public SDK.
      pi.on("session_shutdown", async () => {
        await generation.shutdown();
        generation.release();
      });
      generation.loaded = true;
    } catch (error) {
      generation.dispose();
      throw error;
    }
  };
  return {
    extension: { name: OWNER_NAME, factory },
    assertLoaded(result: Pick<LoadExtensionsResult, "extensions" | "errors">) {
      // Factory completion precedes the SDK's registration commit. The SDK
      // can discard that extension and resolve reload with a diagnostic.
      const published = result.extensions.filter(extension => extension.path === OWNER_PATH).length === 1
        && !result.errors.some(error => error.path === OWNER_PATH);
      if (disposed || cleanupFailed || !active?.loaded || !published) {
        if (!cleanupFailed) active?.dispose();
        throw new Error("MCP bridge owner did not load.");
      }
    },
    blockAdmission() { cleanupFailed = true; },
    assertAdmission() {
      if (disposed || cleanupFailed) throw new Error("MCP owner is disposed or cleanup is unresolved; operations remain blocked.");
    },
    async shutdown(reason?: string) { await active?.shutdown(reason); },
    dispose() {
      disposed = true;
      const generation = active;
      if (!generation) return;
      // Direct synchronous SDK disposal cannot acknowledge transport closure.
      // Keep scoped credentials until the public cleanup promise settles.
      generation.dispose();
    },
  };
}

/** Preserve the caller's reload barrier and release leases on direct disposal. */
export function bindMcpBridgeOwner(
  session: Pick<AgentSession, "reload" | "dispose" | "abort" | "prompt">,
  loader: Pick<ResourceLoader, "getExtensions">,
  owner: ReturnType<typeof createMcpBridgeOwner>,
): void {
  const assertLoaded = () => owner.assertLoaded(loader.getExtensions());
  assertLoaded();
  const dispose = session.dispose.bind(session);
  const reload = session.reload.bind(session);
  const prompt = session.prompt.bind(session);
  let reloading = false;
  const admittedPrompts = new Set<Promise<void>>();
  session.prompt = (...args) => {
    owner.assertAdmission();
    if (reloading) throw new Error("MCP owner reload is in progress; operations remain blocked.");
    // Register before invocation: SDK input/auth/extension preflight precedes
    // its active-agent flag, so abort/isIdle cannot certify prompt quiescence.
    const pending = Promise.resolve().then(() => {
      owner.assertAdmission();
      if (reloading) throw new Error("MCP owner reload is in progress; operations remain blocked.");
      return prompt(...args);
    });
    admittedPrompts.add(pending);
    void pending.then(() => admittedPrompts.delete(pending), () => admittedPrompts.delete(pending));
    return pending;
  };
  session.dispose = () => {
    // SDK dispose aborts synchronously; listeners must see the host fence first.
    owner.dispose();
    try { dispose(); }
    finally { owner.dispose(); }
  };
  session.reload = async options => {
    // The SDK reload and resource loader both mutate shared session state.
    // Reject rather than queue: a barrier can itself try to reload.
    if (reloading) throw new Error("MCP bridge owner reload is already in progress.");
    // Reject instead of self-draining: commands inside an admitted prompt may
    // request reload, and its own preflight cannot await itself.
    if (admittedPrompts.size) throw new Error("MCP owner reload is blocked until admitted prompts settle.");
    reloading = true;
    try {
      owner.assertAdmission();
      await session.abort();
      owner.assertAdmission();
      await owner.shutdown("Piclaw MCP owner reload");
      owner.assertAdmission();
      await reload({ ...options, beforeSessionStart: async () => {
        assertLoaded();
        await options?.beforeSessionStart?.();
        assertLoaded();
      } });
      assertLoaded();
    } catch (error) {
      owner.blockAdmission();
      throw error;
    } finally { reloading = false; }
  };
}
