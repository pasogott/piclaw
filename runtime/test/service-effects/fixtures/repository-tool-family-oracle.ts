import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const runtimeRoot = resolve(import.meta.dir, "../../..");

const COMPUTED_REGISTRATIONS = new Map<string, readonly string[]>([
  ["src/extensions/context-prune.ts#identifier:CONTEXT_PRUNE_TOOL_NAME", ["context_prune"]],
  ["src/extensions/context-prune/query-tool.ts#identifier:CONTEXT_TREE_QUERY_TOOL_NAME", ["context_tree_query"]],
  ["src/extensions/internal-tools.ts#identifier:PRIMARY_TOOL_NAME", ["list_tools"]],
  ["src/extensions/ssh-core.ts#spread:localRead", ["read"]],
  ["src/extensions/ssh-core.ts#spread:localWrite", ["write"]],
  ["src/extensions/ssh-core.ts#spread:localEdit", ["edit"]],
  ["src/extensions/ssh-core.ts#spread:localBash", ["bash"]],
  ["extensions/integrations/context-mode.ts#factory:createToolOutputSearchTool", ["search_tool_output"]],
  ["extensions/integrations/context-mode.ts#factory:createBatchExecTool", ["exec_batch"]],
]);

const EFFECTIVE_REPOSITORY_FAMILIES = Object.freeze([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "mcp",
]);

export interface RepositoryToolFamilyInventory {
  readonly names: readonly string[];
  readonly unresolvedRegistrations: readonly string[];
  readonly registrationSites: ReadonlyMap<string, readonly string[]>;
}

/**
 * Independent static oracle. It parses repository source but imports and runs no
 * extension, tool, add-on, or MCP package.
 */
export function inventoryRepositoryToolFamilies(): RepositoryToolFamilyInventory {
  const names = new Set(EFFECTIVE_REPOSITORY_FAMILIES);
  const unresolved = new Set<string>();
  const sites = new Map<string, Set<string>>();

  for (const root of [resolve(runtimeRoot, "src/extensions"), resolve(runtimeRoot, "extensions")]) {
    for (const path of walkTypeScript(root)) inspectFile(path, names, unresolved, sites);
  }

  for (const key of [...unresolved]) {
    const resolvedNames = COMPUTED_REGISTRATIONS.get(key);
    if (!resolvedNames) continue;
    for (const name of resolvedNames) names.add(name);
    unresolved.delete(key);
  }

  return Object.freeze({
    names: Object.freeze([...names].sort()),
    unresolvedRegistrations: Object.freeze([...unresolved].sort()),
    registrationSites: new Map([...sites].map(([name, values]) => [name, Object.freeze([...values].sort())])),
  });
}

function inspectFile(
  path: string,
  names: Set<string>,
  unresolved: Set<string>,
  sites: Map<string, Set<string>>,
): void {
  const text = readFileSync(path, "utf8");
  const rel = relative(runtimeRoot, path).replaceAll("\\", "/");

  for (const argument of extractRegisterToolArguments(text)) {
    const resolution = resolveRegistration(argument);
    if (resolution.name) {
      names.add(resolution.name);
      const knownSites = sites.get(resolution.name) ?? new Set<string>();
      knownSites.add(rel);
      sites.set(resolution.name, knownSites);
    } else if (resolution.fingerprint !== "expression:") {
      unresolved.add(`${rel}#${resolution.fingerprint}`);
    }
  }
}

function resolveRegistration(argument: string): { name: string | null; fingerprint: string } {
  const trimmed = argument.trim();
  if (!trimmed || trimmed.startsWith(")")) return { name: null, fingerprint: "expression:" };
  if (trimmed.startsWith("{")) {
    const leading = trimmed.slice(0, 800).split(/\b(?:async\s+)?execute\s*\(/, 1)[0];
    const name = leading.match(/(?:^|\n)\s*name\s*:\s*(?:"([^"]+)"|'([^']+)'|([A-Z][A-Z0-9_]+))/);
    if (name?.[1] || name?.[2]) return { name: name[1] ?? name[2] ?? null, fingerprint: "literal" };
    if (name?.[3]) return { name: null, fingerprint: `identifier:${name[3]}` };
    const spreads = [...leading.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
    return { name: null, fingerprint: `spread:${spreads.join("+") || "none"}` };
  }
  const factory = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (factory) return { name: null, fingerprint: `factory:${factory[1]}` };
  return { name: null, fingerprint: `expression:${compact(trimmed)}` };
}

function extractRegisterToolArguments(source: string): string[] {
  const argumentsList: string[] = [];
  const matcher = /\.\s*registerTool\s*\(/g;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
    // Tool names and computed/spread identities are registration-header data.
    // A bounded slice avoids interpreting execute-body regex/template syntax and
    // still makes every new non-literal header an explicit unresolved fixture.
    argumentsList.push(source.slice(matcher.lastIndex, matcher.lastIndex + 350));
  }
  return argumentsList;
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 120);
}

function walkTypeScript(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...walkTypeScript(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

export interface AddonPackageFixture {
  readonly manifest: unknown;
  readonly files: readonly string[];
}

/** Resolve only declared pi.extensions from an in-memory package fixture. */
export function resolveAddonExtensionFixture(fixture: AddonPackageFixture): readonly string[] {
  if (!record(fixture.manifest)) return [];
  const pi = fixture.manifest.pi;
  if (!record(pi) || !Array.isArray(pi.extensions)) return [];
  const available = new Set(fixture.files);
  return Object.freeze(pi.extensions.filter((value): value is string => typeof value === "string" && available.has(value)));
}

export type McpToolPrefixFixture = "server" | "short" | "mcp" | "none";

export interface McpServerFixture {
  readonly name: string;
  readonly directTools: true | readonly string[] | false;
  readonly tools: readonly string[];
  readonly resources?: readonly string[];
  readonly exposeResources?: boolean;
  readonly includeTools?: readonly string[];
  readonly excludeTools?: readonly string[];
}

export function formatMcpFixtureToolName(toolName: string, serverName: string, prefix: McpToolPrefixFixture): string {
  const sanitizedTool = toolName.replaceAll(".", "_");
  let server = serverName.replaceAll("-", "_");
  if (prefix === "none") return sanitizedTool;
  if (prefix === "short") {
    server = serverName.replace(/-?mcp$/i, "").replaceAll("-", "_") || "mcp";
  } else if (prefix === "mcp") {
    server = `mcp__${server}`;
  }
  return `${server}_${sanitizedTool}`;
}

/** Resolve generated names from in-memory metadata; no MCP client is loaded. */
export function resolveMcpDirectFixture(
  servers: readonly McpServerFixture[],
  prefix: McpToolPrefixFixture,
  builtins: ReadonlySet<string>,
): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const server of servers) {
    if (!server.directTools) continue;
    const selected = server.directTools === true ? null : new Set(server.directTools);
    const originals = [
      ...server.tools,
      ...(server.exposeResources === false ? [] : (server.resources ?? []).map((resource) => `read_${resource.replace(/[^A-Za-z0-9_-]+/g, "_")}`)),
    ];
    for (const original of originals) {
      if (selected && !selected.has(original)) continue;
      const candidates = mcpFilterCandidates(original, server.name, prefix);
      if (server.includeTools?.length && !server.includeTools.some((pattern) => matchesMcpFilter(pattern, candidates))) continue;
      if (server.excludeTools?.some((pattern) => matchesMcpFilter(pattern, candidates))) continue;
      const generated = formatMcpFixtureToolName(original, server.name, prefix);
      if (builtins.has(generated) || seen.has(generated)) continue;
      seen.add(generated);
      names.push(generated);
    }
  }
  return Object.freeze(names);
}

function mcpFilterCandidates(toolName: string, serverName: string, prefix: McpToolPrefixFixture): ReadonlySet<string> {
  return new Set([
    toolName,
    formatMcpFixtureToolName(toolName, serverName, prefix),
    formatMcpFixtureToolName(toolName, serverName, "server"),
    formatMcpFixtureToolName(toolName, serverName, "short"),
    formatMcpFixtureToolName(toolName, serverName, "mcp"),
  ].map((value) => value.replaceAll("-", "_")));
}

function matchesMcpFilter(pattern: string, candidates: ReadonlySet<string>): boolean {
  const normalized = pattern.replaceAll("-", "_");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = new RegExp(`^${escaped}$`);
  return [...candidates].some((candidate) => expression.test(candidate));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
