import { expect, test } from "bun:test";

import {
  createDeferredBranchSeed,
  seedSessionManagerFromDeferredBranchSeed,
  type DeferredBranchSeed,
} from "../../src/agent-pool/branch-seeding.js";
import type { SessionEntryAppendPort } from "../../src/agent-pool/session-persistence.js";

function delayedAppendPort(calls: string[]): SessionEntryAppendPort {
  let nextId = 0;
  const record = async (value: string) => {
    await Bun.sleep(1);
    calls.push(value);
    nextId += 1;
    return `new-${nextId}`;
  };
  return {
    appendMessage: async (message: any) => record(`message:${message.role}`),
    appendThinkingLevelChange: async (level) => record(`thinking:${level}`),
    appendModelChange: async (provider, model) => record(`model:${provider}/${model}`),
    appendCompaction: async (_summary, firstKept) => record(`compaction:${firstKept}`),
    appendSessionInfo: async (name) => record(`session:${name}`),
    appendCustomMessageEntry: async (type) => record(`custom-message:${type}`),
    appendCustomEntry: async (type) => record(`custom:${type}`),
  };
}

test("deferred branch seed creation awaits asynchronous source reads", async () => {
  const sourceSession = {
    sessionManager: {
      getLeafId: async () => "leaf",
      getEntries: async () => [],
      getBranch: async () => [{ type: "model_change", id: "model", provider: "openai", modelId: "gpt" }],
      buildSessionContext: async () => ({ messages: [], thinkingLevel: "high", model: null }),
      getSessionFile: async () => "/tmp/source.jsonl",
      getSessionName: async () => "source",
      appendMessage: async () => "m",
      appendThinkingLevelChange: async () => "t",
      appendModelChange: async () => "model",
      appendCompaction: async () => "c",
      appendSessionInfo: async () => "s",
      appendCustomMessageEntry: async () => "cm",
      appendCustomEntry: async () => "ce",
    },
    sessionFile: "/tmp/source.jsonl",
    model: null,
    thinkingLevel: "high",
  } as any;

  const seed = await createDeferredBranchSeed(sourceSession, {
    stableLeafId: "leaf",
    sessionName: "child",
    sourceIsActive: true,
  });
  expect(seed.mode).toBe("stable_branch");
  expect(seed.model).toEqual({ provider: "openai", modelId: "gpt" });
  expect(seed.branchEntries).toHaveLength(1);
});

test("rotated deferred branch seed carries thinking before replaying context", async () => {
  const calls: string[] = [];
  const seed: DeferredBranchSeed = {
    version: 1,
    parentSession: null,
    sessionName: "child",
    model: { provider: "openai", modelId: "gpt" },
    thinkingLevel: "high",
    mode: "rotated_context",
    context: {
      messages: [{ role: "user", content: "hello", timestamp: Date.now() } as any],
      thinkingLevel: "high",
      model: { provider: "openai", modelId: "gpt" },
    },
  };

  await seedSessionManagerFromDeferredBranchSeed(delayedAppendPort(calls), seed);
  expect(calls).toEqual([
    "session:child",
    "model:openai/gpt",
    "thinking:high",
    "message:user",
  ]);
});

test("deferred branch replay preserves entry order and remaps compaction IDs with async writes", async () => {
  const calls: string[] = [];
  const seed: DeferredBranchSeed = {
    version: 1,
    parentSession: null,
    sessionName: "child",
    model: null,
    thinkingLevel: null,
    mode: "stable_branch",
    branchEntries: [
      { type: "message", id: "source-1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "hello", timestamp: Date.now() } as any },
      { type: "compaction", id: "source-2", parentId: "source-1", timestamp: new Date().toISOString(), summary: "summary", firstKeptEntryId: "source-1", tokensBefore: 10 },
      { type: "custom_entry", id: "source-3", customType: "index", data: { ok: true } },
    ],
  };

  await seedSessionManagerFromDeferredBranchSeed(delayedAppendPort(calls), seed);
  expect(calls).toEqual([
    "message:user",
    "compaction:new-1",
    "custom:index",
  ]);
});
