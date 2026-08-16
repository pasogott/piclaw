import "../helpers.js";

import { describe, expect, test } from "bun:test";

import {
  CORE_EARENDIL_FACTORY_TARGETS,
  DYNAMIC_TOOL_PREPARATION_TEMPLATES,
  MESSAGES_ACTIVATION_BLOCKER,
  TOOL_PREPARATION_MANIFEST,
} from "../../src/service-effects/tool-preparation/manifest.js";
import {
  getToolPreparationPolicy,
  listToolPreparationPolicies,
} from "../../src/service-effects/tool-preparation/policy.js";
import {
  normalizeToolPreparationManifest,
  validateToolPreparationManifest,
} from "../../src/service-effects/tool-preparation/validator.js";
import type { ToolPreparationSpec } from "../../src/service-effects/tool-preparation/types.js";
import { resolveAddonPackageTree, type VirtualPackageTree } from "./fixtures/addon-package-tree-oracle.js";
import {
  formatMcpFixtureToolName,
  resolveMcpMetadataFixture,
  resourceNameToToolName,
} from "./fixtures/mcp-metadata-oracle.js";
import {
  inventoryRepositoryToolFamilies,
  type SourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const SPEC_FIELDS = [
  "toolName", "currentSource", "effectClass", "replay", "contextFields",
  "serviceEffector", "abortExpectation", "protectedFields",
].sort();
const TEMPLATE_NAMES = DYNAMIC_TOOL_PREPARATION_TEMPLATES.map((row) => row.toolName);

function freshMcpCache(
  serverName: string,
  metadata: { readonly tools?: readonly Record<string, unknown>[]; readonly resources?: readonly Record<string, unknown>[] } = {},
) {
  return { definitionHash: `hash:${serverName}`, cachedAt: 1_000, ...metadata };
}

function fixtureSpecs(names: readonly string[]): ToolPreparationSpec[] {
  return names.map((toolName) => ({
    toolName,
    currentSource: "hermetic production-composition fixture",
    effectClass: "query",
    replay: "safe",
    contextFields: [],
    serviceEffector: null,
    abortExpectation: "may_finish_late",
    protectedFields: [],
  }));
}

function compositionTree(optionalFiles: readonly string[] = ["one.ts"], builtinEntries = "alwaysOn"): SourceTree {
  const optionalEntries = optionalFiles
    .map((file) => `{ path: resolve(EXTENSIONS_DIR, "optional", "${file}") }`)
    .join(", ");
  return {
    files: {
      "src/extensions/index.ts": `
        import { alwaysOn } from "./always.js";
        export function createBuiltinExtensionFactories() { return [${builtinEntries}]; }
      `,
      "src/extensions/always.ts": `export const alwaysOn = (pi: any) => pi.registerTool({ name: "fixture_always" });`,
      "src/agent-pool/session.ts": `
        const OPTIONAL_EXTENSIONS = [${optionalEntries}];
      `,
      "extensions/optional/one.ts": `export default (pi: any) => pi.registerTool({ name: "fixture_optional" });`,
      "extensions/optional/two.ts": `export default (pi: any) => pi.registerTool({ name: "fixture_new_optional" });`,
      "extensions/unreferenced.ts": `export default (pi: any) => { pi.registerTool({ name: "fixture_unreferenced" }); pi.registerTool({ name: "fixture_always" }); };`,
    },
  };
}

describe("WP-3C production-root coverage oracle", () => {
  test("matches exact repository rows from authoritative production composition", () => {
    const inventory = inventoryRepositoryToolFamilies();
    expect(inventory.unresolvedRegistrations).toEqual([]);
    expect(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort()).toEqual([...inventory.names]);
    expect(inventory.registrationSites.get("cdp_browser")).toEqual(["extensions/browser/cdp-browser-tool/index.ts"]);
    expect(inventory.nonProductionDuplicateSites.get("cdp_browser")).toEqual(["extensions/browser/cdp-browser/index.ts"]);
    expect(inventory.sdkToolFamilies).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
    const compositionCategories = {
      builtin: inventory.compositionRoots.filter((root) => root.startsWith("src/extensions/")),
      optional: inventory.compositionRoots.filter((root) => root.startsWith("extensions/")),
      service: inventory.compositionRoots.filter((root) => root === "src/agent-pool/service-factory.ts"),
    };
    expect(Object.fromEntries(Object.entries(compositionCategories).map(([category, roots]) => [category, roots.length]))).toEqual({
      builtin: 29,
      optional: 9,
      service: 1,
    });
    expect(inventory.compositionRoots).toHaveLength(Object.values(compositionCategories).flat().length);

    const manifestByName = new Map(TOOL_PREPARATION_MANIFEST.map((row) => [row.toolName, row]));
    expect(inventory.registrationSites.size).toBe(65);
    for (const [toolName, sites] of inventory.registrationSites) {
      const currentSource = manifestByName.get(toolName)?.currentSource;
      expect(currentSource).toBeDefined();
      for (const site of sites) expect(currentSource).toContain(`runtime/${site}`);
    }
    for (const toolName of inventory.sdkToolFamilies) {
      expect(manifestByName.get(toolName)?.currentSource).toContain("@earendil-works/pi-coding-agent");
    }
    expect(inventory.registrationSites.has("mcp")).toBeFalse();
    expect(manifestByName.get("mcp")?.currentSource).toContain("pi-mcp-adapter");
  });

  test("ignores an unreferenced registration", () => {
    const inventory = inventoryRepositoryToolFamilies(compositionTree());
    expect(inventory.names).toContain("fixture_always");
    expect(inventory.names).toContain("fixture_optional");
    expect(inventory.names).not.toContain("fixture_unreferenced");
    expect(inventory.registrationSites.get("fixture_always")).toEqual(["src/extensions/always.ts"]);
    expect(inventory.nonProductionDuplicateSites.get("fixture_always")).toEqual(["extensions/unreferenced.ts"]);
  });

  test("a newly referenced optional registration fails exact coverage", () => {
    const baseline = inventoryRepositoryToolFamilies(compositionTree());
    const changed = inventoryRepositoryToolFamilies(compositionTree(["one.ts", "two.ts"]));
    const issues = validateToolPreparationManifest(fixtureSpecs(baseline.names), {
      knownToolNames: changed.names,
      enforceAuthoritativePolicy: false,
    });
    expect(changed.names).toContain("fixture_new_optional");
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "fixture_new_optional" }));
  });

  test("removing an always-on production root makes its row unexpected", () => {
    const baseline = inventoryRepositoryToolFamilies(compositionTree());
    const changed = inventoryRepositoryToolFamilies(compositionTree(undefined, ""));
    const issues = validateToolPreparationManifest(fixtureSpecs(baseline.names), {
      knownToolNames: changed.names,
      rejectUnexpectedExactTools: true,
      enforceAuthoritativePolicy: false,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "unexpected_exact_tool", toolName: "fixture_always" }));
  });
});

describe("WP-3C closed manifest policy and hostile-safe normalization", () => {
  test("normalizes and freezes every exact row and conservative template", () => {
    const inventory = inventoryRepositoryToolFamilies();
    const combined = [...TOOL_PREPARATION_MANIFEST, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES];
    const result = normalizeToolPreparationManifest(combined, {
      knownToolNames: inventory.names,
      dynamicTemplateNames: TEMPLATE_NAMES,
      rejectUnexpectedExactTools: true,
    });
    expect(result.issues).toEqual([]);
    expect(result.specs).toHaveLength(71);
    expect(Object.isFrozen(result.specs)).toBeTrue();
    for (const row of result.specs) {
      expect(Object.keys(row).sort()).toEqual(SPEC_FIELDS);
      expect(Object.isFrozen(row)).toBeTrue();
      expect(Object.isFrozen(row.contextFields)).toBeTrue();
      expect(Object.isFrozen(row.protectedFields)).toBeTrue();
    }
  });

  test("has closed rationale evidence for all 69 repository rows", () => {
    const policies = listToolPreparationPolicies();
    expect(policies).toHaveLength(69);
    expect(policies.map((policy) => policy.toolName).sort()).toEqual(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort());
    for (const row of TOOL_PREPARATION_MANIFEST) {
      const policy = getToolPreparationPolicy(row.toolName)!;
      expect(policy.activationStatus).toBe("latent");
      expect(policy.currentIntegration).toBe("none");
      expect(policy.currentServiceEffector).toBeNull();
      expect(policy.currentContextSource).toContain("neither PiclawToolContext nor a service effector");
      expect(policy.futureContextFields).toEqual(row.contextFields);
      expect(Object.isFrozen(policy.futureContextFields)).toBeTrue();
      expect(policy.futureServiceEffector).toBe(row.serviceEffector);
      expect(policy.futureIntegrationTarget).toContain(row.serviceEffector ?? "without acquiring Piclaw service-operation authority");
      expect(policy.authorityRationale.length).toBeGreaterThan(20);
      expect(policy.contextRationale.length).toBeGreaterThan(20);
      if (row.replay === "safe") expect(policy.safeProof?.length).toBeGreaterThan(20);
      if (row.serviceEffector !== null) {
        expect(policy.idempotencyIdentity?.length).toBeGreaterThan(10);
        expect(policy.activationPrerequisites.length).toBeGreaterThan(0);
      } else if (row.effectClass !== "query") {
        expect(policy.nullAuthorityKind).not.toBeNull();
      }
    }
  });

  test("policy evidence has no runtime mutation surface and validation remains stable", () => {
    const policies = listToolPreparationPolicies();
    const readPolicy = getToolPreparationPolicy("read")!;
    const before = normalizeToolPreparationManifest([TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!]);
    expect(Object.isFrozen(policies)).toBeTrue();
    expect(Object.isFrozen(readPolicy)).toBeTrue();
    expect(Object.isFrozen(readPolicy.contextFields)).toBeTrue();
    expect(Object.isFrozen(readPolicy.futureContextFields)).toBeTrue();
    expect(Object.isFrozen(readPolicy.activationPrerequisites)).toBeTrue();
    expect(Reflect.set(readPolicy, "effectClass", "mutation")).toBeFalse();
    expect(() => (policies as unknown as ToolPreparationSpec[]).push(TOOL_PREPARATION_MANIFEST[0])).toThrow();
    expect(() => (readPolicy.contextFields as string[]).push("env")).toThrow();
    const after = normalizeToolPreparationManifest([TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!]);
    expect(after).toEqual(before);
  });

  test("rejects hostile outer candidate and option containers without invoking getters or throwing", () => {
    let getterCalls = 0;
    const accessorOuter: unknown[] = [];
    Object.defineProperty(accessorOuter, "0", { configurable: true, enumerable: true, get: () => { getterCalls += 1; return TOOL_PREPARATION_MANIFEST[0]; } });
    accessorOuter.length = 1;
    const sparseOuter = new Array(1);
    const symbolOuter: unknown[] = [];
    symbolOuter[Symbol("hidden") as unknown as number] = TOOL_PREPARATION_MANIFEST[0];
    const propertyOuter: unknown[] & { hidden?: boolean } = [];
    propertyOuter.hidden = true;
    const hostileOuter = new Proxy([], { ownKeys: () => { throw new Error("hostile outer"); } });
    const revokedOuter = Proxy.revocable([], {});
    revokedOuter.revoke();
    const excessiveOuter = new Array(10_001);

    for (const candidate of [accessorOuter, sparseOuter, symbolOuter, propertyOuter, hostileOuter, revokedOuter.proxy, excessiveOuter]) {
      let result: ReturnType<typeof normalizeToolPreparationManifest> | undefined;
      expect(() => { result = normalizeToolPreparationManifest(candidate as unknown[]); }).not.toThrow();
      expect(result?.issues).toContainEqual(expect.objectContaining({ code: "invalid_candidate_array" }));
    }

    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const accessorNames: string[] = [];
    Object.defineProperty(accessorNames, "0", { configurable: true, enumerable: true, get: () => { getterCalls += 1; return "read"; } });
    accessorNames.length = 1;
    const accessorOptions = Object.defineProperty({}, "knownToolNames", {
      enumerable: true,
      get: () => { getterCalls += 1; return ["read"]; },
    });
    const revokedOptions = Proxy.revocable({}, {});
    revokedOptions.revoke();
    for (const options of [{ knownToolNames: accessorNames }, accessorOptions, revokedOptions.proxy]) {
      let result: ReturnType<typeof normalizeToolPreparationManifest> | undefined;
      expect(() => { result = normalizeToolPreparationManifest([read], options as never); }).not.toThrow();
      expect(result?.issues).toContainEqual(expect.objectContaining({ code: "invalid_options" }));
    }
    expect(getterCalls).toBe(0);
  });

  test("snapshots mutable inputs so later mutation cannot alter normalized policy", () => {
    const source = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const contextFields = ["env"];
    const protectedFields = ["params.path", "result.content"];
    const input = { ...source, contextFields, protectedFields };
    const result = normalizeToolPreparationManifest([input]);
    contextFields[0] = "localEnv";
    protectedFields[0] = "params.changed";
    expect(result.issues).toEqual([]);
    expect(result.specs[0].contextFields).toEqual(["env"]);
    expect(result.specs[0].protectedFields).toEqual(["params.path", "result.content"]);
  });

  test("rejects accessors, symbols, sparse arrays, cycles and throwing proxies without invoking getters", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    let getterCalls = 0;
    const accessor = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(read),
      currentSource: { enumerable: true, get: () => { getterCalls += 1; return "hostile"; } },
    });
    const symbol = { ...read } as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    const sparse = { ...read, contextFields: new Array(1) };
    const cyclic = { ...read } as Record<string, unknown>;
    cyclic.unexpected = cyclic;
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("hostile"); } });
    const issues = normalizeToolPreparationManifest([accessor, symbol, sparse, cyclic, hostile]).issues;
    expect(getterCalls).toBe(0);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "accessor_field", "unexpected_symbol", "invalid_context_fields", "unexpected_field", "invalid_spec",
    ]));
  });

  test("rejects malformed names/templates/selectors/order and authoritative policy drift", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const write = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "write")!;
    const attach = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "attach_file")!;
    const issues = normalizeToolPreparationManifest([
      { ...read, toolName: "Read Tool" },
      { ...read, toolName: "<unknown-template>" },
      { ...DYNAMIC_TOOL_PREPARATION_TEMPLATES[0], serviceEffector: "EF-S01" },
      { ...read, toolName: "bad_selector", protectedFields: ["params.*"] },
      { ...attach, contextFields: ["localEnv", "chatJid", "operationId"] },
      { ...write, effectClass: "query", replay: "safe" },
      { ...read, serviceEffector: "EF-S01" },
    ]).issues;
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "invalid_tool_name", "invalid_dynamic_template", "invalid_protected_selector", "noncanonical_context_order",
      "authoritative_policy_mismatch", "missing_safe_proof",
    ]));
  });

  test("a malformed exact row cannot satisfy repository coverage", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const issues = validateToolPreparationManifest([{ ...read, unexpected: true }], {
      knownToolNames: ["read"],
      rejectUnexpectedExactTools: true,
      enforceAuthoritativePolicy: false,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "unexpected_field" }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "read" }));
  });

  test("a dynamic template cannot satisfy a missing repository-owned exact name", () => {
    const withoutRead = TOOL_PREPARATION_MANIFEST.filter((row) => row.toolName !== "read");
    const issues = validateToolPreparationManifest([...withoutRead, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES], {
      knownToolNames: inventoryRepositoryToolFamilies().names,
      dynamicTemplateNames: TEMPLATE_NAMES,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "read" }));
  });

  test("keeps every mutation never, every EF closed, and messages blocked", () => {
    expect(TOOL_PREPARATION_MANIFEST.filter((row) => row.effectClass !== "query").every((row) => row.replay === "never")).toBeTrue();
    expect(new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.serviceEffector).filter(Boolean))).toEqual(
      new Set(["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"]),
    );
    expect(TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "messages")).toMatchObject({
      effectClass: "mixed", replay: "never", serviceEffector: null,
    });
    expect(MESSAGES_ACTIVATION_BLOCKER).toContain("delete/move");
    expect(CORE_EARENDIL_FACTORY_TARGETS).toEqual({
      read: "createReadTool", write: "createWriteTool", edit: "createEditTool", bash: "createBashTool",
    });
  });
});

describe("WP-3C hermetic add-on package-tree oracle", () => {
  test("accepts deterministic scoped/unscoped contained declarations and contained symlinks", () => {
    const tree: VirtualPackageTree = {
      nodeModulesRoot: "/node_modules",
      nodes: {
        "/node_modules": { kind: "directory" },
        "/node_modules/@scope": { kind: "directory" },
        "/node_modules/@scope/pkg": { kind: "directory" },
        "/node_modules/@scope/pkg/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["extension.ts"] } }) },
        "/node_modules/@scope/pkg/extension.ts": { kind: "file", content: "scoped" },
        "/node_modules/link": { kind: "symlink", target: "/packages/linked" },
        "/packages/linked": { kind: "directory" },
        "/packages/linked/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["entry.ts"] } }) },
        "/packages/linked/entry.ts": { kind: "file", content: "linked" },
        "/node_modules/plain": { kind: "directory" },
        "/node_modules/plain/package.json": { kind: "file", content: JSON.stringify({ main: "ignored.ts", pi: { extensions: ["entry.ts", "alias.ts", "entry.ts"] } }) },
        "/node_modules/plain/entry.ts": { kind: "file", content: "plain" },
        "/node_modules/plain/alias.ts": { kind: "symlink", target: "entry.ts" },
        "/node_modules/not-a-package.txt": { kind: "file", content: "ignored" },
      },
    };
    const result = resolveAddonPackageTree(tree);
    expect(result.packagePaths).toEqual(["/node_modules/@scope/pkg", "/node_modules/link", "/node_modules/plain"]);
    expect(result.extensionPaths).toEqual(["/node_modules/@scope/pkg/extension.ts", "/node_modules/link/entry.ts", "/node_modules/plain/entry.ts"]);
    expect(result.rejections.map((entry) => entry.code)).toEqual(["duplicate_declaration", "duplicate_declaration"]);
  });

  test("rejects malformed/main-only/traversal/escape/missing/non-file/broken/unreadable targets", () => {
    const tree: VirtualPackageTree = {
      nodeModulesRoot: "/node_modules",
      nodes: {
        "/node_modules": { kind: "directory" },
        "/node_modules/broken": { kind: "symlink", target: "/missing" },
        "/node_modules/main-only": { kind: "directory" },
        "/node_modules/main-only/package.json": { kind: "file", content: JSON.stringify({ main: "entry.ts" }) },
        "/node_modules/malformed": { kind: "directory" },
        "/node_modules/malformed/package.json": { kind: "file", content: "{" },
        "/node_modules/unreadable": { kind: "directory" },
        "/node_modules/unreadable/package.json": { kind: "unreadable" },
        "/node_modules/unsafe": { kind: "directory" },
        "/node_modules/unsafe/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["../escape.ts", "missing.ts", "dir", "outside.ts", "unreadable.ts", 42] } }) },
        "/node_modules/unsafe/dir": { kind: "directory" },
        "/node_modules/unsafe/outside.ts": { kind: "symlink", target: "/outside/entry.ts" },
        "/outside/entry.ts": { kind: "file", content: "escape" },
        "/node_modules/unsafe/unreadable.ts": { kind: "unreadable" },
      },
    };
    const result = resolveAddonPackageTree(tree);
    expect(result.extensionPaths).toEqual([]);
    expect(result.rejections.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "broken_package", "missing_pi_extensions", "malformed_manifest", "unreadable_manifest", "lexical_escape",
      "missing_target", "non_file_target", "realpath_escape", "unreadable_target", "non_string_declaration",
    ]));
  });
});

describe("WP-3C hermetic MCP metadata oracle", () => {
  test("normalizes prefixes and resource names exactly", () => {
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "server")).toBe("agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "short")).toBe("agent_board_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "mcp")).toBe("mcp__agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "none")).toBe("read_item");
    expect(resourceNameToToolName(" Run  Book ")).toBe("run_book");
    expect(resourceNameToToolName("123")).toBe("resource_123");
    expect(resourceNameToToolName("---")).toBe("resource");
  });

  test("uses supplied programmatic definitions and only literal disabled=true suppresses a server", () => {
    const result = resolveMcpMetadataFixture({
      prefix: "server",
      disableProxyTool: false,
      builtins: new Set(),
      servers: [
        { name: "boolean-disabled", disabled: true, directTools: true, cache: freshMcpCache("boolean-disabled", { tools: [{ name: "ignored" }] }) },
        { name: "string-enabled", disabled: "true", directTools: true, cache: freshMcpCache("string-enabled", { tools: [{ name: "search" }] }) },
      ],
    });
    expect(result.directNames).toEqual(["string_enabled_search"]);
    expect(result.missingConfiguredServers).toEqual([]);
  });

  test("handles filters, resources, invalid metadata, collisions, duplicates and proxy suppression", () => {
    const result = resolveMcpMetadataFixture({
      prefix: "short",
      disableProxyTool: true,
      builtins: new Set(["demo_read_resource_123"]),
      servers: [
        {
          name: "demo-mcp", directTools: true, includeTools: ["demo_mcp_*"], excludeTools: ["demo_secret"],
          cache: freshMcpCache("demo-mcp", { tools: [{ name: "search" }, { name: "secret" }, {}], resources: [{ name: "Run  Book" }, { name: "123" }, {}] }),
        },
        { name: "demo", directTools: ["search"], cache: freshMcpCache("demo", { tools: [{ name: "search" }, { name: "write" }] }) },
        { name: "disabled", disabled: true, directTools: true, cache: freshMcpCache("disabled", { tools: [{ name: "ignored" }] }) },
      ],
    });
    expect(result.directNames).toEqual(["demo_search", "demo_read_run_book"]);
    expect(result.proxyRegistered).toBeFalse();
    expect(result.skipped).toEqual(expect.arrayContaining([
      "demo-mcp:invalid-tool", "demo-mcp:resource:read_resource_123:builtin-collision",
      "demo-mcp:invalid-resource", "demo:tool:search:duplicate",
    ]));
  });

  test("validates cache definition hash, timestamp, TTL expiry and exact fresh boundary", () => {
    const result = resolveMcpMetadataFixture({
      prefix: "server",
      nowMs: 10_000,
      maxCacheAgeMs: 100,
      disableProxyTool: true,
      builtins: new Set(),
      servers: [
        { name: "mismatch", directTools: true, cache: { definitionHash: "other", cachedAt: 10_000, tools: [{ name: "search" }] } },
        { name: "zero", directTools: true, cache: { definitionHash: "hash:zero", cachedAt: 0, tools: [{ name: "search" }] } },
        { name: "invalid", directTools: true, cache: { definitionHash: "hash:invalid", cachedAt: "10000", tools: [{ name: "search" }] } },
        { name: "expired", directTools: true, cache: { definitionHash: "hash:expired", cachedAt: 9_899, tools: [{ name: "search" }] } },
        { name: "boundary", directTools: true, cache: { definitionHash: "hash:boundary", cachedAt: 9_900, tools: [{ name: "search" }] } },
      ],
    });
    expect(result.directNames).toEqual(["boundary_search"]);
    expect(result.missingConfiguredServers).toEqual(["expired", "invalid", "mismatch", "zero"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("uses per-server direct selection over the global default", () => {
    const result = resolveMcpMetadataFixture({
      prefix: "server",
      globalDirectTools: true,
      disableProxyTool: false,
      builtins: new Set(),
      servers: [
        { name: "global", cache: freshMcpCache("global", { tools: [{ name: "read" }, { name: "write" }] }) },
        { name: "disabled", directTools: false, cache: freshMcpCache("disabled", { tools: [{ name: "ignored" }] }) },
        { name: "exact", directTools: ["read_run_book"], cache: freshMcpCache("exact", { tools: [{ name: "other" }], resources: [{ name: "Run Book" }, { name: "Other" }] }) },
      ],
    });
    expect(result.directNames).toEqual(["global_read", "global_write", "exact_read_run_book"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("models env precedence, exact resource selection, stale cache and proxy retention", () => {
    const result = resolveMcpMetadataFixture({
      prefix: "none",
      globalDirectTools: true,
      envSelectors: ["selected/read_run_book", "stale"],
      disableProxyTool: true,
      builtins: new Set(),
      servers: [
        { name: "ignored-by-env", directTools: true, cache: freshMcpCache("ignored-by-env", { tools: [{ name: "tool" }] }) },
        { name: "selected", directTools: false, cache: freshMcpCache("selected", { tools: [{ name: "other" }], resources: [{ name: "Run Book" }] }) },
        { name: "stale", directTools: false, cache: { definitionHash: "mismatched", cachedAt: 1_000, tools: [{ name: "old" }] } },
      ],
    });
    expect(result.directNames).toEqual(["read_run_book"]);
    expect(result.missingConfiguredServers).toEqual(["stale"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("retains proxy when metadata is absent or no valid direct tool remains", () => {
    const absent = resolveMcpMetadataFixture({
      prefix: "server", globalDirectTools: true, disableProxyTool: true, builtins: new Set(),
      servers: [{ name: "missing", cache: null }],
    });
    const empty = resolveMcpMetadataFixture({
      prefix: "server", disableProxyTool: true, builtins: new Set(),
      servers: [{ name: "empty", directTools: true, cache: freshMcpCache("empty", { tools: [{}] }) }],
    });
    expect(absent).toMatchObject({ directNames: [], missingConfiguredServers: ["missing"], proxyRegistered: true });
    expect(empty).toMatchObject({ directNames: [], missingConfiguredServers: [], proxyRegistered: true });
  });

  test("does not freeze arbitrary add-on or MCP names into exact rows", () => {
    const exactNames = new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName));
    expect(exactNames.has("fixture_addon_tool")).toBeFalse();
    expect(exactNames.has("demo_search")).toBeFalse();
    expect(TEMPLATE_NAMES).toEqual(["<addon-tool>", "<mcp-direct-tool>"]);
  });
});
