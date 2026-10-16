import { expect, test } from "bun:test";
import type { ModelRuntime as HostRuntime } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { Credential, CredentialStore, Model, TranscriptContext as HostTranscript, AssistantMessage } from "../../node_modules/@earendil-works/pi-ai";
import type { Models, ImageModel, ClassifierModel, Api, ImageApi, ClassifierApi } from "@earendil-works/pi-ai";
import { createHostModels, type HostModelPolicy } from "./src/host-models.ts";

// These ESM-only public exports have no require condition; resolve from root.
const root = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime }: typeof import("../../node_modules/@earendil-works/pi-coding-agent") =
  await import(import.meta.resolve("@earendil-works/pi-coding-agent", root));
const { createAssistantMessageEventStream }: typeof import("../../node_modules/@earendil-works/pi-ai") =
  await import(import.meta.resolve("@earendil-works/pi-ai", root));
import { normalizeContext } from "@earendil-works/pi-ai";
const ref = { provider: "qualification-provider", id: "qualification-model" };
const token = "SYNTHETIC-HOST-ONLY-TOKEN";
const model: Model<"openai-completions"> = { ...ref, name: "Qualification", api: "openai-completions",
  baseUrl: "https://fixture.invalid", input: ["text"], reasoning: true,
  contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function fixture() {
  let stored: Credential | undefined = { type: "api_key", key: token };
  const requested: string[] = [];
  const credentials: CredentialStore = {
    read: async (id) => {
      // Fail before any built-in provider can consult ambient credentials.
      if (id !== ref.provider) throw new Error("Non-fixture auth forbidden");
      requested.push(id); return stored;
    },
    list: async () => stored ? [{ providerId: ref.provider, type: stored.type }] : [],
    modify: async (_id, fn) => { stored = await fn(stored); return stored; },
    delete: async () => { stored = undefined; },
  };
  const runtime: HostRuntime = await ModelRuntime.create({ credentials, modelsPath: null,
    modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    allowModelNetwork: false, refreshOnCreate: false });
  const entered = barrier();
  const held = barrier();
  let hold = false;
  let fail = false;
  let calls = 0;
  let approved = true;
  let budget = true;
  let captured: any;
  let checks = 0;
  let onFence = () => {};
  const generation = new AbortController();
  const check = () => { if (!approved || !budget) throw new Error("Policy denied"); };
  const policy: HostModelPolicy = { signal: generation.signal,
    authorize: async () => check(), assertCurrent: () => { check(); if (++checks === 2) onFence(); } };
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: ref.provider,
    model: ref.id, thinkingLevel: "high", timestamp: Date.now(), stopReason: "toolUse",
    content: [{ type: "thinking", thinking: "synthetic reasoning" },
      { type: "toolCall", id: "call-1", name: "fixture_tool", arguments: { value: 7 } }],
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const run = (owner: Model<Api>, context: HostTranscript, options?: unknown) => {
    calls++; captured = { owner, context, options };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "toolUse", message: structuredClone(message) });
    stream.end(structuredClone(message));
    return stream;
  };
  runtime.registerNativeProvider({ id: ref.provider, name: "Synthetic", getModels: () => [model],
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }),
      resolve: async ({ credential }) => {
        if (hold) { entered.release(); await held.promise; }
        if (fail) throw new Error(token);
        return credential?.key ? { auth: { apiKey: credential.key, headers: { Authorization: `Bearer ${credential.key}` } } } : undefined;
      } } }, stream: run, streamSimple: run });
  const models: Models = createHostModels(runtime, [ref], policy);
  return { runtime, models, policy, requested, message, entered, held,
    model: models.getModel(ref.provider, ref.id)!,
    calls: () => calls, captured: () => captured,
    hold: () => { hold = true; }, fail: () => { fail = true; },
    revoke: () => { approved = false; }, exhaust: () => { budget = false; },
    abort: () => generation.abort(), onFence: (fn: () => void) => { onFence = fn; } };
}
const context = { messages: [{ role: "user" as const, content: "fixture", timestamp: 1 }],
  tools: [{ name: "fixture_tool", description: "fixture", parameters: { type: "object" as const } }] };

for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
  test(`${method}: delegates actual host runtime; preserves JSON tool/thinking/options`, async () => {
    const f = await fixture();
    const options = { reasoning: "high" as const, maxTokens: 42, temperature: 0.2 };
    const value = f.models[method](f.model, context, options);
    const result = "result" in value ? await value.result() : await value;
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual(f.message.content);
    expect(result.model).toBe(ref.id);
    expect(result.thinkingLevel).toBe("high");
    expect(f.calls()).toBe(1);
    expect(f.captured().options).toMatchObject({ ...options, apiKey: token, maxRetries: 0 });
    expect(f.captured().context.messages[0].toolsAdded).toEqual(context.tools);
    expect(f.requested.every((id) => id === ref.provider)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    const reads = f.requested.length;
    expect(JSON.stringify(await f.models.getAuth(f.model))).not.toContain(token);
    expect((await f.models.getAuth(f.model))?.auth).toEqual({});
    expect(f.requested.length).toBe(reads); // No host auth resolution/cache in 1.3.
    f.abort();
    expect(f.captured().options.signal.aborted).toBe(true);
    expect(JSON.stringify(f.models.getAllModels())).not.toContain("Authorization");
  });
  for (const reason of ["revoke", "exhaust", "abort"] as const) {
    test(`${method}: ${reason} during held host auth prevents fake provider dispatch`, async () => {
      const f = await fixture(); f.hold();
      const value = f.models[method](f.model, context);
      const result = "result" in value ? value.result() : value;
      await f.entered.promise; f[reason](); f.held.release();
      expect((await result).stopReason).toBe("error");
      expect(f.calls()).toBe(0);
    });
  }
}
test("denied approval/budget, auth failure and host logout never select another account", async () => {
  for (const action of ["revoke", "exhaust", "fail", "logout"] as const) {
    const f = await fixture();
    if (action === "logout") await f.runtime.logout(ref.provider); else f[action]();
    const result = await f.models.completeSimple(f.model, context);
    expect(result.stopReason).toBe("error"); expect(f.calls()).toBe(0);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(f.requested.every((id) => id === ref.provider)).toBe(true);
  }
});
test("complete factory interface denies non-chat, deferred, auth UI, overrides and provider bypass", async () => {
  const f = await fixture();
  expect(f.models.getModel(ref.provider, "alternative")).toBeUndefined();
  expect(f.models.getAllModels()).toHaveLength(1);
  expect(await f.models.getAvailableOfType("classifier")).toEqual([]);
  expect(await f.models.getAvailableOfType("image")).toEqual([]);
  const handle = { id: "synthetic", provider: ref.provider, modelId: ref.id, api: f.model.api };
  expect((await f.models.fetchDeferred(f.model, handle)).stopReason).toBe("error");
  expect((await f.models.streamDeferred(f.model, handle).result()).stopReason).toBe("error");
  await expect(f.models.cancelDeferred(f.model, handle)).rejects.toThrow();
  const image: ImageModel<ImageApi> = { ...f.model, type: "image", output: ["image"] };
  const classifier: ClassifierModel<ClassifierApi> = { ...f.model, type: "classifier" };
  expect((await f.models.generateImages(image, { input: [] })).stopReason).toBe("error");
  expect((await f.models.classify(classifier, { state: {}, questions: {} })).stopReason).toBe("error");
  expect(() => f.models.logout(ref.provider)).toThrow();
  expect(() => f.models.login(ref.provider, "api_key", { prompt: async () => token, notify: () => {} })).toThrow();
  for (const options of [{ deferred: true }, { apiKey: "override" },
    { transformHeaders: async () => ({}) }, { onResponse: () => {} }, { maxRetries: 1 }]) {
    expect(() => f.models.streamSimple(f.model, context, options)).toThrow();
  }
  f.revoke();
  const provider = f.models.getProvider(ref.provider)!;
  expect((await provider.streamSimple(f.model, normalizeContext(context)).result()).stopReason).toBe("error");
  expect(f.calls()).toBe(0);
});

test("accepted limitation: public transformHeaders is awaited, not an atomic dispatch fence", async () => {
  const f = await fixture();
  f.onFence(() => queueMicrotask(() => { f.revoke(); f.abort(); }));
  await f.models.completeSimple(f.model, context);
  // The runtime still calls the provider after revocation in this await gap.
  // A cooperative transport sees an aborted signal, but strict zero-dispatch
  // requires a public synchronous guard at provider invocation in host 1.2.
  expect(f.calls()).toBe(1);
  expect(f.captured().options.signal.aborted).toBe(true);
});
