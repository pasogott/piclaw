import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { watch, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
// Root application imports deliberately use its Pi 1.2.0 identity, not the private candidate SDK.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { AgentQueue } from "../../runtime/src/queue.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { createAgentPoolModelOptions } from "../../runtime/test/model-services-fixture.js";
import { createDurableQueueDispatch } from "../../runtime/src/agent-pool/durable-queue-dispatch.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../runtime/src/service-effects/contracts/common.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { barrier } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { resetRateLimiterStateForTests } from "../../runtime/src/channels/web/http/rate-limit.js";

async function until(check: () => boolean) {
  for (let n = 0; n < 500 && !check(); n++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

for (const failWait of [false, true]) test(`normal HTTP -> constructed AgentPool -> one DB candidate; wait error=${failWait}`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "application-web-"));
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  const f = await acceptedSteerFixture(dir, "before-submit", undefined, true, { sharedDatabase: true, httpPrimary: true });
  const spies = (["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL factory forbidden"); }));
  const fileEvents: string[] = [];
  const watcher = watch(process.env.PICLAW_WORKSPACE!, { recursive: true }, (_event, name) => { if (name && /\.jsonl$/i.test(name)) fileEvents.push(name); });
  const shutdown = new AbortController();
  const queue = new AgentQueue();
  let pool: AgentPool | undefined;
  let legacyRun: ReturnType<typeof spyOn<AgentPool, "runAgent">> | undefined;
  try {
    storeChatMetadata(f.chatJid, new Date().toISOString());
    const adapter = await f.open(); f.permit = true;
    const sessions = new Map([[f.chatJid, adapter.sessionPosition(f.chatJid, "main", "preserved-user-session")]]);
    let legacyCreates = 0;
    pool = new AgentPool({ ...createAgentPoolModelOptions(), durableSessions: sessions,
      createSession: async () => { legacyCreates++; throw Error("legacy construction forbidden"); } });
    expect(pool).toBeInstanceOf(AgentPool);
    legacyRun = spyOn(pool, "runAgent"); // Observe only; leave the real implementation intact.
    sessions.clear(); // Constructor must capture registration, not consult a mutable selector later.
    expect(legacyCreates).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const channel = new WebChannel({ queue, agentPool: pool });
    channel.broadcastEvent = () => {};
    expect(channel.getInputSourceAdmission).toBeUndefined();
    expect(channel.dispatchAcceptedInput).toBeUndefined();
    channel.getInputSourceAdmission = chat => {
      expect(chat).toBe(f.chatJid);
      return ({ message, rowId, database }) => {
        expect(database).toBe(f.db); expect(database.inTransaction).toBe(true); f.owner.assert();
        const input = { effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
          provenanceRef: "fixture:explicit-host", redactionClass: "private" as const }, chatJid: chat,
          sourceId: message.id, kind: "message" as const, payloadRef: `message-row:${rowId}`,
          targetOperationId: null, parentSourceSeq: null, acceptedAt: message.timestamp, createWakeIntent: false };
        input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
        f.ports.work.acceptSourceInTransaction(input, database);
      };
    };
    const failed = barrier();
    const selected = failWait ? { ...adapter, async wait(...args: Parameters<typeof adapter.wait>) {
      await adapter.wait(...args); failed.release(); throw Error("private lost wait acknowledgement");
    } } : adapter;
    channel.dispatchAcceptedInput = createDurableQueueDispatch({ work: f.ports.work, adapter: selected, branchId: "main",
      assertCurrentWriter: () => f.owner.assert(), shutdown: shutdown.signal,
      waitForReconciliation: (_identity, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) });
    const hold = barrier(); f.base.host.modelHold = hold;
    f.base.host.finalContent = [{ type: "text", text: "one application answer" }];
    const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(f.chatJid)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify({ content: "normal application input" }), // No engine, flags or authority in body.
    }));
    expect(response.status).toBe(201);
    await until(() => f.providerEntries > 0);
    const row = f.db.query("SELECT rowid, id, content FROM messages WHERE chat_jid=? AND is_bot_message=0").get(f.chatJid) as { rowid: number; id: string; content: string };
    expect(row.content).toBe("normal application input");
    expect(f.ports.work.getAcceptedSource(f.chatJid, row.id)?.state).toBe("claimed");
    const lane = `chat:${f.chatJid}`;
    expect(queue.isLaneBusy(lane)).toBe(true);
    expect(f.db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(f.chatJid)).toEqual({ inflight_message_id: row.id });
    hold.release();
    if (failWait) {
      await failed.promise; await Bun.sleep(15);
      expect(queue.isLaneBusy(lane)).toBe(true);
      expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([]);
      expect(f.db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(f.chatJid)).toEqual({ inflight_message_id: row.id });
      shutdown.abort(); await queue.shutdown();
    } else {
      await until(() => !queue.isLaneBusy(lane));
      expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([{ content: "one application answer" }]);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(`message:${row.rowid}:1`)).toHaveLength(1);
      expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(1);
      expect(await pool.getCurrentModelLabel(f.chatJid)).toBe("qualification/synthetic");
      const position = await pool.saveSessionPosition(f.chatJid);
      expect(position).not.toBeNull();
      const tree = await pool.getSessionTreeForChat(f.chatJid);
      expect(tree.leafId).toBe(position);
      expect(tree.nodes.some(node => node.role === "assistant" && node.detail === "one application answer")).toBe(true);
      expect((await pool.applyControlCommand(f.chatJid, { type: "tree", raw: "/tree" })).status).toBe("success");
      expect(pool.getSessionGenerationForChat(f.chatJid)).toBe("preserved-user-session");
    }
    expect(f.base.host.modelCalls).toBe(1); expect(f.base.host.credentialLookups).toBe(0);
    expect(legacyCreates).toBe(0);
    expect(legacyRun).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect((f.db.query("PRAGMA database_list").all() as { seq: number; name: string; file: string }[]).filter(row => row.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.hostPath }]);
    expect((await f.candidateDatabase.all("PRAGMA database_list") as { seq: number; name: string; file: string }[]).filter(row => row.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.hostPath }]);
    const files: string[] = [];
    async function scan(path: string) { for (const item of await readdir(path, { withFileTypes: true })) {
      const next = join(path, item.name); if (item.isDirectory()) await scan(next); else files.push(next);
    } }
    await scan(process.env.PICLAW_WORKSPACE!);
    expect(files.filter(path => /\.jsonl$/i.test(path))).toEqual([]);
    expect(files.filter(path => /\.(db|sqlite)$/i.test(path))).toEqual([f.hostPath]);
    expect(fileEvents).toEqual([]);
  } finally {
    shutdown.abort(); await queue.shutdown(); await pool?.shutdown(); watcher.close();
    legacyRun?.mockRestore();
    for (const spy of spies) spy.mockRestore();
    await f.close(); resetRateLimiterStateForTests(); await rm(dir, { recursive: true, force: true });
  }
}, 20000);
