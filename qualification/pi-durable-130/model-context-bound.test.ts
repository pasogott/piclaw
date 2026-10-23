import "./src/test-guard.js";
import {expect, test} from "bun:test";
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
  expect(error!.message).toBe(`Candidate context bound exceeded; compact first (serialized input bytes=${bytes}, reported tokens=0, dynamic prompt bytes=100000, reserve=8192, output budget=10000, context window=100000)`);
  expect(error!.message).not.toContain(message.content);
});

test("context guard still refuses oversized input, missing dynamic measurements and images", () => {
  expect(() => assertModelContextFits([{...message, content: "x".repeat(100000)}], {}, target, registry, 0)).toThrow("compact first");
  expect(() => assertModelContextFits([message], {}, target, {...registry, sections: () => [{}]}, undefined)).toThrow("Dynamic prompt overhead unavailable");
  expect(() => assertModelContextFits([{...message, content: [{type: "image", mimeType: "image/png", data: "fixture"}]}] as any, {}, target, registry, 0)).toThrow("Non-text context overhead unavailable");
});
