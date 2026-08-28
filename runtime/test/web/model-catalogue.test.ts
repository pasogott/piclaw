import { expect, test } from "bun:test";

import {
  MODEL_CONTEXT_OVERHEAD_TOKENS,
  MODEL_TOKEN_ESTIMATE_SAFETY_MULTIPLIER,
  buildModelSearchDocument,
  calculateModelContextFit,
  classifyModelIdentity,
  classifyModelVariants,
  compareModelCatalogueText,
  filterAndRankModels,
  groupModels,
  normaliseModelCatalogue,
} from "../../web/src/ui/model-catalogue.ts";

test("normaliseModelCatalogue preserves provider/model identity and structured metadata", () => {
  const entries = normaliseModelCatalogue({
    current: "openrouter/anthropic/claude-sonnet-4:latest",
    model_options: [
      {
        provider: "github-copilot",
        id: "claude-sonnet-4",
        label: "github-copilot/claude-sonnet-4",
        name: "Claude Sonnet 4",
        context_window: 200_000,
        reasoning: true,
        thinking_levels: ["off", "high"],
        thinking_level_labels: ["Off", "High"],
        pricing: { input_per_million: 3, output_per_million: 15, cache_read_per_million: 0.3 },
      },
      {
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4:latest",
        label: "openrouter/anthropic/claude-sonnet-4:latest",
        name: "Claude Sonnet 4",
        context_window: 200_000,
        reasoning: true,
      },
    ],
  }, {
    contextUsage: { tokens: 10_000 },
    pinnedKeys: ["github-copilot/claude-sonnet-4"],
    recentByKey: { "github-copilot/claude-sonnet-4": "2026-08-28T12:00:00Z" },
  });

  expect(entries.map((entry) => entry.key)).toEqual([
    "github-copilot/claude-sonnet-4",
    "openrouter/anthropic/claude-sonnet-4:latest",
  ]);
  expect(entries[0]).toMatchObject({
    key: "github-copilot/claude-sonnet-4",
    provider: "github-copilot",
    publisher: null,
    family: "Claude",
    id: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    contextWindow: 200_000,
    reasoning: true,
    thinkingLevels: [{ id: "off", label: "Off" }, { id: "high", label: "High" }],
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: null,
    },
    variants: [],
    current: false,
    pinned: true,
    lastUsedAt: "2026-08-28T12:00:00Z",
  });
  expect(entries[1]).toMatchObject({
    provider: "openrouter",
    publisher: "anthropic",
    family: "Claude",
    variants: ["alias"],
    current: true,
    pinned: false,
    lastUsedAt: null,
  });
});

test("normaliseModelCatalogue supports legacy strings, missing metadata, and duplicate keys", () => {
  const entries = normaliseModelCatalogue({
    current: "openai/gpt-5",
    model_options: [],
    models: ["openai/gpt-5", "anthropic/claude-4", "openai/gpt-5", "", null],
  });

  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    key: "anthropic/claude-4",
    provider: "anthropic",
    id: "claude-4",
    displayName: "anthropic/claude-4",
    contextWindow: null,
    contextFit: {
      state: "unknown",
      currentTokens: null,
      safetyAdjustedTokens: null,
      effectiveContextWindow: null,
    },
  });
  expect(entries[1]).toMatchObject({ key: "openai/gpt-5", current: true });
});

test("classification infers encoded publishers, model families, and deterministic variants", () => {
  expect(classifyModelIdentity({ provider: "openrouter", id: "qwen/qwen3-coder", displayName: "Qwen3 Coder" })).toEqual({
    publisher: "qwen",
    family: "Qwen",
  });
  expect(classifyModelIdentity({ provider: "github-copilot", id: "o4-mini", displayName: "o4 mini" })).toEqual({
    publisher: null,
    family: "OpenAI o-series",
  });
  expect(classifyModelIdentity({ provider: "cerebras", id: "qwen3-235b", displayName: "" })).toEqual({
    publisher: null,
    family: "Qwen",
  });
  expect(classifyModelVariants({ id: "google/gemini-3-preview:free-batch", displayName: "Gemini Image Fast" })).toEqual([
    "batch",
    "free",
    "preview",
    "fast",
    "image",
  ]);
  expect(classifyModelVariants({ id: "anthropic/claude-sonnet-latest" })).toEqual(["alias"]);
});

test("calculateModelContextFit preserves the 4K overhead and 1.1 estimator safety rules", () => {
  expect(MODEL_CONTEXT_OVERHEAD_TOKENS).toBe(4_000);
  expect(MODEL_TOKEN_ESTIMATE_SAFETY_MULTIPLIER).toBe(1.1);
  expect(calculateModelContextFit({ contextWindow: 200_000 }, { tokens: 150_000 })).toEqual({
    state: "fits",
    currentTokens: 150_000,
    safetyAdjustedTokens: 165_000,
    effectiveContextWindow: 196_000,
  });
  expect(calculateModelContextFit({ contextWindow: 128_000 }, { tokens: 150_000 })).toEqual({
    state: "blocked",
    currentTokens: 150_000,
    safetyAdjustedTokens: 165_000,
    effectiveContextWindow: 124_000,
  });
  expect(calculateModelContextFit({ contextWindow: null }, { tokens: 150_000 })).toEqual({
    state: "unknown",
    currentTokens: 150_000,
    safetyAdjustedTokens: 165_000,
    effectiveContextWindow: null,
  });
  expect(calculateModelContextFit({ contextWindow: 128_000 }, null)).toEqual({
    state: "unknown",
    currentTokens: null,
    safetyAdjustedTokens: null,
    effectiveContextWindow: 124_000,
  });
});

test("search matches shared name, identity, route, publisher, family, capability, variant, and context tokens", () => {
  const [entry] = normaliseModelCatalogue({
    model_options: [{
      provider: "openrouter",
      id: "google/gemini-3-preview:free",
      name: "Gemini 3 Flash",
      context_window: 1_000_000,
      reasoning: true,
    }],
  }, { currentTokens: 10_000 });
  const document = buildModelSearchDocument(entry);

  for (const token of ["gemini 3 flash", "openrouter", "google", "gemini", "preview", "free", "reasoning", "1m context"]) {
    expect(document).toContain(token);
  }
  expect(filterAndRankModels([entry], { query: "google reasoning 1m" })).toEqual([entry]);
  expect(filterAndRankModels([entry], { query: "anthropic" })).toEqual([]);
});

test("filterAndRankModels applies compatibility and deterministic recommended ranking", () => {
  const entries = normaliseModelCatalogue({
    current: "openrouter/openai/gpt-5",
    model_options: [
      { provider: "openrouter", id: "openai/gpt-5-preview", name: "GPT 5 Preview", context_window: 128_000, reasoning: true },
      { provider: "openrouter", id: "openai/gpt-5", name: "GPT 5", context_window: 200_000, reasoning: true },
      { provider: "openrouter", id: "openai/gpt-4:free", name: "GPT 4 Free", context_window: 200_000, reasoning: false },
      { provider: "openrouter", id: "openai/gpt-4:latest", name: "GPT 4 Latest", context_window: 200_000, reasoning: false },
      { provider: "github-copilot", id: "claude-sonnet-4", name: "Claude Sonnet 4", context_window: 200_000, reasoning: true },
    ],
  }, {
    currentTokens: 150_000,
    pinnedKeys: ["github-copilot/claude-sonnet-4"],
    recentByKey: { "openrouter/openai/gpt-4:free": "2026-08-28T10:00:00Z" },
  });

  expect(filterAndRankModels(entries).map((entry) => entry.key)).toEqual([
    "openrouter/openai/gpt-5",
    "github-copilot/claude-sonnet-4",
    "openrouter/openai/gpt-4:free",
    "openrouter/openai/gpt-4:latest",
    "openrouter/openai/gpt-5-preview",
  ]);
  expect(filterAndRankModels(entries, { contextFit: "compatible" }).map((entry) => entry.key)).not.toContain("openrouter/openai/gpt-5-preview");
  expect(filterAndRankModels(entries, { providers: "openrouter", variants: "stable", reasoning: false }).map((entry) => entry.key)).toEqual([
    "openrouter/openai/gpt-4:latest",
  ]);
});

test("groupModels groups access providers and encoded publishers with counts", () => {
  const entries = normaliseModelCatalogue({
    model_options: [
      { provider: "openrouter", id: "anthropic/claude-4", context_window: 200_000 },
      { provider: "openrouter", id: "google/gemini-3", context_window: 128_000 },
      { provider: "openrouter", id: "auto", context_window: 200_000 },
      { provider: "github-copilot", id: "gpt-5", context_window: 200_000 },
    ],
  }, { currentTokens: 150_000 });

  const groups = groupModels(entries);
  expect(groups.map((group) => group.provider)).toEqual(["github-copilot", "openrouter"]);
  expect(groups[1]).toMatchObject({
    provider: "openrouter",
    compatibleCount: 2,
    totalCount: 3,
  });
  expect(groups[1].entries.map((entry) => entry.id)).toEqual(["auto"]);
  expect(groups[1].publisherGroups.map((group) => ({ publisher: group.publisher, compatible: group.compatibleCount, total: group.totalCount }))).toEqual([
    { publisher: "anthropic", compatible: 1, total: 1 },
    { publisher: "google", compatible: 0, total: 1 },
  ]);
});

test("405-model catalogue remains distinct, searchable, groupable, and naturally ordered", () => {
  const modelOptions = Array.from({ length: 405 }, (_, index) => ({
    provider: index < 360 ? "openrouter" : index < 385 ? "github-copilot" : "openai",
    id: index < 360
      ? `${["anthropic", "google", "openai", "qwen"][index % 4]}/model-${index}${index % 20 === 0 ? ":free" : ""}`
      : `model-${index}`,
    name: `Model ${index}`,
    context_window: index % 3 === 0 ? 128_000 : 200_000,
    reasoning: index % 2 === 0,
  }));
  const entries = normaliseModelCatalogue({ model_options: modelOptions }, { currentTokens: 150_000 });

  expect(entries).toHaveLength(405);
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(405);
  expect(filterAndRankModels(entries, { query: "qwen model-31" }).map((entry) => entry.id)).toEqual([
    "qwen/model-31",
    "qwen/model-311",
    "qwen/model-315",
    "qwen/model-319",
  ]);
  expect(filterAndRankModels(entries, { contextFit: "blocked" })).toHaveLength(135);
  expect(groupModels(entries).reduce((count, group) => count + group.totalCount, 0)).toBe(405);
  expect(["model-2", "model-10", "model-1"].sort(compareModelCatalogueText)).toEqual(["model-1", "model-2", "model-10"]);
});
