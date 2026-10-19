import { DefaultResourceLoader, type LoadExtensionsResult, type SettingsManager, type ToolDefinition, type RegisteredCommand } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { getInstalledAddonExtensionPaths, resolveAddonPackageEntries } from "../../src/addons/package-entries.js";
import { join, resolve, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { CodeReviewNativeExports } from "./host-code-review-tool.js";
import type { EditableTableNativeExports } from "./host-editable-table-tool.js";
import type { DrawioNativeExports } from "./host-drawio-tool.js";
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
const approvedDelegateFiles = Object.freeze({
  "index.ts": "73563d26795cbab5cd92e8d5f8dabe3d7477fa11dff35e0ed8b21d9ec3f5ab51",
  "delegate.ts": "5466936c43f79c4159d75179c9f6a3f1d8d3439000e388902b321d8e7de9c923",
  "compat/extension-kv.ts": "20408155132b8b86975100f0df7fe03a57ad74d2e4bb8d30f13e2a893441d651",
});
// Candidate source profile; qualification tests exercise every backend import.
const approvedCodeReviewFiles = Object.freeze({
  "index.ts": "9816235d0418bb6f94f9dd0b99edc37f757cc3a72c50506d014cf267c90c0381",
  "tool.ts": "4573abb088c0ccdc46dc159f12ed5467c8a54d87b271ca0829a94d2fcf7e5ca3",
  "runtime.ts": "284b88d0e3466ddc710d228969f7cb23a34d1cdc059f5169c3c39754c6710127",
  "anchors.ts": "0c1504ff42fdd49b1d320fae4d8eafbf969a5dadb7d867cdc8fb81d737242453",
  "contracts.ts": "f1a6eaf8ad1d4b532ccb509b287991668ce8368a0167cd9e8bf83c2dea727f10",
  "database.ts": "18ea9fa1d0a5f7e215429d5fc563dcd166314e1ce8f96fe6a0350c93dabe6558",
  "dispatch.ts": "1d4a07bfc627840b125c7eca6ed8f04ee433a39cb3de29728950b34c29c3bc40",
  "host.ts": "5d8db59386fabeda32bb65b4db97e13aa03d5bf98adf7d91b67077d37dd618a2",
  "markdown.ts": "ab04e2573e426cbb0aad7975eafbb058db1a5e29355c35df485253ebd6a7520b",
  "render-source.ts": "200645c447550f5a33b472f4c6962a272b574ee23a2a74f59572d8a69c9cd2d0",
  "source.ts": "0e36085e06fa41f3dd5107e13ce7a5296cb037ddc2c009c7228adec226e76a60",
  "store.ts": "f8a2977d1376c43c3e576c8c471433c1c77083bc40ebd79a1f663162d4a2d5ff",
  "validation.ts": "6520c981ea388f70e0278cf73583e0c80871aa346b2abd50dab3003d90c9d1a8",
});
const approvedEditableTableFiles = Object.freeze({
  "package.json": "4810df9f1d7d8f5f34cf21eaccb398c574f0b7e8b5f4ee5511a1e01a26eb9e4c",
  "index.ts": "878b9886c824d3a451153975e6fb92f73903e628add2ad754ad5c9c633de5acb",
  "tool.ts": "1d6752181e680055236302c57e9a100aa78d2c6033074034be83f36551814ceb",
  "shared.ts": "ce18a28856afc7d554d015dfeaf6b04d2deb918762040d0ee9dd030a7909b9f4"
});
// Execution-only profile: index imports only node:fs/path. Static route/status
// registration is approved; vendor browser assets are not an execution proof.
const approvedOfficeViewerFiles = Object.freeze({
  "package.json": "fe62110bc5f59674973065afee279f34f7e0ff1cfc078718f8fad14a5973b155",
  "index.ts": "c6d302ab289c6ce97967da40d97aac14f70b04aeb6a8be77c63bcde7e7d97565",
});
// Execution source only. Installed vendor assets remain trusted installation
// content, not integrity-qualified source or a filesystem sandbox.
const approvedDrawioFiles = Object.freeze({
  "package.json": "2942b1e169541326fd83c9bec29f3365c2f1efabfd13511667da503e7cde67d8",
  "index.ts": "ab1ffba287828ed37db87288c7f1feb47a12efb2c66aa983941643575bdf2790",
  "tool.ts": "7a47e648d93d396c5b959795056885353f34fa04322390e35b0e989d95e81a8b",
});
const approvedGoalFiles = Object.freeze({
  "index.ts": "b643ea6d57d74a1ff976532fbdf659d056df4d6f7b0acfe0c42f5d713b8ca30d",
  "deadline-checkpoint.ts": "e94f7cb065f321b06de33bfd7963011f03714c73437eedab634bce69f199c1db",
  "compat/chat-context.ts": "90e20fa38d72915a7cbf4eea4e4134788271e6eb52dfbcb813df05b6d60c3c44",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
});
const profiles = {
  goal: { label: "Goal", name: "@rcarmo/piclaw-addon-goal", version: "0.1.49", files: approvedGoalFiles,
    shadows: [...Object.keys(approvedGoalFiles).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")]), "compat/package.json"],
    events: ["before_agent_start", "tool_execution_end", "session_compact", "input", "message_end", "agent_end"] },
  open_drawio_editor: { label: "Draw.io", name: "@rcarmo/piclaw-addon-drawio-editor", version: "31.4.4", files: approvedDrawioFiles, shadows: ["index.js", "tool.js", "tool.json", "tool/index.js", "tool/package.json"], events: [] as readonly string[] },
  open_office_viewer: { label: "Office Viewer", name: "@rcarmo/piclaw-addon-office-viewer", version: "0.1.3", files: approvedOfficeViewerFiles, shadows: ["index.js"], events: [] as readonly string[] },
  editable_table: { label: "Editable Table", name: "@rcarmo/piclaw-addon-editable-table", version: "0.1.4", files: approvedEditableTableFiles, shadows: ["index.js", "tool.js", "tool.json", "tool/index.js", "tool/package.json", "shared.js", "shared.json", "shared/index.js", "shared/package.json"], events: ["resources_discover"] },
  plan: { label: "Plan", name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", files: approvedPlanFiles, shadows: ["compat/chat-context.js", "compat/extension-kv.js", "compat/package.json"], events: ["before_agent_start"] },
  code_review: { label: "Code Review", name: "@rcarmo/piclaw-addon-code-review", version: "0.1.8", files: approvedCodeReviewFiles,
    shadows: [...Object.keys(approvedCodeReviewFiles).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")])], events: ["resources_discover"] },
  delegate: { label: "Delegate", name: "@rcarmo/piclaw-addon-delegate", version: "0.2.20", files: approvedDelegateFiles, shadows: ["delegate.js", "delegate.json", "delegate/index.js", "delegate/package.json", "compat/extension-kv.js", "compat/package.json"], events: ["session_start", "model_select", "before_agent_start"] },
} as const;
type Profile = keyof typeof profiles;
type Extension = LoadExtensionsResult["extensions"][number];
type InstalledSource = Readonly<{ cwd: string; packageDir: string; entry: string; manifest: string; files: string }>;
type InstalledRegistration = Readonly<{
  source: InstalledSource;
  definition: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"];
  execute: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"]["execute"];
  declaration: string;
  handlerMap: Extension["handlers"];
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: readonly { name: string; definition: ToolDefinition; execute: unknown; declaration: string }[];
  commands: readonly { name: string; command: RegisteredCommand; handler: RegisteredCommand["handler"]; completions: RegisteredCommand["getArgumentCompletions"]; declaration: string }[];
}>;
const loadedInstalledSources = new WeakMap<LoadExtensionsResult, ReadonlyMap<Extension, InstalledRegistration>>();
// DefaultResourceLoader's first reload may reuse a process-wide factory cache.
// The SDK root does not export its cache clear API. Remember the source BEFORE
// every application load (including rejected/failed loads), never just successful
// qualification. An unsupported first attempt permanently poisons this path for
// this process; restored bytes cannot prove which cached factory would run.
// This is cache provenance metadata, not durable ownership/adoption authority.
const attemptedInstalledSources = new Map<string, InstalledSource | undefined>();

function captureApprovedSource(cwd: string, installedEntries: readonly string[], kind: Profile): InstalledSource | undefined {
  try {
    const profile = profiles[kind];
    const workspace = realpathSync(cwd);
    const packageDir = join(workspace, ".pi/extensions/node_modules", profile.name);
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
    if (pkg.name !== profile.name || pkg.version !== profile.version || pkg.type !== "module") return undefined;
    const entries = resolveAddonPackageEntries(packageDir, pkg.pi?.extensions);
    const entry = join(packageDir, "index.ts");
    if (entries.length !== 1 || realpathSync(entries[0]!) !== entry || !installedEntries.some(path => resolve(path) === entry)) return undefined;
    // The pinned TS imports use .js specifiers. A sibling JS file would win
    // resolution and is NOT covered by the approved TS content proof.
    if (profile.shadows.some(file => existsSync(join(packageDir, file)))) return undefined;
    const files = Object.entries(profile.files).map(([file, expected]) => {
      const path = join(packageDir, file);
      if (!inside(path)) throw Error(`${profile.label} source escape`);
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (digest !== expected) throw Error(`Unsupported ${profile.label} source`);
      return `${file}:${realpathSync(path)}:${digest}`;
    }).join("\n");
    return Object.freeze({ cwd: workspace, packageDir, entry, manifest, files });
  } catch { return undefined; }
}
function sameSource(a: InstalledSource | undefined, b: InstalledSource | undefined): boolean {
  return !!a && !!b && a.cwd === b.cwd && a.packageDir === b.packageDir && a.entry === b.entry && a.manifest === b.manifest && a.files === b.files;
}

/** Only a pre-evaluation snapshot bound to this exact loaded registration can
 * qualify. Never infer what ran from a subsequently edited manifest. */
function qualifyInstalled(catalog: LoadExtensionsResult, cwd: string, kind: Profile) {
  const sources = loadedInstalledSources.get(catalog);
  if (!sources?.size) return undefined;
  const profile = profiles[kind];
  const candidates = [...sources].filter(([extension, { source }]) => catalog.extensions.includes(extension) && source.cwd === realpathSync(cwd) &&
    sameSource(source, captureApprovedSource(cwd, getInstalledAddonExtensionPaths(cwd), kind)));
  if (!candidates.length) return undefined;
  if (candidates.length !== 1) throw Error(`Ambiguous installed ${profile.label} package`);
  const [extension, { source, definition, execute, declaration, handlerMap, handlers, tools, commands }] = candidates[0]!;
  const assertCurrent = () => {
    if (!catalog.extensions.includes(extension) || resolve(extension.resolvedPath) !== source.entry ||
      !sameSource(source, captureApprovedSource(cwd, getInstalledAddonExtensionPaths(cwd), kind))) throw Error(`Installed ${profile.label} source changed`);
    const names = kind === "goal" ? ["get_goal", "create_goal", "goal_complete", "goal_stop", "update_goal"] : [kind];
    if (!definition || definition.name !== names[0] || extension.tools.size !== names.length || tools.length !== names.length ||
      names.some(name => !tools.some(prior => prior.name === name && extension.tools.get(name)?.definition === prior.definition && prior.definition.execute === prior.execute && JSON.stringify(prior.definition) === prior.declaration)) ||
      definition.execute !== execute || JSON.stringify(definition) !== declaration || extension.handlers !== handlerMap ||
      extension.handlers.size !== profile.events.length || (profile.events as readonly string[]).some(event => {
        const current = extension.handlers.get(event) ?? [], prior = handlers.get(event) ?? [];
        return !prior.length || current.length !== prior.length || current.some((handler, i) => handler !== prior[i]);
      }) || (kind === "goal" ? commands.length !== 1 || commands[0]?.name !== "goal" || extension.commands.size !== 1 || extension.commands.get("goal") !== commands[0].command || commands[0].command.handler !== commands[0].handler || commands[0].command.getArgumentCompletions !== commands[0].completions || JSON.stringify(commands[0].command) !== commands[0].declaration : extension.commands.size !== 0) || extension.shortcuts.size) throw Error(`Unqualified ${profile.label} capabilities`);
  };
  assertCurrent();
  return Object.freeze({ extension, source, definition: definition!, assertCurrent });
}
/** Source qualification only: Goal lifecycle/commands remain denied by application admission. */
export async function qualifyInstalledGoal(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "goal");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href);
  const names = ["createGoalTools", "loadThreadGoal", "buildGoalSystemPrompt", "prepareGoalInput", "goalInputIdentity", "resolveGoalInput", "accountGoalProgress", "accountTerminalGoalProgress", "shouldContinueGoalAfterMessage", "decideGoalPlanProgress"] as const;
  qualified.assertCurrent();
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Goal public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]])));
  // The native collector must expose the same declarations as this exact loaded
  // registration. Collecting tools does not execute them or run legacy hooks.
  const native = addon.createGoalTools(() => { throw Error("Invocation-local Goal scope required"); }) as ToolDefinition[];
  if (native.length !== qualified.extension.tools.size || new Set(native.map(tool => tool.name)).size !== native.length || native.some(tool => {
    const loaded = qualified.extension.tools.get(tool.name)?.definition;
    return !loaded || typeof tool.execute !== "function" || JSON.stringify(tool) !== JSON.stringify(loaded);
  })) throw Error("Goal native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon, assertCurrent() {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Goal public exports changed");
  } });
}
export async function qualifyInstalledPlan(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "plan");
  if (!qualified) return undefined;
  const { source, assertCurrent } = qualified;
  const exports = await import(pathToFileURL(source.entry).href) as Partial<PlanPromptExports>;
  assertCurrent();
  if (typeof exports.loadSessionPlan !== "function" || typeof exports.buildPlanSystemPrompt !== "function" || typeof exports.buildPlanTurnMessage !== "function") throw Error("Installed Plan prompt exports required");
  const addon: PlanPromptExports = Object.freeze({ loadSessionPlan: exports.loadSessionPlan, buildPlanSystemPrompt: exports.buildPlanSystemPrompt, buildPlanTurnMessage: exports.buildPlanTurnMessage });
  return Object.freeze({ ...qualified, addon });
}

export interface DelegatePolicyExports {
  buildModelCandidates(models: { provider: string; id: string; fullId: string }[], config: unknown): { id: string }[];
}
export async function qualifyInstalledDelegate(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "delegate");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(join(qualified.source.packageDir, "delegate.ts")).href) as Partial<DelegatePolicyExports>;
  qualified.assertCurrent();
  if (typeof exports.buildModelCandidates !== "function") throw Error("Delegate policy export required");
  return Object.freeze({ ...qualified, buildModelCandidates: exports.buildModelCandidates,
    nativeLifecycle: Object.freeze({ kind: "native-parent-model-read-only" as const, events: profiles.delegate.events }) });
}

export async function qualifyInstalledCodeReview(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "code_review");
  if (!qualified) return undefined;
  // Native import is the same canonical runtime module used by startup and the
  // direct add-on API. Legacy loader execute is never called by the native port.
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<CodeReviewNativeExports>;
  qualified.assertCurrent();
  const names = ["createCodeReviewTool", "reviewService", "setReviewDatabaseSource", "closeReviewServices"] as const;
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Code Review public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]]))) as unknown as CodeReviewNativeExports;
  const native = addon.createCodeReviewTool({ async resolve() { throw Error("Invocation-local review scope required"); } });
  const declaration = (value: Pick<typeof native, "name" | "label" | "description" | "parameters">) => JSON.stringify({ name: value.name, label: value.label, description: value.description, parameters: value.parameters });
  if (declaration(native) !== declaration(qualified.definition)) throw Error("Code Review native/legacy declarations differ");
  const assertCurrent = () => {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Code Review public exports changed");
  };
  return Object.freeze({ ...qualified, assertCurrent, addon });
}

export async function qualifyInstalledDrawio(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "open_drawio_editor");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<DrawioNativeExports>;
  qualified.assertCurrent();
  const names = ["createDrawioEditorTool", "bindDrawioVendorHost", "getDrawioVendorCacheDir", "handleRoute"] as const;
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Draw.io public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]]))) as unknown as DrawioNativeExports;
  const declaration = (tool: Pick<ReturnType<DrawioNativeExports["createDrawioEditorTool"]>, "name" | "label" | "description" | "parameters">) => JSON.stringify({ name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters });
  if (declaration(addon.createDrawioEditorTool()) !== declaration(qualified.definition)) throw Error("Draw.io native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon, assertCurrent() {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Draw.io public exports changed");
  } });
}

export function qualifyInstalledOfficeViewer(catalog: LoadExtensionsResult, cwd: string) {
  return qualifyInstalled(catalog, cwd, "open_office_viewer");
}

export async function qualifyInstalledEditableTable(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "editable_table");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<EditableTableNativeExports>;
  qualified.assertCurrent();
  if (typeof exports.createEditableTableTool !== "function") throw Error("Editable table public factory required");
  const factory = exports.createEditableTableTool;
  const native = factory();
  const declaration = (tool: typeof native) => JSON.stringify({ name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters });
  if (declaration(native) !== declaration(qualified.definition as typeof native)) throw Error("Editable table native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon: Object.freeze({ createEditableTableTool: factory }), assertCurrent() { qualified.assertCurrent(); if (exports.createEditableTableTool !== factory) throw Error("Editable table factory changed"); } });
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
  const snapshots = (Object.keys(profiles) as Profile[]).map(kind => {
    const before = captureApprovedSource(options.cwd, installedEntries, kind);
    const entry = join(realpathSync(options.cwd), ".pi/extensions/node_modules", profiles[kind].name, "index.ts");
    if (attemptedInstalledSources.has(entry) && !sameSource(attemptedInstalledSources.get(entry), before))
      throw Error(`Installed ${profiles[kind].label} loader cache provenance changed; process restart required`);
    if (existsSync(entry)) attemptedInstalledSources.set(entry, before);
    return { kind, before, entry };
  });
  const loader = new DefaultResourceLoader({ ...options,
    additionalExtensionPaths: installedEntries,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  try {
    await loader.reload();
  } finally {
    for (const { kind, before, entry } of snapshots) if (existsSync(entry) || attemptedInstalledSources.has(entry)) {
      if (!sameSource(before, captureApprovedSource(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) attemptedInstalledSources.set(entry, undefined);
    }
  }
  const catalog = loader.getExtensions();
  const sources = new Map<Extension, InstalledRegistration>();
  for (const { kind, before } of snapshots) if (before && sameSource(before, captureApprovedSource(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) {
    for (const extension of catalog.extensions) {
      const definition = extension.tools.get(kind === "goal" ? "get_goal" : kind)?.definition;
      if (resolve(extension.resolvedPath) === before.entry && definition) sources.set(extension, Object.freeze({
        source: before, definition, execute: definition.execute, declaration: JSON.stringify(definition), handlerMap: extension.handlers,
        tools: [...extension.tools].map(([name, { definition }]) => Object.freeze({ name, definition, execute: definition.execute, declaration: JSON.stringify(definition) })),
        commands: [...extension.commands].map(([name, command]) => Object.freeze({ name, command, handler: command.handler, completions: command.getArgumentCompletions, declaration: JSON.stringify(command) })),
        handlers: new Map([...extension.handlers].map(([event, handlers]) => [event, Object.freeze([...handlers])])),
      }));
    }
  }
  loadedInstalledSources.set(catalog, sources);
  return catalog;
}

/** Fail closed until a real invocation-local, operation-owned effect port is
 * supplied by the application host. A readOnlyHint, tool name, factory capture,
 * or pre/post execute check is not such a port. In particular, do not run tool
 * hooks through a fabricated AgentSession context. Keep all diagnostics so a
 * successful startup can never silently mean missing installed capabilities.
 */
export function assertApplicationExtensionCatalogSupported(catalog: LoadExtensionsResult, plan?: Awaited<ReturnType<typeof qualifyInstalledPlan>>, delegate?: Awaited<ReturnType<typeof qualifyInstalledDelegate>>, codeReview?: Awaited<ReturnType<typeof qualifyInstalledCodeReview>>, editableTable?: Awaited<ReturnType<typeof qualifyInstalledEditableTable>>, officeViewer?: ReturnType<typeof qualifyInstalledOfficeViewer>, drawio?: Awaited<ReturnType<typeof qualifyInstalledDrawio>>): void {
  plan?.assertCurrent(); delegate?.assertCurrent(); codeReview?.assertCurrent(); editableTable?.assertCurrent(); officeViewer?.assertCurrent(); drawio?.assertCurrent();
  const blocked: string[] = catalog.errors.map(error => `${error.path}: extension load failed`);
  for (const extension of catalog.extensions) {
    for (const { definition } of extension.tools.values()) {
      if (extension === plan?.extension && definition === plan.definition) continue;
      if (extension === delegate?.extension && definition === delegate.definition) continue;
      if (extension === codeReview?.extension && definition === codeReview.definition) continue;
      if (extension === editableTable?.extension && definition === editableTable.definition) continue;
      if (extension === officeViewer?.extension && definition === officeViewer.definition) continue;
      if (extension === drawio?.extension && definition === drawio.definition) continue;
      blocked.push(`${definition.name}: no operation-owned host effect port`);
    }
    for (const event of extension.handlers.keys()) {
      if (extension === plan?.extension && event === "before_agent_start") continue;
      // Static skill discovery only: no session lifecycle or fabricated context.
      if (extension === codeReview?.extension && event === "resources_discover") continue;
      if (extension === editableTable?.extension && event === "resources_discover") continue;
      if (extension === delegate?.extension && delegate.nativeLifecycle.events.some(allowed => allowed === event)) continue;
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
