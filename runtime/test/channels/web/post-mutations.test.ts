import { describe, expect, test } from "bun:test";
import type { InteractionRow } from "../../../src/db.js";
import {
  handleInternalPostRequest,
  handleUpdatePostRequest,
  type PostMutationsContext,
} from "../../../src/channels/web/post-mutations.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function interaction(id = 1): InteractionRow {
  return { id, data: {} } as unknown as InteractionRow;
}

function createContext(overrides: Partial<PostMutationsContext> = {}): PostMutationsContext {
  return {
    defaultChatJid: "web:default",
    lastCommandInteractionId: null,
    json: (payload, status = 200) => jsonResponse(payload, status),
    replaceMessageContent: () => interaction(10),
    broadcastInteractionUpdated: () => {},
    storeMessage: () => interaction(20),
    broadcastAgentResponse: () => {},
    ...overrides,
  };
}

describe("web post mutation helpers", () => {
  test("handleUpdatePostRequest validates id and body", async () => {
    const req = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: JSON.stringify({ content: "ok" }),
      headers: { "Content-Type": "application/json" },
    });

    const badIdRes = await handleUpdatePostRequest(req, null, createContext());
    expect(badIdRes.status).toBe(400);
    expect(await badIdRes.json()).toEqual({ error: "Missing or invalid post id" });

    const badJsonReq = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });
    const badJsonRes = await handleUpdatePostRequest(badJsonReq, 1, createContext());
    expect(badJsonRes.status).toBe(400);
    expect(await badJsonRes.json()).toEqual({ error: "Invalid JSON" });
  });

  test("handleUpdatePostRequest updates thread id and broadcasts", async () => {
    let setThread: { messageId: number; threadId: number } | null = null;
    let broadcasted = false;
    let usedChatJid: string | null = null;
    const ctx = createContext({
      replaceMessageContent: (chatJid, messageId, _content, threadId) => {
        usedChatJid = chatJid;
        setThread = { messageId, threadId: threadId! };
        return interaction(44);
      },
      broadcastInteractionUpdated: () => {
        broadcasted = true;
      },
    });

    const req = new Request("https://example.com/post/44?chat_jid=web%3Abranch", {
      method: "PATCH",
      body: JSON.stringify({ content: "updated", thread_id: 7 }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleUpdatePostRequest(req, 44, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", ok: true, id: 44 });
    expect(usedChatJid).toBe("web:branch");
    expect(setThread).toEqual({ messageId: 44, threadId: 7 });
    expect(broadcasted).toBeTrue();
  });

  test("handleInternalPostRequest validates content and broadcasts success", async () => {
    const missingReq = new Request("https://example.com/internal/post", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const missingRes = await handleInternalPostRequest(missingReq, createContext());
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toEqual({ error: "Missing content" });

    let usedThreadId: number | undefined;
    let usedChatJid: string | null = null;
    let broadcasted = false;
    const ctx = createContext({
      lastCommandInteractionId: 99,
      storeMessage: (chatJid, _content, _isBot, _mediaIds, options) => {
        usedChatJid = chatJid;
        usedThreadId = options?.threadId;
        return interaction(55);
      },
      broadcastAgentResponse: () => {
        broadcasted = true;
      },
    });

    const okReq = new Request("https://example.com/internal/post?chat_jid=web%3Abranch", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const okRes = await handleInternalPostRequest(okReq, ctx);

    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ status: "ok", ok: true, id: 55 });
    expect(usedChatJid).toBe("web:branch");
    expect(usedThreadId).toBe(99);
    expect(broadcasted).toBeTrue();
  });
});
