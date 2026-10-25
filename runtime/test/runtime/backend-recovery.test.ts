import { expect, test } from "bun:test";
import { createRecoverableRuntimeBackend, type RuntimeBackend } from "../../src/runtime/bootstrap.js";
import type { DurableAbortScope, DurableSessionPositionPort } from "../../src/agent-pool/durable-runtime-adapter.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const original: DurableAbortScope = { operationId: "op:accepted", conversationId: 7, sourceSeq: 11 };
function fixture(name: string, trace: string[]) {
  const failure = deferred<unknown>();
  const state = { scope: original as DurableAbortScope | null, closeError: undefined as Error | undefined,
    closeGate: undefined as Promise<void> | undefined, calls: [] as (DurableAbortScope | undefined)[], stopped: false };
  let closing: Promise<void> | undefined;
  const port: DurableSessionPositionPort = { sessionId: "native-domain", branchId: "main", readPosition: async () => "7",
    readAbortScope: async () => state.scope,
    abort: async expected => { state.calls.push(expected); if (expected && JSON.stringify(expected) !== JSON.stringify(state.scope)) return false; state.scope = null; return true; },
    abortRetry: async expected => port.abort!(expected),
  };
  const backend: RuntimeBackend = { storageFailure: failure.promise, sessionOptions: { getDurableSession: chat => chat === "web:test" ? port : undefined,
    dispatchHostCommand: async () => { trace.push(name + ":command"); return true; } },
    bind: () => { trace.push(name + ":bind"); return { prepareInputSourceAdmission: async () => { if (state.stopped) throw Error("Old admission scope closed"); trace.push(name + ":prepare"); } } as ReturnType<RuntimeBackend["bind"]>; },
    attachChannel: async () => { trace.push(name + ":attach"); },
    stop: () => { state.stopped = true; trace.push(name + ":stop"); },
    close: () => closing ??= (async () => { trace.push(name + ":close"); await state.closeGate; if (state.closeError) throw state.closeError; trace.push(name + ":closed"); })(),
  };
  return { failure, state, port, backend };
}
function failAbort(f: ReturnType<typeof fixture>, method: "abort" | "abortRetry" = "abort") {
  const error = Error("Session failed after a storage error");
  f.port[method] = async () => { f.failure.resolve(error); await tick(); throw error; };
  return error;
}

test("failed-storage abort reopens after closed ownership, rebinds, and retries only its captured run", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first);
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  backend.bind({} as Parameters<RuntimeBackend["bind"]>[0]);
  await backend.attachChannel!({} as Parameters<NonNullable<RuntimeBackend["attachChannel"]>>[0]);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(true);
  expect(prepares).toBe(2); expect(next.state.calls).toEqual([original]);
  expect(trace).toEqual(["old:bind", "old:attach", "old:stop", "old:close", "old:closed", "new:bind", "new:attach"]);
  await backend.close();
});

test("recovered abort refuses a successor even if its chat and session are unchanged", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first); next.state.scope = { ...original, operationId: "op:successor", sourceSeq: 12 };
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(false);
  expect(next.state.scope.operationId).toBe("op:successor"); expect(next.state.calls).toEqual([original]);
  await backend.close();
});

test("retry abort retains its exact scope through storage recovery", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first, "abortRetry");
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abortRetry!()).toBe(true);
  expect(next.state.calls).toEqual([original]); await backend.close();
});

test("uncertain cleanup retains failed ownership and never opens a replacement", async () => {
  const trace: string[] = [], first = fixture("old", trace); let prepares = 0;
  failAbort(first); const cleanup = Error("Storage close uncertain"); first.state.closeError = cleanup;
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(cleanup);
  expect(prepares).toBe(1); await expect(backend.close()).rejects.toBe(cleanup);
});

test("reopen waits for old cleanup and shutdown prevents a late replacement", async () => {
  const trace: string[] = [], first = fixture("old", trace), gate = deferred<void>(); let prepares = 0;
  first.state.closeGate = gate.promise;
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  first.failure.resolve(Error("failed storage")); await tick(); expect(prepares).toBe(1);
  backend.stop(); const close = backend.close(); gate.resolve(); await close;
  expect(prepares).toBe(1); expect(first.state.stopped).toBe(true);
});

test("normal shutdown and forged failure names do not trigger recovery", async () => {
  const trace: string[] = [], first = fixture("old", trace); let prepares = 0;
  const forged = Object.assign(Error("ordinary host error"), { name: "SessionFailed" }); first.port.abort = async () => { throw forged; };
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(forged);
  expect(prepares).toBe(1); backend.stop(); first.failure.resolve(forged); await tick(); expect(prepares).toBe(1); await backend.close();
});

test("unscoped abort is never replayed, even after a genuine storage failure", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  const error = failAbort(first); delete first.port.readAbortScope;
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(error);
  expect(next.state.calls).toEqual([]); await backend.close();
});

test("unknown chats and idle scopes do not abort or fabricate dispatch", async () => {
  const first = fixture("old", []); first.state.scope = null;
  const backend = await createRecoverableRuntimeBackend(async () => first.backend);
  expect(backend.sessionOptions.getDurableSession!("web:foreign")).toBeUndefined();
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(false);
  expect(first.state.calls).toEqual([]); await backend.close();
});

test("caller-supplied abort scope cannot be replaced with the current run", async () => {
  const first = fixture("old", []);
  const backend = await createRecoverableRuntimeBackend(async () => first.backend);
  const control = backend.sessionOptions.getDurableSession!("web:test")!;
  for (const foreign of [{ ...original, operationId: "foreign" }, { ...original, conversationId: 8 }, { ...original, sourceSeq: 12 }]) {
    expect(await control.abort!(foreign)).toBe(false);
  }
  expect(first.state.calls).toEqual([]); expect(first.state.scope).toEqual(original);
  await backend.close();
});

test("channel callbacks captured at startup use fresh admission scopes after reopen", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  const bound = backend.bind({} as Parameters<RuntimeBackend["bind"]>[0]);
  await bound.prepareInputSourceAdmission!("web:test");
  first.failure.resolve(Error("storage closed")); await tick();
  await bound.prepareInputSourceAdmission!("web:test");
  expect(trace.filter(value => value.endsWith(":prepare"))).toEqual(["old:prepare", "new:prepare"]);
  await backend.close();
});
