import "../helpers.js";

import { describe, expect, test } from "bun:test";

import { TOOL_PREPARATION_MANIFEST } from "../../src/service-effects/tool-preparation/manifest.js";
import {
  acceptsLateResult,
  boundedOutputFixture,
  composeAfterSingleExecution,
  composeCompleteOutputFixture,
  createScriptedContext,
  exactEditFixture,
  executeWithFence,
  executeWithServiceAuthority,
  probeUnresolvedCall,
  ScriptedDirectTool,
  ScriptedServiceAuthority,
  serializeWritesFixture,
} from "./fixtures/scripted-tool-preparation.js";

function spec(toolName: string) {
  const value = TOOL_PREPARATION_MANIFEST.find((candidate) => candidate.toolName === toolName);
  if (!value) throw new Error(`missing fixture spec ${toolName}`);
  return value;
}

function behaviorKey(row: (typeof TOOL_PREPARATION_MANIFEST)[number]): string {
  return JSON.stringify([
    row.effectClass,
    row.replay,
    row.abortExpectation,
    row.serviceEffector,
    row.contextFields,
  ]);
}

describe("WP-3C complete behavior combination matrix", () => {
  test("executes one faithful recovery case for every effect/replay/abort/effector/context combination", async () => {
    const representatives = new Map<string, (typeof TOOL_PREPARATION_MANIFEST)[number]>();
    for (const row of TOOL_PREPARATION_MANIFEST) representatives.set(behaviorKey(row), row);
    const covered = new Set<string>();
    const branches = { safe: 0, never: 0, mustStop: 0, mayFinishLate: 0, service: 0, external: 0 };

    for (const [key, row] of representatives) {
      const context = createScriptedContext(`matrix-${covered.size}`, `/matrix/${covered.size}`);
      const tool = new ScriptedDirectTool(async () => ({ content: [{ type: "text", text: row.toolName }], details: {} }));
      const outcome = await probeUnresolvedCall(row, tool, context);
      covered.add(key);
      if (row.replay === "safe") {
        branches.safe += 1;
        expect(outcome.status).toBe("executed");
        expect(tool.executeCount).toBe(1);
        expect(tool.contexts[0]).toBe(context);
      } else {
        branches.never += 1;
        expect(outcome.status).toBe("blocked");
        expect(tool.executeCount).toBe(0);
      }
      if (row.abortExpectation === "must_stop") branches.mustStop += 1;
      else branches.mayFinishLate += 1;
      if (row.serviceEffector) branches.service += 1;
      else branches.external += 1;
      expect(row.contextFields.every((field) => Object.hasOwn(context, field))).toBeTrue();
    }

    expect(covered.size).toBe(representatives.size);
    expect(Object.values(branches).every((count) => count > 0)).toBeTrue();
  });

  test("safe recovery uses a fresh isolated four-field context", async () => {
    const tool = new ScriptedDirectTool(async (_id, _params, _signal, _update, context) => ({
      content: [{ type: "text", text: `${context.operationId}:${context.env.cwd}` }],
      details: undefined,
    }));
    const firstContext = createScriptedContext("operation-1", "/remote/one");
    const secondContext = createScriptedContext("operation-2", "/remote/two");
    await tool.execute("initial-call", {}, undefined, undefined, firstContext);
    const recovered = await probeUnresolvedCall(spec("read"), tool, secondContext);

    expect(recovered.status).toBe("executed");
    expect(tool.contexts).toEqual([firstContext, secondContext]);
    expect(tool.contexts[0]).not.toBe(tool.contexts[1]);
    expect(Object.keys(secondContext).sort()).toEqual(["chatJid", "env", "localEnv", "operationId"]);
  });

  test("unknown external mutations and every non-query remain non-recoverable", async () => {
    const tool = new ScriptedDirectTool(async () => { throw new Error("must not execute"); });
    for (const row of TOOL_PREPARATION_MANIFEST.filter((candidate) => candidate.effectClass !== "query")) {
      expect(row.replay).toBe("never");
      expect((await probeUnresolvedCall(row, tool, createScriptedContext(row.toolName, "/work"))).status).toBe("blocked");
    }
    expect(tool.executeCount).toBe(0);
  });
});

describe("WP-3C mapped service-effector authority", () => {
  test("covers every non-null row with exact one-shot EF-S01/S03/S04/S05/S07 authority", async () => {
    const expected = new Map([
      ["attach_file", "EF-S04"],
      ["read_attachment", "EF-S04"],
      ["export_attachment", "EF-S04"],
      ["schedule_task", "EF-S07"],
      ["scheduled_tasks", "EF-S07"],
      ["refresh_workspace_index", "EF-S05"],
      ["send_adaptive_card", "EF-S03"],
      ["send_dashboard_widget", "EF-S03"],
      ["chat", "EF-S01"],
      ["session_control", "EF-S01"],
      ["open_workspace_file", "EF-S05"],
      ["exit_process", "EF-S05"],
    ] as const);
    const mapped = TOOL_PREPARATION_MANIFEST.filter((row) => row.serviceEffector !== null);
    expect(new Map(mapped.map((row) => [row.toolName, row.serviceEffector]))).toEqual(expected);

    const effectorIds = ["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"] as const;
    const exercised = new Set<string>();
    for (const row of mapped) {
      const context = createScriptedContext(`operation:${row.toolName}`, "/authority");
      const tool = new ScriptedDirectTool(async () => ({ content: [{ type: "text", text: row.toolName }], details: undefined }));
      const wrongEffector = effectorIds.find((candidate) => candidate !== row.serviceEffector)!;
      expect((await executeWithServiceAuthority(row, tool, context, undefined)).status).toBe("blocked");
      expect((await executeWithServiceAuthority(row, tool, context, new ScriptedServiceAuthority(wrongEffector, row.toolName, context.operationId))).status).toBe("blocked");
      expect((await executeWithServiceAuthority(row, tool, context, new ScriptedServiceAuthority(row.serviceEffector!, `${row.toolName}:other`, context.operationId))).status).toBe("blocked");
      expect((await executeWithServiceAuthority(row, tool, context, new ScriptedServiceAuthority(row.serviceEffector!, row.toolName, `${context.operationId}:stale`))).status).toBe("blocked");
      expect(tool.executeCount).toBe(0);

      const authority = new ScriptedServiceAuthority(row.serviceEffector!, row.toolName, context.operationId);
      expect((await executeWithServiceAuthority(row, tool, context, authority)).status).toBe("executed");
      expect((await executeWithServiceAuthority(row, tool, context, authority)).status).toBe("blocked");
      expect(tool.executeCount).toBe(1);
      expect(tool.contexts).toEqual([context]);
      exercised.add(`${row.serviceEffector}:${row.toolName}`);
    }

    expect(exercised.size).toBe(expected.size);
    expect(new Set(mapped.map((row) => row.serviceEffector))).toEqual(new Set(effectorIds));
  });
});

describe("WP-3C abort, update ordering and stale-operation fences", () => {
  test("pre-aborted execution invokes no underlying tool", async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = new ScriptedDirectTool(async () => ({ content: [], details: {} }));
    const outcome = await executeWithFence(tool, createScriptedContext("pre-abort", "/work"), controller.signal, () => {});
    expect(outcome).toEqual({ status: "aborted" });
    expect(tool.executeCount).toBe(0);
  });

  test("must_stop propagates abort and accepts no post-abort update", async () => {
    let started!: () => void;
    const observedStart = new Promise<void>((resolve) => { started = resolve; });
    const updates: unknown[] = [];
    const tool = new ScriptedDirectTool(async (_id, _params, signal, onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "started" }], details: { phase: "running" } });
      started();
      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          onUpdate?.({ content: [{ type: "text", text: "late" }], details: {} });
          reject(new Error("aborted"));
        }, { once: true });
      });
    });
    const controller = new AbortController();
    const pending = executeWithFence(tool, createScriptedContext("must-stop", "/work"), controller.signal, (update) => updates.push(update));
    await observedStart;
    controller.abort();
    expect(await pending).toEqual({ status: "aborted" });
    expect(spec("bash").abortExpectation).toBe("must_stop");
    expect(updates).toHaveLength(1);
  });

  test("may_finish_late discards late result and post-abort updates", async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const updates: unknown[] = [];
    const tool = new ScriptedDirectTool(async (_id, _params, _signal, onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "before" }], details: {} });
      await delayed;
      onUpdate?.({ content: [{ type: "text", text: "after" }], details: {} });
      return { content: [{ type: "text", text: "late" }], details: {} };
    });
    const controller = new AbortController();
    const pending = executeWithFence(tool, createScriptedContext("late", "/work"), controller.signal, (update) => updates.push(update));
    await Bun.sleep(0);
    controller.abort();
    release();
    expect(await pending).toEqual({ status: "discarded" });
    expect(updates).toHaveLength(1);
  });

  test("operation change discards stale EF result without accepting a service write", async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let currentOperationId = "operation-old";
    let acceptedServiceWrites = 0;
    const tool = new ScriptedDirectTool(async () => {
      await delayed;
      return { content: [{ type: "text", text: "late" }], details: {} };
    });
    const pending = executeWithFence(
      tool,
      createScriptedContext("operation-old", "/work"),
      new AbortController().signal,
      () => {},
      () => currentOperationId,
    );
    currentOperationId = "operation-new";
    release();
    const outcome = await pending;
    if (outcome.status === "accepted" && acceptsLateResult("operation-old", currentOperationId)) acceptedServiceWrites += 1;
    expect(outcome).toEqual({ status: "discarded" });
    expect(spec("refresh_workspace_index")).toMatchObject({ serviceEffector: "EF-S05", abortExpectation: "may_finish_late" });
    expect(acceptedServiceWrites).toBe(0);
  });

  test("preserves update order and suppresses updates after terminal result", async () => {
    const updates: string[] = [];
    const tool = new ScriptedDirectTool(async (_id, _params, _signal, onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "one" }], details: {} });
      onUpdate?.({ content: [{ type: "text", text: "two" }], details: {} });
      setTimeout(() => onUpdate?.({ content: [{ type: "text", text: "late" }], details: {} }), 0);
      return { content: [{ type: "text", text: "done" }], details: {} };
    });
    const outcome = await executeWithFence(tool, createScriptedContext("updates", "/work"), new AbortController().signal, (update) => {
      const text = update.content[0];
      if (text?.type === "text") updates.push(text.text);
    });
    await Bun.sleep(5);
    expect(outcome.status).toBe("accepted");
    expect(updates).toEqual(["one", "two"]);
  });
});

describe("WP-3C truncation, exact edit and write-serialization cases", () => {
  test("models independent line and byte truncation thresholds", () => {
    const lineBounded = boundedOutputFixture("one\ntwo\nthree", 2, 100);
    const byteBounded = boundedOutputFixture("ééé", 10, 4);
    expect(lineBounded).toEqual({ preview: "one\ntwo", truncated: true, totalLines: 3, totalBytes: 13 });
    expect(byteBounded).toEqual({ preview: "éé", truncated: true, totalLines: 1, totalBytes: 6 });
  });

  test("persists a complete spill copy while preserving native preview/details", async () => {
    const full = "line-1\nline-2\nline-3\nline-4";
    const native = {
      content: [{ type: "text" as const, text: "line-1\nline-2" }],
      details: { truncation: { truncated: true, totalLines: 4 }, fullOutputPath: "/fixture/full.txt" },
    };
    let persisted = "";
    const composed = await composeCompleteOutputFixture(native, (path) => path === "/fixture/full.txt" ? full : undefined, (text) => {
      persisted = text;
      return "stored-fixture";
    });
    expect(persisted).toBe(full);
    expect(composed.content).toBe(native.content);
    expect(composed.details).toEqual({ ...native.details, storedOutputId: "stored-fixture" });
  });

  test("missing spill and persistence faults fail open to the native result", async () => {
    const native = {
      content: [{ type: "text" as const, text: "preview" }],
      details: { fullOutputPath: "/missing/spill.txt" },
    };
    let persistCalls = 0;
    const missing = await composeCompleteOutputFixture(native, () => undefined, () => { persistCalls += 1; return "unexpected"; });
    const failed = await composeCompleteOutputFixture(native, () => "full", () => { throw new Error("fixture fault"); });
    expect(missing).toBe(native);
    expect(failed).toBe(native);
    expect(persistCalls).toBe(0);
  });

  test("post-processes exactly one native execution and never reinvokes on persistence failure", async () => {
    const native = { content: [{ type: "text" as const, text: "native" }], details: { fullOutputPath: "/fixture/native.txt" } };
    const tool = new ScriptedDirectTool(async () => native);
    let compositionCount = 0;
    const result = await composeAfterSingleExecution(tool, createScriptedContext("single", "/work"), () => {
      compositionCount += 1;
      throw new Error("fixture persistence fault");
    });
    expect(tool.executeCount).toBe(1);
    expect(compositionCount).toBe(1);
    expect(result).toBe(native);
  });

  test("exact edit diagnoses zero, one and multiple occurrences", () => {
    expect(() => exactEditFixture("alpha", "missing", "x")).toThrow("found 0");
    expect(exactEditFixture("alpha beta", "beta", "gamma")).toBe("alpha gamma");
    expect(() => exactEditFixture("same same", "same", "x")).toThrow("found 2");
  });

  test("serializes writes in declared order despite different operation latency", async () => {
    const events: string[] = [];
    const results = await serializeWritesFixture([
      async () => { await Bun.sleep(3); events.push("first"); return 1; },
      async () => { events.push("second"); return 2; },
      async () => { events.push("third"); return 3; },
    ]);
    expect(events).toEqual(["first", "second", "third"]);
    expect(results).toEqual([1, 2, 3]);
  });
});
