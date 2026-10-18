import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { apply } from "@earendil-works/chord/delta";
import { Harness, AgentDoc, configure, createRegistry, defineDoc, defineExtension, defineTool, type ToolExecutionApi, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createCodemodeTool } from "@earendil-works/pi-durable/codemode";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { RuntimeModelServices } from "../../src/agent-pool/model-services.js";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { getDb, storeChatMetadata } from "../../src/db.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import { DATA_DIR, SESSIONS_DIR, WORKSPACE_DIR } from "../../src/core/config.js";
import { getPiclawAgentDir } from "../../src/core/agent-dir.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "./application-bootstrap.js";
import { createHostModels } from "./host-models.js";
import { reserveHostRequest, reconcileOperationBudgetWork } from "./host-request-accounting.js";
import { createHostMcp } from "./host-mcp.js";
import { createHostFetch } from "./host-fetch.js";
import { taskModelRequestScope, withTaskModelRequestScope } from "./task-model-boundary-shim.js";
import { createHostBuiltinTools } from "./host-builtins.js";
import { loadApplicationExtensionCatalog, qualifyInstalledPlan, qualifyInstalledDelegate, qualifyInstalledCodeReview, qualifyInstalledEditableTable, qualifyInstalledOfficeViewer, qualifyInstalledDrawio, assertApplicationExtensionCatalogSupported } from "./host-extension-catalog.js";
import { createHostDelegateTool } from "./host-delegate-tool.js";
import { createHostDelegateFileReader } from "./host-delegate-files.js";
import { extensionKvGet } from "../../src/db/extension-kv.js";
import { createHostPlanTool } from "./host-plan-tool.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostCodeReviewTool } from "./host-code-review-tool.js";
import { createHostEditableTableTool, type WidgetPublisher } from "./host-editable-table-tool.js";
import { createHostOfficeViewerTool } from "./host-office-viewer-tool.js";
import { createHostDrawioTool, type WorkspaceFileOpener, type DrawioNativeExports } from "./host-drawio-tool.js";
import { createHostPlanPrompt } from "./host-plan-prompt.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { registerRootExtensionKvStore } from "../../src/db/register-extension-kv.js";
import { requireExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import { registerExtensionRoute } from "../../src/channels/web/http/extension-routes.js";

const ApplicationConversations = defineDoc({ kind: "app.application-conversations", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ version: 1, domain: "", bindings: [] as { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] }) });

type ApplicationMapping = { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
const defaultToolNames = ["read", "bash", "edit", "write", "find", "ls", "grep"] as const;

/** Decorate only this executor's public commit port. The SDK owns the SQL
 * transaction; both checks run under its write lock, including store/result and
 * run-journal commits. Private memo/task bookkeeping and parent settlement keep
 * their original API and lifecycle; this is not a global storage policy. */
function withGuardedCommit(api: ToolExecutionApi, assertCurrent: () => void): ToolExecutionApi {
  const originalCommit = api.commit.bind(api);
  const commit: ToolExecutionApi["commit"] = (body, context) => originalCommit(async tx => {
    assertCurrent();
    const value = await body(tx);
    assertCurrent();
    return value;
  }, context);
  return new Proxy(api, { get(target, key) {
    if (key === "commit") return commit;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const isOldDefault = (tools: unknown) => Array.isArray(tools) &&
  ((tools.length === 1 && tools[0] === "bash") ||
    (tools.length === 6 && defaultToolNames.slice(0, 6).every((name, i) => tools[i] === name)));

/** Read-only preflight, before Harness.open can normalize pending work. All
 * configuration writes still go through public configure in one SDK commit. */
function storedDocument(root: ReturnType<typeof getDb>, id: number): any {
  let value: unknown;
  const revisions = root.query("SELECT kind, version, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(id) as { kind: string; version: number; content: string }[];
  for (const revision of revisions) {
    if (revision.version !== 1) throw Error("Invalid persisted document version");
    if (revision.kind === "base") value = JSON.parse(revision.content);
    else if (revision.kind === "delta" && value) value = apply(value, JSON.parse(revision.content));
    else throw Error("Invalid persisted document");
  }
  if (!value) throw Error("Invalid persisted document");
  return value;
}
function assertToolUpgradeIdle(root: ReturnType<typeof getDb>): void {
  if (root.inTransaction) throw Error("Root connection transaction active");
  if (root.query("SELECT 1 FROM tasks WHERE status <> 'terminal' UNION ALL SELECT 1 FROM submissions WHERE status IN ('queued','placed') LIMIT 1").get())
    throw Error("Host tool upgrade requires idle SDK work");
  const docs = root.query(`SELECT id, kind FROM documents WHERE kind IN ('"pi.inbox"','"pi.live"') AND retired_at IS NULL`).all() as { id: number; kind: string }[];
  for (const doc of docs) {
    const state = storedDocument(root, doc.id);
    if (doc.kind === '"pi.inbox"' ? state.items?.length : state.run) throw Error("Host tool upgrade requires idle SDK work");
  }
  const exists = (table: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (exists("service_effect_s01_chats") && root.query(`SELECT 1 FROM service_effect_s01_chats WHERE active_operation_id IS NOT NULL
    UNION ALL SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed')
    UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal'
    UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') LIMIT 1`).get())
    throw Error("Host tool upgrade requires idle host work");
}
function validateApplicationMapping(root: ReturnType<typeof getDb>, value: unknown): asserts value is ApplicationMapping {
  const m = value as ApplicationMapping;
  const canonical = (v: unknown): v is string => typeof v === "string" && !!v && v === v.trim();
  if (!m || m.version !== 1 || !canonical(m.domain) || !Array.isArray(m.bindings) || !m.bindings.length ||
    ["chatJid", "branchId", "conversationId", "sessionId"].some(key => new Set(m.bindings.map(b => b?.[key as keyof typeof b])).size !== m.bindings.length) ||
    m.bindings.some(b => !b || !canonical(b.chatJid) || !canonical(b.branchId) || !canonical(b.sessionId) || !Number.isSafeInteger(b.conversationId) || b.conversationId <= 1 ||
      !root.query("SELECT 1 FROM conversations WHERE id=?").get(b.conversationId) ||
      !root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(b.chatJid, b.branchId))) throw Error("Invalid durable application conversation manifest");
}

/** Presence detection only: migration remains a separate, unimplemented operation. */
export function assertFreshApplicationHistory(root: ReturnType<typeof getDb>, sessionsDir: string): void {
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir, { recursive: true, withFileTypes: true }) : [];
  if (files.some(file => file.isFile())) throw Error("Durable startup requires migration: legacy session files exist; no files were imported or reset");
  const exists = (name: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const sdkTables = ["durable_schema", "durable_metadata", "record_ids", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"];
  let mapping: ApplicationMapping | undefined;
  if (sdkTables.some(exists)) {
    if (!sdkTables.every(exists)) throw Error("Durable startup requires migration: partial SDK storage");
    const docs = root.query("SELECT id FROM documents WHERE kind='\"app.application-conversations\"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL").all() as { id: number }[];
    if (docs.length !== 1) throw Error("Invalid durable application conversation manifest: migration required");
    const revisions = root.query("SELECT kind, version, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0]!.id) as { kind: string; version: number; content: string }[];
    let materialized: unknown;
    for (const revision of revisions) {
      if (revision.version !== 1) throw Error("Invalid durable application conversation manifest");
      if (revision.kind === "base") materialized = JSON.parse(revision.content);
      else if (revision.kind === "delta" && materialized) materialized = apply(materialized, JSON.parse(revision.content));
      else throw Error("Invalid durable application conversation manifest");
    }
    mapping = materialized as ApplicationMapping;
    validateApplicationMapping(root, mapping);
    for (const b of mapping.bindings) {
      const row = root.query(`SELECT r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='"app.application-identity"' AND d.owner_id=? AND d.retired_at IS NULL ORDER BY r.seq DESC LIMIT 1`).get(b.conversationId) as { content: string } | null;
      if (!row || row.content !== JSON.stringify({ domain: mapping.domain, chatJid: b.chatJid, branchId: b.branchId, sessionId: b.sessionId })) throw Error("Invalid durable application identity");
    }
  }
  const messages = root.query("SELECT rowid, id, chat_jid, is_bot_message FROM messages").all() as { rowid: number; id: string; chat_jid: string; is_bot_message: number }[];
  for (const message of messages) {
    if (!mapping || !exists("service_effect_s01_sources")) throw Error("Durable startup requires migration: legacy message history exists");
    const binding = mapping.bindings.find(b => b.chatJid === message.chat_jid);
    const source = root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=? AND kind='message' AND payload_ref=? AND provenance_ref='application:durable'").get(message.chat_jid, message.id, `message-row:${message.rowid}`);
    const terminal = message.is_bot_message && exists("service_effect_s01_operations") && exists("piclaw_durable_bindings_v1") && root.query(`SELECT 1 FROM service_effect_s01_operations o JOIN piclaw_durable_bindings_v1 b ON b.operation_id=o.operation_id JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE o.chat_jid=? AND o.terminal_message_row_id=? AND o.phase='terminal' AND b.domain=? AND b.incarnation=? AND b.conversation_id=? AND s.provenance_ref='application:durable'`).get(message.chat_jid, message.rowid, mapping.domain, mapping.domain, binding?.conversationId ?? -1);
    if (!binding || !(message.is_bot_message ? terminal : source)) throw Error("Durable startup requires migration: unverified message provenance");
  }
  if (mapping) for (const table of ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"]) {
    if (!exists(table)) continue;
    const rows = root.query(`SELECT domain, incarnation, chat_jid, branch_id, conversation_id, operation_id, source_seq FROM ${table}`).all() as { domain: string; incarnation: string; chat_jid: string; branch_id: string; conversation_id: number; operation_id: string; source_seq: number }[];
    for (const row of rows) {
      const scope = mapping.bindings.find(b => b.chatJid === row.chat_jid && b.branchId === row.branch_id);
      if (row.domain !== mapping.domain || row.incarnation !== mapping.domain || !scope) throw Error("Invalid durable application routing provenance");
      if (scope.conversationId === row.conversation_id) continue;
      // Scheduled forks are not main conversation routes. Validate their persisted
      // EF-S07/EF-S01 allocation provenance, including already completed occurrences.
      const scheduled = table === "piclaw_durable_bindings_v1" && exists("service_effect_s07_occurrences") && root.query(`SELECT 1 FROM piclaw_durable_bindings_v1 b
        JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq AND s.source_id=b.source_id AND s.payload_ref=b.payload_ref
        JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id AND r.operation_id=b.operation_id AND r.accepted_source_seq=s.source_seq
        JOIN service_effect_s01_operation_sources os ON os.operation_id=b.operation_id AND os.chat_jid=b.chat_jid AND os.source_seq=b.source_seq
        JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
        JOIN conversations c ON c.id=b.conversation_id
        WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=? AND b.conversation_id=?
          AND s.kind='scheduled_agent' AND b.request_id='scheduled:' || r.run_id
          AND c.owner_conversation_id IS NULL AND c.owner_task_id IS NULL
          AND (json_extract(c.record,'$.parent.conversationId') IS NULL OR json_extract(c.record,'$.parent.conversationId')=?)`)
        .get(mapping.domain, mapping.domain, row.operation_id, row.source_seq, row.conversation_id, scope.conversationId);
      if (!scheduled) throw Error("Invalid durable application routing provenance");
    }
  }
}

/** Mainstream source factory. Only startup-known chats are admitted; unknown chats fail closed. */
export async function createDefaultApplicationRuntime(owner: RuntimeLockHandle, getModels: () => Promise<RuntimeModelServices>): Promise<RuntimeBackend> {
  if (process.platform !== "linux") throw Error("Durable application ownership is qualified only on Linux");
  if (readAccessConfig().mode !== "single-user") throw Error("Durable host builtins require single-user policy; family effect ports are not qualified");
  const ownership = applicationOwnership(owner);
  const assert = () => owner.assertCurrentOwner();
  const root = getDb();
  assertFreshApplicationHistory(root, SESSIONS_DIR); // BEFORE SDK/schema/model construction
  registerRootExtensionKvStore();
  requireExtensionKvAuthority();
  const settings = SettingsManager.create(WORKSPACE_DIR, getPiclawAgentDir());
  // Public registration happens before model construction, AgentPool, or SDK
  // writes. Never silently start with seven tools when installed tools exist.
  const catalog = await loadApplicationExtensionCatalog({ cwd: WORKSPACE_DIR, agentDir: getPiclawAgentDir(), settingsManager: settings });
  const plan = await qualifyInstalledPlan(catalog, WORKSPACE_DIR);
  const delegate = await qualifyInstalledDelegate(catalog, WORKSPACE_DIR);
  const codeReview = await qualifyInstalledCodeReview(catalog, WORKSPACE_DIR);
  const editableTable = await qualifyInstalledEditableTable(catalog, WORKSPACE_DIR);
  const officeViewer = qualifyInstalledOfficeViewer(catalog, WORKSPACE_DIR);
  const drawio = await qualifyInstalledDrawio(catalog, WORKSPACE_DIR);
  let workspaceFileOpener: WorkspaceFileOpener | undefined;
  let widgetPublisher: WidgetPublisher | undefined;
  try { assert(); assertApplicationExtensionCatalogSupported(catalog, plan, delegate, codeReview, editableTable, officeViewer, drawio); }
  finally { catalog.runtime.invalidate("Application extension preflight ended"); }
  let mcp: Awaited<ReturnType<typeof createHostMcp>> | undefined;
  let captureRuntime: HostConversationRuntime | undefined;
  const lifetime = new AbortController();
  const runtime = () => {
    assert(); lifetime.signal.throwIfAborted();
    if (!captureRuntime) throw Error("Host capture runtime unavailable");
    return captureRuntime;
  };
  const captureSource = async (call: { conversationId: ConversationId; taskId: import("@earendil-works/pi-durable").TaskId; toolCallId: string }) => {
    const captured = await runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
    const authority = createHostOperationAuthority(root, captured, () => {
      assert(); lifetime.signal.throwIfAborted(); runtime().assertCapturedSourceCurrent(captured.inputs);
    }, true);
    return () => { authority.assertCurrent(); if (captured.delegateModel) assertDelegateModel(captured.delegateModel); };
  };
  let assertDelegateModel: (model: { provider: string; modelId: string }) => void = () => { throw Error("Delegate unavailable"); };
  const baseApplicationToolNames: readonly string[] = [...defaultToolNames, "codemode", ...(plan ? ["plan"] : []), ...(delegate ? ["delegate"] : []), ...(codeReview ? ["code_review"] : []), ...(editableTable ? ["editable_table"] : []), ...(officeViewer ? ["open_office_viewer"] : []), ...(drawio ? ["open_drawio_editor"] : [])];
  const previousDefault = baseApplicationToolNames.filter(name => name !== "codemode");
  const isFactoryDefault = (tools: unknown) => isOldDefault(tools) || (Array.isArray(tools) &&
    ((tools.length === defaultToolNames.length && defaultToolNames.every((name, index) => tools[index] === name)) ||
      (tools.length === previousDefault.length && previousDefault.every((name, index) => tools[index] === name)) ||
      (tools.length === baseApplicationToolNames.length && baseApplicationToolNames.every((name, index) => tools[index] === name))));
  let drawioHost: ReturnType<DrawioNativeExports["bindDrawioVendorHost"]> | undefined;
  let sandbox: CodemodeSandbox | undefined;
  let sandboxClose: Promise<void> | undefined;
  const closeSandbox = () => sandboxClose ??= sandbox?.close() ?? Promise.resolve();
  const releaseReviewSource = codeReview?.addon.setReviewDatabaseSource({ database: root, assertOwner: assert });
  try {
  mcp = await createHostMcp({ assertCurrent() { assert(); lifetime.signal.throwIfAborted(); },
    captureSource: api => captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId }) });
  const applicationToolNames = [...baseApplicationToolNames, "fetch", ...mcp.tools.map(tool => tool.name)];
  if (drawio) {
    drawioHost = drawio.addon.bindDrawioVendorHost({
      assertCurrent() { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent(); },
      baseDir: drawio.source.packageDir, cwd: WORKSPACE_DIR,
      cacheDir: drawio.addon.getDrawioVendorCacheDir(DATA_DIR),
    });
    // SDK evaluation and native imports can have distinct module state. Route
    // the existing owner/prefix to the same native module that owns preparation.
    if (registerExtensionRoute("/drawio", (request, pathname) => {
      try { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent(); }
      catch { return new Response("Draw.io vendor unavailable", { status: 503 }); }
      return drawio.addon.handleRoute(request, pathname);
    }, drawio.source.packageDir) === "rejected") throw Error("Draw.io native route unavailable");
    await drawioHost.prepare();
  }
  const host = await getModels(); assert();
  const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
  // Only the host's authenticated/approved catalog grants admission, never getAll().
  const available = host.modelRegistry.getAvailable().filter(model => {
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    return physical?.provider === model.provider && physical.id === model.id;
  });
  const selected = provider && modelId ? available.find(model => model.provider === provider && model.id === modelId) : available[0];
  if (!selected) throw Error("Durable startup requires an available host default model");
  const ref = { provider: selected.provider, id: selected.id };
  // Allocate/recover the shared namespace before any accepted task or API read.
  codeReview?.addon.reviewService();
  const check = (model: { provider: string; id: string }, signal: AbortSignal) => {
    assert(); signal.throwIfAborted();
    if (root.query("SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1").get()) throw Error("Native model budget admission unavailable");
    if (!available.some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model not approved");
    if (!host.modelRegistry.getAvailable().some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model no longer available");
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    if (physical?.provider !== model.provider || physical.id !== model.id) throw Error("Host model no longer available");
  };
  const toolUpgrades: number[] = [];
  // Validate stored choices without opening/writing SDK documents or bundle ports.
  if (root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get()) {
    const manifest = root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"' AND owner_id=1 AND retired_at IS NULL`).get() as { id: number };
    const mapping = storedDocument(root, manifest.id) as ApplicationMapping;
    const active = new Set([1, ...mapping.bindings.map(binding => binding.conversationId)]);
    const docs = root.query(`SELECT id, owner_id, scope_kind FROM documents WHERE kind='"pi.agent"' AND retired_at IS NULL`).all() as { id: number; owner_id: number; scope_kind: string }[];
    for (const doc of docs) {
      const stored = storedDocument(root, doc.id) as { model?: { provider: string; modelId: string }; tools?: unknown; extensions?: unknown };
      if (stored.model && !available.some(model => model.provider === stored.model!.provider && model.id === stored.model!.modelId))
        throw Error("Persisted host model not approved");
      if (doc.scope_kind !== "conversation" || !active.has(doc.owner_id)) continue;
      if (Array.isArray(stored.tools) && stored.tools.some(name => !applicationToolNames.includes(name)))
        throw Error("Persisted host tool not available");
      // Only the recognised previous factory default converges. Explicit custom
      // subsets/filters, modelTools, instructions and extensions remain intact.
      if (isFactoryDefault(stored.tools)) toolUpgrades.push(doc.owner_id);
    }
    if (toolUpgrades.length) { assert(); assertToolUpgradeIdle(root); }
  }
  // Automatic selection inherits the parent; explicit exact models use the same
  // installed approval/classification/exclusion policy, without a parent-tier cap.
  assertDelegateModel = (model: { provider: string; modelId: string }) => {
    if (!delegate) throw Error("Native Delegate unavailable");
    delegate.assertCurrent(); check({ provider: model.provider, id: model.modelId }, lifetime.signal);
    const config = extensionKvGet("delegate", "config", "global");
    const candidate = { provider: model.provider, id: model.modelId, fullId: `${model.provider}/${model.modelId}` };
    if (!delegate.buildModelCandidates([candidate], config).some(entry => entry.id === candidate.fullId)) throw Error("Native Delegate model not approved");
  };
  const requestSources = new WeakMap<AbortSignal, Awaited<ReturnType<HostConversationRuntime["captureRunSource"]>>>();
  const models = createHostModels(host.modelRuntime, available.map(model => ({ provider: model.provider, id: model.id })), { signal: lifetime.signal,
    async captureSourceGuard(signal) {
      const scope = taskModelRequestScope(signal);
      if (!scope) throw Error("Native model request source unavailable");
      if (scope.taskKind === "pi.generation") {
        const captured = await runtime().captureRunSource(scope.conversationId, scope.taskId);
        requestSources.set(scope.signal, captured);
        return () => {
          signal!.throwIfAborted();
          runtime().assertCapturedSourceCurrent(captured.inputs);
          if (captured.delegateModel) assertDelegateModel(captured.delegateModel);
        };
      }
      const check = () => runtime().assertMaintenanceRequest(scope);
      check();
      return check;
    },
    async prepareRequest(model, options, signal) {
      const scope = taskModelRequestScope(options?.signal);
      if (!scope || scope.taskKind !== "pi.generation") return undefined;
      const captured = requestSources.get(scope.signal);
      if (!captured) throw Error("Native request source capture unavailable");
      if (root.query("SELECT 1 FROM service_effect_s07_occurrences WHERE operation_id=?").get(captured.operation.operationId)) return undefined;
      return reserveHostRequest({ database: root, operationId: captured.operation.operationId,
        chatJid: captured.operation.chatJid, authPath: join(getPiclawAgentDir(), "auth.json"), model: model as any,
        maxTokens: options?.maxTokens, executionKind: captured.delegateModel ? "delegate" : "interactive", signal,
        assertCurrent() { assert(); scope.signal.throwIfAborted(); runtime().assertCapturedSourceCurrent(captured.inputs); if (captured.delegateModel) assertDelegateModel(captured.delegateModel); } });
    },
    async authorize(model, _kind, signal) { check(model, signal); }, assertCurrent(model, _kind, signal) { check(model, signal); } });
  const registry = createRegistry();
  // Preserve old persisted extension names without depending on their hook selection.
  registry.install(defineExtension({ name: "app.host-scheduled-source" }));
  const tools = createHostBuiltinTools({ cwd: WORKSPACE_DIR,
    captureSourceGuard: captureSource,
    authority: { assertAllowed() {
    assert(); lifetime.signal.throwIfAborted();
    if (readAccessConfig().mode !== "single-user") throw Error("Host tool permission denied");
  } }, signal: lifetime.signal, shellPath: () => settings.getShellPath(), names: defaultToolNames });
  const builtins = [...tools];
  tools.push(createHostFetch({ async captureSource(api) {
    const source = await captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
    return () => { source(); if (readAccessConfig().mode !== "single-user") throw Error("Host fetch permission denied"); };
  } }));
  tools.push(...mcp.tools);
  if (plan) tools.push(createHostPlanTool(plan.definition as Parameters<typeof createHostPlanTool>[0], { root, assertOwner: () => {
    assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent();
  }, runtime }));
  if (codeReview) tools.push(createHostCodeReviewTool(codeReview.addon, { root, cwd: WORKSPACE_DIR, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); codeReview.assertCurrent(); } }));
  if (officeViewer) tools.push(createHostOfficeViewerTool(officeViewer.definition as Parameters<typeof createHostOfficeViewerTool>[0], { root, runtime, workspace: WORKSPACE_DIR,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); officeViewer.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Office viewer requires single-user mode");
    } }));
  if (editableTable) tools.push(createHostEditableTableTool(editableTable.addon, { root, runtime, publisher: () => widgetPublisher,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); editableTable.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Editable table requires single-user mode");
    } }));
  if (drawio) tools.push(createHostDrawioTool(drawio.addon, { root, cwd: WORKSPACE_DIR, runtime, opener: () => workspaceFileOpener,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Draw.io requires single-user mode");
    } }));
  if (delegate) {
    const readers = builtins.filter(tool => ["read", "grep", "find", "ls"].includes(tool.name));
    const readerExtension = defineExtension({ name: "app.host-delegate-readers", tools: readers });
    const standardExtension = defineExtension({ name: "app.host-delegate-standard", tools: builtins });
    registry.install(readerExtension);
    registry.install(standardExtension);
    tools.push(createHostDelegateTool(delegate.definition as Parameters<typeof createHostDelegateTool>[0], {
      assertCurrent() { assert(); lifetime.signal.throwIfAborted(); delegate.assertCurrent(); }, runtime,
      async selectModel(args, parent) {
        if (args.task_category !== undefined && !["quick", "summarize", "code", "analyze", "reason"].includes(String(args.task_category))) throw Error("Native Delegate task category not qualified");
        let model = parent;
        if (args.model !== undefined) {
          if (typeof args.model !== "string") throw Error("Delegate model must be an exact provider/model ID");
          const slash = args.model.indexOf("/");
          if (slash <= 0 || slash === args.model.length - 1) throw Error("Delegate model must be an exact provider/model ID");
          const provider = args.model.slice(0, slash), modelId = args.model.slice(slash + 1);
          const exact = available.find(entry => entry.provider === provider && entry.id === modelId);
          if (!exact) throw Error("Native Delegate model unavailable");
          model = { provider: exact.provider, modelId: exact.id };
        }
        if (!model) throw Error("Delegate parent model required");
        assertDelegateModel(model); return model;
      }, assertModelCurrent: assertDelegateModel,
      modelSupportsImages(model) {
        assertDelegateModel(model);
        const physical = host.modelRuntime.getPhysicalModel(model.provider, model.modelId);
        return physical?.provider === model.provider && physical.id === model.modelId && physical.input?.includes("image") === true;
      }, readFiles: createHostDelegateFileReader(WORKSPACE_DIR), readonlyTools: readers, readonlyExtensions: [readerExtension], standardTools: builtins, standardExtensions: [standardExtension],
    }));
  }
  sandbox = new CodemodeSandbox({ memoryLimitBytes: 128 * 1024 * 1024 });
  // Native tool description includes discovery instructions. Deliberately no dynamic
  // declaration section: scheduled model overrides retain their fail-closed budget.
  const codemode = createCodemodeTool({ sandbox, models: false });
  tools.push(defineTool<typeof codemode.parameters>({ ...codemode, async execute(args, api, context) {
    const sourceCurrent = await captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
    const assertCurrent = () => { sourceCurrent(); mcp!.assertCurrent(); };
    assertCurrent();
    const result = await codemode.execute(args, withGuardedCommit(api, assertCurrent), context);
    assertCurrent();
    return result;
  } }));
  registry.install(defineExtension({ name: "app.host-builtins", tools }));
  if (plan) registry.install(createHostPlanPrompt(plan.addon, { root, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent(); }, failClosed(error) { lifetime.abort(error); } }));
  const harnessOptions = { models, registry: withTaskModelRequestScope(registry), settings: { retry: { enabled: false } } };
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")?.file;
  if (!path) throw Error("Durable default requires a file-backed application database");
  const storage = new BunSqliteDatabase(path, { root, assertOwner: assert, fenceTransactions: true });
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  let mapping!: { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
  let primary: unknown;
  let failed = false;
  try {
    assert();
    harness = await Harness.open(await SqliteStorage.open(storage), harnessOptions, context);
    const app = await harness.root(context, { agent: { model: { provider: ref.provider, modelId: ref.id }, tools } });
    // The SDK document is the sole routing authority; host binding tables link accepted sources only.
    mapping = await app.commit(async tx => {
      const doc = await tx.doc(ApplicationConversations, app.id);
      return JSON.parse(JSON.stringify(doc)) as typeof mapping;
    }, context);
    if (!mapping.domain) {
      // A fresh host may not have its initial web header until WebChannel construction.
      storeChatMetadata("web:default", new Date().toISOString());
      const chats = root.query("SELECT c.jid, b.branch_id FROM chats c JOIN chat_branches b ON b.chat_jid=c.jid WHERE b.archived_at IS NULL ORDER BY c.jid").all() as { jid: string; branch_id: string }[];
      const bindings = [] as typeof mapping.bindings;
      for (const chat of chats) {
        assert();
        const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: ref.provider, modelId: ref.id }, tools } }, context);
        bindings.push({ chatJid: chat.jid, branchId: chat.branch_id, conversationId: conversation.id, sessionId: crypto.randomUUID() });
      }
      mapping = { version: 1, domain: crypto.randomUUID(), bindings };
      for (const binding of bindings) {
        const identity = { domain: mapping.domain, chatJid: binding.chatJid, branchId: binding.branchId, sessionId: binding.sessionId };
        // Initial creation stores one base, independently anchoring root routing identities.
        const conversation = (await harness.conversation(binding.conversationId as ConversationId, context))!;
        const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
        await conversation.commit(async tx => { await tx.doc(token, conversation.id); }, context);
      }
      await app.commit(async tx => { const doc = await tx.doc(ApplicationConversations, app.id); Object.assign(doc, mapping); }, context);
    }
    validateApplicationMapping(root, mapping);
    if (toolUpgrades.length) {
      // Same-file BEGIN IMMEDIATE fences host admissions for the whole public
      // commit. Repeat global SDK/host preflight under that lock before ANY
      // configuration, not one conversation at a time after partial writes.
      await storage.withIdleModelGuard(() => app.commit(async tx => {
        assert(); assertToolUpgradeIdle(root);
        for (const id of toolUpgrades) {
          const agent = await tx.doc(AgentDoc, id as ConversationId);
          if (!isFactoryDefault(agent.tools)) throw Error("Persisted host tool selection changed");
        }
        assert(); assertToolUpgradeIdle(root);
        for (const id of toolUpgrades) await configure(tx, id as ConversationId, { tools });
        assert(); assertToolUpgradeIdle(root);
      }, context));
    }
  } catch (error) { failed = true; primary = error; }
  // Harness.open may allocate storage before rejecting; the application connection
  // is ours even when no harness was returned. Confirm both layers closed.
  const cleanupFailures: unknown[] = [];
  if (harness) {
    try { await harness.close(context); } catch (error) { cleanupFailures.push(error); }
  }
  try { await storage.close(); } catch (error) { if (!cleanupFailures.includes(error)) cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new RuntimeStartupCleanupError(
    [...(failed ? [primary] : []), ...cleanupFailures], "Application preparation cleanup uncertain");
  if (failed) throw primary;
  assert();
  installTerminalSettlementCompositionSchema(root);
  assert(); reconcileOperationBudgetWork(root);
  const payloadDir = join(DATA_DIR, "durable-answers");
  const payloadPath = (ref: string) => join(payloadDir, createHash("sha256").update(ref).digest("hex"));
  const answers = { put(ref: string, text: string) {
    assert(); mkdirSync(payloadDir, { recursive: true });
    const file = payloadPath(ref);
    if (existsSync(file)) { if (readFileSync(file, "utf8") !== text) throw Error("Immutable answer collision"); return; }
    writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  }, resolver: { resolve(ref: string) {
    assert(); const file = payloadPath(ref); if (!existsSync(file)) return null;
    const bytes = new Uint8Array(readFileSync(file));
    return { ref, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
  } } };
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership, offlineInitialize: true, answers,
    onOperationSettled(operationId) { assert(); reconcileOperationBudgetWork(root, operationId); },
    onRuntime(value) { captureRuntime = value; },
    manifest: mapping.bindings.map(({ chatJid, branchId, conversationId }) => ({ chatJid, branchId, conversationId: conversationId as ConversationId })),
    sessions: new Map(mapping.bindings.map(binding => [binding.chatJid, binding.sessionId])),
    assertConversationAvailable() { check(ref, lifetime.signal); },
    resolveScheduledModel(label) {
      const slash = label.indexOf("/");
      const choice = { provider: label.slice(0, slash), id: label.slice(slash + 1) };
      check(choice, lifetime.signal);
      const physical = host.modelRuntime.getPhysicalModel(choice.provider, choice.id)!;
      if (!Number.isFinite(physical.contextWindow) || physical.contextWindow <= 0 ||
        !Number.isFinite(physical.maxTokens) || physical.maxTokens < 0) throw Error("Model context unavailable");
      return { provider: choice.provider, modelId: choice.id };
    },
    async createConversation(tx, chatJid, branchId) {
      assert(); check(ref, lifetime.signal);
      const doc = await tx.doc(ApplicationConversations, 1 as ConversationId);
      if (doc.domain !== mapping.domain || doc.bindings.some(b => b.chatJid === chatJid || b.branchId === branchId)) throw Error("Application mapping conflict");
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, conversation.id, { model: { provider: ref.provider, modelId: ref.id }, tools });
      const binding = { chatJid, branchId, conversationId: conversation.id, sessionId: crypto.randomUUID() };
      const identity = { domain: mapping.domain, chatJid, branchId, sessionId: binding.sessionId };
      const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
      await tx.doc(token, conversation.id);
      doc.bindings.push(binding);
      assert(); check(ref, lifetime.signal);
      return Object.freeze(binding);
    },
    runtime: { incarnation: mapping.domain, sessionId: mapping.domain, lane: "main", generation: 1, now: () => new Date().toISOString(), harnessOptions,
      codemodeExecute: tools.find(tool => tool.name === "codemode")!.execute } }, context);
  return { sessionOptions: bundle.sessionOptions, bind: bundle.bind,
    attachChannel(channel) {
      assert(); lifetime.signal.throwIfAborted();
      if (widgetPublisher) throw Error("Widget channel already attached");
      const broadcast = channel.broadcastEvent.bind(channel);
      workspaceFileOpener = channel.requestWorkspaceFileOpen?.bind(channel);
      widgetPublisher = (chatJid, key, content, options) => {
        assert(); lifetime.signal.throwIfAborted();
        broadcast("extension_ui_widget", { chat_jid: chatJid, key, content, options });
      };
    },
    stop() {
      widgetPublisher = undefined; workspaceFileOpener = undefined; lifetime.abort();
      // close seals routing synchronously; final close below joins owned cleanup.
      void mcp?.close().catch(() => {});
      void drawioHost?.close().catch(() => {});
      void closeSandbox().catch(() => {});
      bundle.stop();
    }, async close() {
      widgetPublisher = undefined; workspaceFileOpener = undefined;
      lifetime.abort(); releaseReviewSource?.();
      const results = await Promise.allSettled([mcp?.close(), closeSandbox(), drawioHost?.close()]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Native tool cleanup uncertain");
      await bundle.close();
    } };
  } catch (error) {
    lifetime.abort(); releaseReviewSource?.();
    const cleanupFailures: unknown[] = [];
    try { await mcp?.close(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await closeSandbox(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await drawioHost?.close(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    if (cleanupFailures.length) throw new RuntimeStartupCleanupError([error, ...cleanupFailures], "Native tool preparation cleanup uncertain");
    throw error;
  }
}
