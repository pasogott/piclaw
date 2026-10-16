import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { TestOwner } from "./src/ownership.js";
import { context, barrier } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups } from "../../runtime/src/db.js";
import { type DurableConversationOperation } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";

import { acceptedSteerFixture, type RecoveryCheckpoint } from "./src/accepted-steer-recovery-fixture.js";

async function crashChild(dir: string, boundary: string) {
  const env: Record<string,string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "PICLAW_WORKSPACE", "PICLAW_STORE", "PI_CODING_AGENT_DIR", "PICLAW_TEST_FS_ISOLATION_ACTIVE", "PICLAW_TEST_FS_ISOLATION_ROOT"]) if (process.env[key]) env[key] = process.env[key]!;
  const child = Bun.spawn([process.execPath, "src/accepted-steer-recovery-child.ts", "--accepted-steer-crash", dir, boundary], { cwd: import.meta.dir, env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  try {
    const reader = child.stdout.getReader(); let pending = "";
    const checkpoint = await Promise.race([(async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) throw Error("child exited before checkpoint: " + await stderr);
        pending += new TextDecoder().decode(next.value);
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0,end); pending = pending.slice(end+1);
          try { const event = JSON.parse(line); if (event.event === "accepted-steer-committed") return event as RecoveryCheckpoint; } catch {}
        }
      }
    })(), Bun.sleep(10000).then(() => { throw Error("child checkpoint timeout"); })]);
    reader.releaseLock();
    expect(() => TestOwner.acquire(join(dir,"candidate.sqlite"))).toThrow("owner busy");
    child.kill("SIGKILL"); await child.exited;
    expect(child.signalCode).toBe("SIGKILL");
    return checkpoint;
  } finally { child.kill("SIGKILL"); await child.exited; }
}

// Host-only rehearsal: no production registration or recovery controller.
for (const mode of ["clean-close", "SIGKILL"] as const) for (const boundary of ["before-submit", "committed-ack-lost"] as const) {
 test(`accepted steering disk recovery: ${boundary} (${mode})`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "accepted-recovery-"));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const checkpoint = mode === "SIGKILL" ? await crashChild(dir,boundary) : undefined;
  const f = await acceptedSteerFixture(dir,boundary,checkpoint);
  try {
    const { primary, primaryId, b } = checkpoint ?? await f.prepare();
    if (!checkpoint) {
      expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
      await f.runtime!.close(); // Public close aborts cooperative active generation; pending input remains durable.
      closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
      f.owner = TestOwner.acquire(f.path);
      expect(f.owner.token.generation).toBe(f.generation + 1);
      initDatabase(); f.db = getDb(); f.ports = f.stores(); f.permit = false;
    } else {
      expect(f.owner.token.generation).toBe(checkpoint.generation + 1);
      f.committedIntentId = checkpoint.committedIntentId;
      f.base.host.modelHold = barrier();
    }
      const calls = f.base.host.modelCalls, entriesAtReopen = f.providerEntries;
      const adapter = await f.open();
      await Bun.sleep(20);
      expect(f.providerEntries).toBe(entriesAtReopen); // Entry hook runs BEFORE the still-closed model hold.
      expect(f.base.host.modelCalls).toBe(calls);
      expect(f.toolEntries).toBe(0); // Existing tool-entry signal fires before its hold.
      const captured = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as { input: string }).input) as DurableConversationOperation;
      expect(captured.requestId).toBe(`queued-steer:${f.intentSourceId}`);
      expect(captured.claimed.source.sourceId).toBe(f.intentSourceId);
      expect(f.ports.work.getAcceptedSource(f.chatJid, b.sourceId)?.state).toBe("claimed");
      expect(getDeferredQueuedFollowups(f.chatJid)).toEqual([]);
      if (checkpoint) {
        expect(captured).toEqual(checkpoint.intent);
        expect(checkpoint.modelCalls).toBe(1); // Only primary A finished in the killed process.
        expect(checkpoint.effects).toBe(0);
        expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context))?.id).toBe(checkpoint.candidate?.id);
        expect(f.providerEntries).toBe(0);
      }
      const unchanged = f.snapshot();
      await expect(adapter.submitIntent({ ...captured, content: "mismatched provenance" })).rejects.toThrow();
      expect(f.snapshot()).toEqual(unchanged);
      expect(f.providerEntries).toBe(entriesAtReopen);
      expect(await f.runtime!.settle(primary)).toBeNull();
      expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(0);
      expect(f.toolEntries).toBe(0);
      f.permit = true;
      expect(f.providerEntries).toBe(entriesAtReopen); // All paused replay observations above are entry-free.
      f.entryObserved = barrier();
      const sid = await adapter.submitIntent(captured); // Public committed lookup/provenance precedes any submit.
      if (boundary === "committed-ack-lost") expect(sid).toBe(f.committedIntentId);
      else await f.entryObserved.promise; // Synchronize the first legitimate dispatch, not its model completion.
      const entriesAfterSubmit = f.providerEntries;
      expect(entriesAfterSubmit).toBe(entriesAtReopen + (boundary === "before-submit" ? 1 : 0));
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await f.runtime!.submit(primary)).toBe(primaryId);
      await Bun.sleep(20);
      expect(f.providerEntries).toBe(entriesAfterSubmit);
      expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context))?.id).toBe(primaryId);
      expect(f.base.host.modelCalls).toBe(calls);
      f.base.host.finalContent = [{ type: "text", text: "recovered B answer" }];
      f.base.host.modelHold.release();
      await f.runtime!.resume(primary, primaryId);
      let terminal = await f.runtime!.settle(primary);
      for (let n = 0; !terminal && n < 200; n++) { await Bun.sleep(5); terminal = await f.runtime!.settle(primary); }
      expect(terminal?.disposition).toBe("completed");
      expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(b.sourceSeq);
      expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([{ content: "recovered B answer" }]);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(f.incarnation)).toHaveLength(1);
      expect(f.base.host.modelCalls).toBe(calls + 1); // One expected pending generation transition, not side-effect-free replay.
      const completed = f.snapshot();
      const bindingSnapshot = async () => ({
        primary: await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context),
        intent: await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context),
        primaryBinding: await f.ports.bindings.get(primary),
        intents: await f.ports.bindings.intents!.list(primary),
      });
      const completedBindings = await bindingSnapshot(), completedEntries = f.providerEntries;
      f.base.host.modelHold = barrier(); // New entry would be visible even though completion is blocked.
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await f.runtime!.submit(primary)).toBe(primaryId);
      expect((await f.runtime!.settle(primary))?.disposition).toBe("completed");
      await Bun.sleep(20);
      expect(await bindingSnapshot()).toEqual(completedBindings);
      expect(f.providerEntries).toBe(completedEntries);
      expect(f.snapshot()).toEqual(completed); expect(f.base.host.modelCalls).toBe(calls + 1);
      expect(getDeferredQueuedFollowups(f.chatJid)).toEqual([]); expect(f.authorizations).toBeGreaterThan(0);
      expect(f.toolEntries).toBe(0);
      expect(f.base.host.effects).toBe(0);
      expect(f.base.host.credentialLookups).toBe(0);
  } finally {
    await f.close(); process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive: true, force: true });
  }
 }, 20000);
}
