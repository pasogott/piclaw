import type { Message } from "@earendil-works/pi-ai";
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
export function assertModelContextFits(messages: readonly Message[], agent: unknown, target: { contextWindow: number; maxTokens: number }, registry: RegistrySnapshot, promptSectionBytes?: number): void {
  if (!Number.isFinite(target.contextWindow) || target.contextWindow <= 0 || !Number.isFinite(target.maxTokens) || target.maxTokens < 0) throw Error("Model context unavailable");
  if (registry.sections().length && promptSectionBytes === undefined) throw Error("Dynamic prompt overhead unavailable");
  const overhead = promptSectionBytes ?? 0;
  if (!Number.isSafeInteger(overhead) || overhead < 0) throw Error("Dynamic prompt overhead unavailable");
  const tools = registry.tools().map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const bytes = new TextEncoder().encode(JSON.stringify([messages, agent, tools])).length;
  const usage = messages.reduce((max, message) => message.role === "assistant"
    ? Math.max(max, message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite) : max, 0);
  if (messages.some(message => typeof message.content !== "string" && message.content.some(block => block.type === "image"))) throw Error("Non-text context overhead unavailable");
  if (!Number.isFinite(usage) || Math.max(bytes, usage) + overhead + 8192 + target.maxTokens > target.contextWindow) throw Error("Candidate context bound exceeded; compact first");
}
