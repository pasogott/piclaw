import { describe, expect, test } from "bun:test";
import {
  queueFollowupPlaceholderMessage,
  replaceQueuedFollowupPlaceholderMessage,
  sendWebMessage,
  type MessageWriteContext,
} from "../../../../src/channels/web/messaging/message-write-flows.js";

describe("web message write flows", () => {
  test("sendWebMessage stores and broadcasts agent responses and can force thread roots", () => {
    const events: string[] = [];
    const context: MessageWriteContext = {
      defaultAgentId: "default",
      store: {
        storeMessage: (_chat, _text, _bot, _media, options) => {
          expect(options).toEqual({ threadToSelf: true });
          return { id: 42, timestamp: "2026-01-01T00:00:00.000Z", data: { type: "agent_response", content: "hello" } };
        },
        replaceMessageContent: () => null,
      },
      broadcaster: {
        broadcastAgentResponse: (interaction) => events.push(`broadcast:${interaction.id}`),
        broadcastInteractionUpdated: () => {},
      },
      followups: {
        enqueue: () => {},
      },
    };

    sendWebMessage("web:default", "hello", { forceRoot: true }, context);

    expect(events).toEqual(["broadcast:42"]);
  });

  test("queueFollowupPlaceholderMessage enqueues placeholders without broadcasting", () => {
    const events: string[] = [];
    const context: MessageWriteContext = {
      defaultAgentId: "default",
      store: {
        storeMessage: () => ({
          id: 7,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content: "queued" },
        }),
        replaceMessageContent: () => null,
      },
      broadcaster: {
        broadcastAgentResponse: (interaction) => events.push(`broadcast:${interaction.id}`),
        broadcastInteractionUpdated: () => {},
      },
      followups: {
        enqueue: (chatJid, rowId) => events.push(`enqueue:${chatJid}:${rowId}`),
      },
    };

    const interaction = queueFollowupPlaceholderMessage("web:default", "queued", 99, context);

    expect(interaction?.id).toBe(7);
    expect(events).toEqual(["enqueue:web:default:7"]);
  });

  test("replaceQueuedFollowupPlaceholderMessage updates interaction metadata and broadcasts", () => {
    const events: string[] = [];
    const context: MessageWriteContext = {
      defaultAgentId: "default",
      store: {
        storeMessage: () => null,
        replaceMessageContent: () => ({
          id: 55,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content: "updated" },
        }),
      },
      broadcaster: {
        broadcastAgentResponse: () => {},
        broadcastInteractionUpdated: (interaction) => events.push(`updated:${interaction.id}`),
      },
      followups: {
        enqueue: () => {},
      },
    };

    const interaction = replaceQueuedFollowupPlaceholderMessage(
      "web:default",
      55,
      "updated",
      [],
      undefined,
      123,
      context
    );

    expect(interaction?.data.agent_id).toBe("default");
    expect(interaction?.data.thread_id).toBe(123);
    expect(events).toEqual(["updated:55"]);
  });
});
