export type McpToolPrefixFixture = "server" | "short" | "mcp" | "none";

export interface McpMetadataToolFixture {
  readonly name?: unknown;
}

export interface McpMetadataResourceFixture {
  readonly name?: unknown;
}

export interface McpServerCacheFixture {
  readonly definitionHash: unknown;
  readonly cachedAt: unknown;
  readonly tools?: readonly McpMetadataToolFixture[];
  readonly resources?: readonly McpMetadataResourceFixture[];
}

export interface McpServerFixture {
  readonly name: string;
  readonly disabled?: unknown;
  readonly directTools?: true | readonly string[] | false;
  readonly exposeResources?: boolean;
  readonly includeTools?: readonly unknown[];
  readonly excludeTools?: readonly unknown[];
  readonly definitionHash?: string;
  readonly cache?: McpServerCacheFixture | null;
}

export interface McpMetadataFixture {
  readonly prefix: McpToolPrefixFixture;
  readonly globalDirectTools?: boolean;
  readonly envSelectors?: readonly string[];
  readonly disableProxyTool?: boolean;
  readonly nowMs?: number;
  readonly maxCacheAgeMs?: number;
  readonly builtins: ReadonlySet<string>;
  readonly servers: readonly McpServerFixture[];
}

export interface McpMetadataResolution {
  readonly directNames: readonly string[];
  readonly missingConfiguredServers: readonly string[];
  readonly proxyRegistered: boolean;
  readonly skipped: readonly string[];
}

/**
 * Independent, in-memory model of direct metadata selection and proxy fallback.
 * Inputs are compile-time test literals, never runtime MCP/config objects; malformed
 * metadata shapes are rejected by the branches below rather than imported/executed.
 */
export function resolveMcpMetadataFixture(fixture: McpMetadataFixture): McpMetadataResolution {
  const directNames: string[] = [];
  const missing = new Set<string>();
  const skipped: string[] = [];
  const seen = new Set<string>();
  const env = fixture.envSelectors === undefined ? null : parseEnvSelectors(fixture.envSelectors);

  for (const server of fixture.servers) {
    if (server.disabled === true) continue;
    const selection = directSelection(server, fixture.globalDirectTools, env);
    if (!selection) continue;
    if (!validCache(server, fixture)) {
      missing.add(server.name);
      continue;
    }
    const cache = server.cache!;
    if (cache.tools !== undefined && !Array.isArray(cache.tools) || cache.resources !== undefined && !Array.isArray(cache.resources)) {
      skipped.push(`${server.name}:invalid-cache-shape`);
      missing.add(server.name);
      continue;
    }

    for (const metadata of cache.tools ?? []) {
      if (!metadata || typeof metadata !== "object" || typeof metadata.name !== "string" || !metadata.name.trim()) {
        skipped.push(`${server.name}:invalid-tool`);
        continue;
      }
      consider(metadata.name, "tool", server, selection, fixture, seen, directNames, skipped);
    }
    if (server.exposeResources !== false) {
      for (const metadata of cache.resources ?? []) {
        if (!metadata || typeof metadata !== "object" || typeof metadata.name !== "string" || !metadata.name.trim()) {
          skipped.push(`${server.name}:invalid-resource`);
          continue;
        }
        const original = `read_${resourceNameToToolName(metadata.name)}`;
        consider(original, "resource", server, selection, fixture, seen, directNames, skipped);
      }
    }
  }

  const missingConfiguredServers = [...missing].sort();
  const proxyRegistered = fixture.disableProxyTool !== true || directNames.length === 0 || missingConfiguredServers.length > 0;
  return Object.freeze({
    directNames: Object.freeze(directNames),
    missingConfiguredServers: Object.freeze(missingConfiguredServers),
    proxyRegistered,
    skipped: Object.freeze(skipped),
  });
}

export function formatMcpFixtureToolName(toolName: string, serverName: string, prefix: McpToolPrefixFixture): string {
  const tool = toolName.replaceAll(".", "_");
  if (prefix === "none") return tool;
  let server = serverName.replaceAll("-", "_");
  if (prefix === "short") server = serverName.replace(/-?mcp$/i, "").replaceAll("-", "_") || "mcp";
  if (prefix === "mcp") server = `mcp__${server}`;
  return `${server}_${tool}`;
}

export function resourceNameToToolName(name: string): string {
  let value = name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!value || /^\d/.test(value)) value = `resource${value ? `_${value}` : ""}`;
  return value;
}

function validCache(server: McpServerFixture, fixture: McpMetadataFixture): boolean {
  const cache = server.cache;
  if (!cache) return false;
  const expectedHash = server.definitionHash ?? `hash:${server.name}`;
  if (cache.definitionHash !== expectedHash) return false;
  if (!cache.cachedAt || typeof cache.cachedAt !== "number" || !Number.isFinite(cache.cachedAt)) return false;
  const now = fixture.nowMs ?? 1_000;
  const maxAge = fixture.maxCacheAgeMs ?? 1_000;
  return maxAge <= 0 || now - cache.cachedAt <= maxAge;
}

function consider(
  original: string,
  kind: "tool" | "resource",
  server: McpServerFixture,
  selection: true | ReadonlySet<string>,
  fixture: McpMetadataFixture,
  seen: Set<string>,
  directNames: string[],
  skipped: string[],
): void {
  if (selection !== true && !selection.has(original)) return;
  const candidates = filterCandidates(original, server.name, fixture.prefix);
  if (!included(candidates, server.includeTools) || excluded(candidates, server.excludeTools)) return;
  const generated = formatMcpFixtureToolName(original, server.name, fixture.prefix);
  if (fixture.builtins.has(generated)) {
    skipped.push(`${server.name}:${kind}:${original}:builtin-collision`);
    return;
  }
  if (seen.has(generated)) {
    skipped.push(`${server.name}:${kind}:${original}:duplicate`);
    return;
  }
  seen.add(generated);
  directNames.push(generated);
}

function directSelection(
  server: McpServerFixture,
  globalDirect: boolean | undefined,
  env: { readonly servers: ReadonlySet<string>; readonly tools: ReadonlyMap<string, ReadonlySet<string>> } | null,
): true | ReadonlySet<string> | false {
  if (env) {
    if (env.servers.has(server.name)) return true;
    return env.tools.get(server.name) ?? false;
  }
  if (server.directTools !== undefined) {
    if (server.directTools === true) return true;
    if (server.directTools === false) return false;
    return new Set(server.directTools);
  }
  return globalDirect === true ? true : false;
}

function parseEnvSelectors(selectors: readonly string[]): {
  readonly servers: ReadonlySet<string>;
  readonly tools: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const servers = new Set<string>();
  const tools = new Map<string, Set<string>>();
  for (const raw of selectors) {
    const selector = raw.replace(/\/+$/, "");
    if (!selector) continue;
    if (!selector.includes("/")) {
      servers.add(selector);
      continue;
    }
    const [server, tool] = selector.split("/", 2);
    if (!server) continue;
    if (!tool) {
      servers.add(server);
      continue;
    }
    const selected = tools.get(server) ?? new Set<string>();
    selected.add(tool);
    tools.set(server, selected);
  }
  return { servers, tools };
}

function filterCandidates(toolName: string, serverName: string, prefix: McpToolPrefixFixture): ReadonlySet<string> {
  return new Set([
    toolName,
    formatMcpFixtureToolName(toolName, serverName, prefix),
    formatMcpFixtureToolName(toolName, serverName, "server"),
    formatMcpFixtureToolName(toolName, serverName, "short"),
    formatMcpFixtureToolName(toolName, serverName, "mcp"),
  ].map((value) => value.replaceAll("-", "_")));
}

function included(candidates: ReadonlySet<string>, patterns: readonly unknown[] | undefined): boolean {
  return !patterns?.length || patterns.some((pattern) => matches(pattern, candidates));
}

function excluded(candidates: ReadonlySet<string>, patterns: readonly unknown[] | undefined): boolean {
  return Boolean(patterns?.some((pattern) => matches(pattern, candidates)));
}

function matches(pattern: unknown, candidates: ReadonlySet<string>): boolean {
  if (typeof pattern !== "string") return false;
  const normalized = pattern.replaceAll("-", "_");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = new RegExp(`^${escaped}$`);
  return [...candidates].some((candidate) => expression.test(candidate));
}
