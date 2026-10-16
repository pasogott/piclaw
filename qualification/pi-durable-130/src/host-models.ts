import {
  createModels, createProvider, createAssistantMessageEventStream,
  type Api, type Model, type Models, type SimpleStreamOptions,
  type TranscriptContext, type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../../../node_modules/@earendil-works/pi-coding-agent";

export interface ModelRef { provider: string; id: string }
export interface HostModelPolicy {
  /** Includes host model approval and budget admission; never auth/login approval. */
  authorize(ref: ModelRef, kind: "chat", signal: AbortSignal): Promise<void>;
  /** Synchronous approval/budget-generation check after host auth has resolved. */
  assertCurrent(ref: ModelRef, kind: "chat", signal: AbortSignal): void;
  /** Host must abort the grant generation on revocation (including in-flight work). */
  signal: AbortSignal;
}

// Only JSON data crosses package families; no provider/runtime/stream class is shared.
function data<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") throw new Error("Callbacks are not qualified");
    return item;
  }));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const optionKeys = new Set([
  "temperature", "samplingParams", "maxTokens", "transport", "cacheRetention",
  "sessionId", "metadata", "timeoutMs", "websocketConnectTimeoutMs",
  "reasoning", "thinkingBudgets", "toolChoice", "maxRetryDelayMs", "maxRetries",
]);
function requestOptions(options: SimpleStreamOptions = {}): SimpleStreamOptions {
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && value !== undefined && !optionKeys.has(key)) {
      throw new Error(`Unqualified request option: ${key}`);
    }
  }
  if (options.maxRetries !== undefined && options.maxRetries !== 0) {
    throw new Error("Transport retries are not qualified");
  }
  const { signal: _signal, ...rest } = options;
  return { ...data(rest), maxRetries: 0 };
}

/** Qualification only: physical chat models; no credential transfer or production wiring.
 * 1.2 and 1.3 public Models declarations match. A 1.3 factory owns the complete
 * interface; only provider chat dispatch needs adapting. All other execution is
 * unsupported, not a fallback. transformHeaders is a post-auth fence, NOT an
 * atomic send hook: the SDK awaits it and may dispatch in a later microtask.
 */
export function createHostModels(
  hostModelRuntime120: Pick<ModelRuntime, "getPhysicalModel" | "stream" | "streamSimple">,
  approved: readonly ModelRef[],
  policy: HostModelPolicy,
): Models {
  const backing = createModels({ authContext: {
    env: async () => undefined, fileExists: async () => false,
  } });
  const catalog = approved.map((ref): Model<Api> => {
    const model = hostModelRuntime120.getPhysicalModel(ref.provider, ref.id);
    if (!model) throw new Error("Approved physical model is unavailable");
    // Deliberately omit host headers, URLs, compat/config and auth-bearing metadata.
    return freeze(data({ provider: model.provider, id: model.id, name: model.name,
      api: model.api, baseUrl: "https://host-bridge.invalid", input: model.input, reasoning: model.reasoning,
      contextWindow: model.contextWindow, maxTokens: model.maxTokens, cost: model.cost }));
  });
  const relay = (simple: boolean, model: Model<Api>, context: TranscriptContext,
    options?: SimpleStreamOptions) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      try {
        const ref = { provider: model.provider, id: model.id };
        const listed = catalog.find((m) => m.provider === ref.provider && m.id === ref.id);
        if (!listed || listed.api !== model.api) throw new Error("Model is not approved");
        const signal = options?.signal
          ? AbortSignal.any([options.signal, policy.signal]) : policy.signal;
        const safeOptions = requestOptions(options);
        signal.throwIfAborted();
        await policy.authorize(ref, "chat", signal);
        signal.throwIfAborted();
        policy.assertCurrent(ref, "chat", signal);
        // Resolve the physical owner again, never accept caller model overrides/routing.
        const physical = hostModelRuntime120.getPhysicalModel(ref.provider, ref.id);
        if (!physical || physical.api !== listed.api) throw new Error("Model owner changed");
        const hostOptions = { ...safeOptions, signal, transformHeaders: (headers: Record<string, string | null>) => {
          signal.throwIfAborted();
          policy.assertCurrent(ref, "chat", signal);
          return headers; // Host-only closure: never sent to 1.3 or a caller callback.
        } };
        const stream = simple
          ? hostModelRuntime120.streamSimple(physical, data(context), hostOptions)
          : hostModelRuntime120.stream(physical, data(context), hostOptions);
        for await (const event of stream) {
          if (event.type === "error") throw new Error("Host request failed");
          output.push(data(event));
        }
        const result = await stream.result();
        if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error("Host request failed");
        output.end(data(result));
      } catch {
        // Host errors can contain credentials/headers. Do not export them.
        const error: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, timestamp: Date.now(),
          stopReason: "error", errorMessage: "Host model request denied or failed",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        output.push({ type: "error", reason: "error", error });
        output.end(error);
      }
    })();
    return output;
  };
  for (const id of new Set(catalog.map((model) => model.provider))) {
    backing.setProvider(createProvider({ id, models: catalog.filter((m) => m.provider === id),
      auth: { apiKey: { name: "Host-owned authority (not credentials)",
        resolve: async () => ({ auth: {}, source: "host-bridge-keyless" }) } },
      api: {
        stream: (model, context, options) => relay(false, model, context, options),
        streamSimple: (model, context, options) => relay(true, model, context, options),
      },
    }));
  }
  // Public factory implementation, not a partial Models cast. Guard mutation/auth UI
  // and request transforms before factory auth; getProvider exposes only our proxy.
  const chatMethods = new Set(["stream", "streamSimple", "complete", "completeSimple"]);
  return new Proxy(backing, {
    get(target, key) {
      if (["login", "logout", "setProvider", "deleteProvider", "clearProviders"].includes(String(key))) {
        return () => { throw new Error("Host auth UI/mutation is a separate scope"); };
      }
      const value = Reflect.get(target, key);
      if (chatMethods.has(String(key))) return (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
        requestOptions(options);
        return Reflect.apply(value, target, [model, context, options]);
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}
