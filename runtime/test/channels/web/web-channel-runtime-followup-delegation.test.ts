import { afterEach, describe, expect, test } from "bun:test";

import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("WebChannel runtime/follow-up facade delegation", () => {
  test("delegates remaining queued-followup and runtime-state wrapper methods to the extracted facade service", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];
    const placeholder = { id: 21, timestamp: "t", data: { type: "agent_response" } };
    const replaced = { id: 22, timestamp: "t", data: { type: "agent_response" } };
    const queuedItem = { rowId: 31, queuedContent: "queued", threadId: 4, queuedAt: "2026-03-28T00:00:00.000Z" };
    const buffer = { text: "buffer text", totalLines: 5 };
    const status = { type: "intent", title: "Thinking" };

    (fixture.channel as unknown as { runtimeFollowupFacade: unknown }).runtimeFollowupFacade = {
      sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
        calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
      },
      postDashboardWidget: async (chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }) => {
        calls.push(`widget:${chatJid}:${options?.threadId ?? "null"}:${options?.widgetId ?? ""}`);
      },
      queueFollowupPlaceholder: (chatJid: string, text: string, threadId?: number, queuedContent?: string) => {
        calls.push(`queue:${chatJid}:${text}:${threadId ?? "null"}:${queuedContent ?? ""}`);
        return placeholder;
      },
      enqueueQueuedFollowupItem: (
        chatJid: string,
        rowId: number,
        queuedContent: string,
        threadId?: number | null,
        queuedAt?: string,
        extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
      ) => {
        calls.push(`enqueue:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt ?? ""}:${extras?.mediaIds?.join(",") ?? ""}`);
        return 44;
      },
      peekQueuedFollowupItem: (chatJid: string) => {
        calls.push(`peek-item:${chatJid}`);
        return queuedItem;
      },
      consumeQueuedFollowupItem: (chatJid: string) => {
        calls.push(`consume-item:${chatJid}`);
        return queuedItem;
      },
      prependQueuedFollowupItem: (chatJid: string, item: typeof queuedItem) => {
        calls.push(`prepend:${chatJid}:${item.rowId}`);
      },
      replaceQueuedFollowupItem: (chatJid: string, item: typeof queuedItem) => {
        calls.push(`replace-item:${chatJid}:${item.rowId}`);
        return true;
      },
      consumeQueuedFollowupPlaceholder: (chatJid: string) => {
        calls.push(`consume-placeholder:${chatJid}`);
        return 45;
      },
      getQueuedFollowupCount: (chatJid: string) => {
        calls.push(`count:${chatJid}`);
        return 2;
      },
      getQueuedFollowupItems: (chatJid: string) => {
        calls.push(`items:${chatJid}`);
        return [queuedItem];
      },
      removeQueuedFollowupItem: (chatJid: string, rowId: number) => {
        calls.push(`remove:${chatJid}:${rowId}`);
        return queuedItem;
      },
      queuePendingSteering: (chatJid: string, timestamp: string | undefined) => {
        calls.push(`pending-queue:${chatJid}:${timestamp ?? ""}`);
      },
      consumePendingSteering: (chatJid: string) => {
        calls.push(`pending-consume:${chatJid}`);
        return ["2026-03-28T00:03:00.000Z"];
      },
      updateAgentStatus: (chatJid: string, nextStatus: Record<string, unknown>) => {
        calls.push(`status-update:${chatJid}:${String(nextStatus.title ?? "")}`);
      },
      getAgentStatus: (chatJid: string) => {
        calls.push(`status-get:${chatJid}`);
        return status;
      },
      replaceQueuedFollowupPlaceholder: (
        chatJid: string,
        rowId: number,
        text: string,
        mediaIds: number[],
        _contentBlocks: Array<Record<string, unknown>> | undefined,
        threadId?: number,
        isTerminalAgentReply?: boolean,
      ) => {
        calls.push(`replace:${chatJid}:${rowId}:${text}:${mediaIds.join(",")}:${threadId ?? "null"}:${isTerminalAgentReply ? 1 : 0}`);
        return replaced;
      },
      getThreadRootId: (chatJid: string, messageId: string) => {
        calls.push(`thread-root:${chatJid}:${messageId}`);
        return 52;
      },
      resumeChat: (chatJid: string, threadRootId?: number | null) => {
        calls.push(`resume:${chatJid}:${threadRootId ?? "null"}`);
      },
      skipFailedOnModelSwitch: (chatJid: string) => {
        calls.push(`skip-failed:${chatJid}`);
      },
      recoverInflightRuns: () => {
        calls.push("recover");
      },
      resumePendingChats: (chatJid?: string) => {
        calls.push(`resume-pending:${chatJid ?? ""}`);
      },
      loadState: () => {
        calls.push("load");
      },
      saveState: () => {
        calls.push("save");
      },
      setPanelExpanded: (turnId: string, panel: "thought" | "draft", expanded: boolean) => {
        calls.push(`panel-set:${turnId}:${panel}:${expanded}`);
      },
      isPanelExpanded: (turnId: string, panel: "thought" | "draft") => {
        calls.push(`panel-get:${turnId}:${panel}`);
        return true;
      },
      updateThoughtBuffer: (turnId: string, text: string, totalLines: number) => {
        calls.push(`thought:${turnId}:${text}:${totalLines}`);
      },
      updateDraftBuffer: (turnId: string, text: string, totalLines: number) => {
        calls.push(`draft:${turnId}:${text}:${totalLines}`);
      },
      getBuffer: (turnId: string, panel: "thought" | "draft") => {
        calls.push(`buffer:${turnId}:${panel}`);
        return buffer;
      },
    };

    await fixture.channel.sendMessage("web:test", "hello", { threadId: 9 });
    await fixture.channel.postDashboardWidget("web:test", { threadId: 8, widgetId: "widget-facade" });
    expect(fixture.channel.queueFollowupPlaceholder("web:test", "queued", 7, "later")).toBe(placeholder);
    expect(fixture.channel.enqueueQueuedFollowupItem("web:test", 0, "queued", 6, "2026-03-28T00:00:00.000Z", { mediaIds: [1, 2] })).toBe(44);
    expect(fixture.channel.peekQueuedFollowupItem("web:test")).toBe(queuedItem);
    expect(fixture.channel.consumeQueuedFollowupItem("web:test")).toBe(queuedItem);
    fixture.channel.prependQueuedFollowupItem("web:test", queuedItem);
    expect(fixture.channel.replaceQueuedFollowupItem("web:test", queuedItem)).toBe(true);
    expect(fixture.channel.consumeQueuedFollowupPlaceholder("web:test")).toBe(45);
    expect(fixture.channel.getQueuedFollowupCount("web:test")).toBe(2);
    expect(fixture.channel.getQueuedFollowupItems("web:test")).toEqual([queuedItem]);
    expect(fixture.channel.removeQueuedFollowupItem("web:test", 31)).toBe(queuedItem);
    fixture.channel.queuePendingSteering("web:test", "2026-03-28T00:04:00.000Z");
    expect(fixture.channel.consumePendingSteering("web:test")).toEqual(["2026-03-28T00:03:00.000Z"]);
    fixture.channel.updateAgentStatus("web:test", status);
    expect(fixture.channel.getAgentStatus("web:test")).toEqual(status);
    expect(fixture.channel.replaceQueuedFollowupPlaceholder("web:test", 22, "updated", [1, 2], [{ type: "text" }], 6, true)).toBe(replaced);
    expect(fixture.channel.getThreadRootId("web:test", "m-1")).toBe(52);
    fixture.channel.resumeChat("web:test", 12);
    fixture.channel.skipFailedOnModelSwitch("web:test");
    fixture.channel.recoverInflightRuns();
    fixture.channel.resumePendingChats("web:test");
    fixture.channel.loadState();
    fixture.channel.saveState();
    fixture.channel.setPanelExpanded("turn-1", "thought", true);
    expect(fixture.channel.isPanelExpanded("turn-1", "thought")).toBe(true);
    fixture.channel.updateThoughtBuffer("turn-1", "thought text", 3);
    fixture.channel.updateDraftBuffer("turn-1", "draft text", 4);
    expect(fixture.channel.getBuffer("turn-1", "thought")).toEqual(buffer);

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "widget:web:test:8:widget-facade",
      "queue:web:test:queued:7:later",
      "enqueue:web:test:0:queued:6:2026-03-28T00:00:00.000Z:1,2",
      "peek-item:web:test",
      "consume-item:web:test",
      "prepend:web:test:31",
      "replace-item:web:test:31",
      "consume-placeholder:web:test",
      "count:web:test",
      "items:web:test",
      "remove:web:test:31",
      "pending-queue:web:test:2026-03-28T00:04:00.000Z",
      "pending-consume:web:test",
      "status-update:web:test:Thinking",
      "status-get:web:test",
      "replace:web:test:22:updated:1,2:6:1",
      "thread-root:web:test:m-1",
      "resume:web:test:12",
      "skip-failed:web:test",
      "recover",
      "resume-pending:web:test",
      "load",
      "save",
      "panel-set:turn-1:thought:true",
      "panel-get:turn-1:thought",
      "thought:turn-1:thought text:3",
      "draft:turn-1:draft text:4",
      "buffer:turn-1:thought",
    ]);
  });
});
