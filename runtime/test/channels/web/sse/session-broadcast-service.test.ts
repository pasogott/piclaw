import { expect, test } from "bun:test";

import type { AgentPool } from "../../../../src/agent-pool.js";
import { WebSessionBroadcastService } from "../../../../src/channels/web/sse/session-broadcast-service.js";

test("session broadcast service delegates SSE fanout and binds sessions through the shared ui bridge", async () => {
  let installedBinder: ((session: unknown, chatJid: string) => Promise<void> | void) | undefined;
  let providerUsageListener: ((event: unknown) => void) | undefined;
  const handledRequests: Request[] = [];
  const broadcastCalls: Array<{ eventType: string; data: unknown }> = [];
  const bindCalls: Array<{ session: unknown; chatJid: string }> = [];
  const response = new Response("sse");

  const service = new WebSessionBroadcastService(
    {
      setSessionBinder: (binder?: (session: unknown, chatJid: string) => Promise<void> | void) => {
        installedBinder = binder;
      },
      setProviderUsageRefreshListener: (listener: (event: unknown) => void) => {
        providerUsageListener = listener;
      },
    } as unknown as AgentPool,
    {
      sse: {
        clients: new Set(),
        handleRequest: (req?: Request) => {
          handledRequests.push(req as Request);
          return response;
        },
        broadcast: (eventType: string, data: unknown) => {
          broadcastCalls.push({ eventType, data });
        },
        closeAll: () => {},
      } as any,
      uiBridge: {
        bindSession: async (session: unknown, chatJid: string) => {
          bindCalls.push({ session, chatJid });
        },
        stop: () => {},
      } as any,
    }
  );

  expect(service.handleSse(new Request("https://example.test/sse/stream?chat_jid=web:branch-a"))).toBe(response);
  expect(handledRequests).toHaveLength(1);

  service.broadcastEvent("agent_status", { chat_jid: "web:branch-a", type: "thinking" });
  expect(broadcastCalls).toEqual([
    { eventType: "agent_status", data: { chat_jid: "web:branch-a", type: "thinking" } },
  ]);

  expect(installedBinder).toBeDefined();
  const session = { id: "session-1" };
  await installedBinder?.(session, "web:branch-a");
  expect(bindCalls).toEqual([{ session, chatJid: "web:branch-a" }]);
  providerUsageListener?.({
    chat_jid: "web:branch-a",
    current: "zai/glm-4",
    provider_usage: { provider: "zai", plan: "pro" },
  });
  expect(broadcastCalls.at(-1)).toEqual({
    eventType: "model_changed",
    data: {
      chat_jid: "web:branch-a",
      current: "zai/glm-4",
      provider_usage: { provider: "zai", plan: "pro" },
    },
  });
  expect(service.uiBridge).toBeDefined();
  expect(service.sse).toBeDefined();
});
