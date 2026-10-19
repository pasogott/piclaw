import type { Api, Model, TranscriptContext } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '../../src/durable-legacy-sdk.js';
import type { CodexOperation, NativeCodexFactories } from './host-codex-model-profile.ts';

type RootProvider = Parameters<ModelRuntime['registerNativeProvider']>[0];
/** Constructor-only host authority. capture must resolve the actual invocation source,
 * never a selected/default conversation. account checks must include auth identity. */
export interface HostCodexAuthority {
  capture(signal: AbortSignal): Promise<CodexOperation>;
  assertAccount(operation: CodexOperation): void;
  /** Trusted host raw-output sink. Must invoke beforeEffect immediately before each artifact write
   * (including queued writes), and durably retain failed flushes. */
  observe(operation: CodexOperation, response: Response, beforeEffect: () => void): Promise<void>;
  flush(operation: CodexOperation): Promise<void>;
  /** Trusted transport seam for qualification; never accepted in request options. */
  fetch?: typeof globalThis.fetch;
}
export class HostCodexModelServices {
  constructor(private readonly authority: HostCodexAuthority, private readonly nativeAddon: NativeCodexFactories) {}
  /** Call before physical model selection, on the SAME runtime used by dispatch. */
  register(runtime: ModelRuntime, provider: RootProvider): void {
    if (provider.id !== 'openai-codex') throw Error('Wrong Codex provider');
    runtime.registerNativeProvider(provider);
    if (runtime.getRegisteredNativeProvider(provider.id) !== provider) throw Error('Codex registration lost');
  }
  async bind(model: Model<Api>, signal: AbortSignal) {
    if (model.provider !== 'openai-codex' || model.api !== 'openai-codex-responses') return undefined;
    const operation = await this.authority.capture(signal);
    const check = () => {
      signal.throwIfAborted(); operation.signal.throwIfAborted(); operation.assertCurrent();
      this.authority.assertAccount(operation);
      if (operation.model.provider !== model.provider || operation.model.id !== model.id || operation.model.api !== model.api)
        throw Error('Codex request owner changed');
    };
    check();
    const hooks = this.nativeAddon.createNativeCodexHooks(operation.model);
    const authority = this.authority;
    let tail = Promise.resolve();
    let closed = false;
    check();
    return {
      options: {
        // Output observation is HTTP-only. Never silently bypass it via websocket/auto.
        transport: 'sse' as const,
        onPayload(payload: unknown, actual: Model<Api>) {
          check();
          if (actual.provider !== model.provider || actual.id !== model.id || actual.api !== model.api) throw Error('Codex payload owner changed');
          return hooks.request(payload);
        },
        fetch: (async (input, init) => {
          check();
          const response = await (authority.fetch ?? globalThis.fetch)(input, init);
          check();
          if (closed) throw Error("Codex output closed");
          const clone = response.clone();
          tail = tail.then(() => { check(); return authority.observe(operation, clone, check); });
          // Observe concurrently; finish joins before terminal publication.
          void tail.catch(() => {});
          check();
          return response;
        }) as typeof globalThis.fetch,
      },
      headers(headers: Record<string, string | null>) {
        check();
        const transformed = hooks.headers(Object.fromEntries(Object.entries(headers).map(([k,v]) => [k, v ?? undefined])));
        return { ...headers, ...transformed } as Record<string, string | null>;
      },
      context(context: TranscriptContext): TranscriptContext {
        check();
        return { ...context, messages: hooks.context(context.messages).map(message =>
          message.role === 'system' && typeof message.content === 'string'
            ? { ...message, content: hooks.systemPrompt(message.content) } : message) };
      },
      async finish() { closed = true; await tail; check(); await authority.flush(operation); },
    };
  }
}
