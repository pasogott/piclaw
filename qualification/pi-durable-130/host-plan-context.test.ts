import "./src/test-guard.js";
import { expect, test as bunTest } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Harness, createRegistry, defineExtension, defineTool, type Conversation, type TaskId, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { createModels, createProvider, Type, type AssistantMessage, type Message, type Model } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { materializePlanContext, hostPlanContextKind, materializeGoalContext, hostGoalContextKind, type GoalContextIdentity } from "../../runtime/durable-engine/src/host-plan-context.js";
import { projectPublicHistory } from "../../runtime/durable-engine/src/session-tree.js";
import { context, barrier } from "./src/fixture.js";
import { awaitWithContext } from "../../runtime/durable-engine/qualification/context.ts";
// Match the public Root provider's normalization brand, not the private engine's.
import { normalizeContext as normalizeRootContext } from "../../node_modules/@earendil-works/pi-ai";
import { streamSimple as codexStream } from "@earendil-works/pi-ai/api/openai-codex-responses";

// These are isolated SQLite/harness integration cases; allow for the repository's
// background test priority and shared-host I/O without relaxing assertions.
const test = (name: string, body: () => Promise<void>, timeout = 30000) => bunTest(name, body, timeout);

const model: Model<"openai-completions"> = { id: "plan-context", provider: "plan-fixture", name: "Plan fixture",
  api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false,
  contextWindow: 100000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const content = (plan: string) => [{ type: "text" as const, text: `Current Plan Sidebar checklist for web:plan:\n\n${plan || "(empty)"}` }];
const answer = (plan?: string, index = 0): AssistantMessage => ({ role: "assistant", api: model.api,
  provider: model.provider, model: model.id, timestamp: index + 1,
  content: plan === undefined ? [{ type: "text", text: "synthetic summary or answer" }] :
    [{ type: "toolCall", id: `change-${index}`, name: "change_plan", arguments: { markdown: plan } }],
  stopReason: plan === undefined ? "stop" : "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

async function fixture(variant: {goal?:boolean; mixed?:boolean; identity?:()=>GoalContextIdentity} = {}) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "plan-context-"));
  const requests: Message[][] = [], failures: unknown[] = [];
  const state = { plan: "- [ ] ORIGINAL", allowed: true, prepared: false, maintenance: false,
    replies: [] as string[], taskId: 0 as TaskId,
    afterPersist: undefined as ((ctx: Parameters<typeof materializePlanContext>[6]) => Promise<void>) | undefined,
    wrap: (conversation: Conversation) => conversation };
  const assertCurrent = () => { if (!state.allowed) throw Error("Plan source revoked"); };
  const registry = createRegistry();
  let harness: Harness, conversation: Conversation, database: BunSqliteDatabase;
  const handlers: Pick<GenerationHooks, "beforeRequest"> = { async beforeRequest(request, api, ctx) {
    state.prepared = false; state.taskId = api.taskId;
    try {
      const current = (await harness.conversation(api.conversationId, ctx))!;
      const messages = await database.withAdmissionGuard(assertCurrent, async () => {
        const identity = variant.identity?.() ?? {goalId:"goal-owned",generation:1,status:"active" as const};
        if (variant.mixed) {
          const goal = await materializeGoalContext(state.wrap(current), api.taskId, "web:plan", request.messages,
            [{type:"text",text:"Immutable Goal objective"}], identity, assertCurrent, ctx);
          return materializePlanContext(state.wrap(current), api.taskId, "web:plan", goal, content(state.plan), assertCurrent, ctx);
        }
        return variant.goal ? materializeGoalContext(state.wrap(current), api.taskId, "web:plan", request.messages, content(state.plan), identity, assertCurrent, ctx)
          : materializePlanContext(state.wrap(current), api.taskId, "web:plan", request.messages, content(state.plan), assertCurrent, ctx);
      });
      await state.afterPersist?.(ctx);
      state.prepared = true;
      return { messages };
    } catch (error) { failures.push(error); throw error; }
  } };
  const tool = defineTool({ name: "change_plan", description: "Fixture Plan update", callers: ["model"], replay: "unsafe",
    parameters: Type.Object({ markdown: Type.String() }), async execute(args) {
      state.plan = args.markdown; return { output: [{ type: "text", text: "Plan updated." }] };
    } });
  const extension = defineExtension({ name: "plan-fixture", tools: [tool], hooks: [{ task: "pi.generation", handlers }] });
  registry.install(extension);
  const models = createModels({ authContext: { env: async () => { throw Error("No ambient credentials"); },
    fileExists: async () => { throw Error("No ambient credentials"); } } });
  const stream = (_: unknown, request: { messages: readonly Message[] }) => {
    if (!state.maintenance && !state.prepared) throw Error("Plan dispatch was not prepared");
    state.prepared = false;
    requests.push(structuredClone([...request.messages]));
    const message = answer(state.maintenance ? undefined : state.replies.shift(), requests.length);
    const result = new AssistantMessageEventStream();
    result.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); result.end(); return result;
  };
  models.setProvider(createProvider({ id: model.provider, models: [model], api: { stream, streamSimple: stream },
    auth: { apiKey: { name: "Synthetic only", resolve: async () => ({ auth: {}, source: "fixture" }) } } }));
  const options = { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } };
  const open = async () => {
    database = new BunSqliteDatabase(join(dir, "history.sqlite"));
    return Harness.open(await SqliteStorage.open(database), options, context);
  };
  harness = await open();
  conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id },
    instructions: "Stable Plan fixture policy", extensions: [extension], tools: [tool] } });
  return { state, requests, failures, get harness() { return harness; }, get conversation() { return conversation; },
    async entries() { return (await conversation.entries({ order: "ascending" }, 1000, undefined, context)).items; },
    async submit(text: string, target = conversation) { return target.submit({ type: "input", content: [{ type: "text", text }] }, context); },
    async run(text = "continue", target = conversation) { return (await this.submit(text, target)).wait(context); },
    async reopen() { const id = conversation.id; await harness.close(context); harness = await open(); conversation = (await harness.conversation(id, context))!; },
    async close() { await harness.close(context); await rm(dir, { recursive: true, force: true }); } };
}
const snapshots = (rows: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["entries"]>>) => rows.filter(row => row.kind === hostPlanContextKind);
function prefix(before: readonly Message[], after: readonly Message[]) {
  expect(after.length).toBeGreaterThan(before.length);
  expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before));
}

test("Plan changes after a tool append a snapshot without moving the previous request prefix", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("- [-] UPDATED"); await f.run();
    expect(f.requests).toHaveLength(2); prefix(f.requests[0]!, f.requests[1]!);
    expect(snapshots(await f.entries())).toHaveLength(2);
    expect(JSON.stringify(f.requests[1])).toContain("ORIGINAL"); expect(JSON.stringify(f.requests[1])).toContain("UPDATED");
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test("unchanged Plan is not duplicated over tool rounds or later accepted inputs", async () => {
  const f = await fixture();
  try {
    f.state.replies.push(f.state.plan, f.state.plan); await f.run(); await f.run("next user turn");
    expect(f.requests).toHaveLength(4);
    for (let i = 1; i < f.requests.length; i++) prefix(f.requests[i - 1]!, f.requests[i]!);
    expect(snapshots(await f.entries())).toHaveLength(1);
  } finally { await f.close(); }
});

test("A to B to A preserves each historical snapshot rather than deduplicating by old text", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("- [x] B", f.state.plan); await f.run();
    expect(snapshots(await f.entries())).toHaveLength(3);
    for (let i = 1; i < 3; i++) prefix(f.requests[i - 1]!, f.requests[i]!);
  } finally { await f.close(); }
});

test("empty Plan becomes an explicit clearing snapshot and is deduplicated", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("", ""); await f.run();
    expect(snapshots(await f.entries())).toHaveLength(2);
    expect(JSON.stringify(f.requests.at(-1))).toContain("(empty)");
    prefix(f.requests[0]!, f.requests[1]!); prefix(f.requests[1]!, f.requests[2]!);
  } finally { await f.close(); }
});

test("initially empty Plan has one stable snapshot until the checklist changes", async () => {
  const f = await fixture();
  try {
    f.state.plan = ""; await f.run(); await f.run(); expect(snapshots(await f.entries())).toHaveLength(1);
    f.state.plan = "- [ ] populated"; await f.run();
    prefix(f.requests[0]!, f.requests[1]!); prefix(f.requests[1]!, f.requests[2]!);
    expect(snapshots(await f.entries())).toHaveLength(2);
  } finally { await f.close(); }
});

test("reopen retains unchanged Plan position and immutable original entries", async () => {
  const f = await fixture();
  try {
    await f.run(); const original = snapshots(await f.entries())[0]!;
    await f.reopen(); await f.run("after reopen");
    expect(snapshots(await f.entries())).toEqual([original]); prefix(f.requests[0]!, f.requests[1]!);
  } finally { await f.close(); }
});

test("pre-dispatch interruption recovers the exact pinned suffix before appending a newer Plan", async () => {
  const f = await fixture(); const committed = barrier();
  try {
    f.state.afterPersist = async ctx => { committed.release(); await awaitWithContext(new Promise<void>(() => {}), ctx); };
    const submission = await f.submit("interrupted"); const waiting = submission.wait(context).catch(() => undefined);
    await committed.promise; const original = snapshots(await f.entries())[0]!;
    expect(f.requests).toHaveLength(0);
    f.state.afterPersist = undefined; f.state.plan = "- [-] changed offline";
    await f.reopen(); await waiting;
    const recovered = (await f.harness.submission(submission.id, context))!; await recovered.wait(context);
    expect(f.requests).toHaveLength(1);
    const entries = snapshots(await f.entries()); expect(entries).toHaveLength(2); expect(entries[0]).toEqual(original);
    const sent = JSON.stringify(f.requests[0]); expect(sent.indexOf("ORIGINAL")).toBeLessThan(sent.indexOf("changed offline"));
    await f.run(); expect(snapshots(await f.entries())).toEqual(entries);
  } finally { await f.close(); }
}, 10000);

test("forks inherit the historical snapshot without rewriting it or appending a duplicate", async () => {
  const f = await fixture();
  try {
    await f.run(); const entries = await f.entries(); const inherited = snapshots(entries)[0]!;
    const child = await f.conversation.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context);
    await f.run("fork input", child);
    const rows = (await child.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(snapshots(rows)).toEqual([inherited]); prefix(f.requests[0]!, f.requests[1]!);
    expect(snapshots(await f.entries())).toEqual([inherited]);
  } finally { await f.close(); }
});

test("independent native conversations do not share Plan deduplication state", async () => {
  const f = await fixture();
  try {
    await f.run(); const agent = await f.conversation.agent(context);
    const child = await f.harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
      model: agent.model!, instructions: "other context", extensions: agent.extensions, tools: agent.tools } }, context);
    await f.run("other conversation", child);
    const main = snapshots(await f.entries());
    const other = snapshots((await child.entries({ order: "ascending" }, 100, undefined, context)).items);
    expect(main).toHaveLength(1); expect(other).toHaveLength(1); expect(main[0]!.id).not.toBe(other[0]!.id);
    expect(other[0]!.conversationId).toBe(child.id);
  } finally { await f.close(); }
});

for (const reset of [true, false]) test(`Plan rematerializes after ${reset ? "reset" : "actual compaction"} without consulting discarded snapshots`, async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 4; i++) await f.run(`history ${i}`);
    const original = snapshots(await f.entries())[0]!;
    if (reset) await f.conversation.reset("reset handoff", context);
    else {
      f.state.maintenance = true;
      const task = await f.conversation.compact(undefined, context);
      const result = await f.harness.waitForTask(task, context); f.state.maintenance = false;
      expect(result.state.outcome.status).toBe("completed");
      if (result.state.outcome.status === "completed") {
        const placed = (await f.harness.submission(result.state.outcome.result.submissionId!, context))!;
        expect((await placed.wait(context)).status).toBe("done");
      }
    }
    const view = await f.conversation.context(context); expect(view.entries.some(entry => entry.id === original.id)).toBe(false);
    await f.run("post boundary");
    const current = await f.conversation.context(context);
    expect(current.entries.filter(entry => entry.kind === hostPlanContextKind)).toHaveLength(1);
    expect(snapshots(await f.entries())[0]).toEqual(original);
    await f.run("same again"); prefix(f.requests.at(-2)!, f.requests.at(-1)!);
  } finally { await f.close(); }
});

test("source revocation after candidate append rolls back the snapshot at the SQL boundary", async () => {
  const f = await fixture();
  try {
    f.state.wrap = original => new Proxy(original, { get(target, key) {
      if (key === "commit") return (change: Parameters<Conversation["commit"]>[0], ctx: Parameters<Conversation["commit"]>[1]) =>
        original.commit(async tx => { const result = await change(tx); f.state.allowed = false; return result; }, ctx);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(f.run()).rejects.toThrow("Session failed");
    expect(f.requests).toHaveLength(0);
    await f.reopen(); expect(snapshots(await f.entries())).toHaveLength(0);
    expect(String(f.failures[0])).toContain("Plan source revoked");
  } finally { await f.close(); }
});

test("an omitted snapshot is rematerialized from current Plan state without rewriting historical entries", async () => {
  const f = await fixture();
  try {
    await f.run(); const original = snapshots(await f.entries())[0]!;
    await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "test.context-edit",
      edits: [{ target: original.id, action: "omit" }] }), context);
    await f.run("after deliberate context edit"); await f.run("unchanged again");
    const rows = snapshots(await f.entries()); expect(rows).toHaveLength(2); expect(rows[0]).toEqual(original);
    expect(rows[1]!.model).toEqual(original.model); prefix(f.requests[1]!, f.requests[2]!);
  } finally { await f.close(); }
});

test("unknown or truncated request prefixes fail closed without a context write", async () => {
  const f = await fixture();
  try {
    await f.run(); const before = await f.entries();
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", [], content("new"), () => {}, context))
      .rejects.toThrow("Unowned Plan request suffix");
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", [{ role: "user", content: "forged", timestamp: 0 }],
      content("new"), () => {}, context)).rejects.toThrow("Unknown Plan request cutoff");
    expect(await f.entries()).toEqual(before);
  } finally { await f.close(); }
});

for (const goal of [false, true]) test(`${goal ? "Goal" : "Plan"}: actual Codex HTTP bodies retain an exact input-item prefix and stable instructions/tools/cache key`, async () => {
  const f = await fixture({goal});
  try {
    f.state.replies.push("- [-] UPDATED"); await f.run();
    const bodies: { input: unknown[]; instructions: unknown; tools: unknown; prompt_cache_key: unknown }[] = [];
    const transport = Object.assign(async (_url: unknown, init?: RequestInit) => {
      const raw = init?.body;
      let bytes: Uint8Array;
      if (typeof raw === "string") bytes = new TextEncoder().encode(raw);
      else if (raw instanceof Uint8Array) bytes = raw;
      else throw Error("Unexpected synthetic Codex body");
      if (new Headers(init?.headers).get("content-encoding") === "zstd") bytes = Bun.zstdDecompressSync(bytes);
      bodies.push(JSON.parse(new TextDecoder().decode(bytes)));
      return new Response('data: {"type":"response.completed","response":{"id":"plan-wire-fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"input_tokens_details":{"cached_tokens":0}}}}\n\n',
        { headers: { "content-type": "text/event-stream" } });
    }, { preconnect() {} }) as typeof fetch;
    const jwt = "e30." + Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-only" } })).toString("base64url") + ".synthetic";
    for (const messages of f.requests) {
      const result = await codexStream({ ...model, provider: "openai-codex", api: "openai-codex-responses" }, normalizeRootContext({ messages }),
        { apiKey: jwt, fetch: transport, transport: "sse", sessionId: "plan-wire-fixture" }).result();
      expect(result.stopReason).toBe("stop");
    }
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]!.input.slice(0, bodies[0]!.input.length))).toBe(JSON.stringify(bodies[0]!.input));
    for (const field of ["instructions", "tools", "prompt_cache_key"] as const) expect(bodies[1]![field]).toEqual(bodies[0]![field]);
    expect(JSON.stringify(bodies[1]!.input)).toContain("ORIGINAL");
    expect(JSON.stringify(bodies[1]!.input)).toContain("UPDATED");
  } finally { await f.close(); }
});

test("terminal generations cannot append Plan context and snapshots remain hidden from the existing tree", async () => {
  const f = await fixture();
  try {
    await f.run(); const rows = await f.entries(); const view = await f.conversation.context(context);
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", view.messages, content("new"), () => {}, context))
      .rejects.toThrow("Exact live Plan generation required");
    expect(await f.entries()).toEqual(rows);
    const visible = projectPublicHistory(rows, null);
    expect(visible.some(node => node.entry.type === "message" && JSON.stringify(node.entry).includes("ORIGINAL"))).toBe(false);
    expect(visible.filter(node => node.entry.type === "message")).toHaveLength(2);
    const hidden = snapshots(rows)[0]!;
    expect(() => projectPublicHistory([{ ...hidden, data: { owner: "forged" } }], null)).toThrow("Invalid hidden Plan context");
  } finally { await f.close(); }
});

const goalSnapshots = (rows: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["entries"]>>) => rows.filter(row => row.kind === hostGoalContextKind);
test("Goal context preserves every prior implicit cache-write ending through tools and later input", async () => {
  const f = await fixture({goal:true});
  try {
    f.state.replies.push(f.state.plan, f.state.plan); await f.run(); await f.run("later accepted input");
    expect(f.requests).toHaveLength(4);
    for (let i=1;i<f.requests.length;i++) prefix(f.requests[i-1]!, f.requests[i]!);
    const rows=await f.entries(); expect(goalSnapshots(rows)).toHaveLength(1);
    expect(JSON.stringify(projectPublicHistory(rows, null))).not.toContain("Current Plan Sidebar");
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("Goal objective changes append new snapshots and survive reopen without duplicate context", async () => {
  const f = await fixture({goal:true});
  try {
    f.state.replies.push("Changed Goal objective", f.state.plan); await f.run();
    expect(goalSnapshots(await f.entries())).toHaveLength(3);
    await f.reopen(); await f.run("continue retained goal");
    expect(goalSnapshots(await f.entries())).toHaveLength(3);
    for (let i=1;i<f.requests.length;i++) prefix(f.requests[i-1]!, f.requests[i]!);
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("Goal identity changes append even when prompt bytes are identical", async () => {
  let identity: GoalContextIdentity={goalId:"original",generation:1,status:"active"};
  const f = await fixture({goal:true,identity:()=>identity});
  try {
    await f.run(); identity={goalId:"replacement",generation:2,status:"active"}; await f.run("new Goal generation");
    identity={...identity,status:"budget_limited"}; await f.run("budget wrap-up");
    const rows=goalSnapshots(await f.entries()); expect(rows).toHaveLength(3);
    expect(rows.map(row=>(row.data as GoalContextIdentity).goalId)).toEqual(["original","replacement","replacement"]);
    expect(rows.map(row=>(row.data as GoalContextIdentity).status)).toEqual(["active","active","budget_limited"]);
    for(let i=1;i<f.requests.length;i++)prefix(f.requests[i-1]!,f.requests[i]!);
  } finally { await f.close(); }
});
test("Goal and Plan repair only their shared owned pinned suffix and retain distinct historical positions", async () => {
  const f = await fixture({mixed:true});
  try {
    f.state.replies.push("Changed Plan", "Changed Plan"); await f.run(); await f.reopen(); await f.run("next user");
    expect(goalSnapshots(await f.entries())).toHaveLength(1); expect(snapshots(await f.entries())).toHaveLength(2);
    for(let i=1;i<f.requests.length;i++)prefix(f.requests[i-1]!,f.requests[i]!);
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("revoked Goal context authority cannot dispatch or write a snapshot", async () => {
  const f=await fixture({goal:true});
  try {
    f.state.allowed=false; const before=(await f.entries()).length; await f.run();
    expect(f.requests).toHaveLength(0); expect((await f.entries()).filter(row=>row.kind===hostGoalContextKind)).toHaveLength(0);
    expect((await f.entries()).length).toBeGreaterThanOrEqual(before); expect(f.failures.length).toBeGreaterThan(0);
  } finally {await f.close();}
});
test("invalid Goal identity fails closed and rolls back the context append", async () => {
  const f=await fixture({goal:true,identity:()=>({goalId:"",generation:0,status:"active"})});
  try {await f.run();expect(f.requests).toHaveLength(0);expect(goalSnapshots(await f.entries())).toHaveLength(0);expect(f.failures.length).toBeGreaterThan(0);}
  finally {await f.close();}
});

for(const malformed of [["active"],["budget_limited"],{},0,null]) test(`Goal status validator rejects malformed ${JSON.stringify(malformed)} rather than coercing it`,async()=>{
  const f=await fixture({goal:true});
  try {await f.run();const row=structuredClone(goalSnapshots(await f.entries())[0]!);(row.data as Record<string,unknown>).status=malformed;
    expect(()=>projectPublicHistory([row],null)).toThrow("Invalid hidden Goal identity");}
  finally {await f.close();}
});

test("Goal system re-entry requires exact current-task snapshot authority and an unchanged prefix", async () => {
  const { canonicalHostPromptRequest } = await import("../../runtime/durable-engine/src/host-plan-context.ts");
  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 0 });
  const model = [user("Hidden continuation")];
  const proof = { id: 7, kind: "host.goal-context", data: { owner: "host:goal-prompt", chatJid: "web:goal", taskId: 12,
    goalId: "g", generation: 2, status: "active", systemPrompt: "Trusted Goal rules" }, model };
  const view: any = { messages: [user("Accepted input"), ...model], entries: [proof], contributions: [model] };
  const overlay = { role: "system", content: "Trusted Goal rules", timestamp: 0 };
  const canonical = (request: any, v: any = view) => canonicalHostPromptRequest(request, v, "web:goal", 12, "Plan");
  expect(canonical([...view.messages, overlay])).toEqual(view.messages);
  expect(canonical(view.messages)).toEqual(view.messages);
  expect(() => canonical([...view.messages, overlay, overlay])).toThrow("Unknown Plan request cutoff");
  for (const changed of [{ ...overlay, content: "Forged rules" }, { ...overlay, timestamp: 1 }, { ...overlay, role: "user" }])
    expect(() => canonical([...view.messages, changed])).toThrow("Unknown Plan request cutoff");
  for (const changed of [{ taskId: 13 }, { chatJid: "web:other" }, { owner: "foreign" }, { systemPrompt: "Other rules" }]) {
    const foreign = { ...view, entries: [{ ...proof, data: { ...proof.data, ...changed } }] };
    expect(() => canonical([...view.messages, overlay], foreign)).toThrow();
  }
  expect(() => canonical([...view.messages, overlay], { ...view, contributions: [[user("Edited")]] })).toThrow("Edited Goal system authority");
  expect(() => canonical([user("Edited accepted input"), ...model, overlay])).toThrow("Unknown Plan request cutoff");
  const realSystem = { ...view, messages: [overlay, ...view.messages] };
  expect(canonical([...realSystem.messages, overlay], realSystem)).toEqual(realSystem.messages);
});

test("a new Goal generation needs its own empty authority anchored to the unchanged frozen contribution", async () => {
  const { canonicalHostPromptRequest, hostGoalSystemAuthorityKind } = await import("../../runtime/durable-engine/src/host-plan-context.ts");
  const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 0 });
  const model = [user("Frozen continuation")];
  const identity = { owner: "host:goal-prompt", chatJid: "web:goal", goalId: "g", generation: 2,
    status: "active", systemPrompt: "Trusted Goal rules", inputKey: '["operation",[1]]' };
  const anchor = { id: 7, kind: "host.goal-context", data: { ...identity, taskId: 12 }, model };
  const authority = { id: 8, kind: hostGoalSystemAuthorityKind, data: { ...identity, taskId: 13, goalContextEntryId: 7 }, model: [] };
  const messages = [user("Accepted input"), ...model], overlay = { role: "system" as const, content: identity.systemPrompt, timestamp: 0 };
  const view: any = { messages, entries: [anchor, authority], contributions: [model, []] };
  const canonical = (v: any = view, request: any = [...messages, overlay]) => canonicalHostPromptRequest(request, v, "web:goal", 13, "Plan");
  expect(canonical()).toEqual(messages);
  expect(projectPublicHistory([anchor, authority] as any, null)).toEqual([]);
  expect(() => projectPublicHistory([{ ...authority, model }] as any, null)).toThrow("Invalid Goal system authority");
  expect(() => projectPublicHistory([{ ...authority, data: { ...authority.data, owner: "foreign" } }] as any, null)).toThrow("Invalid Goal system authority");
  expect(() => canonical({ ...view, entries: [anchor], contributions: [model] })).toThrow("Unknown Plan request cutoff");
  expect(() => canonical(view, [...messages, overlay, overlay])).toThrow("Unknown Plan request cutoff");
  // Raw entry chronology proves the anchor even when compaction changes view ordering.
  expect(canonical({ ...view, entries: [authority, anchor], contributions: [[], model] })).toEqual(messages);
  for (const change of [{ taskId: 14 }, { chatJid: "web:foreign" }, { owner: "foreign" }, { goalId: "other" },
    { generation: 3 }, { status: "budget_limited" }, { systemPrompt: "Edited rules" }, { inputKey: '["other",[1]]' },
    { goalContextEntryId: 99 }, { goalContextEntryId: 8 }]) {
    const forged = { ...authority, data: { ...authority.data, ...change } };
    expect(() => canonical({ ...view, entries: [anchor, forged] })).toThrow();
  }
  expect(() => canonical({ ...view, entries: [{ ...anchor, id: 9 }, { ...authority, data: { ...authority.data, goalContextEntryId: 9 } }] })).toThrow("Missing earlier Goal context authority");
  expect(() => canonical({ ...view, contributions: [[user("Edited frozen contribution")], []] })).toThrow("Edited Goal context authority");
  expect(() => canonical({ ...view, entries: [anchor, { ...authority, model }] })).toThrow("Invalid Goal system authority");
  expect(() => canonical({ ...view, contributions: [model, model] })).toThrow("Edited Goal system authority");
  expect(() => canonical(view, [user("Edited accepted input"), ...model, overlay])).toThrow("Unknown Plan request cutoff");
  const realSystem = { ...view, messages: [overlay, ...messages] };
  expect(canonical(realSystem, [...realSystem.messages, overlay])).toEqual(realSystem.messages);
});
