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
async function fixture(multimodal = false, keyless = false) {
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
  const admissions: string[] = [];
  let onFence = () => {};
  const generation = new AbortController();
  const check = () => { if (!approved || !budget) throw new Error("Policy denied"); };
  const policy: HostModelPolicy = { signal: generation.signal,
    authorize: async (owner, kind) => { admissions.push(`${owner.provider}/${owner.id}/${kind}`); check(); }, assertCurrent: () => { check(); if (++checks === 2) onFence(); } };
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
  const image: ImageModel<ImageApi> = { ...model, type: "image", api: "synthetic-images", output: ["image", "text"],
    headers: { Authorization: token }, inputLimits: { maxRequestBytes: 10000,
      images: { maxPerRequest: 2, resize: { maxWidth: 512, ...{ credential: token } }, ...{ token } }, ...{ token } },
    cost: { ...model.cost, ...{ token } } };
  const classifier: ClassifierModel<ClassifierApi> = { ...image, type: "classifier", api: "synthetic-classifier", contextWindow: 2048 };
  const oneShot = (owner: unknown, ctx: unknown, options: unknown) => { calls++; captured = { owner, context: ctx, options }; };
  runtime.registerNativeProvider({ id: ref.provider, name: "Synthetic", getModels: () => [model],
    getAllModels: () => multimodal ? [model, image, classifier] : [model],
    generateImages: async (owner, ctx, options) => {
      oneShot(owner, ctx, options);
      if (fail) throw new Error(token);
      return { api: owner.api, provider: owner.provider, model: owner.id, stopReason: "stop", timestamp: 2,
        output: [{ type: "image", data: "c3ludGhldGlj", mimeType: "image/png", ...{ token } }, { type: "text", text: "synthetic" }],
        usage: { ...message.usage, cost: { ...message.usage.cost, total: 0.25, ...{ token } } },
        ...{ token, cause: token, errorMessage: token } };
    },
    classify: async (owner, ctx, options) => {
      oneShot(owner, ctx, options);
      if (fail) throw new Error(token);
      return { api: owner.api, provider: owner.provider, model: owner.id, stopReason: "stop", timestamp: 2,
        answers: { valid: { type: "bool", probability: 0.9, ...{ token } },
          pick: { type: "choice", choice: "yes", probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 },
          score: { type: "score", score: 0.7, confidence: 0.6 } }, usage: message.usage,
        ...{ token, cause: token, errorMessage: token } };
    },
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }),
      resolve: async ({ credential }) => {
        if (hold) { entered.release(); await held.promise; }
        if (fail) throw new Error(token);
        if (keyless) return { auth: {}, source: "synthetic-keyless" };
        return credential?.key ? { auth: { apiKey: credential.key, headers: { Authorization: `Bearer ${credential.key}` } } } : undefined;
      } } }, stream: run, streamSimple: run });
  const approvedModels = multimodal ? [ref, { ...ref, type: "image" as const }, { ...ref, type: "classifier" as const }] : [ref];
  const models: Models = createHostModels(runtime, approvedModels, policy);
  return { runtime, models, policy, requested, message, entered, held, admissions,
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

const imageContext = { input: [{ type: "text" as const, text: "draw synthetic" }] };
const classifierContext = { state: { text: "synthetic", numbers: [1, 2] }, questions: {
  valid: { type: "bool" as const, instructions: "valid?", criteria: { true: "yes", false: "no" } } } };
for (const kind of ["image", "classifier"] as const) {
  const invoke = (f: Awaited<ReturnType<typeof fixture>>, override?: Record<string, unknown>, options?: Record<string, unknown>, direct = false) => {
    const provider = direct ? f.models.getProvider(ref.provider)! : f.models;
    return kind === "image"
      ? provider.generateImages!({ ...f.models.getModelOfType("image", ref.provider, ref.id)!, ...override }, imageContext, options)
      : provider.classify!({ ...f.models.getModelOfType("classifier", ref.provider, ref.id)!, ...override }, classifierContext, options);
  };
  test(`${kind}: public host runtime success, keyless and credential auth, typed options and sanitized cost/results`, async () => {
    for (const keyless of [false, true]) {
      const f = await fixture(true, keyless);
      const options = kind === "image" ? { metadata: { purpose: "fixture" }, timeoutMs: 12 } : { temperature: 0.5, timeoutMs: 12 };
      const result = await invoke(f, undefined, options);
      expect(result.stopReason).toBe("stop");
      expect(f.calls()).toBe(1);
      expect(f.captured().options).toMatchObject({ ...options, maxRetries: 0 });
      expect(f.captured().owner.api).toBe(kind === "image" ? "synthetic-images" : "synthetic-classifier");
      expect(f.captured().context).toEqual(kind === "image" ? imageContext : classifierContext);
      expect(f.admissions).toEqual([`${ref.provider}/${ref.id}/${kind === "image" ? "generateImages" : "classify"}`]);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(result.usage?.totalTokens).toBe(5);
      if ("output" in result) {
        expect(result.output[0]).toEqual({ type: "image", data: "c3ludGhldGlj", mimeType: "image/png" });
        expect(result.usage?.cost.total).toBe(0.25);
      } else expect(result.answers.valid).toEqual({ type: "bool", probability: 0.9 });
      f.abort(); expect(f.captured().options.signal.aborted).toBe(true);
    }
  });
  for (const action of ["revoke", "exhaust", "abort"] as const) {
    test(`${kind}: ${action} before auth and during held auth prevents dispatch`, async () => {
      for (const held of [false, true]) {
        const f = await fixture(true);
        if (held) f.hold(); else f[action]();
        const pending = invoke(f);
        if (held) { await f.entered.promise; f[action](); f.held.release(); }
        expect((await pending).stopReason).toBe("error"); expect(f.calls()).toBe(0);
      }
    });
  }
  test(`${kind}: auth failures/logout sanitized; no account fallback`, async () => {
    for (const action of ["fail", "logout"] as const) {
      const f = await fixture(true);
      if (action === "logout") await f.runtime.logout(ref.provider); else f.fail();
      const result = await invoke(f);
      expect(result.stopReason).toBe("error"); expect(f.calls()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(f.requested.every((id) => id === ref.provider)).toBe(true);
    }
  });
  test(`${kind}: foreign ownership, API/type spoofing and direct provider policy bypass denied`, async () => {
    const f = await fixture(true);
    for (const override of [{ id: "different" }, { provider: "different" }, { api: model.api }, { type: "chat" }]) {
      expect((await invoke(f, override)).stopReason).toBe("error");
    }
    f.revoke(); expect((await invoke(f, undefined, undefined, true)).stopReason).toBe("error");
    expect(f.calls()).toBe(0);
  });
  test(`${kind}: public transforms never execute before policy, even when approved`, async () => {
    for (const denied of [false, true]) {
      const f = await fixture(true);
      if (denied) f.revoke();
      const reads = f.requested.length;
      let callbacks = 0;
      const result = await invoke(f, undefined, { transformHeaders: async () => { callbacks++; return {}; } });
      expect(result.stopReason).toBe("error");
      expect(callbacks).toBe(0);
      expect(f.calls()).toBe(0);
      expect(f.requested.length).toBe(reads);
      expect(f.admissions).toEqual([]);
    }
  });
  test(`${kind}: public and direct allowed option values must be JSON data before admission`, async () => {
    class Invalid { value = 1; }
    const keys = ["timeoutMs", "maxRetryDelayMs", "maxRetries", kind === "image" ? "metadata" : "temperature"];
    for (const direct of [false, true]) {
      const f = await fixture(true);
      for (const key of keys) {
        for (const value of [() => 1, new Invalid(), NaN, Infinity, -Infinity]) {
          expect((await invoke(f, undefined, { [key]: value }, direct)).stopReason).toBe("error");
        }
      }
      expect(f.calls()).toBe(0);
      expect(f.admissions).toEqual([]);
    }
  });
  test(`${kind}: caller abort signal survives public preflight and combines with grant`, async () => {
    const f = await fixture(true);
    const caller = new AbortController();
    expect((await invoke(f, undefined, { signal: caller.signal, maxRetries: 0, maxRetryDelayMs: 0 })).stopReason).toBe("stop");
    expect(f.captured().options.maxRetryDelayMs).toBe(0);
    expect(f.captured().options.signal.aborted).toBe(false);
    caller.abort();
    expect(f.captured().options.signal.aborted).toBe(true);
    const aborted = await fixture(true);
    expect((await invoke(aborted, undefined, { signal: caller.signal })).stopReason).toBe("aborted");
    expect(aborted.calls()).toBe(0);
  });
  test(`${kind}: public model data and false API fail closed without stream fallback`, async () => {
    const f = await fixture(true);
    const reads = f.requested.length;
    for (const override of [{ api: "false-api" }, { extra: () => 1 }, { extra: new Date() }]) {
      expect((await invoke(f, override)).stopReason).toBe("error");
    }
    expect(f.calls()).toBe(0);
    expect(f.requested.length).toBe(reads);
    expect(f.admissions).toEqual([]);
  });
  test(`${kind}: keyless bridge auth describes no credentials, not host authentication`, async () => {
    const f = await fixture(true);
    const owner = f.models.getModelOfType(kind, ref.provider, ref.id)!;
    const reads = f.requested.length;
    const auth = await f.models.getAuth(owner);
    expect(auth?.auth).toEqual({});
    expect(auth?.source).toBe("host-bridge-keyless");
    expect(f.requested.length).toBe(reads);
    f.revoke();
    expect((await invoke(f)).stopReason).toBe("error");
    expect(f.calls()).toBe(0);
  });
  test(`${kind}: raw auth, transforms, retries and other-operation options denied even via provider`, async () => {
    const f = await fixture(true);
    for (const options of [{ apiKey: token }, { headers: { Authorization: token } }, { transformHeaders: () => ({}) },
      { onPayload: () => ({}) }, { maxRetries: 1 }, { deferred: true }, { size: "1024x1024" },
      kind === "image" ? { temperature: 1 } : { metadata: {} }]) {
      expect((await invoke(f, undefined, options, true)).stopReason).toBe("error");
    }
    expect(f.calls()).toBe(0);
  });
}
test("multimodal catalog keeps type-qualified shared IDs immutable, strips nested metadata and does not auto-approve", async () => {
  const f = await fixture(true);
  expect(f.models.getModels()).toHaveLength(1);
  expect(f.models.getAllModels()).toHaveLength(3);
  expect(await f.models.getAvailableOfType("image")).toHaveLength(1);
  expect(await f.models.getAvailableOfType("classifier")).toHaveLength(1);
  const image = f.models.getModelOfType("image", ref.provider, ref.id)!;
  expect(image.inputLimits).toEqual({ maxRequestBytes: 10000, images: { maxPerRequest: 2, resize: { maxWidth: 512 } } });
  expect(Object.isFrozen(image)).toBe(true); expect(Object.isFrozen(image.inputLimits!.images!.resize)).toBe(true);
  expect(JSON.stringify(f.models.getAllModels())).not.toContain(token);
  const chatOnly = createHostModels(f.runtime, [ref], f.policy);
  expect(chatOnly.getAllModels()).toHaveLength(1);
  expect((await chatOnly.generateImages(image, imageContext)).stopReason).toBe("error");
  expect(f.calls()).toBe(0);
  const port = { getPhysicalModel: f.runtime.getPhysicalModel.bind(f.runtime), stream: f.runtime.stream.bind(f.runtime), streamSimple: f.runtime.streamSimple.bind(f.runtime) };
  expect(() => createHostModels(port, [{ ...ref, type: "image" }], f.policy)).toThrow("unavailable");
});
test("non-JSON image bytes/class instances are denied rather than JSON-cloned", async () => {
  const f = await fixture(true);
  const image = f.models.getModelOfType("image", ref.provider, ref.id)!;
  const bad = { input: [{ type: "text" as const, text: "bad", bytes: new Uint8Array([1]) }] };
  expect((await f.models.generateImages(image, bad)).stopReason).toBe("error");
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
