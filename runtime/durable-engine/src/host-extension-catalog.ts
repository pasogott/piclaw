import { DefaultResourceLoader, type LoadExtensionsResult, type SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { getInstalledAddonExtensionPaths, resolveAddonPackageEntries } from "../../src/addons/package-entries.js";
import { join, resolve, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export interface PlanPromptExports {
  loadSessionPlan(chatJid: string): { chat_jid: string; markdown: string; updated_at: string | null };
  buildPlanSystemPrompt(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): string;
  buildPlanTurnMessage(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): { customType: string; content: { type: "text"; text: string }[]; display: boolean } | undefined;
}

// Core policy for the effect proof in qualification/plan.test.ts. This is not
// an add-on lockfile: other installed content still loads, but gets no exemption.
const approvedPlanFiles = Object.freeze({
  "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
  "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
});
type Extension = LoadExtensionsResult["extensions"][number];
type PlanSource = Readonly<{ cwd: string; packageDir: string; entry: string; manifest: string; files: string }>;
type PlanRegistration = Readonly<{
  source: PlanSource;
  definition: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"];
  execute: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"]["execute"];
  handlers: readonly unknown[];
}>;
const loadedPlanSources = new WeakMap<LoadExtensionsResult, ReadonlyMap<Extension, PlanRegistration>>();
// DefaultResourceLoader's first reload may reuse a process-wide factory cache.
// The SDK root does not export its cache clear API. Remember the source BEFORE
// every application load (including rejected/failed loads), never just successful
// qualification. An unsupported first attempt permanently poisons this path for
// this process; restored bytes cannot prove which cached factory would run.
// This is cache provenance metadata, not durable ownership/adoption authority.
const attemptedPlanSources = new Map<string, PlanSource | undefined>();

function captureApprovedPlan(cwd: string, installedEntries: readonly string[]): PlanSource | undefined {
  try {
    const workspace = realpathSync(cwd);
    const packageDir = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
    // Neither a renamed package nor a symlink out of the installed namespace
    // grants provenance. Entry/helper links may not escape the canonical root.
    if (realpathSync(packageDir) !== packageDir) return undefined;
    const inside = (file: string) => {
      const path = relative(packageDir, realpathSync(file));
      return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
    };
    if (!inside(join(packageDir, "package.json"))) return undefined;
    const manifest = readFileSync(join(packageDir, "package.json"), "utf8");
    const pkg = JSON.parse(manifest);
    if (pkg.name !== "@rcarmo/piclaw-addon-plan-sidebar" || pkg.version !== "0.1.25" || pkg.type !== "module") return undefined;
    const entries = resolveAddonPackageEntries(packageDir, pkg.pi?.extensions);
    const entry = join(packageDir, "index.ts");
    if (entries.length !== 1 || realpathSync(entries[0]!) !== entry || !installedEntries.some(path => resolve(path) === entry)) return undefined;
    // The pinned TS imports use .js specifiers. A sibling JS file would win
    // resolution and is NOT covered by the approved TS content proof.
    if (["compat/chat-context.js", "compat/extension-kv.js", "compat/package.json"].some(file => existsSync(join(packageDir, file)))) return undefined;
    const files = Object.entries(approvedPlanFiles).map(([file, expected]) => {
      const path = join(packageDir, file);
      if (!inside(path)) throw Error("Plan source escape");
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (digest !== expected) throw Error("Unsupported Plan source");
      return `${file}:${realpathSync(path)}:${digest}`;
    }).join("\n");
    return Object.freeze({ cwd: workspace, packageDir, entry, manifest, files });
  } catch { return undefined; }
}
function sameSource(a: PlanSource | undefined, b: PlanSource | undefined): boolean {
  return !!a && !!b && a.cwd === b.cwd && a.packageDir === b.packageDir && a.entry === b.entry && a.manifest === b.manifest && a.files === b.files;
}

/** Only a pre-evaluation snapshot bound to this exact loaded registration can
 * qualify. Never infer what ran from a subsequently edited manifest. */
export async function qualifyInstalledPlan(catalog: LoadExtensionsResult, cwd: string) {
  const sources = loadedPlanSources.get(catalog);
  if (!sources?.size) return undefined;
  const candidates = [...sources].filter(([extension, { source }]) => catalog.extensions.includes(extension) && source.cwd === realpathSync(cwd) &&
    sameSource(source, captureApprovedPlan(cwd, getInstalledAddonExtensionPaths(cwd))));
  if (!candidates.length) return undefined;
  if (candidates.length !== 1) throw Error("Ambiguous installed Plan package");
  const [extension, { source, definition, execute, handlers }] = candidates[0]!;
  const assertCurrent = () => {
    if (!catalog.extensions.includes(extension) || resolve(extension.resolvedPath) !== source.entry ||
      !sameSource(source, captureApprovedPlan(cwd, getInstalledAddonExtensionPaths(cwd)))) throw Error("Installed Plan source changed");
    const currentHandlers = extension.handlers.get("before_agent_start") ?? [];
    if (!definition || definition.name !== "plan" || extension.tools.size !== 1 || extension.tools.get("plan")?.definition !== definition || definition.execute !== execute ||
      extension.handlers.size !== 1 || currentHandlers.length !== handlers.length || !handlers.length || currentHandlers.some((handler, i) => handler !== handlers[i]) ||
      extension.commands.size || extension.shortcuts.size) throw Error("Unqualified Plan capabilities");
  };
  assertCurrent();
  const exports = await import(pathToFileURL(source.entry).href) as Partial<PlanPromptExports>;
  assertCurrent();
  if (typeof exports.loadSessionPlan !== "function" || typeof exports.buildPlanSystemPrompt !== "function" || typeof exports.buildPlanTurnMessage !== "function") throw Error("Installed Plan prompt exports required");
  const addon: PlanPromptExports = Object.freeze({ loadSessionPlan: exports.loadSessionPlan, buildPlanSystemPrompt: exports.buildPlanSystemPrompt, buildPlanTurnMessage: exports.buildPlanTurnMessage });
  return Object.freeze({ extension, addon, definition: definition!, assertCurrent });
}

/** The public Pi registry, not a second registerTool implementation. Factories
 * run once at application startup, without AgentSession or SessionManager.
 * No action stubs are rebound and no native extension context is fabricated.
 */
export async function loadApplicationExtensionCatalog(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
}): Promise<LoadExtensionsResult> {
  const installedEntries = getInstalledAddonExtensionPaths(options.cwd);
  const before = captureApprovedPlan(options.cwd, installedEntries);
  const planEntry = join(realpathSync(options.cwd), ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar/index.ts");
  if (attemptedPlanSources.has(planEntry) && !sameSource(attemptedPlanSources.get(planEntry), before)) {
    throw Error("Installed Plan loader cache provenance changed; process restart required");
  }
  // Record before evaluation, even if loading subsequently fails. Never replace
  // a rejected snapshot with approved on-disk bytes in the same process.
  if (existsSync(planEntry)) attemptedPlanSources.set(planEntry, before);
  const loader = new DefaultResourceLoader({ ...options,
    additionalExtensionPaths: installedEntries,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  try {
    await loader.reload();
  } finally {
    if (existsSync(planEntry) || attemptedPlanSources.has(planEntry)) {
      if (!sameSource(before, captureApprovedPlan(options.cwd, getInstalledAddonExtensionPaths(options.cwd)))) attemptedPlanSources.set(planEntry, undefined);
    }
  }
  const catalog = loader.getExtensions();
  const sources = new Map<Extension, PlanRegistration>();
  if (before && sameSource(before, captureApprovedPlan(options.cwd, getInstalledAddonExtensionPaths(options.cwd)))) {
    for (const extension of catalog.extensions) {
      const definition = extension.tools.get("plan")?.definition;
      if (resolve(extension.resolvedPath) === before.entry && definition) sources.set(extension, Object.freeze({
        source: before, definition, execute: definition.execute,
        handlers: Object.freeze([...(extension.handlers.get("before_agent_start") ?? [])]),
      }));
    }
  }
  loadedPlanSources.set(catalog, sources);
  return catalog;
}

/** Fail closed until a real invocation-local, operation-owned effect port is
 * supplied by the application host. A readOnlyHint, tool name, factory capture,
 * or pre/post execute check is not such a port. In particular, do not run tool
 * hooks through a fabricated AgentSession context. Keep all diagnostics so a
 * successful startup can never silently mean missing installed capabilities.
 */
export function assertApplicationExtensionCatalogSupported(catalog: LoadExtensionsResult, plan?: Awaited<ReturnType<typeof qualifyInstalledPlan>>): void {
  plan?.assertCurrent();
  const blocked: string[] = catalog.errors.map(error => `${error.path}: extension load failed`);
  for (const extension of catalog.extensions) {
    for (const { definition } of extension.tools.values()) {
      if (extension === plan?.extension && definition === plan.definition) continue;
      blocked.push(`${definition.name}: no operation-owned host effect port`);
    }
    for (const event of extension.handlers.keys()) {
      if (extension === plan?.extension && event === "before_agent_start") continue;
      blocked.push(`${extension.path}: ${event} lifecycle not bound to durable host`);
    }
    if (extension.commands.size || extension.shortcuts.size) {
      blocked.push(`${extension.path}: session commands/shortcuts not bound to durable host`);
    }
  }
  // Queued provider/MCP/action registrations must not disappear merely because
  // this application lifetime has no ExtensionRunner.bindCore/session_start.
  const runtime = catalog.runtime;
  if (runtime.pendingProviderRegistrations.length || runtime.pendingNativeProviderRegistrations.length || runtime.pendingVirtualModelRegistrations.length || runtime.mcpServers.list().length) {
    blocked.push("extension provider/MCP registrations not bound to durable host");
  }
  if (blocked.length) throw new Error(`Durable extension qualification required:\n${blocked.join("\n")}`);
}
