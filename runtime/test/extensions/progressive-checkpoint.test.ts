import { afterEach, expect, test } from "bun:test";

import { clearDomainConfigRegistryForTests } from "../../src/core/domain-config.js";
import { registerExtensionKvStore, type ExtensionKvStore } from "../../src/extension-kv-registry.js";
import {
  buildProgressiveCheckpointFingerprint,
  createProgressiveCheckpointStore,
} from "../../src/extensions/smart-compaction/progressive-checkpoint.js";
import { buildProgressiveCompactionChunksFromSourceUnits } from "../../src/extensions/smart-compaction/progressive-policy.js";
import { runProgressiveCompaction } from "../../src/extensions/smart-compaction/progressive.js";

function memoryKv(values = new Map<string, unknown>()): ExtensionKvStore {
  const id = (extensionId: string, key: string, scope = "chat", scopeKey = "") => `${extensionId}\0${scope}\0${scopeKey}\0${key}`;
  return {
    get: (extensionId, key, scope, scopeKey) => structuredClone(values.get(id(extensionId, key, scope, scopeKey)) ?? null) as any,
    set: (extensionId, key, value, scope, scopeKey) => { values.set(id(extensionId, key, scope, scopeKey), structuredClone(value)); },
    delete: (extensionId, key, scope, scopeKey) => values.delete(id(extensionId, key, scope, scopeKey)),
    list: (extensionId, prefix = "", scope, scopeKey) => [...values.keys()]
      .filter((entry) => entry.startsWith(`${extensionId}\0${scope ?? "chat"}\0${scopeKey ?? ""}\0${prefix}`))
      .map((entry) => entry.split("\0").at(-1)!),
    query: () => [],
    clear: () => 0,
  };
}

const budget = { contextWindow: 128_000, promptBudgetChars: 20_000, chunkBudgetChars: 4_000, mergeBudgetChars: 20_000, forceProgressive: true };
const model = { provider: "test", id: "model", api: "test", baseUrl: "" };

function units() {
  return [
    { id: "a1", groupId: "a", renderedText: "A1", sourceIndexes: [0], sourceEntryIds: ["e0"], segmentIndex: 1, segmentCount: 2 },
    { id: "a2", groupId: "a", renderedText: "A2", sourceIndexes: [1], sourceEntryIds: ["e1"], segmentIndex: 2, segmentCount: 2 },
    { id: "b", groupId: "b", renderedText: "B", sourceIndexes: [2], sourceEntryIds: ["e2"], segmentIndex: 1, segmentCount: 1 },
  ];
}

afterEach(() => {
  registerExtensionKvStore(memoryKv());
  clearDomainConfigRegistryForTests();
});

test("source-unit chunking keeps every atomic group in one chunk", () => {
  const chunks = buildProgressiveCompactionChunksFromSourceUnits(units(), 2);
  expect(chunks).toHaveLength(2);
  expect(chunks[0]?.groupIds).toEqual(["a"]);
  expect(chunks[0]?.text).toBe("A1\nA2");
  expect(chunks[1]?.groupIds).toEqual(["b"]);
});

test("source-unit chunking rejects non-contiguous group reuse", () => {
  const bad = [units()[0]!, units()[2]!, units()[1]!];
  expect(() => buildProgressiveCompactionChunksFromSourceUnits(bad, 100)).toThrow("non-contiguous");
});

test("checkpoint store resumes a complete prefix and invalidates source, model, and policy changes", () => {
  registerExtensionKvStore(memoryKv());
  const chunks = buildProgressiveCompactionChunksFromSourceUnits(units(), 4);
  const store = createProgressiveCheckpointStore("web:test");
  const fingerprint = buildProgressiveCheckpointFingerprint({ chunks, model, budget, reserveTokens: 1000 });
  store.save(fingerprint, chunks, ["summary-a"]);
  expect(store.load(fingerprint, chunks)).toEqual(["summary-a"]);

  const sourceChanged = buildProgressiveCheckpointFingerprint({ chunks: chunks.map((chunk, index) => index ? chunk : { ...chunk, text: `${chunk.text}!` }), model, budget, reserveTokens: 1000 });
  expect(store.load(sourceChanged, chunks)).toEqual([]);
  store.save(fingerprint, chunks, ["summary-a"]);
  const modelChanged = buildProgressiveCheckpointFingerprint({ chunks, model: { ...model, id: "other" }, budget, reserveTokens: 1000 });
  expect(store.load(modelChanged, chunks)).toEqual([]);
  store.save(fingerprint, chunks, ["summary-a"]);
  const policyChanged = buildProgressiveCheckpointFingerprint({ chunks, model, budget: { ...budget, chunkBudgetChars: 5000 }, reserveTokens: 1000 });
  expect(store.load(policyChanged, chunks)).toEqual([]);
});

test("a second progressive run resumes validated chunks and skips their model calls", async () => {
  registerExtensionKvStore(memoryKv());
  const sourceUnits = Array.from({ length: 6 }, (_, index) => ({
    id: `unit-${index}`,
    groupId: `group-${index}`,
    renderedText: `SOURCE_${index} ${"x".repeat(2500)}`,
    sourceIndexes: [index],
    sourceEntryIds: [`entry-${index}`],
    segmentIndex: 1,
    segmentCount: 1,
  }));
  const persistedValues = new Map<string, unknown>();
  registerExtensionKvStore(memoryKv(persistedValues));
  const store = createProgressiveCheckpointStore("web:resume");
  const summary = (index: number) => `## Chunk Range\n- ${index}-${index}\n\n## Goals / User Intent\n- preserve ${index}\n\n## Constraints & Preferences\n- exact\n\n## Decisions\n- checkpoint\n\n## Files / Commands / Tool Outcomes\n- none\n\n## Progress\n- Done: summarized\n- In progress: continue\n- Blocked: none\n\n## Open Questions / Next Steps\n- continue\n\n## Key Continuity Facts\n- SOURCE_${index}`;
  let calls = 0;
  const firstStream = async (_model: unknown, context: any) => {
    const prompt = context.messages[0].content[0].text as string;
    const index = Number(prompt.match(/Chunk: (\d+)\//)?.[1] ?? 1) - 1;
    calls += 1;
    if (index >= 4) throw new Error("simulated interruption");
    return { result: async () => ({ content: [{ type: "text", text: summary(index) }], stopReason: "stop" }), async *[Symbol.asyncIterator]() {} } as any;
  };
  const common = {
    llmMessages: [], sourceUnits, humanUserIndexes: new Set<number>(), model, auth: {}, settings: { reserveTokens: 1_000 },
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() }, budget,
    abortSignal: new AbortController().signal, ctx: { ui: {} }, timeoutMs: 300_000, startedAt: Date.now(), checkpointStore: store,
  };
  const first = await runProgressiveCompaction({ ...common, streamFn: firstStream as any });
  expect(first.complete).toBe(false);
  expect(calls).toBe(6);

  calls = 0;
  // Re-register a fresh store wrapper over persisted values to simulate a
  // process restart before the second compaction attempt.
  registerExtensionKvStore(memoryKv(persistedValues));
  const resumedStore = createProgressiveCheckpointStore("web:resume");
  const secondStream = async (_model: unknown, context: any) => {
    const prompt = context.messages[0].content[0].text as string;
    calls += 1;
    if (prompt.includes("deterministic chunk")) {
      const index = Number(prompt.match(/Chunk: (\d+)\//)?.[1] ?? 1) - 1;
      return { result: async () => ({ content: [{ type: "text", text: summary(index) }], stopReason: "stop" }), async *[Symbol.asyncIterator]() {} } as any;
    }
    const final = "## Goal\nresume\n\n## Current Active Topic\n- test\n\n## Historical / Background Context\n- chunks\n\n## Constraints & Preferences\n- exact\n\n## Progress\n### Done\n- [x] resumed\n### In Progress\n- [ ] none\n### Blocked\n- none\n\n## Key Decisions\n- checkpoint\n\n## Next Steps\n1. done\n\n## Critical Context\n- all facts";
    return { result: async () => ({ content: [{ type: "text", text: final }], stopReason: "stop" }), async *[Symbol.asyncIterator]() {} } as any;
  };
  const second = await runProgressiveCompaction({ ...common, checkpointStore: resumedStore, startedAt: Date.now(), streamFn: secondStream as any });
  expect(second.complete).toBe(true);
  expect(calls).toBe(3); // two remaining chunks plus final merge
  expect(resumedStore.load(buildProgressiveCheckpointFingerprint({ chunks: buildProgressiveCompactionChunksFromSourceUnits(sourceUnits, budget.chunkBudgetChars), model, budget, reserveTokens: 1_000 }), buildProgressiveCompactionChunksFromSourceUnits(sourceUnits, budget.chunkBudgetChars))).toEqual([]);
});

test("checkpoint store never resumes a missing or mismatched chunk record", () => {
  const values = new Map<string, unknown>();
  registerExtensionKvStore(memoryKv(values));
  const chunks = buildProgressiveCompactionChunksFromSourceUnits(units(), 4);
  const store = createProgressiveCheckpointStore("web:test-corrupt");
  const fingerprint = buildProgressiveCheckpointFingerprint({ chunks, model, budget, reserveTokens: 1000 });
  store.save(fingerprint, chunks, ["summary-a", "summary-b"]);
  const chunkKey = [...values.keys()].find((key) => key.endsWith("checkpoint-chunk:000001"));
  expect(chunkKey).toBeTruthy();
  values.delete(chunkKey!);
  registerExtensionKvStore(memoryKv(values));
  expect(createProgressiveCheckpointStore("web:test-corrupt").load(fingerprint, chunks)).toEqual([]);
  expect(values.size).toBe(0);
});
