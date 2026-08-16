import "../helpers.js";

import { describe, expect, test } from "bun:test";
import { ExecutionError, type ExecutionEnv, type Result as ResultValue } from "@earendil-works/pi-agent-core";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

function unwrap<T, E>(result: ResultValue<T, E>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function readOperations(env: ExecutionEnv): ReadOperations {
  return {
    async access(path) { await unwrap(await env.fileInfo(path)); },
    async readFile(path) { return Buffer.from(unwrap(await env.readBinaryFile(path))); },
    async detectImageMimeType() { return null; },
  };
}

function writeOperations(env: ExecutionEnv, observed: string[] = []): WriteOperations {
  return {
    async mkdir(path) {
      observed.push(`mkdir:${path}`);
      await unwrap(await env.createDir(path, { recursive: true }));
    },
    async writeFile(path, content) {
      observed.push(`write:${path}`);
      await unwrap(await env.writeFile(path, content));
    },
  };
}

function editOperations(env: ExecutionEnv, observed: string[] = []): EditOperations {
  return {
    async access(path) {
      observed.push(`access:${path}`);
      await unwrap(await env.fileInfo(path));
    },
    async readFile(path) {
      observed.push(`read:${path}`);
      return Buffer.from(unwrap(await env.readBinaryFile(path)));
    },
    async writeFile(path, content) {
      observed.push(`write:${path}`);
      await unwrap(await env.writeFile(path, content));
    },
  };
}

function bashOperations(env: ExecutionEnv): BashOperations {
  return {
    async exec(command, cwd, options) {
      const result = await env.exec(command, {
        cwd,
        env: options.env as Record<string, string> | undefined,
        timeout: options.timeout,
        abortSignal: options.signal,
        onStdout: (chunk) => options.onData(Buffer.from(chunk)),
        onStderr: (chunk) => options.onData(Buffer.from(chunk)),
      });
      if (!result.ok) {
        if (result.error.code === "aborted") throw new Error("aborted");
        if (result.error.code === "timeout") throw new Error(`timeout:${options.timeout ?? 0}`);
        throw result.error;
      }
      return { exitCode: result.value.exitCode };
    },
  };
}

function text(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("WP-3C public Earendil core factory behavior", () => {
  test("read uses the ExecutionEnv-backed absolute path and preserves offset/limit behavior", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.putText("notes/a.txt", "one\ntwo\nthree\nfour");
    const tool = createReadTool(env.cwd, { operations: readOperations(env) });

    const result = await tool.execute("read-1", { path: "notes/a.txt", offset: 2, limit: 2 }, undefined, undefined);

    expect(text(result)).toBe("two\nthree\n\n[1 more lines in file. Use offset=4 to continue.]");
  });

  test("read exposes truncation details and rejects missing, pre-aborted and mid-flight calls", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.putText("large.txt", Array.from({ length: 2_100 }, (_, index) => `line-${index + 1}`).join("\n"));
    const tool = createReadTool(env.cwd, { operations: readOperations(env) });
    const truncated = await tool.execute("read-large", { path: "large.txt" }, undefined, undefined);
    expect(truncated.details?.truncation).toMatchObject({ truncated: true, truncatedBy: "lines", maxLines: 2_000 });
    expect(text(truncated)).toContain("Use offset=2001 to continue.");
    await expect(tool.execute("read-missing", { path: "missing.txt" }, undefined, undefined)).rejects.toMatchObject({ code: "not_found" });

    const pre = new AbortController();
    pre.abort();
    await expect(tool.execute("read-pre", { path: "large.txt" }, pre.signal, undefined)).rejects.toThrow("Operation aborted");

    const gate = deferred();
    let accessStarted!: () => void;
    const started = new Promise<void>((resolve) => { accessStarted = resolve; });
    const blocked = createReadTool(env.cwd, {
      operations: {
        ...readOperations(env),
        async access(path) { accessStarted(); await gate.promise; await readOperations(env).access(path); },
      },
    });
    const controller = new AbortController();
    const pending = blocked.execute("read-mid", { path: "large.txt" }, controller.signal, undefined);
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow("Operation aborted");
    gate.resolve();
  });

  test("write resolves paths, creates the parent first and does not write after a mid-flight abort", async () => {
    const env = new FakeExecutionEnv("/repo");
    const observed: string[] = [];
    const tool = createWriteTool(env.cwd, { operations: writeOperations(env, observed) });
    const result = await tool.execute("write-1", { path: "nested/a.txt", content: "hello" }, undefined, undefined);
    expect(text(result)).toBe("Successfully wrote 5 bytes to nested/a.txt");
    expect(observed).toEqual(["mkdir:/repo/nested", "write:/repo/nested/a.txt"]);
    expect(new TextDecoder().decode(env.files.get("/repo/nested/a.txt"))).toBe("hello");

    const gate = deferred();
    let mkdirStarted!: () => void;
    const started = new Promise<void>((resolve) => { mkdirStarted = resolve; });
    let writes = 0;
    const blocked = createWriteTool(env.cwd, {
      operations: {
        async mkdir() { mkdirStarted(); await gate.promise; },
        async writeFile() { writes += 1; },
      },
    });
    const controller = new AbortController();
    const pending = blocked.execute("write-mid", { path: "never.txt", content: "never" }, controller.signal, undefined);
    await started;
    controller.abort();
    gate.resolve();
    await expect(pending).rejects.toThrow("Operation aborted");
    expect(writes).toBe(0);
  });

  test("write rejects backend errors and a pre-aborted call without touching operations", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.rejectAllFiles = true;
    const observed: string[] = [];
    const tool = createWriteTool(env.cwd, { operations: writeOperations(env, observed) });
    await expect(tool.execute("write-error", { path: "a.txt", content: "x" }, undefined, undefined)).rejects.toMatchObject({ code: "unknown" });
    expect(observed).toEqual(["mkdir:/repo"]);

    observed.length = 0;
    const pre = new AbortController();
    pre.abort();
    await expect(tool.execute("write-pre", { path: "a.txt", content: "x" }, pre.signal, undefined)).rejects.toThrow("Operation aborted");
    expect(observed).toEqual([]);
  });

  test("edit writes one exact replacement and reports absolute operation ordering", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.putText("a.txt", "alpha\nbeta\n");
    const observed: string[] = [];
    const tool = createEditTool(env.cwd, { operations: editOperations(env, observed) });
    const result = await tool.execute("edit-1", { path: "a.txt", edits: [{ oldText: "beta", newText: "gamma" }] }, undefined, undefined);
    expect(text(result)).toBe("Successfully replaced 1 block(s) in a.txt.");
    expect(observed).toEqual(["access:/repo/a.txt", "read:/repo/a.txt", "write:/repo/a.txt"]);
    expect(new TextDecoder().decode(env.files.get("/repo/a.txt"))).toBe("alpha\ngamma\n");
    expect(result.details?.patch).toContain("+gamma");
  });

  test("edit rejects duplicate and missing matches without writing", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.putText("a.txt", "same same");
    const observed: string[] = [];
    const tool = createEditTool(env.cwd, { operations: editOperations(env, observed) });
    await expect(tool.execute("edit-duplicate", { path: "a.txt", edits: [{ oldText: "same", newText: "next" }] }, undefined, undefined)).rejects.toThrow("Found 2 occurrences");
    expect(observed).not.toContain("write:/repo/a.txt");
    observed.length = 0;
    await expect(tool.execute("edit-missing", { path: "a.txt", edits: [{ oldText: "absent", newText: "next" }] }, undefined, undefined)).rejects.toThrow("Could not find the exact text");
    expect(observed).not.toContain("write:/repo/a.txt");
  });

  test("bash streams combined output and surfaces non-zero and timeout outcomes", async () => {
    const env = new FakeExecutionEnv("/repo");
    const tool = createBashTool(env.cwd, { operations: bashOperations(env), exposeSessionEnvironment: false });
    env.script({ _tag: "result", stdout: "out\n", stderr: "err\n", exitCode: 0 });
    const updates: string[] = [];
    const success = await tool.execute("bash-ok", { command: "echo ok" }, undefined, (update) => updates.push(text(update)));
    expect(text(success)).toBe("out\nerr\n");
    expect(updates.at(-1)).toBe("out\nerr\n");

    env.script({ _tag: "result", stdout: "partial", stderr: "", exitCode: 7 });
    await expect(tool.execute("bash-nonzero", { command: "false" }, undefined, undefined)).rejects.toThrow("partial\n\nCommand exited with code 7");

    env.script({ _tag: "error", error: new ExecutionError("timeout", "deadline") });
    await expect(tool.execute("bash-timeout", { command: "sleep", timeout: 3 }, undefined, undefined)).rejects.toThrow("Command timed out after 3 seconds");
  });

  test("bash preserves pre-abort and mid-flight abort behavior through ExecutionEnv", async () => {
    const env = new FakeExecutionEnv("/repo");
    const tool = createBashTool(env.cwd, { operations: bashOperations(env), exposeSessionEnvironment: false });
    env.script({ _tag: "result", stdout: "unused", stderr: "", exitCode: 0 });
    const pre = new AbortController();
    pre.abort();
    await expect(tool.execute("bash-pre", { command: "unused" }, pre.signal, undefined)).rejects.toThrow("Command aborted");
    expect(env.shellSteps).toHaveLength(1);
    env.shellSteps.length = 0;

    const gate = deferred();
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    env.script({ _tag: "wait_for_stop", started, release: gate.promise });
    const controller = new AbortController();
    const pending = tool.execute("bash-mid", { command: "wait" }, controller.signal, undefined);
    await running;
    controller.abort();
    gate.resolve();
    await expect(pending).rejects.toThrow("Command aborted");
    expect(env.killedGroups).toHaveLength(1);
  });
});
