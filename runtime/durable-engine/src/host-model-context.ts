import type { Message } from "@earendil-works/pi-ai";
import type { RegistrySnapshot } from "@earendil-works/pi-durable";

/** Candidate-only bound shared by idle operator and owned in-turn model controls. */
export function assertModelContextFits(messages: readonly Message[], agent: unknown, target: { contextWindow: number; maxTokens: number }, registry: RegistrySnapshot): void {
  if (!Number.isFinite(target.contextWindow) || target.contextWindow <= 0 || !Number.isFinite(target.maxTokens) || target.maxTokens < 0) throw Error("Model context unavailable");
  if (registry.sections().length) throw Error("Dynamic prompt overhead unavailable");
  const tools = registry.tools().map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const bytes = new TextEncoder().encode(JSON.stringify([messages, agent, tools])).length;
  const usage = messages.reduce((max, message) => message.role === "assistant"
    ? Math.max(max, message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite) : max, 0);
  if (messages.some(message => typeof message.content !== "string" && message.content.some(block => block.type === "image"))) throw Error("Non-text context overhead unavailable");
  if (!Number.isFinite(usage) || Math.max(bytes, usage) + 8192 + target.maxTokens > target.contextWindow) throw Error("Candidate context bound exceeded; compact first");
}
