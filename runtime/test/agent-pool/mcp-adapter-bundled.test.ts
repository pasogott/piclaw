import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { setEnv } from "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";
import { hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../src/secure/mcp-keychain.js";
import { createRealTestModelServices } from "../model-services-fixture.js";
import { executeCall, executeDescribe, executeList, executeSearch, executeStatus } from "../../../node_modules/pi-mcp-adapter/proxy-modes.ts";
import { createMcpStatusSnapshot } from "../../../node_modules/pi-mcp-adapter/mcp-status.ts";

describe("bundled pi-mcp-adapter integration", () => {
  test("enforces proxy include/exclude policy on stale discovery and before transport", async () => {
    const callTool = mock(async () => ({ isError: false, content: [{ type: "text", text: "ok" }] }));
    const connection = {
      status: "connected",
      tools: [
        { name: "retrieve", description: "Read data", inputSchema: { type: "object" } },
        { name: "delete_entity", description: "Delete data", inputSchema: { type: "object" } },
      ],
      resources: [],
      prompts: [],
      client: { callTool, readResource: mock() },
    };
    const state = {
      config: {
        settings: { toolPrefix: "server" },
        mcpServers: {
          workiq: {
            command: "workiq.exe",
            includeTools: ["retrieve"],
            excludeTools: ["delete_entity"],
          },
        },
      },
      manager: {
        getConnection: mock(() => connection),
        getRequestOptions: mock(() => undefined),
        touch: mock(),
        incrementInFlight: mock(),
        decrementInFlight: mock(),
      },
      toolMetadata: new Map([["workiq", [
        { name: "workiq_retrieve", originalName: "retrieve", description: "Read data" },
        { name: "workiq_delete_entity", originalName: "delete_entity", description: "Delete data" },
      ]]]),
      resourceCounts: new Map(),
      serverInstructions: new Map(),
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;

    expect(executeList(state, "workiq").details).toMatchObject({ tools: ["workiq_retrieve"], count: 1 });
    expect(executeSearch(state, "delete").details).toMatchObject({ matches: [], count: 0 });
    expect(executeDescribe(state, "workiq_delete_entity").details).toMatchObject({ error: "tool_not_found" });
    expect(executeStatus(state).details).toMatchObject({ totalTools: 1 });
    expect(createMcpStatusSnapshot(state)).toMatchObject({ totalTools: 1 });

    const denied = await executeCall(state, "workiq_delete_entity", {});
    expect(denied.details).toMatchObject({ error: "tool_not_allowed", server: "workiq" });
    expect(callTool).not.toHaveBeenCalled();

    const allowed = await executeCall(state, "workiq_retrieve", { q: "status" });
    expect(allowed.content[0]?.text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  test("keeps the MCP proxy available when startup quarantines an invalid optional server", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-mcp-quarantine-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = join(tempRoot, "workspace");
    const storeDir = join(tempRoot, "store");
    const dataDir = join(tempRoot, "data");
    mkdirSync(join(workspaceDir, ".pi"), { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(workspaceDir, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: {
        broken: { bearerTokenKeychain: "broken/token" },
      },
    }));
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: workspaceDir, PICLAW_STORE: storeDir, PICLAW_DATA: dataDir });
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      await hydrateMcpKeychainCredentials(workspaceDir, async (name) => ({
        name,
        type: "token",
        secret: "unused",
        username: null,
      }));
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        cwd: workspaceDir,
      });
      const allTools = (runtime.session as any)._extensionRunner?.getAllRegisteredTools?.() ?? [];
      expect(allTools.some((tool: any) => tool.definition?.name === "mcp")).toBe(true);
      runtime.session.dispose?.();
    } finally {
      resetMcpStartupStateForTests();
      restoreEnv();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  test("registers the mcp proxy tool and slash commands for piclaw sessions", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-mcp-adapter-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = join(tempRoot, "workspace");
    const storeDir = join(tempRoot, "store");
    const dataDir = join(tempRoot, "data");
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: workspaceDir, PICLAW_STORE: storeDir, PICLAW_DATA: dataDir });
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        cwd: workspaceDir,
      });

      const session: any = runtime.session;
      const allTools = session._extensionRunner?.getAllRegisteredTools?.() ?? [];
      const mcpTool = allTools.find((t: any) => t.definition?.name === "mcp");
      expect(mcpTool).toBeTruthy();
      const tool = mcpTool;
      expect(typeof tool?.definition?.description).toBe("string");
      expect(tool.definition.description).toContain("MCP");

      expect(typeof session.extensionRunner?.getCommand).toBe("function");
      const mcpCommand = session.extensionRunner.getCommand("mcp");
      expect(mcpCommand).toBeTruthy();
      expect(typeof mcpCommand?.description).toBe("string");
      expect(mcpCommand.description).toContain("MCP");
      expect(session.extensionRunner.getCommand("mcp-auth")).toBeTruthy();

      session.dispose?.();
    } finally {
      restoreEnv();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
