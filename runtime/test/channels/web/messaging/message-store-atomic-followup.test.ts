import { afterEach, describe, expect, test } from "bun:test";

import { createTempWorkspace, setEnv } from "../../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function fixture() {
  const ws = createTempWorkspace("piclaw-atomic-followup-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const db = await import("../../../../src/db.js");
  const store = await import("../../../../src/channels/web/messaging/message-store.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  const channel = { pendingLinkPreviews: new Set<number>(), broadcastEvent: () => {} } as any;
  const params = {
    chatJid: "web:default",
    content: "continue protected work",
    isBot: false,
    mediaIds: [],
    agentId: "default",
    agentName: "Pi",
    userName: "You",
  };
  return { db, store, channel, params };
}

describe("atomic deferred follow-up materialization", () => {
  test("fault before queue consume rolls back the user row and preserves durable intent", async () => {
    const { db, store, channel, params } = await fixture();
    db.setDeferredQueuedFollowups("web:default", [{
      rowId: -1,
      queuedContent: params.content,
      threadId: 77,
      queuedAt: new Date().toISOString(),
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    }]);

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
      beforeDeferredFollowupConsume: () => { throw new Error("simulated process interruption"); },
    });

    expect(result).toBeNull();
    expect(db.getDeferredQueuedFollowups("web:default").map((item) => item.rowId)).toEqual([-1]);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 0 });
  });

  test("null consume id is treated as absent and does not roll back an ordinary user row", async () => {
    const { db, store, channel, params } = await fixture();

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: null,
    });

    expect(result?.data.content).toBe(params.content);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });
  });

  test("successful commit leaves exactly one user row and no queue intent", async () => {
    const { db, store, channel, params } = await fixture();
    db.setDeferredQueuedFollowups("web:default", [{
      rowId: -1,
      queuedContent: params.content,
      threadId: 77,
      queuedAt: new Date().toISOString(),
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    }]);

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
    });

    expect(result?.data.content).toBe(params.content);
    expect(db.getDeferredQueuedFollowups("web:default")).toEqual([]);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });

    const replay = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
    });
    expect(replay).toBeNull();
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });
  });
});
