import { AsyncLocalStorage } from "node:async_hooks";
import { Type } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { McpClient } from "@earendil-works/pi-mcp";
import { getMcpBridgeReadSnapshot, acquireMcpSessionBridge, assertMcpBridgeSourcesCurrent } from "../../src/secure/mcp-keychain.js";
import { readMcpInstancePolicy } from "../../src/core/config-mcp.js";
import { planMcpEnginePolicy } from "../../src/agent-pool/mcp-engine-plan.js";
import { createNativeStdio } from "../../src/agent-pool/mcp-native-stdio.js";
import { constrainNativeTransport } from "../../src/agent-pool/mcp-native-transport.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";

/** Startup-owned, tools-only stdio profile. No adapter fallback or live apply. */
export async function createHostMcp(options: {
  assertCurrent(): void;
  captureSource(api: ToolExecutionApi): Promise<() => void>;
}) {
  const snapshot = getMcpBridgeReadSnapshot();
  const policy = readMcpInstancePolicy();
  const enabled = Object.entries(snapshot.adapterConfig.mcpServers).filter(([, server]) => server.disabled !== true);
  const tools: ReturnType<typeof defineTool>[] = [];
  const closes: (() => Promise<void>)[] = [];
  let sealed = false;
  let closing: Promise<void> | undefined;
  const scope = new AsyncLocalStorage<{ name: string; assertCurrent(): void; signal?: AbortSignal }>();
  const assertCurrent = () => {
    options.assertCurrent();
    if (sealed || getMcpBridgeReadSnapshot().revision !== snapshot.revision || readMcpInstancePolicy().revision !== policy.revision) throw Error("Native MCP owner is no longer current");
    assertMcpBridgeSourcesCurrent();
  };
  const lease = acquireMcpSessionBridge();
  const close = () => {
    sealed = true;
    return closing ??= (async () => {
      const results = await Promise.allSettled(closes.map(close => close()));
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(r => r.reason), "Native MCP cleanup uncertain");
      lease.release();
    })();
  };
  try {
    // Empty configuration has no effect, including on historical Adapter profiles.
    if (enabled.length || snapshot.dryRun.rows.some(row => row.status === "quarantined") || [...snapshot.diagnostics, ...snapshot.dryRun.diagnostics].some(row => row.serverName === "(configuration)")) {
      const plan = planMcpEnginePolicy(policy.policy, snapshot, { native: true, adapter: false, codemode: true });
      if (policy.policy.engine !== "native" || !plan.applicable || !plan.codemodeEnabled) throw Error("Durable MCP requires explicit Native engine and codemode-compatible configuration");
      const allowed = new Set(["command", "args", "cwd", "env", "disabled", "directTools"]);
      for (const [name, original] of enabled) {
        const projected = snapshot.nativePreview.servers.find(server => server.name === name);
        const reference = (v: unknown): boolean => typeof v === "string" && /\$|\{env:|^!/.test(v);
        if (!projected || !("command" in projected.config) || Object.keys(original).some(key => !allowed.has(key)) || original.directTools === true ||
          reference(original.command) || reference(original.cwd) || original.args?.some(reference) || Object.values(original.env ?? {}).some(reference) || !/^[A-Za-z0-9_]+$/.test(name)) throw Error("Durable MCP supports only literal, mapped stdio tool configuration");
      }
      // Validate the entire configuration before starting any process.
      for (const [name] of enabled) {
        assertCurrent();
        const server = snapshot.nativePreview.servers.find(server => server.name === name)!.config;
        if (!("command" in server)) throw Error("Native stdio required");
        const declarations = new Set<string>();
        const raw = createNativeStdio({ command: server.command, args: server.args ? [...server.args] : undefined, cwd: server.cwd, env: { ...server.env },
          assertStart: assertCurrent,
          assertSend(message) {
            assertCurrent();
            if ("method" in message && message.method === "tools/call") {
              const call = scope.getStore();
              if (!call || !declarations.has(call.name) || (message.params as any)?.name !== call.name) throw Error("Native MCP call authority unavailable");
              call.signal?.throwIfAborted();
              call.assertCurrent(); // immediately before the actual stdin write
            }
          },
        });
        const constrained = constrainNativeTransport(raw);
        const client = new McpClient({ name: "piclaw-durable", version: "1", requestTimeoutMs: 10000 });
        closes.push(async () => {
          const results = await Promise.allSettled([client.close(), constrained.close()]);
          const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
          if (failure) throw failure.reason;
        });
        await client.connect(constrained.transport);
        for (const declaration of await client.listTools({ timeoutMs: 10000 })) {
          if (!/^[A-Za-z0-9_]+$/.test(declaration.name) || declarations.has(declaration.name) || declaration.inputSchema?.type !== "object") throw Error("Unsupported native MCP tool declaration");
          declarations.add(declaration.name);
          const toolName = `mcp__${name}__${declaration.name}`;
          if (tools.some(tool => tool.name === toolName)) throw Error("Duplicate native MCP tool name");
          tools.push(defineTool<ReturnType<typeof Type.Unsafe<Record<string, unknown>>>>({ name: toolName, description: declaration.description ?? toolName,
            parameters: Type.Unsafe<Record<string, unknown>>(JSON.parse(JSON.stringify(declaration.inputSchema))),
            structuredOutputSchema: Type.Any(), callers: ["tools"], replay: "unsafe",
            async execute(args, api, context) {
              const guard = await options.captureSource(api);
              const check = () => { assertCurrent(); context.abortSignal?.throwIfAborted(); guard(); };
              check();
              let result;
              try { result = await scope.run({ name: declaration.name, assertCurrent: check, signal: context.abortSignal }, () => client.callTool(declaration.name, args, { signal: context.abortSignal, timeoutMs: 10000 })); }
              catch { throw Error("Host MCP request failed"); }
              check();
              // Project only supported public content, never server diagnostics/private fields.
              if (result.content.some(block => block.type !== "text")) throw Error("Unsupported MCP result content");
              return { output: result.content.map(block => ({ type: "text" as const, text: (block as { text: string }).text })), structuredOutput: { content: result.content.map(block => ({ type: "text", text: (block as { text: string }).text })), ...(result.isError ? { isError: true } : {}), ...(result.structuredContent ? { structuredContent: result.structuredContent as JsonValue } : {}) } };
            },
          }));
        }
      }
    }
    return { tools, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new RuntimeStartupCleanupError([error, cleanup], "Native MCP startup cleanup uncertain"); }
    throw error;
  }
}
