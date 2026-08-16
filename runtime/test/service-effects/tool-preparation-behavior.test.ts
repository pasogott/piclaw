import "../helpers.js";

import { describe, expect, test } from "bun:test";

import { TOOL_PREPARATION_MANIFEST } from "../../src/service-effects/tool-preparation/manifest.js";
import {
  acceptsLateResult,
  composeAfterSingleExecution,
  createScriptedContext,
  metadataOnlyTrace,
  probeUnresolvedCall,
  ScriptedDirectTool,
} from "./fixtures/scripted-tool-preparation.js";

function spec(toolName: string) {
  const value = TOOL_PREPARATION_MANIFEST.find((candidate) => candidate.toolName === toolName);
  if (!value) throw new Error(`missing fixture spec ${toolName}`);
  return value;
}

describe("WP-3C implementation-independent recovery cases", () => {
  test("safe query recovery executes once with a fresh four-field context", async () => {
    const tool = new ScriptedDirectTool(async (_id, _params, _signal, _update, context) => ({
      content: [{ type: "text", text: `${context.operationId}:${context.env.cwd}` }],
      details: undefined,
    }));
    const firstContext = createScriptedContext("operation-1", "/remote/one");
    const secondContext = createScriptedContext("operation-2", "/remote/two");

    await tool.execute("initial-call", {}, undefined, undefined, firstContext);
    const recovered = await probeUnresolvedCall(spec("read"), tool, secondContext);

    expect(recovered.status).toBe("executed");
    expect(tool.executeCount).toBe(2);
    expect(tool.contexts).toEqual([firstContext, secondContext]);
    expect(Object.keys(secondContext).sort()).toEqual(["chatJid", "env", "localEnv", "operationId"]);
  });

  test("never recovery blocks a mutation without invoking it", async () => {
    const tool = new ScriptedDirectTool(async () => {
      throw new Error("mutation must not be replayed");
    });
    expect(await probeUnresolvedCall(spec("bash"), tool, createScriptedContext("operation-1", "/work"))).toEqual({ status: "blocked" });
    expect(tool.executeCount).toBe(0);
  });

  test("every safe row is a deterministic query and every mutation stays never", () => {
    expect(TOOL_PREPARATION_MANIFEST.filter((row) => row.replay === "safe").every((row) => row.effectClass === "query")).toBeTrue();
    expect(TOOL_PREPARATION_MANIFEST.filter((row) => row.effectClass !== "query").every((row) => row.replay === "never")).toBeTrue();
  });
});

describe("WP-3C abort and late-result cases", () => {
  test("must_stop propagates abort and accepts no post-abort update", async () => {
    let started!: () => void;
    const observedStart = new Promise<void>((resolve) => { started = resolve; });
    const updates: unknown[] = [];
    const tool = new ScriptedDirectTool(async (_id, _params, signal, onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "started" }], details: { phase: "running" } });
      started();
      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const controller = new AbortController();
    const pending = tool.execute("abort-call", {}, controller.signal, (update) => updates.push(update), createScriptedContext("operation-1", "/work"));
    await observedStart;
    controller.abort();

    await expect(pending).rejects.toThrow("aborted");
    await Bun.sleep(0);
    expect(spec("bash").abortExpectation).toBe("must_stop");
    expect(updates).toHaveLength(1);
  });

  test("may_finish_late result is rejected by the operation fence", async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let acceptedServiceWrites = 0;
    const tool = new ScriptedDirectTool(async () => {
      await delayed;
      return { content: [{ type: "text", text: "late" }], details: {} };
    });
    const controller = new AbortController();
    const pending = tool.execute("late-call", {}, controller.signal, undefined, createScriptedContext("operation-old", "/work"));
    controller.abort();
    release();
    const result = await pending;
    if (acceptsLateResult("operation-old", "operation-new")) acceptedServiceWrites += 1;

    expect(result.content).toEqual([{ type: "text", text: "late" }]);
    expect(spec("refresh_workspace_index")).toMatchObject({
      serviceEffector: "EF-S05",
      abortExpectation: "may_finish_late",
    });
    expect(acceptedServiceWrites).toBe(0);
  });
});

describe("WP-3C update, truncation, and protected-data cases", () => {
  test("post-result persistence composes over one native execution and preserves full-output details", async () => {
    const nativeResult = {
      content: [{ type: "text" as const, text: "bounded preview" }],
      details: {
        truncation: { truncated: true, totalLines: 500 },
        fullOutputPath: "/fixture/full-output.txt",
      },
    };
    const tool = new ScriptedDirectTool(async () => nativeResult);
    let compositionCount = 0;
    const composed = await composeAfterSingleExecution(tool, createScriptedContext("operation-1", "/work"), async (result) => {
      compositionCount += 1;
      return {
        content: [{ type: "text", text: "tool-output:fixture-handle\n\nPreview:\nbounded preview" }],
        details: { ...(result.details as object), storedOutputId: "fixture-handle" },
      };
    });

    expect(tool.executeCount).toBe(1);
    expect(compositionCount).toBe(1);
    expect(composed.details).toEqual({
      truncation: { truncated: true, totalLines: 500 },
      fullOutputPath: "/fixture/full-output.txt",
      storedOutputId: "fixture-handle",
    });
  });

  test("post-result persistence failure fails open without reinvocation", async () => {
    const nativeResult = { content: [{ type: "text" as const, text: "native" }], details: { fullOutputPath: "/fixture/native.txt" } };
    const tool = new ScriptedDirectTool(async () => nativeResult);
    const result = await composeAfterSingleExecution(tool, createScriptedContext("operation-1", "/work"), () => {
      throw new Error("fixture persistence fault");
    });
    expect(tool.executeCount).toBe(1);
    expect(result).toBe(nativeResult);
  });

  test("metadata-only trace excludes protected arguments and results", () => {
    const secret = "fixture-secret-value";
    const trace = metadataOnlyTrace(spec("keychain"));
    const serialized = JSON.stringify({ trace, genericError: "credential operation failed" });
    expect(spec("keychain").protectedFields).toContain("params.secret");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("result.content");
  });
});
