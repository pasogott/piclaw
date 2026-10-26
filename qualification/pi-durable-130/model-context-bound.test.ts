import "./src/test-guard.js";
import {expect, test} from "bun:test";
import {estimateContextTokens} from "../../runtime/durable-engine/qualification/ai.ts";
import {assertModelContextFits} from "../../runtime/durable-engine/src/host-model-context.ts";

const message = {role: "user", content: "PRIVATE_PROMPT_MUST_NOT_BE_LOGGED", timestamp: 0} as const;
const registry = {sections: () => [], tools: () => []} as any;
const target = {contextWindow: 100000, maxTokens: 10000};

test("context-fit refusal explains numeric conservative budgets without prompt contents", () => {
  expect(() => assertModelContextFits([message], {}, target, registry, 0)).not.toThrow();
  let error: Error | undefined;
  try { assertModelContextFits([message], {}, target, registry, 100000); } catch(e) { error=e as Error; }
  expect(error).toBeInstanceOf(Error);
  const bytes=Buffer.byteLength(JSON.stringify([[message], {}, []]));
  expect(error!.message).toBe(`Candidate context bound exceeded; compact first (serialized input bytes=${bytes}, reported tokens=0, estimated context tokens=${estimateContextTokens([message]).tokens}, unmeasured input bytes=${bytes}, input token bound=${bytes}, dynamic prompt bytes=100000, reserve=8192, output budget=10000, context window=100000)`);
  expect(error!.message).not.toContain(message.content);
});

test("context guard still refuses oversized input, missing dynamic measurements and images", () => {
  expect(() => assertModelContextFits([{...message, content: "x".repeat(100000)}], {}, target, registry, 0)).toThrow("compact first");
  expect(() => assertModelContextFits([message], {}, target, {...registry, sections: () => [{}]}, undefined)).toThrow("Dynamic prompt overhead unavailable");
  expect(() => assertModelContextFits([{...message, content: [{type: "image", mimeType: "image/png", data: "fixture"}]}] as any, {}, target, registry, 0)).toThrow("Non-text context overhead unavailable");
});

function measuredAssistant(tokens: number, signature = "") {
  return { role: "assistant", api: "qualification", provider: "openai-codex", model: "gpt-6.1-sol", timestamp: 1,
    content: [{ type: "thinking", thinking: "", thinkingSignature: signature }], stopReason: "stop",
    usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as any;
}

test("reported model-switch rejection admits the larger window without treating measured metadata bytes as tokens", () => {
  const measured = measuredAssistant(459016);
  const agent = {}, tools: any[] = [];
  const targetBytes = 3430762;
  measured.content[0].thinkingSignature = "x".repeat(targetBytes - new TextEncoder().encode(JSON.stringify([[measured], agent, tools])).length);
  expect(new TextEncoder().encode(JSON.stringify([[measured], agent, tools])).length).toBe(targetBytes);
  expect(() => assertModelContextFits([measured], agent, { contextWindow: 1050000, maxTokens: 128000 }, registry, 32970, tools)).not.toThrow();
  expect(() => assertModelContextFits([measured], agent, { contextWindow: 500000, maxTokens: 128000 }, registry, 32970, tools)).toThrow("Candidate context bound exceeded");
});

test("unmeasured suffix keeps a conservative bound after reported usage", () => {
  const measured = measuredAssistant(459016);
  const trailing = { role: "user", content: "x".repeat(700000), timestamp: 2 } as const;
  expect(() => assertModelContextFits([measured, trailing], {}, { contextWindow: 1050000, maxTokens: 128000 }, registry, 32970)).toThrow("Candidate context bound exceeded");
});

test("latest applicable usage replaces older historical high-water marks", () => {
  const old = measuredAssistant(900000);
  const latest = { ...measuredAssistant(100000), timestamp: 2 };
  expect(() => assertModelContextFits([old, latest], {}, { contextWindow: 500000, maxTokens: 128000 }, registry, 32970)).not.toThrow();
});

test("a replaced prefix cannot reuse older reported usage to hide unmeasured input", () => {
  const measured = measuredAssistant(1000, "x".repeat(200000));
  const newerPrefix = { role: "user", content: "new prefix", timestamp: 2 } as const;
  expect(() => assertModelContextFits([newerPrefix, measured], {}, target, registry, 0)).toThrow("Candidate context bound exceeded");
});

test("unmeasured schemas and invalid usage remain fail closed", () => {
  const measured = measuredAssistant(1000);
  const tools = [{ name: "fixture", description: "x".repeat(200000), parameters: {} }] as any;
  expect(() => assertModelContextFits([measured], {}, target, registry, 0, tools)).toThrow("Candidate context bound exceeded");
  for (const invalid of [NaN, Infinity, -1]) {
    const malformed = measuredAssistant(1000); malformed.usage.input = invalid;
    expect(() => assertModelContextFits([malformed], {}, target, registry, 0)).toThrow("Model context usage unavailable");
  }
});
