import type { AgentSession, ExtensionFactory, LoadExtensionsResult, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { acquireMcpSessionBridge, type McpSessionBridgeLease } from "../secure/mcp-keychain.js";

const OWNER_NAME = "piclaw-mcp-owner";
const OWNER_PATH = `<inline:${OWNER_NAME}>`;

/**
 * One bridge lease per extension-load generation, not per AgentSession lifetime.
 * The owner's public shutdown handlers run before our release handler. Dispose
 * is a fallback for failed construction/direct session disposal; it cannot
 * certify transport cleanup when the SDK or owner suppresses shutdown errors.
 */
export function createMcpBridgeOwner(
  createOwner: (bridge: McpSessionBridgeLease) => ExtensionFactory,
  acquire: () => McpSessionBridgeLease = acquireMcpSessionBridge,
) {
  let active: { release(): void; loaded: boolean } | null = null;
  let disposed = false;
  const factory: ExtensionFactory = async pi => {
    if (disposed || active) throw new Error("MCP bridge owner is not ready for a new generation.");
    const bridge = acquire();
    let released = false;
    const generation = {
      loaded: false,
      release() {
        if (released) return;
        released = true;
        try { bridge.release(); }
        finally { if (active === generation) active = null; }
      },
    };
    active = generation;
    try {
      await createOwner(bridge)(pi);
      if (disposed || released) throw new Error("MCP bridge owner was disposed during loading.");
      // Registered last so the adapter retains its scoped environment until
      // its earlier shutdown handlers settle through the public SDK.
      pi.on("session_shutdown", async () => generation.release());
      generation.loaded = true;
    } catch (error) {
      generation.release();
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
      if (disposed || !active?.loaded || !published) {
        active?.release();
        throw new Error("MCP bridge owner did not load.");
      }
    },
    dispose() { disposed = true; active?.release(); },
  };
}

/** Preserve the caller's reload barrier and release leases on direct disposal. */
export function bindMcpBridgeOwner(
  session: Pick<AgentSession, "reload" | "dispose">,
  loader: Pick<ResourceLoader, "getExtensions">,
  owner: ReturnType<typeof createMcpBridgeOwner>,
): void {
  const assertLoaded = () => owner.assertLoaded(loader.getExtensions());
  assertLoaded();
  const dispose = session.dispose.bind(session);
  const reload = session.reload.bind(session);
  let reloading = false;
  session.dispose = () => {
    try { dispose(); }
    finally { owner.dispose(); }
  };
  session.reload = async options => {
    // The SDK reload and resource loader both mutate shared session state.
    // Reject rather than queue: a barrier can itself try to reload.
    if (reloading) throw new Error("MCP bridge owner reload is already in progress.");
    reloading = true;
    try {
      await reload({ ...options, beforeSessionStart: async () => {
        assertLoaded();
        await options?.beforeSessionStart?.();
        assertLoaded();
      } });
      assertLoaded();
    } finally { reloading = false; }
  };
}
