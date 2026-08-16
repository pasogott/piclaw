import { createHash } from "node:crypto";

export type McpToolPrefixFixture = "server" | "short" | "mcp" | "none";

export interface McpMetadataToolFixture { readonly name?: unknown }
export interface McpMetadataResourceFixture { readonly name?: unknown }
export interface McpServerCacheFixture {
  readonly configHash: unknown;
  readonly cachedAt: unknown;
  readonly tools?: readonly McpMetadataToolFixture[];
  readonly resources?: readonly McpMetadataResourceFixture[];
}
export interface McpCacheFixture {
  readonly version: unknown;
  readonly servers: Readonly<Record<string, McpServerCacheFixture>>;
}
export interface McpServerFixture {
  readonly name: string;
  readonly disabled?: boolean;
  readonly directTools?: true | readonly string[] | false;
  readonly exposeResources?: boolean;
  readonly includeTools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly command?: unknown;
  readonly args?: unknown;
  readonly socket?: unknown;
  readonly env?: unknown;
  readonly cwd?: unknown;
  readonly url?: unknown;
  readonly headers?: unknown;
  readonly auth?: unknown;
  readonly bearerToken?: unknown;
  readonly bearerTokenEnv?: unknown;
  readonly lifecycle?: unknown;
  readonly idleTimeout?: unknown;
  readonly requestTimeoutMs?: unknown;
  readonly debug?: unknown;
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
  readonly cache: McpCacheFixture | null;
}
export interface McpMetadataResolution {
  readonly directNames: readonly string[];
  readonly missingConfiguredServers: readonly string[];
  readonly proxyRegistered: boolean;
  readonly skipped: readonly string[];
}

interface SnapshotFixture extends Omit<McpMetadataFixture, "builtins" | "servers" | "cache" | "envSelectors"> {
  readonly builtins: readonly string[];
  readonly envSelectors?: readonly string[];
  readonly servers: readonly SnapshotServer[];
  readonly cache: SnapshotCache | null;
}
interface SnapshotServer extends McpServerFixture {
  readonly directTools?: true | readonly string[] | false;
  readonly includeTools?: readonly string[];
  readonly excludeTools?: readonly string[];
}
interface SnapshotCache {
  readonly version: number;
  readonly servers: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
interface DirectSelectors {
  readonly servers: readonly string[];
  readonly tools: Readonly<Record<string, readonly string[]>>;
}

const INVALID_FIXTURE = Object.freeze({
  directNames: Object.freeze([]),
  missingConfiguredServers: Object.freeze([]),
  proxyRegistered: true,
  skipped: Object.freeze(["invalid-fixture"]),
});
const CACHE_VERSION = 1;
const FIXTURE_FIELDS = new Set(["prefix", "globalDirectTools", "envSelectors", "disableProxyTool", "nowMs", "maxCacheAgeMs", "builtins", "servers", "cache"]);
const SERVER_FIELDS = new Set([
  "name", "disabled", "directTools", "exposeResources", "includeTools", "excludeTools",
  "command", "args", "socket", "env", "cwd", "url", "headers", "auth", "bearerToken", "bearerTokenEnv",
  "lifecycle", "idleTimeout", "requestTimeoutMs", "debug",
]);
const CACHE_ENVELOPE_FIELDS = new Set(["version", "servers"]);
const CACHE_ENTRY_FIELDS = new Set(["configHash", "cachedAt", "tools", "resources"]);
const METADATA_FIELDS = new Set(["name"]);
const IDENTITY_FIELDS = [
  "command", "args", "socket", "env", "cwd", "url", "headers", "auth", "bearerToken", "bearerTokenEnv",
  "exposeResources", "includeTools", "excludeTools",
] as const;
const MAX_SERVERS = 1_000;
const MAX_METADATA = 10_000;
const MAX_CANONICAL_DEPTH = 12;
const MAX_CANONICAL_ENTRIES = 20_000;

/** Stable pure identity hash matching the installed adapter's cache-significant field set. */
export function computeMcpServerIdentityHash(server: McpServerFixture): string {
  const identity: Record<string, unknown> = Object.create(null);
  for (const field of IDENTITY_FIELDS) identity[field] = server[field];
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

/** Independent descriptor-closed model; no runtime MCP/config object is imported or executed. */
export function resolveMcpMetadataFixture(value: unknown): McpMetadataResolution {
  const fixture = snapshotFixture(value);
  if (!fixture) return INVALID_FIXTURE;
  const directNames: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const duplicateServer = fixture.servers.find((server, index) => fixture.servers.findIndex((candidate) => candidate.name === server.name) !== index);
  if (duplicateServer) return invalidWithReason(`duplicate-server:${duplicateServer.name}`);
  const env = fixture.envSelectors === undefined ? null : parseEnvSelectors(fixture.envSelectors);
  if (env?.issue) return invalidWithReason(env.issue);

  if (fixture.cache && fixture.cache.version !== CACHE_VERSION) skipped.push(`cache:unsupported-version:${fixture.cache.version}`);
  for (const server of fixture.servers) {
    if (server.disabled === true) continue;
    const selection = directSelection(server, fixture.globalDirectTools, env?.value ?? null);
    if (selection === false) continue;
    const cache = fixture.cache?.version === CACHE_VERSION ? fixture.cache.servers[server.name] : undefined;
    if (!validCache(cache, server, fixture)) {
      if (!missing.includes(server.name)) missing.push(server.name);
      continue;
    }
    const tools = cache.tools === undefined ? [] : snapshotDenseArray(cache.tools, MAX_METADATA);
    const resources = cache.resources === undefined ? [] : snapshotDenseArray(cache.resources, MAX_METADATA);
    if (!tools || !resources) {
      skipped.push(`${server.name}:invalid-cache-shape`);
      if (!missing.includes(server.name)) missing.push(server.name);
      continue;
    }

    for (const metadata of tools) {
      const name = snapshotMetadataName(metadata);
      if (!name) { skipped.push(`${server.name}:invalid-tool`); continue; }
      consider(name, "tool", server, selection, fixture, directNames, skipped);
    }
    if (server.exposeResources !== false) {
      for (const metadata of resources) {
        const name = snapshotMetadataName(metadata);
        if (!name) { skipped.push(`${server.name}:invalid-resource`); continue; }
        consider(`read_${resourceNameToToolName(name)}`, "resource", server, selection, fixture, directNames, skipped);
      }
    }
  }

  const missingConfiguredServers = missing.sort();
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

function invalidWithReason(reason: string): McpMetadataResolution {
  return Object.freeze({ directNames: Object.freeze([]), missingConfiguredServers: Object.freeze([]), proxyRegistered: true, skipped: Object.freeze([reason]) });
}

function snapshotFixture(value: unknown): SnapshotFixture | null {
  const fixture = snapshotClosedObject(value, FIXTURE_FIELDS);
  if (!fixture || !["server", "short", "mcp", "none"].includes(String(fixture.prefix))) return null;
  if (fixture.globalDirectTools !== undefined && typeof fixture.globalDirectTools !== "boolean") return null;
  if (fixture.disableProxyTool !== undefined && typeof fixture.disableProxyTool !== "boolean") return null;
  const envSelectors = fixture.envSelectors === undefined ? undefined : snapshotCanonicalStringArray(fixture.envSelectors, MAX_METADATA);
  if (fixture.envSelectors !== undefined && !envSelectors) return null;
  if (!validOptionalTime(fixture.nowMs, false) || !validOptionalTime(fixture.maxCacheAgeMs, true)) return null;
  const builtins = snapshotStringSet(fixture.builtins, MAX_METADATA);
  const servers = snapshotDenseArray(fixture.servers, MAX_SERVERS);
  const cache = fixture.cache === null ? null : snapshotCache(fixture.cache);
  if (!builtins || !servers || fixture.cache !== null && !cache) return null;
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
    builtins: Object.freeze(builtins),
    servers: Object.freeze(snapshots),
    cache,
  });
}

function snapshotServer(value: unknown): SnapshotServer | null {
  const server = snapshotClosedObject(value, SERVER_FIELDS);
  if (!server || typeof server.name !== "string" || !server.name || server.name !== server.name.trim()) return null;
  if (server.disabled !== undefined && typeof server.disabled !== "boolean") return null;
  if (server.exposeResources !== undefined && typeof server.exposeResources !== "boolean") return null;
  let directTools: true | false | readonly string[] | undefined;
  if (typeof server.directTools === "boolean" || server.directTools === undefined) directTools = server.directTools;
  else {
    const snapshot = snapshotCanonicalStringArray(server.directTools, MAX_METADATA);
    if (!snapshot || hasDuplicates(snapshot)) return null;
    directTools = Object.freeze(snapshot);
  }
  const includeTools = server.includeTools === undefined ? undefined : snapshotCanonicalStringArray(server.includeTools, MAX_METADATA);
  const excludeTools = server.excludeTools === undefined ? undefined : snapshotCanonicalStringArray(server.excludeTools, MAX_METADATA);
  if (server.includeTools !== undefined && (!includeTools || hasDuplicates(includeTools)) || server.excludeTools !== undefined && (!excludeTools || hasDuplicates(excludeTools))) return null;
  const canonicalIdentity: Record<string, unknown> = Object.create(null);
  for (const field of IDENTITY_FIELDS) {
    if (field === "includeTools" || field === "excludeTools" || field === "exposeResources" || server[field] === undefined) continue;
    const snapshot = snapshotCanonical(server[field]);
    if (snapshot === null && server[field] !== null) return null;
    canonicalIdentity[field] = snapshot;
  }
  return Object.freeze({
    name: server.name,
    disabled: server.disabled as boolean | undefined,
    directTools,
    exposeResources: server.exposeResources as boolean | undefined,
    includeTools: includeTools && Object.freeze(includeTools),
    excludeTools: excludeTools && Object.freeze(excludeTools),
    ...canonicalIdentity,
  }) as SnapshotServer;
}

function snapshotCache(value: unknown): SnapshotCache | null {
  const envelope = snapshotClosedObject(value, CACHE_ENVELOPE_FIELDS);
  if (!envelope || !Number.isSafeInteger(envelope.version)) return null;
  const serverMap = snapshotOpenRecord(envelope.servers, MAX_SERVERS);
  if (!serverMap) return null;
  const servers: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  for (const [name, raw] of Object.entries(serverMap)) {
    if (!name || name !== name.trim()) return null;
    const entry = snapshotClosedObject(raw, CACHE_ENTRY_FIELDS);
    if (!entry) return null;
    servers[name] = Object.freeze(entry);
  }
  return Object.freeze({ version: envelope.version as number, servers: Object.freeze(servers) });
}

function snapshotClosedObject(value: unknown, fields: ReadonlySet<string>): Record<string, unknown> | null {
  const snapshot = snapshotOpenRecord(value, fields.size);
  if (!snapshot) return null;
  for (const key of Object.keys(snapshot)) if (!fields.has(key)) return null;
  return snapshot;
}

function snapshotOpenRecord(value: unknown, maximum: number): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(value)) return null;
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  if (keys.length > maximum) return null;
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") return null;
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

function snapshotCanonicalStringArray(value: unknown, maximum: number): string[] | null {
  const snapshot = snapshotDenseArray(value, maximum);
  return snapshot && snapshot.every((entry) => typeof entry === "string" && entry.length > 0 && entry === entry.trim()) ? snapshot as string[] : null;
}

function snapshotStringSet(value: unknown, maximum: number): string[] | null {
  try {
    const entries: unknown[] = [];
    const iterator = Set.prototype.values.call(value as Set<unknown>);
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (entries.length === maximum) return null;
      entries.push(next.value);
    }
    return entries.every((entry) => typeof entry === "string") && !hasDuplicates(entries as string[]) ? entries as string[] : null;
  } catch { return null; }
}

function snapshotCanonical(value: unknown, depth = 0, budget = { entries: 0 }): unknown | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= MAX_CANONICAL_DEPTH || ++budget.entries > MAX_CANONICAL_ENTRIES) return null;
  if (Array.isArray(value)) {
    const array = snapshotDenseArray(value, MAX_METADATA);
    if (!array) return null;
    const result: unknown[] = [];
    for (const entry of array) {
      const snapshot = snapshotCanonical(entry, depth + 1, budget);
      if (snapshot === null && entry !== null) return null;
      result.push(snapshot);
    }
    return Object.freeze(result);
  }
  const record = snapshotOpenRecord(value, MAX_METADATA);
  if (!record) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(record).sort()) {
    const snapshot = snapshotCanonical(record[key], depth + 1, budget);
    if (snapshot === null && record[key] !== null) return null;
    result[key] = snapshot;
  }
  return Object.freeze(result);
}

function snapshotMetadataName(value: unknown): string | null {
  const metadata = snapshotClosedObject(value, METADATA_FIELDS);
  return metadata && typeof metadata.name === "string" && metadata.name.length > 0 && metadata.name === metadata.name.trim() ? metadata.name : null;
}

function validOptionalTime(value: unknown, allowZero: boolean): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function validCache(cache: Readonly<Record<string, unknown>> | undefined, server: SnapshotServer, fixture: SnapshotFixture): cache is Readonly<Record<string, unknown>> {
  if (!cache || cache.configHash !== computeMcpServerIdentityHash(server)) return false;
  if (typeof cache.cachedAt !== "number" || !Number.isSafeInteger(cache.cachedAt) || cache.cachedAt <= 0) return false;
  const now = fixture.nowMs ?? 1_000;
  const maxAge = fixture.maxCacheAgeMs ?? 1_000;
  if (cache.cachedAt > now) return false;
  return maxAge === 0 || now - cache.cachedAt <= maxAge;
}

function consider(original: string, kind: "tool" | "resource", server: SnapshotServer, selection: true | readonly string[], fixture: SnapshotFixture, directNames: string[], skipped: string[]): void {
  if (selection !== true && !selection.includes(original)) return;
  const candidates = filterCandidates(original, server.name, fixture.prefix);
  if (!included(candidates, server.includeTools) || excluded(candidates, server.excludeTools)) return;
  const generated = formatMcpFixtureToolName(original, server.name, fixture.prefix);
  if (fixture.builtins.includes(generated)) { skipped.push(`${server.name}:${kind}:${original}:builtin-collision`); return; }
  if (directNames.includes(generated)) { skipped.push(`${server.name}:${kind}:${original}:duplicate`); return; }
  directNames.push(generated);
}

function directSelection(server: SnapshotServer, globalDirect: boolean | undefined, env: DirectSelectors | null): true | readonly string[] | false {
  if (env) {
    if (env.servers.includes(server.name)) return true;
    return env.tools[server.name] ?? false;
  }
  if (server.directTools !== undefined) return server.directTools;
  return globalDirect === true;
}

function parseEnvSelectors(selectors: readonly string[]): { readonly value: DirectSelectors | null; readonly issue: string | null } {
  const servers: string[] = [];
  const tools: Record<string, string[]> = Object.create(null);
  const seen: string[] = [];
  for (const raw of selectors) {
    const selector = raw.replace(/\/+$/, "");
    if (!selector || selector !== raw || seen.includes(selector)) return { value: null, issue: `invalid-env-selector:${raw}` };
    seen.push(selector);
    if (!selector.includes("/")) { servers.push(selector); continue; }
    const parts = selector.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { value: null, issue: `invalid-env-selector:${raw}` };
    const selected = tools[parts[0]] ?? [];
    selected.push(parts[1]);
    tools[parts[0]] = selected;
  }
  return { value: Object.freeze({ servers: Object.freeze(servers), tools: Object.freeze(Object.fromEntries(Object.entries(tools).map(([key, names]) => [key, Object.freeze(names)]))) }), issue: null };
}

function filterCandidates(toolName: string, serverName: string, prefix: McpToolPrefixFixture): readonly string[] {
  return Object.freeze([...new Set([toolName, formatMcpFixtureToolName(toolName, serverName, prefix), formatMcpFixtureToolName(toolName, serverName, "server"), formatMcpFixtureToolName(toolName, serverName, "short"), formatMcpFixtureToolName(toolName, serverName, "mcp")].map((entry) => entry.replaceAll("-", "_")))]);
}
function included(candidates: readonly string[], patterns: readonly string[] | undefined): boolean { return !patterns?.length || patterns.some((pattern) => matches(pattern, candidates)); }
function excluded(candidates: readonly string[], patterns: readonly string[] | undefined): boolean { return Boolean(patterns?.some((pattern) => matches(pattern, candidates))); }
function matches(pattern: string, candidates: readonly string[]): boolean {
  const normalized = pattern.replaceAll("-", "_");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = new RegExp(`^${escaped}$`);
  return candidates.some((candidate) => expression.test(candidate));
}
function hasDuplicates(values: readonly string[]): boolean { return new Set(values).size !== values.length; }
function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "undefined" : serialized;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
