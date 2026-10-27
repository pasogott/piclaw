import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Model } from "@earendil-works/pi-ai";

import { getActivePiclawCompactionTrigger, runWithPiclawCompactionTrigger } from "../../src/agent-pool/compaction-trigger-context.js";
import {
  resetCompactionRuntimeConfigForTests,
  setCompactionRuntimeConfigForTests,
} from "../../src/core/config.js";
import { streamComplete } from "../../src/extensions/smart-compaction/stream-complete.js";
import {
  startDelayedOpenAICompatibleServer,
  type DelayedOpenAIServer,
} from "../fixtures/delayed-openai-compatible-server.js";

process.env.PICLAW_DB_IN_MEMORY = "1";

let fixture: DelayedOpenAIServer;

beforeEach(() => {
  resetCompactionRuntimeConfigForTests();
  fixture = startDelayedOpenAICompatibleServer();
});

afterEach(() => {
  fixture.stop();
  resetCompactionRuntimeConfigForTests();
});

function model(): Model<"openai-completions"> {
  return {
    id: "delayed-fixture",
    name: "Delayed local fixture",
    api: "openai-completions",
    provider: "local-fixture",
    baseUrl: fixture.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

async function actualAdapterCompletion(signal: AbortSignal, onResponseHeaders?: () => void) {
  return await streamComplete({
    model: model(),
    systemPrompt: "Return a compact continuity summary.",
    userPrompt: "Summarize this deterministic fixture.",
    maxTokens: 128,
    signal,
    apiKey: "fixture-key",
    onResponseHeaders,
    onProgress: () => {},
    progressIntervalMs: 0,
  });
}

function textOf(message: Awaited<ReturnType<typeof actualAdapterCompletion>>): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

test("actual adapter remains in provider_connect while response headers are delayed", async () => {
  let requestReceived!: () => void;
  const received = new Promise<void>((resolve) => { requestReceived = resolve; });
  fixture.enqueue({ headerDelayMs: 3_000, chunks: ["too late"], onRequestReceived: requestReceived });
  const controller = new AbortController();
  let observedStage: string | undefined;
  await runWithPiclawCompactionTrigger({
    chatJid: "web:delayed-provider-connect",
    trigger: "manual",
    willRetry: false,
    source: "test",
    deadlineAtMs: Date.now() + 10_000,
    executionStage: "deterministic",
  }, async () => {
    const run = actualAdapterCompletion(controller.signal);
    await received;
    observedStage = getActivePiclawCompactionTrigger()?.executionStage;
    controller.abort();
    await run.catch(() => undefined);
  });
  expect(observedStage).toBe("provider_connect");
});

test("actual adapter advances from response headers to first_token before content", async () => {
  fixture.enqueue({ firstTokenDelayMs: 3_000, chunks: ["too late"] });
  const controller = new AbortController();
  let responseHeadersObserved = false;
  const run = runWithPiclawCompactionTrigger({
    chatJid: "web:delayed-first-token",
    trigger: "manual",
    willRetry: false,
    source: "test",
    deadlineAtMs: Date.now() + 10_000,
    executionStage: "deterministic",
  }, async () => await actualAdapterCompletion(controller.signal, () => {
    responseHeadersObserved = true;
    controller.abort();
  }));

  await run.catch(() => undefined);
  expect(responseHeadersObserved).toBe(true);
});

test("actual adapter reports an early SSE termination without a finish reason", async () => {
  fixture.enqueue({ chunks: ["partial"], terminateEarly: true });
  const message = await actualAdapterCompletion(new AbortController().signal);
  expect(message.stopReason).toBe("error");
  expect(message.errorMessage).toContain("finish_reason");
});
