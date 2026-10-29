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
  const payloadBytes=Buffer.byteLength(JSON.stringify([[{ role: message.role, content: message.content }], {}, []]));
  expect(error!.message).toBe(`Candidate context bound exceeded; compact first (serialized input bytes=${bytes}, reported tokens=0, estimated context tokens=${estimateContextTokens([message]).tokens}, unmeasured input bytes=${payloadBytes}, input token bound=${payloadBytes}, dynamic prompt bytes=100000, reserve=8192, output budget=10000, context window=100000)`);
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

function unmeasuredMetadataFixture(): Message[] {
  const messages: Message[] = [
    { role: "user", content: "u".repeat(216289), timestamp: 1 },
    { role: "toolResult", toolCallId: "call", toolName: "lookup", content: [{ type: "text", text: "result" }],
      isError: false, details: { raw: "" }, timestamp: 2 },
  ];
  const bytes = new TextEncoder().encode(JSON.stringify([messages, {}, []])).length;
  (messages[1] as any).details.raw = "z".repeat(693468 - bytes);
  return messages;
}
test("zero-usage mid-turn metadata does not turn 693468 serialized bytes into tokens", () => {
  const messages = unmeasuredMetadataFixture(), before = JSON.stringify(messages);
  expect(new TextEncoder().encode(JSON.stringify([messages, {}, []])).length).toBe(693468);
  expect(estimateContextTokens(messages)).toMatchObject({ tokens: 61799, usageTokens: 0, lastUsageIndex: null });
  expect(() => assertModelContextFits(messages, {}, { contextWindow: 500000, maxTokens: 128000 }, registry, 32970)).not.toThrow();
  expect(JSON.stringify(messages)).toBe(before);
  expect(() => assertModelContextFits(messages, {}, { contextWindow: 350000, maxTokens: 128000 }, registry, 32970)).toThrow("Candidate context bound exceeded");
});
test("unmeasured metadata after a measured prefix is not model text", () => {
  const tool = unmeasuredMetadataFixture()[1]!;
  (tool as any).nestedCalls = [{ raw: "n".repeat(200000) }];
  const messages = [measuredAssistant(1000), tool];
  expect(() => assertModelContextFits(messages, {}, target, registry, 0)).not.toThrow();
  (tool as any).content = [{ type: "text", text: "z".repeat(200000) }];
  expect(() => assertModelContextFits(messages, {}, target, registry, 0)).toThrow("Candidate context bound exceeded");
});
test("metadata-shaped argument keys and opaque reasoning remain conservatively counted", () => {
  for (const key of ["details", "signature", "usage", "diagnostics"]) {
    const call = measuredAssistant(0);
    call.content = [{ type: "toolCall", id: "call", name: "fixture", arguments: { [key]: "x".repeat(200000) } }];
    expect(() => assertModelContextFits([call], {}, target, registry, 0)).toThrow("Candidate context bound exceeded");
  }
  expect(() => assertModelContextFits([measuredAssistant(0, "s".repeat(200000))], {}, target, registry, 0)).toThrow("Candidate context bound exceeded");
});
test("system section and schema payloads remain counted without measurements", () => {
  for (const message of [
    { role: "system", content: "", sections: { context: "x".repeat(200000) }, timestamp: 1 },
    { role: "system", content: "", toolsAdded: [{ name: "fixture", description: "x".repeat(200000), parameters: {} }], timestamp: 1 },
  ] as Message[]) expect(() => assertModelContextFits([message], {}, target, registry, 0)).toThrow("Candidate context bound exceeded");
});
