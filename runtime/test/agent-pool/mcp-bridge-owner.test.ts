import { expect, test } from "bun:test";
import type { ExtensionAPI, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { createMcpBridgeOwner } from "../../src/agent-pool/mcp-bridge-owner.js";

function fixture() {
  let acquired = 0, releases = 0;
  const events: string[] = [];
  const createApi = () => {
    const shutdown: Array<() => Promise<void>> = [];
    const api = { on: (event: string, handler: () => Promise<void>) => { if (event === "session_shutdown") shutdown.push(handler); } } as unknown as ExtensionAPI;
    return { api, shutdown: async () => { for (const handler of shutdown) await handler(); } };
  };
  const acquire = () => {
    const id = ++acquired; let closed = false;
    events.push(`acquire:${id}`);
    return { revision: String(id), config: { mcpServers: {} }, resolveRuntimeEnv: () => closed ? {} : { SYNTHETIC: String(id) }, release: () => { releases++; closed = true; events.push(`release:${id}`); } };
  };
  return { acquire, createApi, events, get acquired() { return acquired; }, get releases() { return releases; } };
}

const published = { extensions: [{ path: "<inline:piclaw-mcp-owner>" }], errors: [] } as unknown as Pick<LoadExtensionsResult, "extensions" | "errors">;

test("bridge generations release after owner shutdown and reacquire per reload", async () => {
  const f = fixture();
  const owner = createMcpBridgeOwner(bridge => pi => { let stopped = false; pi.on("session_shutdown", async () => { if (stopped) return; stopped = true; expect(bridge.resolveRuntimeEnv("test").SYNTHETIC).toBe(bridge.revision); f.events.push(`shutdown:${bridge.revision}`); }); }, f.acquire);
  expect(f.acquired).toBe(0);
  const first = f.createApi(); await owner.extension.factory(first.api); owner.assertLoaded(published);
  await expect(owner.extension.factory(f.createApi().api)).rejects.toThrow("not ready");
  expect(f.acquired).toBe(1);
  await first.shutdown(); await first.shutdown(); expect(f.releases).toBe(1);
  const second = f.createApi(); await owner.extension.factory(second.api); await second.shutdown(); owner.dispose(); owner.dispose();
  expect(f.events).toEqual(["acquire:1", "shutdown:1", "release:1", "acquire:2", "shutdown:2", "release:2"]);
  expect(f.releases).toBe(2);
  await expect(owner.extension.factory(f.createApi().api)).rejects.toThrow("not ready");
});

test("failed owner loading and disposal during loading do not leak or double-release leases", async () => {
  const f = fixture();
  const broken = createMcpBridgeOwner(() => async () => { throw Error("fixture failure"); }, f.acquire);
  await expect(broken.extension.factory(f.createApi().api)).rejects.toThrow("fixture failure"); broken.dispose(); expect(f.releases).toBe(1);
  let finish!: () => void;
  const loading = createMcpBridgeOwner(() => async () => { await new Promise<void>(resolve => { finish = resolve; }); }, f.acquire);
  const api = f.createApi(); const pending = loading.extension.factory(api.api);
  loading.dispose(); finish(); await expect(pending).rejects.toThrow("disposed"); await api.shutdown(); loading.dispose(); expect(f.releases).toBe(2);
});

test("a stale shutdown cannot release a replacement generation", async () => {
  const f = fixture(), owner = createMcpBridgeOwner(() => () => {}, f.acquire);
  const old = f.createApi(); await owner.extension.factory(old.api); await old.shutdown();
  const next = f.createApi(); await owner.extension.factory(next.api); await old.shutdown(); expect(f.releases).toBe(1);
  owner.dispose(); expect(f.releases).toBe(2);
});

for (const kind of ["absent", "diagnostic", "duplicate"] as const) {
  test(`loader ${kind} rejects a locally completed factory and releases its lease`, async () => {
    const f = fixture(), owner = createMcpBridgeOwner(() => () => {}, f.acquire);
    await owner.extension.factory(f.createApi().api);
    const result = { extensions: kind === "absent" ? [] : kind === "duplicate" ? [...published.extensions, ...published.extensions] : published.extensions,
      errors: kind === "diagnostic" ? [{ path: "<inline:piclaw-mcp-owner>", error: "Synthetic failed registration commit" }] : [] };
    expect(() => owner.assertLoaded(result)).toThrow("did not load");
    owner.dispose(); expect(f.releases).toBe(1);
  });
}

test("unrelated extension diagnostic is not an MCP owner failure", async () => {
  const f = fixture(), owner = createMcpBridgeOwner(() => () => {}, f.acquire);
  await owner.extension.factory(f.createApi().api);
  owner.assertLoaded({ ...published, errors: [{ path: "<inline:unrelated>", error: "Synthetic error" }] });
  owner.dispose(); expect(f.releases).toBe(1);
});

test("acquire failure is not a loaded owner and may be retried", async () => {
  const f = fixture(); let fail = true;
  const owner = createMcpBridgeOwner(() => () => {}, () => { if (fail) throw Error("acquire failed"); return f.acquire(); });
  await expect(owner.extension.factory(f.createApi().api)).rejects.toThrow("acquire failed");
  expect(() => owner.assertLoaded(published)).toThrow("did not load");
  fail = false; await owner.extension.factory(f.createApi().api); owner.assertLoaded(published);
  owner.dispose(); expect(f.releases).toBe(1);
});

test("release errors do not leave a falsely loaded owner", async () => {
  const f = fixture();
  const owner = createMcpBridgeOwner(() => () => {}, () => { const bridge = f.acquire(); return { ...bridge, release: () => { bridge.release(); throw Error("release failed"); } }; });
  const api = f.createApi(); await owner.extension.factory(api.api);
  await expect(api.shutdown()).rejects.toThrow("release failed");
  expect(() => owner.assertLoaded(published)).toThrow("did not load");
  owner.dispose(); expect(f.releases).toBe(1);
});
