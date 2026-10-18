import { expect, test } from "bun:test";
import { handleAgentCommandsRequest } from "../../../../src/channels/web/agent/agent-commands.js";

for (const bound of [true, false]) test(`durable command discovery never hydrates legacy sessions; bound=${bound}`, async () => {
  const options: any = { defaultChatJid: "web:default", json: (value: unknown, status = 200) => Response.json(value, { status }), agentPool: {
    async getDurableSessionMetadata(chat: string) { expect(chat).toBe("web:default"); return bound ? { backend: "durable", tools: [], extensions: ["unadvertised-addon"] } : null; },
    getSessionForIntrospection: async () => { throw Error("Legacy hydration forbidden"); },
  } };
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands"), options);
  expect(response.status).toBe(bound ? 200 : 404);
  if (bound) {
    const result = await response.json() as any;
    expect(result.backend).toBe("durable");
    expect(result.commands.some((command: any) => command.name === "/model")).toBe(true);
    expect(result.commands.some((command: any) => command.name === "/passkeys")).toBe(true);
    expect(result.commands.some((command: any) => command.name === "unadvertised-addon")).toBe(false);
    expect(new Set(result.commands.map((command: any) => command.name.toLowerCase())).size).toBe(result.commands.length);
  }
  expect(response.headers.get("server-timing")).toContain("agent_commands");
});
