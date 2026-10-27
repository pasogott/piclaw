import { resumePendingChats, type WebPendingResumeContext, type WebPendingResumeStore } from "../../../src/channels/web/runtime/recovery.js";
import { AgentQueue } from "../../../src/queue.js";
import { waitFor } from "../../helpers.js";

describe("web recovery helpers", () => {

  test("resumePendingChats enqueues only chats with pending messages", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string }> = [];

    const ctx: WebPendingResumeContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async (chatJid, agentId) => {
        processed.push({ chatJid, agentId });
      },
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({ "web:1": "t1", "web:2": "t2" }),
      getKnownChatJids: () => ["web:1", "web:2"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid) => (chatJid === "web:2" ? [{ id: "m" }] : []),
    };

    resumePendingChats(ctx, undefined, store);

    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:2"]);
    await enqueued[0].task();
    expect(processed).toEqual([{ chatJid: "web:2", agentId: "default" }]);
  });

  test("resumePendingChats scans known chats even when a cursor row is missing", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const calls: Array<{ chatJid: string; since: string }> = [];

    const ctx: WebPendingResumeContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({ "web:known": "t1" }),
      getKnownChatJids: () => ["web:known", "web:new"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid, since) => {
        calls.push({ chatJid, since });
        return chatJid === "web:new" ? [{ id: "new-msg" }] : [];
      },
    };

    resumePendingChats(ctx, undefined, store);

    expect(calls).toContainEqual({ chatJid: "web:new", since: "" });
    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:new"]);
  });

  test("resumePendingChats isolates an explicit chat branch from sibling pending chats", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const calls: Array<{ chatJid: string; since: string }> = [];

    const ctx: WebPendingResumeContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({
        "web:default": "t-root",
        "web:default:branch:research": "t-branch",
      }),
      getKnownChatJids: () => ["web:default", "web:default:branch:research"],
      getDeferredQueuedFollowups: (chatJid) =>
        chatJid === "web:default:branch:research"
          ? [{ rowId: -1, queuedContent: "branch queued", threadId: null, queuedAt: "2026-01-01T00:00:00.000Z" }]
          : [{ rowId: -2, queuedContent: "root queued", threadId: null, queuedAt: "2026-01-01T00:00:01.000Z" }],
      getMessagesSince: (chatJid, since) => {
        calls.push({ chatJid, since });
        return chatJid === "web:default:branch:research" ? [{ id: "branch-msg" }] : [{ id: "root-msg" }];
      },
    };

    resumePendingChats(ctx, "web:default:branch:research", store);

    expect(calls).toEqual([{ chatJid: "web:default:branch:research", since: "t-branch" }]);
    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:default:branch:research"]);
  });

  test("resumePendingChats enqueues deferred-only queued followups", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];

    const ctx: WebPendingResumeContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({ "web:queue-only": "" }),
      getKnownChatJids: () => ["web:queue-only"],
      getDeferredQueuedFollowups: () => [{ rowId: -1, queuedContent: "queued after restart", threadId: null, queuedAt: "2026-01-01T00:00:00.000Z" }],
      getMessagesSince: () => [],
    };

    resumePendingChats(ctx, undefined, store);

    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:queue-only"]);
  });

  test("repeated resume_pending wakeups collapse to one queued observation per chat", async () => {
    const queue = new AgentQueue();
    const processed: string[] = [];
    let resolveRun: (() => void) | null = null;
    const runGate = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    const ctx: WebPendingResumeContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        queue.enqueue(task, key);
      },
      processChat: async (chatJid) => {
        processed.push(chatJid);
        await runGate;
      },
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({ "web:1": "t0" }),
      getKnownChatJids: () => ["web:1"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [{ id: "m1" }],
    };

    resumePendingChats(ctx, undefined, store);
    resumePendingChats(ctx, undefined, store);
    await waitFor(() => processed.length === 1, 250, 1);

    expect(processed).toEqual(["web:1"]);

    resolveRun?.();
    await queue.shutdown(50);
  });
});

test("pending discovery wakes attachment-only deferred input without interpreting its payload", () => {
  const keys: string[] = [];
  const context: WebPendingResumeContext = { assistantName: "Pi", defaultAgentId: "default", enqueue(_task,key){keys.push(key);}, async processChat(){} };
  const store: WebPendingResumeStore = { getAllChatCursors:()=>({}),getKnownChatJids:()=>["web:attachments"],getMessagesSince:()=>[],
    getDeferredQueuedFollowups:()=>[{rowId:-1,queuedContent:"",queuedAt:"2026-01-01T00:00:00.000Z",mediaIds:[99]}] };
  resumePendingChats(context,undefined,store);
  expect(keys).toEqual(["resume:web:attachments"]);
});
