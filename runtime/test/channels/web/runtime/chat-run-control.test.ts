import { describe, expect, test } from "bun:test";
import {
  getThreadRootId,
  resumeChat,
  type ChatRunControlStore,
  type ResumeChatContext,
} from "../../../../src/channels/web/runtime/chat-run-control.js";

describe("web chat run control helpers", () => {
  test("getThreadRootId delegates to store", () => {
    const store: ChatRunControlStore = {
      getThreadRootId: (chatJid, messageId) => (chatJid === "web:1" && messageId === "m1" ? 123 : null),
    };

    expect(getThreadRootId("web:1", "m1", store)).toBe(123);
    expect(getThreadRootId("web:1", "m2", store)).toBeNull();
  });

  test("resumeChat enqueues task and invokes processChat with default agent", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];

    const ctx: ResumeChatContext = {
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ task, key });
      },
      processChat: async (chatJid, agentId, threadRootId) => {
        processed.push({ chatJid, agentId, threadRootId });
      },
    };

    resumeChat("web:1", 77, ctx);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].key).toBe("resume:web:1:77");

    await enqueued[0].task();
    expect(processed).toEqual([{ chatJid: "web:1", agentId: "default", threadRootId: 77 }]);
  });

  test("resumeChat uses stable wake key when no thread root is provided", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];

    const ctx: ResumeChatContext = {
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ task, key });
      },
      processChat: async () => {},
    };

    resumeChat("web:1", undefined, ctx);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].key).toBe("resume:web:1:wake");

    // A second call with no threadRootId produces the same key, so the queue
    // will deduplicate it.
    resumeChat("web:1", null, ctx);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1].key).toBe("resume:web:1:wake");
  });
});
