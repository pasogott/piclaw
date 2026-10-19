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

for (const rejectRequestAuthority of [false, true]) test(`actual Goal tool task captures its live accepted operation; rejected=${rejectRequestAuthority}`, async () => {
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
  const f = await acceptedSteerFixture(dir, "before-submit", undefined, true);
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href);
  registerRootExtensionKvStore(); requireExtensionKvAuthority(); addon.resetGoalAddonForTests();
  let captures = 0;
  const tools = createHostGoalTools(addon.createGoalTools, { root: f.db, assertOwner: () => f.owner.assert(), runtime: () => ({ async captureToolSource(conversation, task, call) {
    const proof = await f.runtime!.captureToolSource(conversation, task, call);
    expect(proof.operation.chatJid).toBe(f.chatJid); captures++; return proof;
  } }) });
  const extension = defineExtension({ name: "native-goal-fixture", tools }); f.base.registry.install(extension);
  const { createHostGoalPrompt } = await import("../../runtime/durable-engine/src/host-goal-prompt.js");
  let requestFenced = false, modelEntries = 0;
  const terminalProofs: boolean[] = [];
  const promptExtension = createHostGoalPrompt(addon, { root: f.db, assertOwner: () => f.owner.assert(), runtime: () => ({
    async captureRunSource(conversation, task) {
      if (rejectRequestAuthority) throw Error("synthetic Goal request authority revoked");
      const captured = await f.runtime!.captureRunSource(conversation, task);
      const goal = extensionKvGet("goal", "thread-goal", "chat", f.chatJid) as { goal_id: string; lifecycle_generation: number; status: string } | null;
      if (goal?.status === "complete") {
        terminalProofs.push(await f.runtime!.hasGoalTerminalResult(conversation, task, { goalId: goal.goal_id, generation: goal.lifecycle_generation, status: "complete" }));
        terminalProofs.push(await f.runtime!.hasGoalTerminalResult(conversation, task, { goalId: "wrong-goal", generation: goal.lifecycle_generation, status: "complete" }));
        terminalProofs.push(await f.runtime!.hasGoalTerminalResult(conversation, task, { goalId: goal.goal_id, generation: goal.lifecycle_generation + 1, status: "complete" }));
      }
      return captured;
    },
  }), failClosed() { requestFenced = true; } });
  f.base.registry.install(promptExtension);
  const prompts: string[] = [];
  const model = f.base.models.getModel("qualification", "synthetic")!;
  const stream = (_model: unknown, transcript: { messages: { role: string }[] }) => {
    modelEntries++;
    prompts.push(JSON.stringify(transcript.messages));
    const toolTurns = transcript.messages.filter(message => message.role === "toolResult").length;
    const calling = toolTurns < 2;
    const output = createAssistantMessageEventStream();
    const message = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      stopReason: calling ? "toolUse" as const : "stop" as const, content: calling
        ? [{ type: "toolCall" as const, id: `native-goal-call-${toolTurns}`, name: toolTurns === 0 ? "create_goal" : "goal_complete",
          arguments: (toolTurns === 0 ? { objective: "Live Goal source capture" } : { summary: "Verified live transition", evidence: ["native accepted operation tool task"] }) as Record<string, string | string[]> }]
        : [{ type: "text" as const, text: "Goal stored" }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    output.push({ type: "done", reason: message.stopReason, message }); output.end(message); return output;
  };
  f.base.models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: "Synthetic", resolve: async () => { if (requestFenced) throw Error("Goal request lifetime fenced"); return { auth: {}, source: "fixture" }; } } }, api: { stream, streamSimple: stream } }));
  try {
    const harness = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
    try { await harness.commit(tx => configure(tx, f.base.root.id, { tools, extensions: [extension, promptExtension] }), context); } finally { await harness.close(context); }
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
    if (rejectRequestAuthority) {
      expect(requestFenced).toBe(true);
      expect(modelEntries).toBe(0);
      expect(captures).toBe(0);
      expect(extensionKvGet("goal", "thread-goal", "chat", f.chatJid)).toBeNull();
      return;
    }
    expect(captures).toBe(2);
    expect(terminalProofs).toEqual([true, false, false]);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain("<objective>");
    expect(prompts[1]).toContain("Live Goal source capture");
    expect(prompts[1]).toContain("Active Goal");
    expect(prompts[2]).not.toContain("<objective>");
    const completedGoal = extensionKvGet("goal", "thread-goal", "chat", f.chatJid) as { goal_id: string; lifecycle_generation: number };
    expect(completedGoal).toMatchObject({ objective: "Live Goal source capture", status: "complete", lifecycle_generation: 2 });
    expect((await f.runtime!.reconcile(input)).answer?.text).toBe("Goal stored");
    await f.runtime!.close(); f.runtime = undefined;
    const reader = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
    try {
      const conversation = (await reader.conversation(f.base.root.id, context))!;
      const entries = await conversation.entries({ order: "ascending" }, 100, undefined, context);
      expect(JSON.stringify(entries.items)).not.toContain("Active Goal");
      const results = entries.items.filter(entry => entry.kind === "pi.tool-result");
      expect(results).toHaveLength(2);
      const committed = results.at(-1)!.model as unknown as readonly { toolCallId: string; toolName: string; isError: boolean; details: { goal: unknown } }[];
      expect(committed).toHaveLength(1);
      expect(committed[0]).toMatchObject({ toolCallId: "native-goal-call-1", toolName: "goal_complete", isError: false,
        details: { goal: { goalId: completedGoal.goal_id, lifecycleGeneration: completedGoal.lifecycle_generation, status: "complete", completionSummary: "Verified live transition" } } });
    } finally { await reader.close(context); }
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); await f.close(); await rm(dir, { recursive: true, force: true }); }
});

test("prepared Goal text and accepted source commit together; stale lifecycle rolls admission back", async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const { createCurrentPiclawServiceWorkStore } = await import("../../runtime/src/service-effects/current-piclaw/service-work-store.js");
  const { installServiceWorkSchema } = await import("../../runtime/src/service-effects/current-piclaw/service-work-schema.js");
  const { value, sealed, effect, at } = await import("./src/host-handoff.js");
  const { hashCanonicalRequest } = await import("../../runtime/src/service-effects/contracts/common.js");
  initDatabase(); const db = getDb(); installServiceWorkSchema(db);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const chatJid = "web:goal-admission";
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance: () => true }));
  const authority = { extensionId: "goal", chatJid, assertCurrent() {}, write<T>(body: () => T) { return db.transaction(body).immediate(); } };
  const scoped = <T>(body: () => T) => withExtensionKvAuthority(authority, body);
  try {
    scoped(() => addon.createThreadGoal(chatJid, "Accepted current Goal"));
    const prepared = scoped(() => addon.prepareGoalInput("🎯 Continue goal: Accepted current Goal", chatJid));
    expect(prepared.decision.action).toBe("transform");
    const text = prepared.decision.text as string;
    db.query("INSERT OR IGNORE INTO chats(jid,name,last_message_time) VALUES (?,?,?)").run(chatJid, "Goal admission", at);
    const admit = (id: string, preparation: typeof prepared, afterAccept?: () => void) => db.transaction(() => scoped(() => {
      preparation.assertCurrent();
      db.query("INSERT INTO messages(id,chat_jid,content,timestamp,is_from_me) VALUES (?,?,?,?,0)").run(id, chatJid, text, at);
      const message = db.query("SELECT rowid FROM messages WHERE id=? AND chat_jid=?").get(id, chatJid) as { rowid: number };
      const accepted = work.acceptSourceInTransaction(sealed({ effect: effect(id), chatJid, sourceId: id, kind: "message", payloadRef: `message-row:${message.rowid}`,
        targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false }), db);
      afterAccept?.();
      preparation.assertCurrent();
      return accepted;
    })).immediate();
    const source = admit("goal-admitted", prepared);
    const row = db.query("SELECT content FROM messages WHERE id='goal-admitted'").get() as { content: string };
    expect(row.content).toBe(text);
    expect(row.content).toContain("Accepted current Goal");
    expect(source.payloadRef).toMatch(/^message-row:/);
    expect(hashCanonicalRequest({ type: "input", requestId: "goal-admitted", content: row.content }))
      .toBe(hashCanonicalRequest({ type: "input", requestId: "goal-admitted", content: text }));
    const stale = scoped(() => addon.prepareGoalInput("🎯 Continue goal: Accepted current Goal", chatJid));
    scoped(() => { addon.clearThreadGoal(chatJid); addon.createThreadGoal(chatJid, "Accepted current Goal"); });
    const before = ["messages", "service_effect_s01_sources", "service_effect_s01_decisions"].map(table => db.query(`SELECT * FROM ${table}`).all());
    expect(() => admit("goal-stale", stale)).toThrow("Goal input lifecycle changed");
    expect(["messages", "service_effect_s01_sources", "service_effect_s01_decisions"].map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    const changedAfterWrite = scoped(() => addon.prepareGoalInput("🎯 Continue goal: Accepted current Goal", chatJid));
    expect(() => admit("goal-mid-write", changedAfterWrite, () => {
      addon.clearThreadGoal(chatJid); addon.createThreadGoal(chatJid, "Different lifecycle");
    })).toThrow("Goal input lifecycle changed");
    expect(["messages", "service_effect_s01_sources", "service_effect_s01_decisions"].map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ objective: "Accepted current Goal" });
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); }
});

test("actual web message admission runs Goal lifecycle guard inside its owned transaction", async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const { mkdirSync } = await import("node:fs");
  const { createApplicationBootstrapBundle, applicationOwnership } = await import("../../runtime/durable-engine/src/application-bootstrap.js");
  const { acquireRuntimeLock } = await import("../../runtime/src/runtime/single-instance.js");
  const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.js");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { openFixture, context } = await import("./src/fixture.js");
  const { admitWebUserMessage } = await import("../../runtime/src/channels/web/messaging/message-store.js");
  const { storeChatMetadata } = await import("../../runtime/src/db.js");
  process.env.PICLAW_DB_IN_MEMORY = "0";
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  initDatabase(); const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  const { installTerminalSettlementCompositionSchema } = await import("../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js");
  installTerminalSettlementCompositionSchema(root);
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
  const lock = acquireRuntimeLock({ lockPath: join(process.env.PICLAW_WORKSPACE!, "goal-admission.lock"), strictOwnership: true, disabled: false });
  const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const conversation = fixture.root.id; await fixture.close();
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const chat = "web:goal-real-web";
  storeChatMetadata(chat, new Date().toISOString());
  const authority = { extensionId: "goal", chatJid: chat, assertCurrent() { lock.assertCurrentOwner(); }, write<T>(body: () => T) { return root.transaction(body).immediate(); } };
  const scoped = <T>(body: () => T) => withExtensionKvAuthority(authority, body);
  scoped(() => addon.createThreadGoal(chat, "Actual web source fence"));
  const prepared = scoped(() => addon.prepareGoalInput("🎯 Continue goal: Actual web source fence", chat));
  let guardCalls = 0, failAfterSource = false, asyncGuard = false, routeOnly = false;
  const { createHostGoalInput } = await import("../../runtime/durable-engine/src/host-goal-input.js");
  const prepareInputText = createHostGoalInput(addon, chatJid => {
    lock.assertCurrentOwner(); if (chatJid !== chat) throw Error("Goal chat mismatch");
  });
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(lock), offlineInitialize: true,
    manifest: [{ chatJid: chat, branchId: "main", conversationId: conversation }], sessions: new Map([[chat, "original"]]),
    runtime: { incarnation: "goal-admission", sessionId: "goal-admission", lane: "main", generation: 1, now: () => new Date().toISOString(),
      harnessOptions: { models: fixture.models, registry: fixture.registry } },
    answers: { resolver: { resolve: () => null }, put() {} },
    prepareInputText,
    assertInputAdmission(chatJid, content) {
      if (routeOnly) return;
      expect(root.inTransaction).toBe(true); expect(chatJid).toBe(chat); expect(content).toBe(prepared.decision.text);
      if (asyncGuard) return Promise.reject(Error("private asynchronous guard failure")) as never;
      guardCalls++;
      scoped(() => {
        if (failAfterSource && guardCalls % 2 === 0) { addon.clearThreadGoal(chat); addon.createThreadGoal(chat, "Changed after source write"); }
        prepared.assertCurrent();
      });
    },
  }, context);
  try {
    const bound = bundle.bind({ queue: { enqueue() {} }, agentPool: { setSessionBinder() {}, isStreaming: () => false, isActive: () => false } } as any);
    const acceptSource = bound.getInputSourceAdmission!(chat)!;
    const input = { chatJid: chat, content: prepared.decision.text, isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" };
    const channel = { broadcastEvent() {}, pendingLinkPreviews: new Set<number>() };
    await admitWebUserMessage(channel, input, { acceptSource }, () => {}, new AbortController().signal);
    expect(guardCalls).toBe(2);
    const before = ["messages", "service_effect_s01_sources", "service_effect_s01_decisions", "extension_kv"].map(table => root.query(`SELECT * FROM ${table}`).all());
    failAfterSource = true;
    await expect(admitWebUserMessage(channel, input, { acceptSource }, () => {}, new AbortController().signal)).rejects.toThrow("Goal input lifecycle changed");
    expect(guardCalls).toBe(4);
    expect(["messages", "service_effect_s01_sources", "service_effect_s01_decisions", "extension_kv"].map(table => root.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    failAfterSource = false; asyncGuard = true;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(admitWebUserMessage(channel, input, { acceptSource }, () => {}, new AbortController().signal)).rejects.toThrow("Input admission guard must be synchronous");
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
      expect(["messages", "service_effect_s01_sources", "service_effect_s01_decisions", "extension_kv"].map(table => root.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    } finally { process.off("unhandledRejection", onUnhandled); }
    routeOnly = true; asyncGuard = false;
    const { WebChannel } = await import("../../runtime/src/channels/web.js");
    const web = new WebChannel(bound);
    web.broadcastEvent = () => {};
    const response = await web.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify({ content: "🎯 Continue goal: Actual web source fence", mode: "queue" }),
    }));
    expect(response.status).toBe(201);
    const routed = root.query("SELECT content FROM messages WHERE chat_jid=? ORDER BY rowid DESC LIMIT 1").get(chat) as { content: string };
    expect(routed.content).toContain("Continue working toward the active thread goal");
    expect(routed.content).toContain("Actual web source fence");
    expect(routed.content).toContain("<piclaw_goal_input>");
    const reconstructed = createHostGoalInput(addon, () => lock.assertCurrentOwner());
    expect(reconstructed(chat, routed.content).text).toBe(routed.content);
    scoped(() => { addon.clearThreadGoal(chat); addon.createThreadGoal(chat, "Actual web source fence"); });
    expect(() => reconstructed(chat, routed.content)).toThrow("Goal input is no longer executable");
    scoped(() => addon.clearThreadGoal(chat));
    const beforeRejected = root.query("SELECT id FROM messages WHERE chat_jid=?").all(chat);
    const denied = await web.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify({ content: "🎯 Continue goal: Actual web source fence", mode: "queue" }),
    }));
    expect(denied.status).toBe(503);
    expect(root.query("SELECT id FROM messages WHERE chat_jid=?").all(chat)).toEqual(beforeRejected);
  } finally { await bundle.close(); lock.release(); addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); }
});
