import { expect, test } from "bun:test";
import type { ExtensionAPI, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { bindMcpBridgeOwner, createMcpBridgeOwner } from "../../src/agent-pool/mcp-bridge-owner.js";

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

test("public shutdown acknowledgement settles before SDK reload and scoped lease release", async () => {
  const f = fixture();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let shutdowns = 0;
  const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ async shutdown() { shutdowns++; await gate; } }), f.acquire, { requireLifecycle: true });
  let api = f.createApi(); await owner.extension.factory(api.api);
  let reloads = 0, prompts = 0;
  const session = { async abort() {}, async prompt() { prompts++; }, dispose() {}, async reload(options: any) { reloads++; await api.shutdown(); api = f.createApi(); await owner.extension.factory(api.api); await options.beforeSessionStart(); } };
  bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
  const reload = session.reload({}); await Bun.sleep(0);
  expect(reloads).toBe(0); expect(f.releases).toBe(0); expect(shutdowns).toBe(1);
  expect(() => session.prompt()).toThrow("reload is in progress"); expect(prompts).toBe(0);
  finish(); await reload;
  expect(reloads).toBe(1); expect(f.releases).toBe(1); expect(f.acquired).toBe(2);
  await session.prompt(); expect(prompts).toBe(1);
  await api.shutdown(); owner.dispose();
});

for (const failure of ["reject", "timeout"] as const) {
  test(`failed public cleanup ${failure} blocks reload, replacement and captured prompt`, async () => {
    const f = fixture();
    const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ shutdown: () => failure === "reject" ? Promise.reject(Error("synthetic close failure")) : new Promise(() => {}) }), f.acquire, { requireLifecycle: true, shutdownTimeoutMs: 20 });
    const api = f.createApi(); await owner.extension.factory(api.api);
    let reloads = 0, prompts = 0;
    const session = { async abort() {}, async prompt() { prompts++; }, dispose() {}, async reload() { reloads++; } };
    bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
    await expect(session.reload()).rejects.toThrow("replacement remains blocked");
    await expect(session.reload()).rejects.toThrow("cleanup is unresolved");
    expect(() => session.prompt()).toThrow("cleanup is unresolved");
    await expect(owner.extension.factory(f.createApi().api)).rejects.toThrow("not ready");
    expect(reloads).toBe(0); expect(prompts).toBe(0); expect(f.releases).toBe(0);
  });
}

for (const stage of ["settings", "loader", "barrier", "discarded-owner"] as const) {
  test(`post-ACK SDK reload ${stage} failure keeps admission fenced`, async () => {
    const f = fixture();
    const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ async shutdown() {} }), f.acquire, { requireLifecycle: true });
    let api = f.createApi(); await owner.extension.factory(api.api);
    let publishedResult = published, prompts = 0;
    const session = { async abort() {}, async prompt() { prompts++; }, dispose() {}, async reload(options: any) {
      if (stage === "settings" || stage === "loader") throw Error("synthetic SDK mutation failure");
      await api.shutdown(); api = f.createApi(); await owner.extension.factory(api.api);
      if (stage === "discarded-owner") publishedResult = { extensions: [], errors: [] };
      await options.beforeSessionStart();
    } };
    bindMcpBridgeOwner(session as any, { getExtensions: () => publishedResult } as any, owner);
    await expect(session.reload(stage === "barrier" ? { beforeSessionStart() { throw Error("synthetic barrier failure"); } } : {})).rejects.toThrow();
    expect(() => session.prompt()).toThrow("cleanup is unresolved");
    await expect(session.reload({})).rejects.toThrow("cleanup is unresolved");
    expect(prompts).toBe(0); owner.dispose(); await Bun.sleep(0);
  });
}

test("admitted prompt preflight and reentrant reload stay outside cleanup until prompt settles", async () => {
  const f = fixture(); let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let shutdowns = 0, aborts = 0, reloads = 0;
  const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ async shutdown() { shutdowns++; } }), f.acquire, { requireLifecycle: true });
  let api = f.createApi(); await owner.extension.factory(api.api);
  const session = { async abort() { aborts++; }, async prompt() {
    await expect(session.reload({})).rejects.toThrow("admitted prompts");
    await gate;
  }, dispose() {}, async reload(options: any) { reloads++; await api.shutdown(); api = f.createApi(); await owner.extension.factory(api.api); await options.beforeSessionStart(); } };
  bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
  const prompt = session.prompt();
  await expect(session.reload({})).rejects.toThrow("admitted prompts");
  expect(aborts).toBe(0); expect(shutdowns).toBe(0); expect(f.releases).toBe(0);
  finish(); await prompt; await session.reload({});
  expect(reloads).toBe(1); expect(f.releases).toBe(1); await api.shutdown(); owner.dispose();
});

test("same-turn prompt admission then disposal rejects before queued SDK invocation", async () => {
  const f = fixture(); const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ async shutdown() {} }), f.acquire, { requireLifecycle: true });
  await owner.extension.factory(f.createApi().api);
  let prompts = 0; const session = { async abort() {}, async prompt() { prompts++; }, async reload() {}, dispose() {} };
  bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
  const pending = session.prompt(); session.dispose();
  await expect(pending).rejects.toThrow("disposed"); expect(prompts).toBe(0);
});

test("synchronous SDK disposal listeners cannot reenter captured prompt or reload", async () => {
  const f = fixture(); const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ async shutdown() {} }), f.acquire, { requireLifecycle: true });
  await owner.extension.factory(f.createApi().api);
  let prompts = 0, reloads = 0; let nested!: Promise<void>;
  const session = { async abort() {}, async prompt() { prompts++; }, async reload() { reloads++; }, dispose() {
    expect(() => session.prompt()).toThrow("disposed"); nested = session.reload();
  } };
  bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
  session.dispose(); await expect(nested).rejects.toThrow("disposed");
  expect(prompts).toBe(0); expect(reloads).toBe(0); await Bun.sleep(0);
});

for (const phase of ["abort", "ack"] as const) {
  test(`disposal during awaited ${phase} prevents SDK reload mutation`, async () => {
    const f = fixture(); let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ shutdown: () => phase === "ack" ? gate : Promise.resolve() }), f.acquire, { requireLifecycle: true });
    await owner.extension.factory(f.createApi().api);
    let reloads = 0;
    const session = { abort: () => phase === "abort" ? gate : Promise.resolve(), async prompt() {}, async reload() { reloads++; }, dispose() {} };
    bindMcpBridgeOwner(session as any, { getExtensions: () => published } as any, owner);
    const pending = session.reload(); await Bun.sleep(0); session.dispose(); finish();
    await expect(pending).rejects.toThrow("disposed"); expect(reloads).toBe(0);
  });
}

test("direct disposal keeps the scoped lease until raw cleanup settles after deadline", async () => {
  const f = fixture(); let finish!: () => void;
  const cleanup = new Promise<void>(resolve => { finish = resolve; });
  const owner = createMcpBridgeOwner((_bridge, onLifecycle) => () => onLifecycle({ shutdown: () => cleanup }), f.acquire, { requireLifecycle: true, shutdownTimeoutMs: 10 });
  await owner.extension.factory(f.createApi().api);
  owner.dispose(); await Bun.sleep(15); expect(f.releases).toBe(0);
  finish(); await Bun.sleep(0); expect(f.releases).toBe(1);
});

test("required public lifecycle cannot be silently discarded by an old adapter", async () => {
  const f = fixture();
  const owner = createMcpBridgeOwner(() => () => {}, f.acquire, { requireLifecycle: true });
  await expect(owner.extension.factory(f.createApi().api)).rejects.toThrow("did not supply");
  expect(f.releases).toBe(1);
});

test("release errors do not leave a falsely loaded owner", async () => {
  const f = fixture();
  const owner = createMcpBridgeOwner(() => () => {}, () => { const bridge = f.acquire(); return { ...bridge, release: () => { bridge.release(); throw Error("release failed"); } }; });
  const api = f.createApi(); await owner.extension.factory(api.api);
  await expect(api.shutdown()).rejects.toThrow("release failed");
  expect(() => owner.assertLoaded(published)).toThrow("did not load");
  owner.dispose(); expect(f.releases).toBe(1);
});
