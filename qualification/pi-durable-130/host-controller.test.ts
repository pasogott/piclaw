import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { createHostController, type HostControllerOptions } from "../../runtime/durable-engine/src/host-controller.js";
import { context } from "./src/fixture.js";
import { at, value } from "./src/host-handoff.js";

for (const modes of [["happy"], ["lost-ack"], ["unknown"], ["failed-open"], ["background"],
  ["bootstrap-close-failure", "shutdown-close-failure"]] as const) {
  test(`explicit owner-first host controller: ${modes.join(" / ")}`, async () => {
    for (const mode of modes) {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-controller-"));
    const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
    const f = await acceptedSteerFixture(dir, mode === "lost-ack" ? "committed-ack-lost" : "before-submit");
    let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
    let actualClose: (() => Promise<void>) | undefined;
    let capturedLease: Parameters<HostControllerOptions["createStorage"]>[0] | undefined;
    const closeFailure = mode === "bootstrap-close-failure" || mode === "shutdown-close-failure";
    try {
      const { primary, primaryId } = await f.prepare();
      await f.runtime!.close(); f.runtime = undefined;
      f.db.exec("DROP TABLE recovery_fixture_identity");
      if (mode === "unknown" || mode === "bootstrap-close-failure" || mode === "background") {
        // Real public candidate admission, not a fabricated inspection. The host has no work for it.
        const s = await SqliteStorage.open(new OwnedSqlite(f.owner));
        const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
        const h = await Harness.open(s, { models: f.base.models, registry: f.base.registry }, context);
        const c = await h.conversation(f.base.root.id, context);
        if (mode === "background") {
          // Actual public Session admission, not inspectPending fault injection. Scheduling stays paused.
          const task = { definition: { name: "qualification-independent-background", version: 1,
            initial: (_input: null) => ({ phase: "held" as const }),
            phases: { held: async () => { throw Error("Background task must never execute"); } },
            abort: async () => { throw Error("Background task must never abort"); } } };
          const id = await h.commit(tx => tx.createTask(task, null, {
            ownership: { kind: "conversation" }, conversationId: c!.id, background: true,
          }), context);
          const inspection = await h.inspect(context);
          expect(inspection.scheduling).toBe("paused");
          expect(inspection.tasks.some(t => t.record.id === id && t.record.background && t.record.owner === undefined)).toBe(true);
          expect(inspection.submissions).toEqual([]);
        } else {
          await c!.submit({ type: "input", requestId: "unknown-public-input", content: "unowned" }, context);
        }
        await h.close(context);
      }
      f.owner.releaseAfterClose(); f.owner.closeConnection();
      const events: string[] = [];
      const options: HostControllerOptions = {
        async acquireOwnership() {
          f.owner = TestOwner.acquire(f.path); events.push("owner");
          return { assertCurrentOwner: () => f.owner.assert(), release() { events.push("release"); f.owner.releaseAfterClose(); } };
        },
        async createStorage(lease) {
          lease.assertCurrentOwner(); events.push("storage");
          expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
          const s = await SqliteStorage.open(new OwnedSqlite(f.owner));
          const close = s.close.bind(s);
          if (closeFailure) {
            capturedLease = lease;
            actualClose = () => close(context);
            // Throw BEFORE actual close: resource cleanup is unconfirmed and must retain ownership.
            s.close = async () => { events.push("close-failed"); throw Error("injected storage close failure"); };
          } else s.close = async c => { await close(c); events.push("close"); };
          return s;
        },
        runtime: { incarnation: f.incarnation, ...f.ports,
          harnessOptions: { models: f.base.models, registry: f.base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
          existingConversationIds: [mode === "failed-open" ? 999999 as typeof f.base.root.id : f.base.root.id],
          conversationFor: () => f.base.root.id, putAnswer() {}, sessionId: f.incarnation, lane: "main", generation: f.generation, now: () => at },
        recovery: { manifest: [{ chatJid: f.chatJid, branchId: "main", conversationId: f.base.root.id }],
          work: f.ports.work, bindings: f.ports.bindings,
          async readAcceptedInput(source) {
            const row = f.db.query("SELECT content FROM messages WHERE id=? AND chat_jid=?").get(source.sourceId, source.chatJid) as { content: string } | null;
            if (!row) throw Error("Missing message");
            const binding = await f.ports.bindings.findSource(source.chatJid, source.sourceSeq);
            return { claimed: { source, operation: value(await f.ports.work.getOperation(f.incarnation))! }, branchId: "main",
              requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content: row.content };
          } },
      };
      const entries = f.providerEntries;
      const pending = createHostController(options, context);
      // Mutable caller scope/callback replacements after first await cannot change the open.
      Object.assign(options.runtime, { existingConversationIds: [] });
      options.recovery.readAcceptedInput = async () => { throw Error("replacement"); };
      if (mode === "shutdown-close-failure") {
        controller = await pending;
        const closing = controller.close();
        expect(controller.close()).toBe(closing);
        await expect(closing).rejects.toThrow("injected storage close failure");
        expect(controller.close()).toBe(closing);
        await expect(controller.close()).rejects.toThrow("injected storage close failure");
      } else if (mode === "happy" || mode === "lost-ack") {
        controller = await pending;
        expect(controller.recovered[0]!.input).toEqual(primary);
        expect(controller.pendingIntentIds).toEqual(mode === "happy" ? [`queued-steer:${f.intentSourceId}`] : []);
        expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        expect(f.providerEntries).toBe(entries);
        f.base.host.modelHold?.release();
        const intent = controller.recovered[1]!.input;
        const id = await controller.runtime.submitIntent(intent);
        // Lost ACK repair is deliberately not a progress grant.
        if (mode === "lost-ack") await controller.runtime.resume(primary, primaryId);
        let state = await controller.runtime.reconcileIntent(intent);
        for (let i = 0; i < 100 && state.status?.status !== "done"; i++) {
          await Bun.sleep(5); state = await controller.runtime.reconcileIntent(intent);
        }
        expect(state.status?.status).toBe("done");
        expect(await controller.runtime.submitIntent(intent)).toBe(id);
        await controller.close();
      } else {
        await expect(pending).rejects.toThrow(mode === "bootstrap-close-failure" ? "injected storage close failure" :
          mode === "unknown" || mode === "background" ? "Unknown recovered candidate authority" : "Missing manifest conversation");
        expect(f.providerEntries).toBe(entries);
      }
      if (closeFailure) {
        expect(events).toEqual(["owner", "storage", "close-failed"]);
        f.owner.assert();
        expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
        expect(f.providerEntries).toBe(entries);
        // Cleanup uses captured real ports, never a retry of the cached rejected controller close.
        await actualClose!(); actualClose = undefined;
        await capturedLease!.release(); capturedLease = undefined;
        expect(events).toEqual(["owner", "storage", "close-failed", "release"]);
        const contender = TestOwner.acquire(f.path);
        contender.releaseAfterClose(); contender.closeConnection();
      } else expect(events).toEqual(["owner", "storage", "close", "release"]);
    } finally {
      if (closeFailure) {
        await actualClose?.();
        await capturedLease?.release();
      } else await controller?.close();
      await f.close();
      if (oldMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = oldMemory;
      await rm(dir, { recursive: true, force: true });
    }
    }
  }, 15000);
}
