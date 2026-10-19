import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { requireExtensionKvAuthority, withExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";

test("actual Goal factory uses scoped shared database KV and denies revoked mutation", async () => {
  const source = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!source) throw Error("DURABLE_GOAL_ADDON_ROOT required for local Goal factory qualification");
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  const root = getDb();
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(source, "addons/goal/index.ts")).href);
  addon.resetGoalAddonForTests();
  let allowed = true;
  const authority = { extensionId: "goal", chatJid: "web:goal-owned", assertCurrent() { if (!allowed) throw Error("Goal owner revoked"); },
    write<T>(body: () => T): T { return root.transaction(() => { this.assertCurrent(); const result = body(); this.assertCurrent(); return result; }).immediate(); } };
  const tools = addon.createGoalTools(() => authority.chatJid, {
    async run(_name: string, args: unknown, _context: unknown, body: () => Promise<unknown>) {
      if (!args || Object.getPrototypeOf(args) !== Object.prototype) throw Error("Plain Goal args required");
      authority.assertCurrent();
      return withExtensionKvAuthority(authority, body);
    },
  }) as { name: string; execute(...args: unknown[]): Promise<unknown> }[];
  const invoke = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute("owned-call", args, undefined, undefined,
    { get sessionManager() { throw Error("Legacy session forbidden"); } });
  try {
    expect(tools.map(tool => tool.name).sort()).toEqual(["create_goal", "get_goal", "goal_complete", "goal_stop", "update_goal"]);
    await invoke("create_goal", { objective: "Use the actual shared database", token_budget: 123 });
    expect(extensionKvGet("goal", "thread-goal", "chat", authority.chatJid)).toMatchObject({ objective: "Use the actual shared database", status: "active", token_budget: 123 });
    expect(root.query("SELECT extension_id,scope,scope_key FROM extension_kv WHERE extension_id='goal'").all()).toEqual([{ extension_id: "goal", scope: "chat", scope_key: authority.chatJid }]);
    const before = root.query("SELECT * FROM extension_kv WHERE extension_id='goal'").all();
    allowed = false;
    await expect(invoke("goal_complete", { summary: "Denied", evidence: ["must not persist"] })).rejects.toThrow("Goal owner revoked");
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='goal'").all()).toEqual(before);
    allowed = true;
    await invoke("goal_complete", { summary: "Verified", evidence: ["shared database fixture"] });
    expect(extensionKvGet("goal", "thread-goal", "chat", authority.chatJid)).toMatchObject({ status: "complete", completion_summary: "Verified" });
    expect(() => addon.loadThreadGoal(authority.chatJid)).toThrow("Extension KV operation authority required");
    expect(() => withExtensionKvAuthority({ ...authority, chatJid: "web:foreign" }, () => addon.loadThreadGoal(authority.chatJid))).toThrow("Extension KV scope denied");
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); }
});

test("Goal host adapter fences mutations to committed operation authority", async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const { createHostGoalTools } = await import("../../runtime/durable-engine/src/host-goal-tools.js");
  const { installTerminalSettlementCompositionSchema } = await import("../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js");
  const { createCurrentPiclawServiceWorkStore } = await import("../../runtime/src/service-effects/current-piclaw/service-work-store.js");
  const { value, effect, sealed, at } = await import("./src/host-handoff.js");
  const { context } = await import("./src/fixture.js");
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const chat = "web:goal-operation";
  const source = value(await work.acceptSource(sealed({ effect: effect("goal-accept"), chatJid: chat, sourceId: "goal-source", kind: "message", payloadRef: "goal-payload", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("goal-claim"), chatJid: chat, expectedFrontier: 0, newOperationId: "goal-operation", claimedAt: at })))!;
  const operation = value(await work.bindHarness(sealed({ effect: effect("goal-bind", claimed.operation.operationId, source.sourceSeq), expectedVersion: claimed.operation.version,
    sessionId: "goal-session", lane: "main", harnessOperationId: "42", state: "running", watchGeneration: 1 })));
  const captured = { operation, inputs: [{ incarnation: "goal-copy", conversationId: 2 as never, chatJid: chat, branchId: "main", operationId: operation.operationId,
    sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: "goal-request", requestHash: "a".repeat(64), submissionId: 42 as never }] };
  let revokeDuringCapture = false;
  let factoryCalls = 0;
  const tools = createHostGoalTools((resolveChat) => { factoryCalls++; return addon.createGoalTools(resolveChat); }, { root: db, assertOwner() {}, runtime: () => ({ async captureToolSource() {
    await Promise.resolve();
    if (revokeDuringCapture) db.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid=?").run(chat);
    return captured;
  } }) });
  const api = { conversationId: 2, taskId: 99, callId: "goal-call", output() {}, async details() {} } as any;
  const invoke = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args, api, context);
  try {
    await invoke("create_goal", { objective: "Operation-owned Goal" });
    expect(extensionKvGet("goal", "thread-goal", "chat", chat)).toMatchObject({ status: "active", objective: "Operation-owned Goal" });
    revokeDuringCapture = true;
    await expect(invoke("goal_complete", { summary: "Denied", evidence: ["revoked operation"] })).rejects.toThrow();
    expect(extensionKvGet("goal", "thread-goal", "chat", chat)).toMatchObject({ status: "active" });
    expect(factoryCalls).toBe(1);
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); }
});

test("actual Goal tool task captures its live accepted operation before shared KV mutation", async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { acceptedSteerFixture } = await import("./src/accepted-steer-recovery-fixture.js");
  const { context } = await import("./src/fixture.js");
  const { value, effect, sealed, at } = await import("./src/host-handoff.js");
  const { Harness, configure, defineExtension } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { OwnedSqlite } = await import("./src/ownership.js");
  const { createProvider, createAssistantMessageEventStream } = await import("../../runtime/durable-engine/node_modules/@earendil-works/pi-ai");
  const { storeChatMetadata } = await import("../../runtime/src/db.js");
  const { createHostGoalTools } = await import("../../runtime/durable-engine/src/host-goal-tools.js");
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "goal-live-source-"));
  const f = await acceptedSteerFixture(dir, "before-submit");
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href);
  registerRootExtensionKvStore(); requireExtensionKvAuthority(); addon.resetGoalAddonForTests();
  let captures = 0;
  const tools = createHostGoalTools(addon.createGoalTools, { root: f.db, assertOwner: () => f.owner.assert(), runtime: () => ({ async captureToolSource(conversation, task, call) {
    const proof = await f.runtime!.captureToolSource(conversation, task, call);
    expect(proof.operation.chatJid).toBe(f.chatJid); captures++; return proof;
  } }) });
  const extension = defineExtension({ name: "native-goal-fixture", tools }); f.base.registry.install(extension);
  const model = f.base.models.getModel("qualification", "synthetic")!;
  const stream = (_model: unknown, transcript: { messages: { role: string }[] }) => {
    const calling = transcript.messages.findLast(message => message.role !== "system")?.role === "user";
    const output = createAssistantMessageEventStream();
    const message = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      stopReason: calling ? "toolUse" as const : "stop" as const, content: calling
        ? [{ type: "toolCall" as const, id: "native-goal-call", name: "create_goal", arguments: { objective: "Live Goal source capture" } }]
        : [{ type: "text" as const, text: "Goal stored" }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    output.push({ type: "done", reason: message.stopReason, message }); output.end(message); return output;
  };
  f.base.models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
  try {
    const harness = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
    try { await harness.commit(tx => configure(tx, f.base.root.id, { tools, extensions: [extension] }), context); } finally { await harness.close(context); }
    await f.open(); f.permit = true;
    storeChatMetadata(f.chatJid, at);
    const source = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:goal-source`), chatJid: f.chatJid, sourceId: "goal-native", kind: "message", payloadRef: "goal-native", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    f.db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)").run("goal-native", f.chatJid, "Create the explicit goal", at);
    const claimed = value(await f.ports.work.claimNext(sealed({ effect: effect(`${f.incarnation}:goal-claim`), chatJid: f.chatJid, expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
    const { hashCanonicalRequest } = await import("../../runtime/src/service-effects/contracts/common.js");
    const input = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: "main", operationId: f.incarnation,
      sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: f.primaryRequestId,
      requestHash: hashCanonicalRequest({ type: "input", requestId: f.primaryRequestId, content: "Create the explicit goal" }) };
    const id = await f.runtime!.submit(input);
    value(await f.ports.work.bindHarness(sealed({ effect: effect(`${f.incarnation}:goal-running`, f.incarnation, source.sourceSeq), expectedVersion: claimed.operation.version,
      sessionId: f.incarnation, lane: "main", harnessOperationId: String(id), state: "running", watchGeneration: f.generation })));
    await f.runtime!.wait(input, id);
    expect(captures).toBe(1);
    expect(extensionKvGet("goal", "thread-goal", "chat", f.chatJid)).toMatchObject({ objective: "Live Goal source capture", status: "active" });
    expect((await f.runtime!.reconcile(input)).answer?.text).toBe("Goal stored");
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); await f.close(); await rm(dir, { recursive: true, force: true }); }
});
