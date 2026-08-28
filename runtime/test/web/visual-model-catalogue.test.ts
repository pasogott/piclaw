import { expect, test } from "bun:test";

import { normaliseVisualModelPickerOptions } from "../../web/static/visual/frontend/src/components/model-context-bar/useModelPicker.ts";

test("visual model picker keeps normalized current state for non-canonical backend labels", () => {
  expect(normaliseVisualModelPickerOptions({
    current: "gpt-5",
    models: [],
    model_options: [{
      provider: "openai",
      id: "gpt-5",
      label: "gpt-5",
      name: "GPT-5",
      reasoning: true,
      pricing: { input_per_million: 1, output_per_million: 2 },
    }],
  } as any)).toEqual([{
    id: "openai/gpt-5",
    current: true,
    name: "GPT-5",
    context_window: null,
    reasoning: true,
    pricing: {
      input_per_million: 1,
      output_per_million: 2,
      cache_read_per_million: null,
      cache_write_per_million: null,
    },
  }]);
});

test("visual model picker omits unknown reasoning metadata for legacy string payloads", () => {
  expect(normaliseVisualModelPickerOptions({
    current: "openai/gpt-4.1",
    models: ["openai/gpt-4.1"],
    model_options: [],
  } as any)).toEqual([{
    id: "openai/gpt-4.1",
    current: true,
    name: null,
    context_window: null,
    reasoning: undefined,
    pricing: null,
  }]);
});
