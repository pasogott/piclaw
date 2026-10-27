import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { spyOn } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { createAgentPoolServices } from "../../src/agent-pool/service-factory.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { initDatabase, storeChatMetadata, getChatBranchByChatJid } from "../../src/db.js";
import * as legacySession from "../../src/agent-pool/session.js";
import { AgentToolFactory } from "../../src/agent-pool/tool-factory.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { AgentSessionBinder } from "../../src/agent-pool/session-binder.js";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { getDb } from "../../src/db/connection.js";

for (const empty of [false, true]) {
  test(`durable backend ${empty ? "empty" : "exact"} scope never reads legacy factories or creates sessions`, async () => {
    initDatabase();
    const model = createAgentPoolModelOptions();
    const durableSessions = new Map(empty ? [] : [["web:bound", {
      sessionId: "durable", branchId: "main", readPosition: async () => "leaf", readModel: async () => "provider/model",
    }] as const]);
    let factoryReads = 0;
    const compatibility = {
      get createSession(): never { factoryReads++; throw Error("legacy main factory accessed"); },
    };
    const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
    const before = snapshot();
    const spies = [
      ...(["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); })),
      ...(["ensureSessionDir", "ensureNamedSessionDir", "createDefaultSession", "createSessionInDir", "lightweightPrewarmSession"] as const)
        .map(name => spyOn(legacySession, name).mockImplementation(() => { throw Error("legacy session setup forbidden"); })),
      spyOn(AgentToolFactory.prototype, "createDefaultTools").mockImplementation(() => { throw Error("legacy tool setup forbidden"); }),
      spyOn(AgentBranchManager.prototype, "mergeChatBranchIntoParent").mockImplementation(() => { throw Error("legacy merge entered"); }),
      spyOn(AgentBranchManager.prototype, "restoreChatBranch").mockImplementation(() => { throw Error("legacy restore entered"); }),
      spyOn(AgentBranchManager.prototype, "renameChatJid").mockImplementation(() => { throw Error("legacy identity rename entered"); }),
    ];
    let pool: AgentPool | undefined;
    let services: ReturnType<typeof createAgentPoolServices> | undefined;
    try {
      const options = Object.assign({}, model, { getDurableSession: (chat: string) => durableSessions.get(chat) });
      Object.defineProperties(options, Object.getOwnPropertyDescriptors(compatibility));
      pool = new AgentPool(options);
      const serviceOptions = Object.assign({}, {
        pool: new Map(), activeForkBaseLeafByChat: new Map(),
        authStorage: model.credentialStore, modelRuntime: model.modelRuntime,
        modelRegistry: model.modelRegistry!, settingsManager: SettingsManager.inMemory(), workspaceDir: process.env.PICLAW_WORKSPACE!, getDurableSession: (chat: string) => durableSessions.get(chat),
      });
      Object.defineProperties(serviceOptions, Object.getOwnPropertyDescriptors(compatibility));
      services = createAgentPoolServices(serviceOptions);
      expect(services.sessionManager).not.toBeInstanceOf(AgentSessionManager);
      expect(services.sessionBinder).not.toBeInstanceOf(AgentSessionBinder);
      expect(services.toolFactory).not.toBeInstanceOf(AgentToolFactory);
      expect(services.turnCoordinator).not.toBeInstanceOf(AgentTurnCoordinator);
      const databaseBefore = getDb().serialize();
      let runnerOptionReads = 0;
      // Backend-owned lookup remains live for post-startup routes.
      for (const chat of ["web:bound", "web:unknown"]) {
        await expect(pool.getSessionForIntrospection(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        await expect(services.sessionManager.getOrCreate(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        expect("getOrCreateSide" in services.sessionManager).toBe(false);
        expect(services.sessionManager.prewarm(chat, { mode: "lightweight" })).toBe(false);
        expect(services.sessionManager.prewarm(chat, { mode: "full" })).toBe(false);
        await expect(pool.mergeChatBranchIntoParent(chat)).rejects.toThrow("Durable branch rollup unavailable");
        // Native restore now exists. An absent branch must still reject before
        // any legacy fallback or persisted metadata change.
        await expect(pool.restoreChatBranch(chat)).rejects.toThrow(`Unknown chat branch: ${chat}`);
        expect(getDb().serialize()).toEqual(databaseBefore);
        await expect(pool.renameChatJid(chat, "web:renamed")).rejects.toThrow("Durable chat identity rename unavailable");
        expect(await pool.applyControlCommand(chat, { type: "rollup", raw: "/rollup" })).toMatchObject({ status: "error", message: "Durable branch rollup unavailable" });
      }
      for (const chat of ["web:bound", "web:unknown", "dream:manual:fixture", "operation:fixture", "custom:room"]) {
        const options = { get budgetWorkId() { runnerOptionReads++; return `forbidden-native-${empty}-${chat}`; } };
        const output = await pool.runAgent("must not enter legacy orchestration", chat, options);
        expect(getDb().serialize()).toEqual(databaseBefore);
        expect(output).toEqual({ status: "error", result: null, error: "Native execution requires an admitted operation", failureCategory: "non_recoverable" });
      }
      expect(runnerOptionReads).toBe(0);
      expect(getDb().serialize()).toEqual(databaseBefore);
      if (!empty) {
        expect(await pool.saveSessionPosition("web:bound")).toBe("leaf");
        expect(await pool.getCurrentModelLabel("web:bound")).toBe("provider/model");
      }
      expect(factoryReads).toBe(0);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    } finally {
      await pool?.shutdown();
      await services?.sessionManager.shutdown();
      for (const spy of spies) spy.mockRestore();
    }
  });
}

for (const binding of ["missing", "foreign", "stale", "current"] as const) {
  test(`native restore ${binding} binding retains metadata atomicity without legacy construction`, async () => {
    initDatabase();
    const chat = `web:native-restore-${binding}`;
    storeChatMetadata(chat, "2026-10-25T00:00:00.000Z");
    getDb().query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run("2026-10-25T00:01:00.000Z", chat);
    const archived = getChatBranchByChatJid(chat)!;
    let factoryReads = 0, ownerChecks = 0;
    const options = {
      ...createAgentPoolModelOptions(),
      getDurableSession: (id: string) => id !== chat || binding === "missing" ? undefined : {
        sessionId: "same-native-session",
        branchId: binding === "foreign" ? "foreign-branch" : archived.branch_id,
        assertCurrent() { ownerChecks++; if (binding === "stale") throw Error("fixture native owner stale"); },
      },
      get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
    };
    const legacyRestore = spyOn(AgentBranchManager.prototype, "restoreChatBranch").mockImplementation(() => { throw Error("legacy restore entered"); });
    const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
    let pool: AgentPool | undefined;
    try {
      pool = new AgentPool(options);
      const databaseBefore = getDb().serialize();
      const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
      const filesBefore = snapshot();
      if (binding === "current") {
        const restored = await pool.restoreChatBranch(chat, { agentName: "restored-native-handle" });
        expect(restored).toMatchObject({ branch_id: archived.branch_id, chat_jid: chat, root_chat_jid: archived.root_chat_jid,
          parent_branch_id: archived.parent_branch_id, archived_at: null, agent_name: "restored-native-handle" });
        expect(getChatBranchByChatJid(chat)).toEqual(restored);
        expect(ownerChecks).toBe(1);
      } else {
        await expect(pool.restoreChatBranch(chat, { agentName: "must-rollback" })).rejects.toThrow(
          binding === "stale" ? "fixture native owner stale" : "Exact native restore binding unavailable");
        expect(getDb().serialize()).toEqual(databaseBefore);
        expect(getChatBranchByChatJid(chat)).toEqual(archived);
        expect(ownerChecks).toBe(binding === "stale" ? 1 : 0);
      }
      expect(factoryReads).toBe(0);
      expect(legacyRestore).not.toHaveBeenCalled(); expect(legacyCreate).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(filesBefore);
    } finally {
      await pool?.shutdown(); legacyRestore.mockRestore(); legacyCreate.mockRestore();
    }
  });
}
