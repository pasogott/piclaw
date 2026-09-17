import "../helpers.js";
import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { BACKGROUND_CONTEXT, createContextKey, withContextValue } from "@earendil-works/pi-agent-core/harness/context";
import type { AgentHarnessTool, AgentHarnessToolInvocation, AgentLane } from "@earendil-works/pi-agent-core";
import type { PiclawToolContext } from "../../src/service-effects/contracts/execution-context-resolver.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";
import {
  createSelectedHarnessFixture,
  fauxAssistantMessage,
  fauxToolCall,
  readInstalledEarendilAgentCoreVersion,
} from "./fixtures/earendil-harness-direct-probe.js";

const ctx = BACKGROUND_CONTEXT;
const OPERATION = "01950000-0000-7000-8000-000000000001";

async function snapshot(lane: AgentLane, context = ctx) {
  const watch = await lane.watch(context);
  try { return watch.snapshot; } finally { watch.unsubscribe(); }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("selected 0.85.1 public Harness semantics (inactive evidence only)", () => {
  test("HC-015 explicit lane acquisition is atomic and configuration is isolated", async () => {
    const f = await createSelectedHarnessFixture();
    try {
      expect(await readInstalledEarendilAgentCoreVersion()).toBe("0.85.1");
      expect(await f.harness.lanes(ctx)).toEqual([]);
      const [main, same] = await Promise.all([f.harness.lane("main", ctx), f.harness.lane("main", ctx)]);
      expect(main).toBe(same);
      const other = await f.harness.lane("other", ctx);
      await main.setThinkingLevel("high", ctx);
      expect(await main.getThinkingLevel(ctx)).toBe("high");
      expect(await other.getThinkingLevel(ctx)).toBe("off");
      expect((await f.harness.lanes(ctx)).map((lane) => lane.name).sort()).toEqual(["main", "other"]);
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-001 accept is durable before generation and drive settles one last result", async () => {
    const f = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("done")] });
    try {
      const lane = await f.harness.lane("main", ctx);
      const accepted = await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "hello" }, ctx);
      expect(accepted.ok).toBe(true);
      expect(f.faux.state.callCount).toBe(0);
      const before = await snapshot(lane);
      expect(before.operation?.id).toBe(OPERATION);
      expect(before.operation?.kind).toBe("run");
      const driven = await lane.drive({ operationId: OPERATION }, ctx);
      expect(driven.ok && driven.value.kind).toBe("settled");
      const after = await snapshot(lane);
      expect(after.operation).toBeNull();
      expect(after.lastResult).toBeDefined();
      expect(f.faux.state.callCount).toBe(1);
      const settled = after.transcript.filter((entry) => entry.type === "message" && entry.message.role === "assistant");
      expect(settled).toHaveLength(1);
      expect(await lane.getResult(OPERATION, ctx)).toEqual(after.lastResult);
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-002 six-argument tools retain Piclaw authority, invocation identity and awaited memo writes", async () => {
    const env = new FakeExecutionEnv("/test");
    const toolContext = Object.freeze({ chatJid: "chat:owned", operationId: "piclaw-operation", env, localEnv: env });
    const key = createContextKey<string>("selected-probe");
    const chord = withContextValue(key, "context-value", ctx);
    const observed: string[] = [];
    let captured: AgentHarnessToolInvocation | undefined;
    const tool: AgentHarnessTool<PiclawToolContext> = {
      name: "memo_probe", label: "Memo probe", description: "offline selected-release fixture",
      parameters: Type.Object({}), replay: "safe",
      async execute(callId, _params, update, owner, invocation, context) {
        captured = invocation;
        expect(callId).toBe("tool-call");
        expect(owner).toBe(toolContext);
        expect(owner.operationId).toBe("piclaw-operation");
        expect(invocation.operationId).toBe(OPERATION);
        expect(invocation.invocationId).toBeTruthy();
        expect(invocation.turnId).toBeTruthy();
        expect(context.value(key)).toBe("context-value");
        expect(await invocation.getMemo("value")).toBeUndefined();
        await invocation.setMemo("value", { phase: 1 }); observed.push("write");
        expect(await invocation.getMemo("value")).toEqual({ phase: 1 }); observed.push("read");
        await invocation.setMemo("value", undefined); observed.push("delete");
        expect(await invocation.getMemo("value")).toBeUndefined();
        update({ content: [{ type: "text", text: "working" }], details: {} });
        return { content: [{ type: "text", text: "tool done" }], details: {} };
      },
    };
    const f = await createSelectedHarnessFixture<PiclawToolContext>({
      tools: [tool], toolContext,
      responses: [fauxAssistantMessage(fauxToolCall("memo_probe", {}, { id: "tool-call" }), { stopReason: "toolUse" }), fauxAssistantMessage("finished")],
    });
    try {
      const lane = await f.harness.lane("main", chord);
      expect((await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "tool" }, chord)).ok).toBe(true);
      expect((await lane.drive({ operationId: OPERATION }, chord)).ok).toBe(true);
      expect(observed).toEqual(["write", "read", "delete"]);
      expect(captured).toBeDefined();
      await expect(captured!.setMemo("late", "forbidden")).rejects.toBeDefined();
      const after = await snapshot(lane, chord);
      expect(after.transcript.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")).toHaveLength(1);
      expect(f.faux.state.callCount).toBe(2);
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-009 abort uses exact operation identity and expires late tool writes", async () => {
    const started = gate(), released = gate();
    let captured: AgentHarnessToolInvocation | undefined;
    const tool: AgentHarnessTool = {
      name: "blocked", label: "Blocked", description: "controlled offline effect", parameters: Type.Object({}), replay: "never",
      async execute(_id, _params, _update, _owner, invocation) {
        captured = invocation; started.release(); await released.promise;
        return { content: [{ type: "text", text: "late result" }], details: {} };
      },
    };
    const f = await createSelectedHarnessFixture({ tools: [tool], responses: [fauxAssistantMessage(fauxToolCall("blocked", {}), { stopReason: "toolUse" })] });
    try {
      const lane = await f.harness.lane("main", ctx);
      await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "block" }, ctx);
      const driving = lane.drive({ operationId: OPERATION }, ctx);
      await started.promise;
      const aborted = await lane.requestAbort(OPERATION, ctx);
      expect(aborted.ok && aborted.value.operationId).toBe(OPERATION);
      released.release();
      expect((await driving).ok).toBe(true);
      await expect(captured!.setMemo("late", "forbidden")).rejects.toBeDefined();
      expect((await snapshot(lane)).operation).toBeNull();
      expect(f.faux.state.callCount).toBe(1);
    } finally { released.release(); await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-016 closing accepted-undriven work does not call a provider and restores its identity", async () => {
    const f = await createSelectedHarnessFixture();
    const lane = await f.harness.lane("main", ctx);
    await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "pending" }, ctx);
    const metadata = f.session.metadata;
    await f.harness.close(ctx);
    expect(f.faux.state.callCount).toBe(0);
    const session = await f.repo.open(metadata, ctx);
    const restored = await createSelectedHarnessFixture({ repo: f.repo, session });
    try {
      expect(restored.open).toEqual([expect.objectContaining({ lane: "main", operationId: OPERATION, kind: "run" })]);
      expect((await (await restored.harness.lane("main", ctx)).inspectExecution(ctx)).current?.id).toBe(OPERATION);
    } finally { await restored.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-003 parallel effects complete out of order but tool results retain source order", async () => {
    const firstStarted = gate(), secondDone = gate();
    const completions: string[] = [];
    const tool: AgentHarnessTool = {
      name: "parallel", label: "Parallel", description: "ordered evidence", replay: "safe", parameters: Type.Object({ n: Type.Number() }),
      async execute(id) {
        if (id === "first") { firstStarted.release(); await secondDone.promise; }
        else { await firstStarted.promise; secondDone.release(); }
        completions.push(id);
        return { content: [{ type: "text", text: id }], details: {} };
      },
    };
    const f = await createSelectedHarnessFixture({ tools: [tool], toolExecution: "parallel", responses: [
      fauxAssistantMessage([fauxToolCall("parallel", { n: 1 }, { id: "first" }), fauxToolCall("parallel", { n: 2 }, { id: "second" })], { stopReason: "toolUse" }), fauxAssistantMessage("done"),
    ] });
    try {
      const lane = await f.harness.lane("main", ctx);
      const result = await lane.prompt("parallel", undefined, ctx);
      expect(result.ok).toBe(true);
      expect(completions).toEqual(["second", "first"]);
      const entries = (await snapshot(lane)).transcript;
      expect(entries.flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : [])).toEqual(["first", "second"]);
    } finally { secondDone.release(); await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-006/007/008 lane queues preserve identity, support cancellation and consume nextRun once", async () => {
    const f = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("done")] });
    try {
      const lane = await f.harness.lane("main", ctx), other = await f.harness.lane("other", ctx);
      const steer = await lane.steer("steer", undefined, ctx);
      const follow = await lane.followUp("follow", undefined, ctx);
      const next = await lane.nextRun("next", undefined, ctx);
      expect(steer.ok && follow.ok && next.ok).toBe(true);
      if (!steer.ok || !follow.ok || !next.ok) throw new Error("queue admission failed");
      expect((await snapshot(lane)).queues.map((q) => q.entryId)).toEqual([steer.value.entryId, follow.value.entryId, next.value.entryId]);
      expect((await snapshot(other)).queues).toEqual([]);
      expect((await lane.cancelQueued(steer.value.entryId, ctx)).ok).toBe(true);
      expect((await lane.cancelQueued(follow.value.entryId, ctx)).ok).toBe(true);
      expect((await lane.prompt("run", undefined, ctx)).ok).toBe(true);
      const after = await snapshot(lane);
      expect(after.queues).toEqual([]);
      expect(after.transcript.filter((entry) => entry.id === next.value.entryId)).toHaveLength(1);
      const again = await lane.cancelQueued(next.value.entryId, ctx);
      expect(again.ok && again.value.kind).toBe("already_consumed");
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-018 lane watch snapshot/resnapshot and hook registration order are preserved", async () => {
    const f = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("done")] });
    try {
      const lane = await f.harness.lane("main", ctx);
      const hookCalls: string[] = [];
      f.harness.hooks.on("before_run", () => { hookCalls.push("first"); }, { id: "first" });
      f.harness.hooks.on("before_run", async () => { await Promise.resolve(); hookCalls.push("second"); }, { id: "second" });
      const watch = await lane.watch(ctx);
      expect(watch.snapshot.operation).toBeNull();
      const events: string[] = [];
      try {
        const accepted = await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "watch" }, ctx);
        expect(accepted.ok).toBe(true);
        watch.start((event) => { events.push(event.type); });
        expect((await lane.drive({ operationId: OPERATION }, ctx)).ok).toBe(true);
        expect(hookCalls).toEqual(["first", "second"]);
        expect(events).toContain("run_start");
        expect(events).toContain("run_end");
        expect(events.indexOf("run_start")).toBeLessThan(events.indexOf("run_end"));
        expect((await watch.resnapshot(ctx)).operation).toBeNull();
      } finally { watch.unsubscribe(); }
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

  test("HC-019 explicit usage adjustments have stable lane and session totals", async () => {
    const f = await createSelectedHarnessFixture();
    try {
      const lane = await f.harness.lane("main", ctx);
      const usage = { input: 3, output: 2, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 } };
      const recorded = await lane.recordUsage(usage, { details: { provenance: "fixture-only" } }, ctx);
      expect(recorded.ok).toBe(true);
      const before = await snapshot(lane);
      expect(before.stats).toBeDefined();
      expect(JSON.stringify(before.stats)).toContain('"totalTokens":14');
      const again = await snapshot(lane);
      expect(again.stats).toEqual(before.stats);
      expect((await f.session.getStats(ctx)).usage.totalTokens).toBe(14);
    } finally { await f.harness.close(ctx); await f.repo.close(ctx); }
  });

});
