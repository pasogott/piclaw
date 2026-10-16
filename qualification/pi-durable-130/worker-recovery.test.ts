import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { acceptedSteerFixture } from './src/accepted-steer-recovery-fixture.js';
import { TestOwner, OwnedSqlite } from './src/ownership.js';
import { context, barrier } from './src/fixture.js';
import { at, value } from './src/host-handoff.js';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { createHostController } from '../../runtime/durable-engine/src/host-controller.js';
import { closeDatabase, initDatabase, getDb } from '../../runtime/src/db/connection.js';
import { beginChatRun, getInflightRuns, rollbackInflightRun, getDeferredQueuedFollowups } from '../../runtime/src/db/chat-cursors.js';
import { createDurableConversationAdapter } from '../../runtime/src/agent-pool/durable-runtime-adapter.js';
import { createDurableQueueDispatch } from '../../runtime/src/agent-pool/durable-queue-dispatch.js';
import { createDurableRecoveryDispatch } from '../../runtime/src/agent-pool/durable-recovery-dispatch.js';
import { AgentQueue } from '../../runtime/src/queue.js';
import { WebChannel } from '../../runtime/src/channels/web.js';
import { processChat } from '../../runtime/src/channels/web/handlers/agent.js';

test('disk restart controller + current queue worker: lost ACK repair retains lane until terminal SQL/event', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'worker-recovery-'));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const f = await acceptedSteerFixture(dir, 'committed-ack-lost', undefined, true);
  const shutdown = new AbortController();
  let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
  const queue = new AgentQueue();
  try {
    const { primary } = await f.prepare();
    const row = f.db.query('SELECT rowid AS rowId, id FROM messages WHERE id=?').get(primary.sourceId) as { rowId: number; id: string };
    beginChatRun(f.chatJid, at, { prevTs: '', messageId: row.id, startedAt: at });
    const before = f.snapshot(), committedId = f.committedIntentId!, bootEntries = f.providerEntries;
    const oldOwner = f.owner;
    await f.runtime!.close(); f.runtime = undefined;
    oldOwner.releaseAfterClose(); // Actual candidate close precedes ownership release.
    closeDatabase(); // Actual host SQL connection close, not a cache reset.
    const events: string[] = [];
    f.owner = TestOwner.acquire(f.path); events.push("owner");
    expect(() => oldOwner.assert()).toThrow("owner lost");
    initDatabase(); f.db = getDb(); f.ports = f.stores();
    controller = await createHostController({
      async acquireOwnership() {
        f.owner.assert();
        return { assertCurrentOwner: () => f.owner.assert(), release() { events.push('release'); f.owner.releaseAfterClose(); } };
      },
      async createStorage(lease) {
        lease.assertCurrentOwner(); events.push('storage');
        expect(() => TestOwner.acquire(f.path)).toThrow('owner busy');
        const storage = await SqliteStorage.open(new OwnedSqlite(f.owner));
        const close = storage.close.bind(storage);
        storage.close = async c => { await close(c); events.push('close'); };
        return storage;
      },
      runtime: { incarnation: f.incarnation,
        // All ports were rebuilt against the reopened disk connection.
        work: f.ports.work,
        terminal: f.ports.terminal,
        bindings: f.ports.bindings,
        harnessOptions: { models: f.base.models, registry: f.base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
        existingConversationIds: [f.base.root.id], conversationFor: () => f.base.root.id,
        putAnswer: f.putAnswer, sessionId: f.incarnation, lane: 'main', generation: f.generation, now: () => at },
      recovery: { manifest: [{ chatJid: f.chatJid, branchId: 'main', conversationId: f.base.root.id }],
        work: f.ports.work,
        bindings: f.ports.bindings,
        async readAcceptedInput(source) {
          const content = (f.db.query('SELECT content FROM messages WHERE id=? AND chat_jid=?').get(source.sourceId, source.chatJid) as { content: string }).content;
          const binding = await f.ports.bindings.findSource(source.chatJid, source.sourceSeq);
          return { claimed: { source, operation: value(await f.ports.work.getOperation(f.incarnation))! }, branchId: 'main', requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content };
        } },
    }, context);
    oldOwner.closeConnection();
    expect(events).toEqual(['owner', 'storage']);
    expect(f.snapshot()).toEqual(before);
    expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');
    expect(controller.recovered.map(x => x.input.sourceId)).toEqual([primary.sourceId, f.intentSourceId]);
    expect(getInflightRuns().find(x => x.chatJid === f.chatJid)?.messageId).toBe(row.id);
    const entries = f.providerEntries;
    expect(entries).toBe(bootEntries);
    const intent = controller.recovered[1]!.input;
    const recovery = createDurableRecoveryDispatch({ assertCurrentWriter: () => f.owner.assert(), shutdown: shutdown.signal,
      reconcileRecovered: controller.reconcileRecovered, async submitIntent() { throw Error('No fresh admission'); } });
    const adapter = createDurableConversationAdapter({ incarnation: f.incarnation,
      manifest: [{ chatJid: f.chatJid, branchId: 'main', conversationId: f.base.root.id }], runtime: controller.runtime });
    const observing = barrier();
    const dispatch = createDurableQueueDispatch({ work: f.ports.work, adapter, branchId: 'main', assertCurrentWriter: () => f.owner.assert(), shutdown: shutdown.signal,
      waitForReconciliation(identity, signal) { const wait = recovery.waitForReconciliation(identity, signal); observing.release(); return wait; } });
    let legacy = 0, releases = 0, next = 0;
    const channel = new WebChannel({ queue, agentPool: { setSessionBinder() {}, runAgent() { legacy++; throw Error('Legacy forbidden'); } } as any });
    channel.dispatchAcceptedInput = dispatch;
    channel.resumeChat = () => { releases++; };
    // Existing cursor recovery API makes the persisted inflight primary visible again.
    rollbackInflightRun(f.chatJid, '');
    const lane = `chat:${f.chatJid}`;
    const finished = barrier();
    queue.enqueue(async () => { await processChat(channel, f.chatJid, 'default'); finished.release(); }, 'recovered-primary', lane);
    queue.enqueue(async () => { next++; }, 'behind-primary', lane);
    await observing.promise;
    expect(queue.isLaneBusy(lane)).toBe(true); expect(next).toBe(0); expect(releases).toBe(0);
    expect(getInflightRuns().find(x => x.chatJid === f.chatJid)?.messageId).toBe(row.id);
    expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(0);
    const workerEntries = f.providerEntries;
    expect(workerEntries).toBe(entries + 1); // Entry hook runs BEFORE the held model callback.
    const repair = recovery.retryRecoveredWork(); expect(recovery.retryRecoveredWork()).toBe(repair); await repair;
    expect((await controller.runtime.reconcileIntent(intent)).submissionId).toBe(committedId);
    expect(f.providerEntries).toBe(workerEntries); // ACK repair is not a scheduling grant.
    expect(next).toBe(0); expect(releases).toBe(0);
    f.base.host.modelHold?.release();
    for (let n = 0; n < 500 && !(await controller.runtime.settle(primary)); n++) await Bun.sleep(2);
    expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(1);
    recovery.onReconcile(); await finished.promise;
    for (let n = 0; n < 100 && !next; n++) await Bun.sleep(1);
    expect(next).toBe(1); expect(releases).toBe(1); expect(legacy).toBe(0);
    expect(getInflightRuns().filter(x => x.chatJid === f.chatJid)).toEqual([]);
    expect(getDeferredQueuedFollowups(f.chatJid)).toEqual([]);
    expect(f.db.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toHaveLength(1);
    expect(f.db.query('SELECT state FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual([{ state: 'consumed' }, { state: 'consumed' }]);
    // Deliberately attach AFTER terminal/event: no replayed event may be required.
    expect(await Promise.race([dispatch.waitForPending({ chatJid: f.chatJid, messageId: row.id, rowId: row.rowId }), Bun.sleep(100).then(() => 'lost-wake')])).toBe('settled');
    expect(await controller.runtime.submitIntent(intent)).toBe(committedId);
    expect(await dispatch(f.chatJid, row.id, row.rowId)!()).toBe('settled');
    expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(1);
    expect(f.db.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toHaveLength(1);
    expect(f.base.host.modelCalls).toBe(2); // Completed primary A was not replayed; only B entered.
    expect(f.db.query('SELECT submission_id FROM piclaw_durable_intent_bindings_v1').all()).toEqual([{ submission_id: committedId }]);
    await controller.close(); expect(events).toEqual(['owner', 'storage', 'close', 'release']);
  } finally {
    shutdown.abort(); f.base.host.modelHold?.release(); await controller?.close(); await f.close();
    if (oldMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
