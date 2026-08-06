import { describe, expect, test } from "bun:test";

import type { InteractionRow } from "../../../../src/db.js";
import {
  WebMessageProcessingStorageService,
  type WebMessageProcessingStorageChannel,
} from "../../../../src/channels/web/messaging/message-processing-storage-service.js";

describe("WebMessageProcessingStorageService", () => {
  test("delegates processChat and normalizes null thread roots to undefined", async () => {
    const calls: Array<{ chatJid: string; agentId: string; threadRootId?: number }> = [];
    const service = new WebMessageProcessingStorageService(
      {
        pendingLinkPreviews: new Set<number>(),
        broadcastEvent: () => {},
      } as unknown as WebMessageProcessingStorageChannel,
      {
        defaultAgentId: "default",
        getAssistantName: () => "Pi",
        processChat: async (_channel, chatJid, agentId, threadRootId) => {
          calls.push({
            chatJid,
            agentId,
            ...(threadRootId !== undefined ? { threadRootId } : {}),
          });
        },
        storeWebMessage: () => null,
      },
    );

    await service.processChat("web:default", "agent-a", null);
    await service.processChat("web:branch", "agent-b", 77);

    expect(calls).toEqual([
      { chatJid: "web:default", agentId: "agent-a" },
      { chatJid: "web:branch", agentId: "agent-b", threadRootId: 77 },
    ]);
  });

  test("shapes default agent identity and persistence options for storeMessage", () => {
    const calls: Array<{
      params: {
        chatJid: string;
        content: string;
        isBot: boolean;
        mediaIds: number[];
        agentId: string;
        agentName: string;
        userName?: string | null;
      };
      options: {
        contentBlocks?: unknown[];
        linkPreviews?: unknown[];
        threadId?: number | null;
        isTerminalAgentReply?: boolean;
        isSteeringMessage?: boolean;
        removeProtectedContinuationForSourceMessageId?: string | null;
        consumeDeferredFollowupRowId?: number | null;
      };
    }> = [];
    let assistantName = "Pi";
    let userName = "Rui";
    const firstInteraction: InteractionRow = {
      id: 11,
      chat_jid: "web:default",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { type: "agent_response", content: "stored" },
    };
    const secondInteraction: InteractionRow = {
      id: 12,
      chat_jid: "web:default",
      timestamp: "2026-01-01T00:01:00.000Z",
      data: { type: "user_message", content: "stored again" },
    };

    const service = new WebMessageProcessingStorageService(
      {
        pendingLinkPreviews: new Set<number>(),
        broadcastEvent: () => {},
      } as unknown as WebMessageProcessingStorageChannel,
      {
        defaultAgentId: "default",
        getAssistantName: () => assistantName,
        getUserName: () => userName,
        processChat: async () => {},
        storeWebMessage: (_channel, params, options) => {
          calls.push({ params, options });
          return calls.length === 1 ? firstInteraction : secondInteraction;
        },
      },
    );

    const storedBot = service.storeMessage("web:default", "hello", true, [5, 6], {
      contentBlocks: [{ type: "text" }],
      linkPreviews: [{ url: "https://example.com" }],
      threadId: 42,
      isTerminalAgentReply: true,
      isSteeringMessage: true,
      removeProtectedContinuationForSourceMessageId: "source-1",
      consumeDeferredFollowupRowId: -1,
    });

    assistantName = "Pi Prime";
    userName = "Rui Carmo";
    const storedUser = service.storeMessage("web:default", "follow-up", false, [], {});

    expect(storedBot).toBe(firstInteraction);
    expect(storedUser).toBe(secondInteraction);
    expect(calls).toEqual([
      {
        params: {
          chatJid: "web:default",
          content: "hello",
          isBot: true,
          mediaIds: [5, 6],
          agentId: "default",
          agentName: "Pi",
          userName: "Rui",
        },
        options: {
          contentBlocks: [{ type: "text" }],
          linkPreviews: [{ url: "https://example.com" }],
          threadId: 42,
          isTerminalAgentReply: true,
          isSteeringMessage: true,
          removeProtectedContinuationForSourceMessageId: "source-1",
          consumeDeferredFollowupRowId: -1,
        },
      },
      {
        params: {
          chatJid: "web:default",
          content: "follow-up",
          isBot: false,
          mediaIds: [],
          agentId: "default",
          agentName: "Pi Prime",
          userName: "Rui Carmo",
        },
        options: {
          contentBlocks: undefined,
          linkPreviews: undefined,
          threadId: null,
          isTerminalAgentReply: undefined,
          isSteeringMessage: undefined,
          removeProtectedContinuationForSourceMessageId: undefined,
          consumeDeferredFollowupRowId: undefined,
        },
      },
    ]);
  });
});
