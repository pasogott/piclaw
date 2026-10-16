import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { HostConversationRuntime, initializeHostDurableBindings, createHostDurableBindings, type AcceptedInput } from "../../runtime/durable-engine/src/index.js";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { createDurableConversationAdapter, type DurableConversationOperation } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { createDurableQueuedSteering } from "../../runtime/src/agent-pool/durable-queued-steering.js";
import { storeWebMessage } from "../../runtime/src/channels/web/messaging/message-store.js";

// Explicit host-only controller rehearsal. No production registration or recovery loop.
for (const boundary of ["before-submit", "committed-ack-lost"] as const) {
  test(`accepted steering disk recovery: ${boundary}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "accepted-recovery-"));
    const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
    process.env.PICLAW_DB_IN_MEMORY = "0";
    initDatabase();
    let db = getDb();
    const chatJid = `web:recovery:${boundary}`, incarnation = `recovery:${boundary}`;
    const path = join(dir, "candidate.sqlite");
    let owner = TestOwner.acquire(path);
    const base = await openFixture({ get acquired() { return owner.acquired; } }, () => {}, () => SqliteStorage.open(new OwnedSqlite(owner)));
    await base.close();
    const manifest = [{ chatJid, branchId: "main", conversationId: base.root.id }];
    const generation = owner.token.generation; // Persisted operation watch generation, NOT replacement owner token.
    let runtime: HostConversationRuntime | undefined;
    let candidateStorage: SqliteStorage;
    let providerEntries = 0;
    let entryObserved: ReturnType<typeof barrier> | undefined;
    base.host.onModelEnter = () => { providerEntries++; entryObserved?.release(); };
    let ackLost = false;
    let committedIntentId: Awaited<ReturnType<HostConversationRuntime["submitIntent"]>> | undefined;
    const payloads = new InMemoryEffectPayloadResolver();
    let permit = false, authorizations = 0;
    const intentSourceId = `source-${crypto.randomUUID()}`;
    const primaryRequestId = `primary:${incarnation}`;
    const assert = () => owner.assert();
    function stores() {
      db.exec("PRAGMA foreign_keys=ON");
      const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance() { assert(); return true; } }));
      const terminal = value(createCurrentPiclawTerminalSettlementStore(db, payloads, { hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return true; } }));
      const bindings = createHostDurableBindings(db, { domain: incarnation, incarnation, manifest, assertOwner: assert,
        async resolveContent(ref) {
          const row = db.query("SELECT content FROM messages WHERE id=? AND chat_jid=?").get(ref.replace(/^queued-source:/, ""), chatJid) as { content: string } | null;
          if (!row) throw Error("Missing payload"); return row.content;
        } });
      return { work, terminal, bindings };
    }
    installTerminalSettlementCompositionSchema(db); initializeHostDurableBindings(db, assert);
    db.exec("CREATE TABLE IF NOT EXISTS recovery_fixture_identity (id TEXT PRIMARY KEY, input TEXT NOT NULL)");
    let ports = stores();
    async function open() {
      runtime = await HostConversationRuntime.open({ incarnation, owner: { assert, release() {} },
        openStorage: async () => { assert(); candidateStorage = await SqliteStorage.open(new OwnedSqlite(owner)); return candidateStorage; },
        harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
        ...ports, existingConversationIds: [base.root.id], conversationFor(chat, branch) {
          if (chat !== chatJid || branch !== "main") throw Error("Manifest conflict"); return base.root.id;
        }, authorizeScheduling(inspection) {
          assert(); authorizations++;
          if (!permit) throw Error("Host scheduling gate closed");
          if (inspection.submissions.some(s => s.conversationId !== base.root.id || ![primaryRequestId, `queued-steer:${intentSourceId}`].includes(s.requestId!))) throw Error("Unknown recovered authority");
        }, putAnswer(ref, text) { payloads.putText(ref, text); }, sessionId: incarnation, lane: "main", generation, now: () => at }, context);
      return createDurableConversationAdapter({ incarnation, manifest, runtime });
    }
    const snapshot = () => ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits", "recovery_fixture_identity"].map(t => db.query(`SELECT * FROM ${t}`).all());
    try {
      storeChatMetadata(chatJid, at);
      const source = value(await ports.work.acceptSource(sealed({ effect: effect(`${incarnation}:A`), chatJid, sourceId: `${incarnation}:A`, kind: "message" as const,
        payloadRef: `${incarnation}:A`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)").run(source.sourceId, chatJid, "primary A", at);
      const claimed = value(await ports.work.claimNext(sealed({ effect: effect(`${incarnation}:claim`), chatJid, expectedFrontier: 0, newOperationId: incarnation, claimedAt: at })))!;
      const primary: AcceptedInput = { incarnation, conversationId: base.root.id, chatJid, branchId: "main", operationId: incarnation,
        sourceId: source.sourceId, sourceSeq: source.sourceSeq, payloadRef: source.payloadRef, requestId: primaryRequestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId: primaryRequestId, content: "primary A" }) };
      let adapter = await open(); permit = true;
      const primaryId = await runtime!.submit(primary);
      await runtime!.wait(primary, primaryId); // Primary is committed before the restart; never replay it.
      const operation = value(await ports.work.getOperation(claimed.operation.operationId))!;
      value(await ports.work.bindHarness(sealed({ effect: effect(`${incarnation}:running`, incarnation, source.sourceSeq), expectedVersion: operation.version,
        sessionId: incarnation, lane: "main", harnessOperationId: String(primaryId), state: "running" as const, watchGeneration: generation })));
      const b = value(await ports.work.acceptSource(sealed({ effect: effect(`${incarnation}:B`), chatJid, sourceId: intentSourceId, kind: "message" as const,
        payloadRef: `queued-source:${intentSourceId}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      setDeferredQueuedFollowups(chatJid, [{ rowId: 1650, source_id: b.sourceId, source_accepted: true, queuedContent: "accepted B", queuedAt: at }]);
      const coordinator = createDurableQueuedSteering({ work: ports.work, chatJid, branchId: "main", assertCurrentWriter: assert,
        runningBinding: { sessionId: incarnation, lane: "main", watchGeneration: generation },
        adapter: { ...adapter, validateIntent(input) {
          adapter.validateIntent(input);
          // Fixture controller's captured identity is persisted in the SAME materialization transaction.
          db.query("INSERT INTO recovery_fixture_identity VALUES (?,?)").run(incarnation, JSON.stringify(input));
        }, async submitIntent(input) {
          committedIntentId = await adapter.submitIntent(input);
          ackLost = true; // Reached only AFTER the public runtime submission succeeds.
          throw Error(`ACK lost after ${committedIntentId}`);
        } },
        readQueued: id => getDeferredQueuedFollowups(chatJid).find(x => x.rowId === id),
        validatePayload({ item }) { expect(item.source_id).toBe(b.sourceId); expect(item.queuedContent).toBe("accepted B"); },
        materialize: (item, accept) => storeWebMessage({ broadcastEvent() {} } as Parameters<typeof storeWebMessage>[0],
          { chatJid, content: item.queuedContent, isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" },
          { consumeDeferredFollowupRowId: item.rowId, materializeQueuedSource: accept, isSteeringMessage: true }) });
      const accepted = await coordinator.accept(1650);
      expect(getDeferredQueuedFollowups(chatJid)).toEqual([]);
      expect(ports.work.getAcceptedSource(chatJid, b.sourceId)?.state).toBe("claimed");
      expect(await runtime!.settle(primary)).toBeNull();
      base.host.modelHold = barrier();
      if (boundary === "committed-ack-lost") {
        await accepted.dispatch(); // Coordinator intentionally catches the simulated lost ACK.
        expect(ackLost).toBe(true);
        expect(committedIntentId).toBeDefined();
        const committed = await candidateStorage!.submissionByRequest(base.root.id, `queued-steer:${intentSourceId}`, context);
        expect(committed?.id).toBe(committedIntentId);
        expect(committed?.type).toBe("input");
      } else {
        expect(ackLost).toBe(false);
        expect(committedIntentId).toBeUndefined();
        expect(await candidateStorage!.submissionByRequest(base.root.id, `queued-steer:${intentSourceId}`, context)).toBeUndefined();
      }
      expect((await candidateStorage!.submissionByRequest(base.root.id, primaryRequestId, context))?.id).toBe(primaryId);
      expect(() => TestOwner.acquire(path)).toThrow("owner busy");
      await runtime!.close(); // Public close aborts cooperative active generation; pending input remains durable.
      closeDatabase(); owner.releaseAfterClose(); owner.closeConnection();
      owner = TestOwner.acquire(path);
      expect(owner.token.generation).toBe(generation + 1);
      initDatabase(); db = getDb(); ports = stores(); permit = false;
      const calls = base.host.modelCalls, entriesAtReopen = providerEntries;
      adapter = await open();
      await Bun.sleep(20);
      expect(providerEntries).toBe(entriesAtReopen); // Entry hook runs BEFORE the still-closed model hold.
      expect(base.host.modelCalls).toBe(calls);
      const captured = JSON.parse((db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(incarnation) as { input: string }).input) as DurableConversationOperation;
      const unchanged = snapshot();
      await expect(adapter.submitIntent({ ...captured, content: "mismatched provenance" })).rejects.toThrow();
      expect(snapshot()).toEqual(unchanged);
      expect(providerEntries).toBe(entriesAtReopen);
      expect(await runtime!.settle(primary)).toBeNull();
      expect(value(await ports.work.getChatFrontier(chatJid)).consumedThroughSourceSeq).toBe(0);
      permit = true;
      expect(providerEntries).toBe(entriesAtReopen); // All paused replay observations above are entry-free.
      entryObserved = barrier();
      const sid = await adapter.submitIntent(captured); // Public committed lookup/provenance precedes any submit.
      if (boundary === "committed-ack-lost") expect(sid).toBe(committedIntentId);
      else await entryObserved.promise; // Synchronize the first legitimate dispatch, not its model completion.
      const entriesAfterSubmit = providerEntries;
      expect(entriesAfterSubmit).toBe(entriesAtReopen + (boundary === "before-submit" ? 1 : 0));
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await runtime!.submit(primary)).toBe(primaryId);
      await Bun.sleep(20);
      expect(providerEntries).toBe(entriesAfterSubmit);
      expect((await candidateStorage!.submissionByRequest(base.root.id, primaryRequestId, context))?.id).toBe(primaryId);
      expect(base.host.modelCalls).toBe(calls);
      base.host.finalContent = [{ type: "text", text: "recovered B answer" }];
      base.host.modelHold.release();
      await runtime!.resume(primary, primaryId);
      let terminal = await runtime!.settle(primary);
      for (let n = 0; !terminal && n < 200; n++) { await Bun.sleep(5); terminal = await runtime!.settle(primary); }
      expect(terminal?.disposition).toBe("completed");
      expect(value(await ports.work.getChatFrontier(chatJid)).consumedThroughSourceSeq).toBe(b.sourceSeq);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chatJid)).toEqual([{ content: "recovered B answer" }]);
      expect(db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(incarnation)).toHaveLength(1);
      expect(base.host.modelCalls).toBe(calls + 1); // One expected pending generation transition, not side-effect-free replay.
      const completed = snapshot();
      const bindingSnapshot = async () => ({
        primary: await candidateStorage!.submissionByRequest(base.root.id, primaryRequestId, context),
        intent: await candidateStorage!.submissionByRequest(base.root.id, captured.requestId, context),
        primaryBinding: await ports.bindings.get(primary),
        intents: await ports.bindings.intents!.list(primary),
      });
      const completedBindings = await bindingSnapshot(), completedEntries = providerEntries;
      base.host.modelHold = barrier(); // New entry would be visible even though completion is blocked.
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await runtime!.submit(primary)).toBe(primaryId);
      expect((await runtime!.settle(primary))?.disposition).toBe("completed");
      await Bun.sleep(20);
      expect(await bindingSnapshot()).toEqual(completedBindings);
      expect(providerEntries).toBe(completedEntries);
      expect(snapshot()).toEqual(completed); expect(base.host.modelCalls).toBe(calls + 1);
      expect(getDeferredQueuedFollowups(chatJid)).toEqual([]); expect(authorizations).toBeGreaterThan(0);
    } finally {
      base.host.modelHold?.release(); await runtime?.close(); await base.close();
      owner.releaseAfterClose(); owner.closeConnection(); closeDatabase();
      process.env.PICLAW_DB_IN_MEMORY = oldMemory;
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);
}
