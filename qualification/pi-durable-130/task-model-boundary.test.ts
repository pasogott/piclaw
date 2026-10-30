import { expect, test } from "bun:test";
import { createRegistry, defineExtension, defineTask } from "../../runtime/durable-engine/qualification/durable.ts";
import { context } from "./src/fixture.ts";
import { withTaskModelRequestScope, taskModelRequestScope, taskModelHookScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";

test("temporary request scope preserves exact invocation identity through awaits and rejects other signals", async () => {
  const registry = createRegistry();
  const definition = defineTask({ name: "qualification.scope", version: 1, initial: () => ({ phase: "request" as const }),
    phases: { async request() {} }, async abort() {} });
  registry.install(defineExtension({ name: "scope", tasks: [definition] }));
  const wrapped = withTaskModelRequestScope(registry);
  const snapshot = wrapped.snapshot();
  expect(snapshot.task("qualification.scope")).toBe(snapshot.tasks().find(task => task.definition.name === "qualification.scope"));
  expect(registry.snapshot().task("qualification.scope")).toBe(definition);
  const controller = new AbortController();
  const runtime = { taskId: 12, conversationId: 34, signal: controller.signal };
  let observed: unknown;
  const task = defineTask({ name: "qualification.observe", version: 1, initial: () => ({ phase: "summarize" as const }),
    phases: { async summarize(_task, actual) {
      await Promise.resolve();
      observed = taskModelRequestScope(actual.signal);
      expect(taskModelHookScope({ taskId: actual.taskId, conversationId: actual.conversationId })).toBeUndefined();
      expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
      expect(taskModelRequestScope(undefined)).toBeUndefined();
    } }, async abort() {} });
  registry.install(defineExtension({ name: "observe", tasks: [task] }));
  const phase = wrapped.snapshot().task("qualification.observe")!.definition.phases.summarize as Function;
  await phase({}, runtime, context);
  expect(observed).toMatchObject({ taskId: 12, conversationId: 34, taskKind: "qualification.observe", phase: "summarize", signal: controller.signal });
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
  controller.abort();
  await expect(phase({}, runtime, context)).rejects.toThrow();
});

test("Goal hook identity resolves only its current public generation IDs without a HookApi signal", async () => {
  const registry = createRegistry(), controller = new AbortController();
  const task = defineTask({ name: "pi.generation", version: 1, initial: () => ({ phase: "request" as const }),
    phases: { async request(_record, actual) {
      await Promise.resolve();
      const api = { taskId: actual.taskId, conversationId: actual.conversationId,
        get signal(): never { throw Error("HookApi.signal is not a public SDK contract"); } };
      expect(taskModelHookScope(api)?.signal).toBe(actual.signal);
      expect(taskModelHookScope({ taskId: 99 as never, conversationId: actual.conversationId })).toBeUndefined();
      expect(taskModelHookScope({ taskId: actual.taskId, conversationId: 99 as never })).toBeUndefined();
      expect(taskModelRequestScope(undefined)).toBeUndefined();
      expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
    } }, async abort() {} });
  // Public RegistryReader fixture: the SDK registry already owns pi.generation.
  // Substitute only its executable definition for this identity-only unit test.
  const reader = { subscribe: registry.subscribe.bind(registry), snapshot() {
    const snapshot = registry.snapshot();
    return new Proxy(snapshot, { get(target, key) {
      if (key === "task") return (name: string) => name === "pi.generation" ? task : target.task(name);
      if (key === "tasks") return () => target.tasks().map(current => current.definition.name === "pi.generation" ? task : current);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
  const wrapped = withTaskModelRequestScope(reader);
  const phase = wrapped.snapshot().task("pi.generation")!.definition.phases.request as Function;
  await phase({}, { taskId: 12, conversationId: 34, signal: controller.signal }, context);
  expect(taskModelHookScope({ taskId: 12 as never, conversationId: 34 as never })).toBeUndefined();
});

test("temporary request scope isolates concurrent phases and follows registry replacement", async () => {
  const registry = createRegistry();
  const seen: number[] = [];
  const make = (version: number) => defineTask({ name: "qualification.concurrent", version,
    initial: () => ({ phase: "summarize" as const }),
    phases: { async summarize(_record, runtime) {
      await Bun.sleep(runtime.taskId === 1 ? 5 : 1);
      expect(taskModelRequestScope(runtime.signal)?.taskId).toBe(runtime.taskId);
      seen.push(version);
    } }, async abort() {} });
  const first = make(1);
  registry.install(defineExtension({ name: "concurrent", tasks: [first] }));
  const wrapped = withTaskModelRequestScope(registry);
  const original = wrapped.snapshot();
  let changes = 0;
  const unsubscribe = wrapped.subscribe(() => { changes++; });
  const phase = original.task("qualification.concurrent")!.definition.phases.summarize as Function;
  const signals = [new AbortController().signal, new AbortController().signal];
  await Promise.all(signals.map((signal, index) => phase({}, { taskId: index + 1, conversationId: index + 10, signal }, context)));
  registry.install(defineExtension({ name: "concurrent", tasks: [make(2)] }));
  expect(changes).toBe(1);
  expect(original.task("qualification.concurrent")!.definition.version).toBe(1);
  expect(wrapped.snapshot().task("qualification.concurrent")!.definition.version).toBe(2);
  expect(seen).toEqual([1, 1]);
  unsubscribe();
});

test("temporary request scope is rebuilt for a persisted summary phase after harness reopen", async () => {
  const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { createModels } = await import("../../runtime/durable-engine/qualification/ai.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.ts");
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "task-model-reopen-"));
  const openStorage = () => SqliteStorage.open(new BunSqliteDatabase(join(directory, "tasks.sqlite")));
  const registry = createRegistry();
  let executions = 0;
  const task = defineTask<null, { phase: "summarize" }, null, object>({ name: "qualification.recovered-summary", version: 1,
    initial: () => ({ phase: "summarize" }),
    phases: { async summarize(record, runtime, ctx) {
      const scope = taskModelRequestScope(runtime.signal);
      expect(scope).toMatchObject({ taskId: record.id, conversationId: record.conversationId, taskKind: "qualification.recovered-summary", phase: "summarize" });
      executions++;
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    } }, async abort() {} });
  registry.install(defineExtension({ name: "recovered", tasks: [task] }));
  const options = { models: createModels(), registry: withTaskModelRequestScope(registry) };
  let harness = await Harness.open(await openStorage(), options, context);
  const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const id = await harness.commit(tx => tx.createTask(task, null, { conversationId: conversation.id, ownership: { kind: "conversation" } }), context);
  expect(executions).toBe(0);
  await harness.close(context);
  harness = await Harness.open(await openStorage(), options, context);
  try {
    harness.resume();
    expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
    expect(executions).toBe(1);
  } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
});
