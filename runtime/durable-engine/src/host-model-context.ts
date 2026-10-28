import type { Message } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { RegistrySnapshot, PromptInput } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";

/** Read-only request preparation, outside any configuration transaction. Do not
 * invoke model generation or write synthetic pi.system/history entries here.
 * Fail closed if a section cannot be measured; do not silently omit its text.
 */
export async function measureModelPromptSections(messages: readonly Message[], input: Omit<PromptInput, "shown">, context: Context): Promise<number> {
  const shown: Record<string, string> = Object.create(null);
  for (const message of messages) if (message.role === "system") {
    for (const [key, value] of Object.entries(message.sections ?? {})) {
      if (value === null) delete shown[key]; else shown[key] = value;
    }
  }
  let bytes = 0;
  for (const section of input.agent.sections) {
    context.abortSignal?.throwIfAborted();
    const value = await section.render({ ...input, shown: { ...shown } }, context);
    context.abortSignal?.throwIfAborted();
    if (value === undefined) continue;
    if (typeof value !== "string") throw Error("Dynamic prompt overhead unavailable");
    const rendered = section.tag === false ? value : `<${section.key}>\n${value}\n</${section.key}>`;
    bytes += new TextEncoder().encode(JSON.stringify([section.key, rendered])).length;
  }
  return bytes;
}

/** Candidate-only bound shared by idle operator and owned in-turn model controls. */
export function assertModelContextFits(messages: readonly Message[], agent: unknown, target: { contextWindow: number; maxTokens: number }, registry: RegistrySnapshot, promptSectionBytes?: number, selectedTools?: readonly ModelToolSchema[]): void {
  if (!Number.isFinite(target.contextWindow) || target.contextWindow <= 0 || !Number.isFinite(target.maxTokens) || target.maxTokens < 0) throw Error("Model context unavailable");
  if (registry.sections().length && promptSectionBytes === undefined) throw Error("Dynamic prompt overhead unavailable");
  const overhead = promptSectionBytes ?? 0;
  if (!Number.isSafeInteger(overhead) || overhead < 0) throw Error("Dynamic prompt overhead unavailable");
  const tools = selectedTools ?? registry.tools().map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  if (messages.some(message => typeof message.content !== "string" && message.content.some(block => block.type === "image"))) throw Error("Non-text context overhead unavailable");
  if (messages.some(message => message.role === "assistant" &&
    [message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite, message.usage.totalTokens]
      .some(value => !Number.isFinite(value) || value < 0))) throw Error("Model context usage unavailable");
  // The SDK identifies the last applicable measured prefix, including prefix
  // changes. Serialized metadata/signatures in that prefix are not token usage.
  // Keep a byte-per-token upper bound for the unmeasured suffix and current
  // configuration/schemas; never let a small old measurement hide new input.
  const estimate = estimateContextTokens(messages);
  const suffix = estimate.lastUsageIndex === null ? messages : messages.slice(estimate.lastUsageIndex + 1);
  const unmeasuredBytes = new TextEncoder().encode(JSON.stringify([suffix, agent, tools])).length;
  const inputBound = Math.max(estimate.tokens, estimate.usageTokens + unmeasuredBytes);
  if (!Number.isFinite(inputBound) || inputBound < 0 || inputBound + overhead + 8192 + target.maxTokens > target.contextWindow) {
    const bytes = new TextEncoder().encode(JSON.stringify([messages, agent, tools])).length;
    // Numeric-only diagnostics explain conservative admission without exposing
    // prompts, tool arguments, credentials or opaque reasoning signatures.
    throw Error(`Candidate context bound exceeded; compact first (serialized input bytes=${bytes}, reported tokens=${estimate.usageTokens}, estimated context tokens=${estimate.tokens}, unmeasured input bytes=${unmeasuredBytes}, input token bound=${inputBound}, dynamic prompt bytes=${overhead}, reserve=8192, output budget=${target.maxTokens}, context window=${target.contextWindow})`);
  }
}

export type ModelToolSchema = Pick<import('@earendil-works/pi-durable').ToolRegistration, 'name' | 'description' | 'parameters'>;
export interface ModelContextAdmission {
  messages: readonly Message[];
  tools: readonly ModelToolSchema[];
  promptSectionBytes: number;
  assertScopeCurrent(): void;
  assertCurrent(tx: import('@earendil-works/pi-durable').Tx, current: unknown): Promise<void>;
}

/** Resolve one public SDK loadout and fence its configuration and history before
 * using a narrower schema bound. All reads precede the selection transaction. */
export async function prepareModelContextAdmission(options: {
  conversation: import('@earendil-works/pi-durable').Conversation;
  registry: import('@earendil-works/pi-durable').RegistryReader;
  defaultExtensions(): readonly { name: string }[] | undefined;
  readAgentState(): Promise<unknown>;
  measure(messages: readonly Message[], agent: import('@earendil-works/pi-durable').Agent): Promise<number>;
  assertCurrent(): void;
  context: Context;
}): Promise<ModelContextAdmission> {
  const { conversation, context } = options;
  const installed = [...options.registry.snapshot().installed()];
  const defaults = () => JSON.stringify(options.defaultExtensions()?.map(extension => extension.name));
  const expectedDefaults = defaults();
  const checkScope = () => {
    context.abortSignal?.throwIfAborted();
    options.assertCurrent();
    const current = options.registry.snapshot().installed();
    if (current.length !== installed.length || current.some((extension, index) => extension !== installed[index]) || defaults() !== expectedDefaults) {
      throw Error('Model context registry changed; retry the command.');
    }
  };
  checkScope();
  const expectedState = JSON.stringify((await options.readAgentState()) ?? {}); checkScope();
  // Context order after compaction differs from append order: retained older
  // entries follow the new head. Fence the actual transcript frontier instead.
  const tail = await conversation.commit(async tx =>
    (await tx.scanEntries({ conversationId: conversation.id, order: 'descending' }, 1)).items[0]?.id, context);
  checkScope();
  const resolved = await conversation.agent(context); checkScope();
  const view = await conversation.context(context); checkScope();
  const tools = resolved.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  // Match the JSON envelope used by the conservative bound, without executable
  // tools, callable-only declarations or resolved host metadata.
  const schemas = JSON.parse(JSON.stringify(tools)) as ModelToolSchema[];
  const promptSectionBytes = await options.measure(view.messages, resolved); checkScope();
  return {
    messages: view.messages, tools: schemas, promptSectionBytes, assertScopeCurrent: checkScope,
    async assertCurrent(tx, current) {
      checkScope();
      if (JSON.stringify(current) !== expectedState) throw Error('Model context configuration changed; retry the command.');
      const latest = await tx.scanEntries({ conversationId: conversation.id, order: 'descending' }, 1);
      checkScope();
      if (latest.items[0]?.id !== tail) throw Error('Model context history changed; retry the command.');
    },
  };
}
