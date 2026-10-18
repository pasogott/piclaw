import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const [marker, pid] = process.argv.slice(2);
writeFileSync(pid!, String(process.pid));
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (!Object.hasOwn(message, "id")) continue;
  let result: unknown = {};
  if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo fixture", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }, annotations: { readOnlyHint: true } }] };
  else if (message.method === "tools/call") { appendFileSync(marker!, "call\n"); result = { content: [{ type: "text", text: message.params.arguments.message }] }; }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
}
