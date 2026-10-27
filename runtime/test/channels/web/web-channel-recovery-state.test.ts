import { afterEach, expect, test } from "bun:test";
import { createTempWorkspace, setEnv } from "../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(async () => {
  try {
    const config = await import("../../../src/core/config.js");
    config.setWebTotpSecret("");
  } catch (_error) {
    void _error;
  }
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function initWebChannelFixture(chatJids: string[] = ["web:default"]) {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  const now = new Date().toISOString();
  for (const chatJid of chatJids) {
    db.storeChatMetadata(chatJid, now, "Web");
  }

  const webMod = await import("../../../src/channels/web.js");
  return { db, webMod };
}

test("web channel loadState clears stale persisted statuses when there is no inflight durable state", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:default", "web:compact"]);

  db.setRouterState("last_agent_timestamp_web", JSON.stringify({
    agentStatuses: {
      "web:default": {
        type: "tool_call",
        title: "Running tool",
        turn_id: "turn-stale",
        runtime_generation: "old-runtime",
      },
      "web:compact": {
        type: "intent",
        intent_key: "compaction",
        title: "Compacting context",
        started_at: "2026-03-14T14:00:00.000Z",
        turn_id: "turn-42",
        runtime_generation: "old-runtime",
      },
    },
    contextUsages: {},
    draftRecoveries: {},
  }));

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  second.loadState();

  expect(second.getAgentStatus("web:default")).toBeNull();
  expect(second.getAgentStatus("web:compact")).toBeNull();
});

test("web channel ignores old inflight cursors as display authority while preserving them", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:compact"]);

  const userTs = new Date(Date.now() - 5_000).toISOString();
  const messageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: messageId,
    chat_jid: "web:compact",
    sender: "user",
    sender_name: "User",
    content: "/compact",
    timestamp: userTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.beginChatRun("web:compact", userTs, {
    prevTs: "",
    messageId,
    startedAt: "2026-03-14T14:00:00.000Z",
  });

  db.setRouterState("last_agent_timestamp_web", JSON.stringify({
    agentStatuses: {
      "web:compact": {
        type: "intent",
        intent_key: "compaction",
        title: "Compacting context",
        started_at: "2026-03-14T14:00:00.000Z",
        turn_id: "turn-42",
        runtime_generation: "old-runtime",
      },
    },
    contextUsages: {},
    draftRecoveries: {},
  }));

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  second.loadState();

  expect(second.getAgentStatus("web:compact")).toBeNull();
  expect(db.getInflightRuns().some(run => run.chatJid === "web:compact")).toBe(true);
});

test("native startup and live draft buffers preserve historical payloads without publishing them", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:historical"]);
  const historical = { turnId: "old-turn", text: "Old uncommitted draft", totalLines: 1, updatedAt: 1 };
  db.setRouterState("last_agent_timestamp_web", JSON.stringify({ agentStatuses: {}, contextUsages: {}, draftRecoveries: { "web:historical": historical } }));
  db.beginChatRun("web:historical", "2026-01-01T00:00:01.000Z", { prevTs: "", messageId: "old-input", startedAt: "2026-01-01T00:00:00.000Z" });
  const web = new (webMod.WebChannel as any)({ queue: { enqueue() { throw Error("No legacy replay"); } },
    agentPool: { getContextUsageForChat: async () => null } });
  const before = db.getDb().serialize();
  web.loadState();
  web.updateAgentStatus("web:historical", { type: "thinking", turn_id: "new-turn" });
  web.updateDraftBuffer("new-turn", "Current transient draft", 1);
  const { runWebStartupRecoveryBootstrap } = await import("../../../src/runtime/startup.js");
  const scheduled: (() => void)[] = [];
  runWebStartupRecoveryBootstrap(web, undefined, resume => scheduled.push(resume));
  expect(scheduled).toHaveLength(1);
  expect(web.getBuffer("new-turn", "draft")).toEqual({ text: "Current transient draft", totalLines: 1, updatedAt: expect.any(Number) });
  expect(db.getDb().serialize()).toEqual(before);
  expect(db.getTimeline("web:historical", 10)).toEqual([]);
});
