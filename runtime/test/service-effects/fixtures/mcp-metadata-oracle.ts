export type McpToolPrefixFixture = "server" | "short" | "mcp" | "none";

export interface McpMetadataToolFixture { readonly name?: unknown }
export interface McpMetadataResourceFixture { readonly name?: unknown }
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

interface SnapshotFixture extends Omit<McpMetadataFixture, "builtins" | "servers"> {
  readonly builtins: ReadonlySet<string>;
  readonly servers: readonly SnapshotServer[];
}
interface SnapshotServer extends Omit<McpServerFixture, "cache"> {
  readonly cache?: Record<string, unknown> | null;
}

const INVALID_FIXTURE = Object.freeze({
  directNames: Object.freeze([]),
  missingConfiguredServers: Object.freeze([]),
  proxyRegistered: true,
  skipped: Object.freeze(["invalid-fixture"]),
});
const FIXTURE_FIELDS = new Set(["prefix", "globalDirectTools", "envSelectors", "disableProxyTool", "nowMs", "maxCacheAgeMs", "builtins", "servers"]);
const SERVER_FIELDS = new Set(["name", "disabled", "directTools", "exposeResources", "includeTools", "excludeTools", "definitionHash", "cache"]);
const CACHE_FIELDS = new Set(["definitionHash", "cachedAt", "tools", "resources"]);
const METADATA_FIELDS = new Set(["name"]);
const MAX_SERVERS = 1_000;
const MAX_METADATA = 10_000;

/** Independent descriptor-closed model; no runtime MCP/config object is imported or executed. */
export function resolveMcpMetadataFixture(value: unknown): McpMetadataResolution {
  const fixture = snapshotFixture(value);
  if (!fixture) return INVALID_FIXTURE;
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
    const tools = cache.tools === undefined ? [] : snapshotDenseArray(cache.tools, MAX_METADATA);
    const resources = cache.resources === undefined ? [] : snapshotDenseArray(cache.resources, MAX_METADATA);
    if (!tools || !resources) {
      skipped.push(`${server.name}:invalid-cache-shape`);
      missing.add(server.name);
      continue;
    }

    for (const metadata of tools) {
      const name = snapshotMetadataName(metadata);
      if (!name) { skipped.push(`${server.name}:invalid-tool`); continue; }
      consider(name, "tool", server, selection, fixture, seen, directNames, skipped);
    }
    if (server.exposeResources !== false) {
      for (const metadata of resources) {
        const name = snapshotMetadataName(metadata);
        if (!name) { skipped.push(`${server.name}:invalid-resource`); continue; }
        const original = `read_${resourceNameToToolName(name)}`;
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
  let value = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!value || /^\d/.test(value)) value = `resource${value ? `_${value}` : ""}`;
  return value;
}

function snapshotFixture(value: unknown): SnapshotFixture | null {
  const fixture = snapshotClosedObject(value, FIXTURE_FIELDS);
  if (!fixture || !["server", "short", "mcp", "none"].includes(String(fixture.prefix))) return null;
  if (fixture.globalDirectTools !== undefined && typeof fixture.globalDirectTools !== "boolean") return null;
  if (fixture.disableProxyTool !== undefined && typeof fixture.disableProxyTool !== "boolean") return null;
  const envSelectors = fixture.envSelectors === undefined ? undefined : snapshotStringArray(fixture.envSelectors, MAX_METADATA);
  if (fixture.envSelectors !== undefined && !envSelectors) return null;
  if (!validOptionalTime(fixture.nowMs, false) || !validOptionalTime(fixture.maxCacheAgeMs, true)) return null;
  const builtins = snapshotStringSet(fixture.builtins, MAX_METADATA);
  const servers = snapshotDenseArray(fixture.servers, MAX_SERVERS);
  if (!builtins || !servers) return null;
  const snapshots: SnapshotServer[] = [];
  for (const value of servers) {
    const server = snapshotServer(value);
    if (!server) return null;
    snapshots.push(server);
  }
  return Object.freeze({
    prefix: fixture.prefix as McpToolPrefixFixture,
    globalDirectTools: fixture.globalDirectTools as boolean | undefined,
    envSelectors: envSelectors && Object.freeze(envSelectors),
    disableProxyTool: fixture.disableProxyTool as boolean | undefined,
    nowMs: fixture.nowMs as number | undefined,
    maxCacheAgeMs: fixture.maxCacheAgeMs as number | undefined,
    builtins,
    servers: Object.freeze(snapshots),
  });
}

function snapshotServer(value: unknown): SnapshotServer | null {
  const server = snapshotClosedObject(value, SERVER_FIELDS);
  if (!server || typeof server.name !== "string" || !server.name) return null;
  if (server.exposeResources !== undefined && typeof server.exposeResources !== "boolean") return null;
  if (server.definitionHash !== undefined && typeof server.definitionHash !== "string") return null;
  let directTools: true | false | readonly string[] | undefined;
  if (typeof server.directTools === "boolean" || server.directTools === undefined) directTools = server.directTools;
  else {
    const snapshot = snapshotStringArray(server.directTools, MAX_METADATA);
    if (!snapshot) return null;
    directTools = Object.freeze(snapshot);
  }
  const includeTools = server.includeTools === undefined ? undefined : snapshotDenseArray(server.includeTools, MAX_METADATA);
  const excludeTools = server.excludeTools === undefined ? undefined : snapshotDenseArray(server.excludeTools, MAX_METADATA);
  if (server.includeTools !== undefined && !includeTools || server.excludeTools !== undefined && !excludeTools) return null;
  let cache: Record<string, unknown> | null | undefined;
  if (server.cache === null || server.cache === undefined) cache = server.cache;
  else {
    cache = snapshotClosedObject(server.cache, CACHE_FIELDS);
    if (!cache) return null;
  }
  return Object.freeze({
    name: server.name,
    disabled: server.disabled,
    directTools,
    exposeResources: server.exposeResources as boolean | undefined,
    includeTools: includeTools && Object.freeze(includeTools),
    excludeTools: excludeTools && Object.freeze(excludeTools),
    definitionHash: server.definitionHash as string | undefined,
    cache,
  });
}

function snapshotClosedObject(value: unknown, fields: ReadonlySet<string>): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(value)) return null;
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !fields.has(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotDenseArray(value: unknown, maximum: number): unknown[] | null {
  let descriptors: PropertyDescriptorMap;
  let keys: readonly PropertyKey[];
  try {
    if (!Array.isArray(value)) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(value);
  } catch { return null; }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  if (keys.some((key) => typeof key !== "string" || key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function snapshotStringArray(value: unknown, maximum: number): string[] | null {
  const snapshot = snapshotDenseArray(value, maximum);
  return snapshot && snapshot.every((entry) => typeof entry === "string") ? snapshot as string[] : null;
}

function snapshotStringSet(value: unknown, maximum: number): ReadonlySet<string> | null {
  try {
    const entries: unknown[] = [];
    const iterator = Set.prototype.values.call(value as Set<unknown>);
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (entries.length === maximum) return null;
      entries.push(next.value);
    }
    if (!entries.every((entry) => typeof entry === "string")) return null;
    return new Set(entries as string[]);
  } catch { return null; }
}

function snapshotMetadataName(value: unknown): string | null {
  const metadata = snapshotClosedObject(value, METADATA_FIELDS);
  return metadata && typeof metadata.name === "string" && metadata.name.trim() ? metadata.name : null;
}

function validOptionalTime(value: unknown, allowZero: boolean): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function validCache(server: SnapshotServer, fixture: SnapshotFixture): boolean {
  const cache = server.cache;
  if (!cache) return false;
  const expectedHash = server.definitionHash ?? `hash:${server.name}`;
  if (cache.definitionHash !== expectedHash) return false;
  if (typeof cache.cachedAt !== "number" || !Number.isSafeInteger(cache.cachedAt) || cache.cachedAt <= 0) return false;
  const now = fixture.nowMs ?? 1_000;
  const maxAge = fixture.maxCacheAgeMs ?? 1_000;
  if (cache.cachedAt > now) return false;
  return maxAge === 0 || now - cache.cachedAt <= maxAge;
}

function consider(original: string, kind: "tool" | "resource", server: SnapshotServer, selection: true | ReadonlySet<string>, fixture: SnapshotFixture, seen: Set<string>, directNames: string[], skipped: string[]): void {
  if (selection !== true && !selection.has(original)) return;
  const candidates = filterCandidates(original, server.name, fixture.prefix);
  if (!included(candidates, server.includeTools) || excluded(candidates, server.excludeTools)) return;
  const generated = formatMcpFixtureToolName(original, server.name, fixture.prefix);
  if (fixture.builtins.has(generated)) { skipped.push(`${server.name}:${kind}:${original}:builtin-collision`); return; }
  if (seen.has(generated)) { skipped.push(`${server.name}:${kind}:${original}:duplicate`); return; }
  seen.add(generated);
  directNames.push(generated);
}

function directSelection(server: SnapshotServer, globalDirect: boolean | undefined, env: { readonly servers: ReadonlySet<string>; readonly tools: ReadonlyMap<string, ReadonlySet<string>> } | null): true | ReadonlySet<string> | false {
  if (env) {
    if (env.servers.has(server.name)) return true;
    return env.tools.get(server.name) ?? false;
  }
  if (server.directTools !== undefined) {
    if (typeof server.directTools === "boolean") return server.directTools;
    return new Set(server.directTools);
  }
  return globalDirect === true;
}

function parseEnvSelectors(selectors: readonly string[]): { readonly servers: ReadonlySet<string>; readonly tools: ReadonlyMap<string, ReadonlySet<string>> } {
  const servers = new Set<string>();
  const tools = new Map<string, Set<string>>();
  for (const raw of selectors) {
    const selector = raw.replace(/\/+$/, "");
    if (!selector) continue;
    if (!selector.includes("/")) { servers.add(selector); continue; }
    const [server, tool] = selector.split("/", 2);
    if (!server) continue;
    if (!tool) { servers.add(server); continue; }
    const selected = tools.get(server) ?? new Set<string>();
    selected.add(tool);
    tools.set(server, selected);
  }
  return { servers, tools };
}

function filterCandidates(toolName: string, serverName: string, prefix: McpToolPrefixFixture): ReadonlySet<string> {
  return new Set([toolName, formatMcpFixtureToolName(toolName, serverName, prefix), formatMcpFixtureToolName(toolName, serverName, "server"), formatMcpFixtureToolName(toolName, serverName, "short"), formatMcpFixtureToolName(toolName, serverName, "mcp")].map((entry) => entry.replaceAll("-", "_")));
}
function included(candidates: ReadonlySet<string>, patterns: readonly unknown[] | undefined): boolean { return !patterns?.length || patterns.some((pattern) => matches(pattern, candidates)); }
function excluded(candidates: ReadonlySet<string>, patterns: readonly unknown[] | undefined): boolean { return Boolean(patterns?.some((pattern) => matches(pattern, candidates))); }
function matches(pattern: unknown, candidates: ReadonlySet<string>): boolean {
  if (typeof pattern !== "string") return false;
  const normalized = pattern.replaceAll("-", "_");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = new RegExp(`^${escaped}$`);
  return [...candidates].some((candidate) => expression.test(candidate));
}
