import "../helpers.js";

import { describe, expect, test } from "bun:test";

import {
  CORE_EARENDIL_FACTORY_TARGETS,
  DYNAMIC_TOOL_PREPARATION_TEMPLATES,
  MESSAGES_ACTIVATION_BLOCKER,
  TOOL_PREPARATION_MANIFEST,
} from "../../src/service-effects/tool-preparation/manifest.js";
import { validateToolPreparationManifest } from "../../src/service-effects/tool-preparation/validator.js";
import {
  formatMcpFixtureToolName,
  inventoryRepositoryToolFamilies,
  resolveAddonExtensionFixture,
  resolveMcpDirectFixture,
} from "./fixtures/repository-tool-family-oracle.js";

const SPEC_FIELDS = [
  "toolName",
  "currentSource",
  "effectClass",
  "replay",
  "contextFields",
  "serviceEffector",
  "abortExpectation",
  "protectedFields",
].sort();
const TEMPLATE_NAMES = DYNAMIC_TOOL_PREPARATION_TEMPLATES.map((row) => row.toolName);

describe("WP-3C latent tool preparation manifest", () => {
  test("independent repository source oracle resolves every registration", () => {
    const inventory = inventoryRepositoryToolFamilies();
    expect(inventory.unresolvedRegistrations).toEqual([]);
    expect(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort()).toEqual([...inventory.names]);
    expect(inventory.registrationSites.get("cdp_browser")).toEqual([
      "extensions/browser/cdp-browser-tool/index.ts",
      "extensions/browser/cdp-browser/index.ts",
    ]);
  });

  test("validates exact fields, exact repository coverage, and conservative templates", () => {
    const inventory = inventoryRepositoryToolFamilies();
    const combined = [...TOOL_PREPARATION_MANIFEST, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES];
    expect(validateToolPreparationManifest(combined, {
      knownToolNames: inventory.names,
      dynamicTemplateNames: TEMPLATE_NAMES,
      rejectUnexpectedExactTools: true,
    })).toEqual([]);
    for (const row of combined) expect(Object.keys(row).sort()).toEqual(SPEC_FIELDS);
  });

  test("a dynamic template cannot satisfy a missing repository-owned exact name", () => {
    const withoutRead = TOOL_PREPARATION_MANIFEST.filter((row) => row.toolName !== "read");
    const issues = validateToolPreparationManifest([...withoutRead, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES], {
      knownToolNames: inventoryRepositoryToolFamilies().names,
      dynamicTemplateNames: TEMPLATE_NAMES,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "read" }));
  });

  test("rejects duplicate, widened-context, and unsafe mixed rows", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const issues = validateToolPreparationManifest([
      read,
      read,
      { ...read, toolName: "widened", contextFields: ["env", "harness"] },
      { ...read, toolName: "unsafe", effectClass: "mixed", replay: "safe" },
      { ...read, toolName: " padded " },
      { ...read, toolName: "extra", unexpected: true },
    ]);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "duplicate_tool_name",
      "invalid_tool_name",
      "invalid_context_fields",
      "unsafe_replay",
      "unexpected_field",
    ]));
  });

  test("keeps every current mutation never and every EF reference closed", () => {
    const mutations = TOOL_PREPARATION_MANIFEST.filter((row) => row.effectClass !== "query");
    expect(mutations.length).toBeGreaterThan(0);
    expect(new Set(mutations.map((row) => row.replay))).toEqual(new Set(["never"]));
    expect(new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.serviceEffector).filter(Boolean))).toEqual(
      new Set(["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"]),
    );
    for (const toolName of ["refresh_workspace_index", "open_workspace_file", "exit_process"]) {
      expect(TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === toolName)?.serviceEffector).toBe("EF-S05");
    }
  });

  test("records core public factory targets without constructing future tools", () => {
    expect(CORE_EARENDIL_FACTORY_TARGETS).toEqual({
      read: "createReadTool",
      write: "createWriteTool",
      edit: "createEditTool",
      bash: "createBashTool",
    });
    for (const name of ["grep", "find", "ls"]) {
      const row = TOOL_PREPARATION_MANIFEST.find((candidate) => candidate.toolName === name)!;
      expect(row.currentSource).toContain("no branch-local direct constructor");
      expect(row).toMatchObject({ effectClass: "query", replay: "safe", contextFields: ["env"] });
    }
  });

  test("keeps messages activation-blocked with no invented EF authority", () => {
    expect(TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "messages")).toMatchObject({
      effectClass: "mixed",
      replay: "never",
      serviceEffector: null,
    });
    expect(MESSAGES_ACTIVATION_BLOCKER).toContain("add/post are future EF-S03 candidates");
    expect(MESSAGES_ACTIVATION_BLOCKER).toContain("delete/move");
  });
});

describe("WP-3C hermetic add-on and MCP fixtures", () => {
  test("uses only package pi.extensions and never main as a fallback", () => {
    expect(resolveAddonExtensionFixture({
      manifest: { name: "@fixture/scoped-addon", main: "ignored.ts", pi: { extensions: ["extension.ts", "missing.ts"] } },
      files: ["ignored.ts", "extension.ts"],
    })).toEqual(["extension.ts"]);
    expect(resolveAddonExtensionFixture({ manifest: { main: "ignored.ts" }, files: ["ignored.ts"] })).toEqual([]);
    expect(resolveAddonExtensionFixture({ manifest: "malformed", files: [] })).toEqual([]);
  });

  test("normalizes all MCP prefixes without loading adapter or server code", () => {
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "server")).toBe("agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "short")).toBe("agent_board_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "mcp")).toBe("mcp__agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "none")).toBe("read_item");
  });

  test("applies direct selection, filters, resources, builtin collision, and first duplicate wins", () => {
    const names = resolveMcpDirectFixture([
      {
        name: "demo-mcp",
        directTools: true,
        tools: ["search", "secret", "read"],
        resources: ["Run Book"],
        includeTools: ["demo_mcp_*"],
        excludeTools: ["demo_secret"],
      },
      { name: "demo", directTools: ["search"], tools: ["search", "write"] },
      { name: "hidden-mcp", directTools: true, tools: [], resources: ["Private"], exposeResources: false },
      { name: "disabled", directTools: false, tools: ["ignored"] },
    ], "short", new Set(["demo_read"]));
    expect(names).toEqual(["demo_search", "demo_read_Run_Book"]);
  });

  test("does not freeze arbitrary fixture add-on or MCP names into exact rows", () => {
    const exactNames = new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName));
    expect(exactNames.has("fixture_addon_tool")).toBeFalse();
    expect(exactNames.has("demo_search")).toBeFalse();
    expect(TEMPLATE_NAMES).toEqual(["<addon-tool>", "<mcp-direct-tool>"]);
  });
});
