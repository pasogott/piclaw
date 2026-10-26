// Single-root application composition; execution and recovery remain SDK-owned.
import type { Database } from "bun:sqlite";
import { readScheduledDefinition } from "../../src/db/scheduled-task-definitions.js";
import { resolveAcceptedMessageThread } from "./host-message-thread.js";
import { getAgentRuntimeConfig } from "../../src/core/config.js";
import { formatTimeoutDuration } from "../../src/agent-pool/prompt-utils.js";
import { getBudgetWorkContext } from "../../src/budget/context.js";
import { ensureBudgetWork, getBudgetWork } from "../../src/db/budget-limits.js";
import { operationBudgetWorkId, sidePromptSourceId } from "./host-request-accounting.js";
import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import type { SidePromptOptions, SidePromptResult } from "../../src/agent-pool/contracts.js";
import type { WebChannelOpts } from "../../src/channels/web.js";
import type { EffectPayloadResolver } from "../../src/service-effects/contracts/payload-resolver.js";
import { createCurrentPiclawServiceWorkStore } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import { createDurableConversationAdapter, type DurableAbortScope } from "../../src/agent-pool/durable-runtime-adapter.js";
import { createDurableQueueDispatch } from "../../src/agent-pool/durable-queue-dispatch.js";
import { createDurableRecoveryDispatch } from "../../src/agent-pool/durable-recovery-dispatch.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { createHostController, type HostControllerOptions } from "./host-controller.js";
import { createHostDurableBindings, assertNativeScheduledBudgetAvailable } from "./host-bindings.js";
import { assertHostSchema, initializeHostSchema, migrateHostAcceptedPayloadLookup } from "./host-schema.js";
import { readApplicationMessagePayload } from "./accepted-payload-recovery.js";
import { value, effect, sealed } from "./host-effects.js";
import { hashScheduledLeaseToken } from "../../src/service-effects/current-piclaw/scheduled-run-values.js";
import type { ScheduledRunLease } from "../../src/service-effects/contracts/scheduled-run-store.js";
import { QueuedFollowupLifecycleService } from "../../src/channels/web/runtime/queued-followup-lifecycle-service.js";
import type { QueuedFollowupItem } from "../../src/queued-followups.js";
import type { AcceptedInput, RuntimeOptions } from "./host-runtime.js";
import type { ConversationId,Tx } from "@earendil-works/pi-durable";
import { nativeBackgroundIdentity,readNativeBackgroundPayload,type NativeBackgroundPayload } from "../../src/agent-pool/background-operation-contract.js";
import { backgroundPolicyProvenance,type NativeBackgroundContext } from "./host-background-context.js";

import { createDurableQueuedSteering } from "../../src/agent-pool/durable-queued-steering.js";
import { storeWebMessage } from "../../src/channels/web/messaging/message-store.js";
import { createApplicationHostInput } from "./host-application-input.js";
import { registerNativeBranchControlGuard } from "../../src/db/native-routing-policy.js";

type Manifest = HostControllerOptions["recovery"]["manifest"];
/** Keep the full queue intent proof, plus a payload digest that remains verifiable
 * after normal materialisation removes the UI queue row. No second payload store. */
function queuedInputProvenance(item: QueuedFollowupItem): string {
  const { source_accepted, materializeRetries, ...immutable } = item;
  return `application:queued:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutable)))}:${hashCanonicalRequest({ content: item.queuedContent })}`;
}
/** Validate existing host routing before any import/journal/schema write. */
export function assertApplicationBranchRoutes(root: Database, manifest: readonly { chatJid: string; branchId: string }[], historicalBindings = false) {
  for (const binding of manifest) {
    const row = root.query("SELECT branch_id, archived_at FROM chat_branches WHERE chat_jid=?").get(binding.chatJid) as
      { branch_id: string; archived_at: string | null } | null;
    // Keep the existing explicit synthetic main binding contract unchanged.
    if (binding.branchId !== "main" && (!row || row.branch_id !== binding.branchId || !historicalBindings && row.archived_at !== null))
      throw Error("Exact application branch manifest required");
  }
}
/** Borrowing seals only this controller scope. The application keeps the original lock
 * handle and releases it AFTER all services, root DB and other components shut down. */
export function applicationOwnership(lock: RuntimeLockHandle) {
  const assert = () => {
    if (!lock.enabled || !lock.strictOwnership) throw Error("Strict application ownership required");
    lock.assertCurrentOwner();
  };
  assert();
  return Object.freeze({ borrow() {
    assert(); let sealed = false;
    return Object.freeze({ assertCurrentOwner() { if (sealed) throw Error("Borrowed ownership sealed"); assert(); },
      release() { sealed = true; } });
  } });
}

export interface ApplicationBootstrapOptions {
  root: Database;
  path: string;
  background?: {
    contexts:readonly NativeBackgroundContext[];
    payloads:ReadonlyMap<string,NativeBackgroundPayload>;
    sourceIdForAddon(operationId:string):string;
    prepareAddon(operationId:string,existing:NativeBackgroundPayload|undefined):NativeBackgroundPayload;
    assertCurrent(payload:NativeBackgroundPayload):void;
    /** Installed only with fully qualified model/tool/accounting/abort ports. */
    assertExecution?: (payload:NativeBackgroundPayload)=>void;
    put(payload:NativeBackgroundPayload):void|Promise<void>;
    publish(tx:Tx,payload:NativeBackgroundPayload):Promise<NativeBackgroundContext>;
  };
  ownership: ReturnType<typeof applicationOwnership>;
  manifest: Manifest;
  /** Original host session identities, not a new bootstrap-generated identity. */
  sessions: ReadonlyMap<string, string>;
  offlineInitialize?: boolean;
  /** Validated default manifest retains archived historical bindings. Admission
   * still requires current active host policy; copied/import plans stay strict. */
  historicalBindings?: boolean;
  /** Publish the existing runtime before recovery can schedule any provider. */
  onMaintenanceSettled?: (workId: string) => void;
  onOperationSettled?: RuntimeOptions["onOperationSettled"];
  prepareTerminalEffect?: RuntimeOptions["prepareTerminalEffect"];
  materializeAnswer?: RuntimeOptions["materializeAnswer"];
  dispatchHostCommand?: import("../../src/agent-pool/contracts.js").AgentPoolOptions["dispatchHostCommand"];
  requestProcessExit?: (reason: string) => Promise<void>;
  readExecutionPolicy?: () => {autoCompact: boolean; autoRetry: boolean};
  setExecutionPolicy?: (name: "autoCompact" | "autoRetry", enabled: boolean) => void;
  onRuntime?: (runtime: import("./host-runtime.js").HostConversationRuntime) => void;
  assertConversationAvailable?: () => void;
  assertAdmission?: RuntimeOptions["assertAdmission"];
  /** Host-owned physical catalog approval; no credentials or provider execution. */
  resolveScheduledModel?: (label: string) => { provider: string; modelId: string };
  observeSidePrompt?: (sourceId: string, observer: NonNullable<SidePromptOptions["onEvent"]>) => () => void;
  /** Synchronous final admission check on already materialised immutable input. */
  assertInputAdmission?: (chatJid: string, content: string) => void;
  prepareInputText?: NonNullable<WebChannelOpts["prepareInputText"]>;
  createConversation?: (tx: import("@earendil-works/pi-durable").Tx, chatJid: string, branchId: string) => Promise<Manifest[number] & { sessionId: string }>;
  runtime: Pick<HostControllerOptions["runtime"], "incarnation" | "sessionId" | "lane" | "generation" | "harnessOptions" | "now" | "codemodeExecute" | "onStorageFailure">;
  /** Existing application payload store, with immutable answer references. */
  answers: { resolver: EffectPayloadResolver; put(ref: string, text: string): void | Promise<void> };
  /** Optional acknowledgement boundary; the supplied operation still performs the real wait. */
  wrapWait?: (wait: NonNullable<import("../../src/agent-pool/durable-runtime-adapter.js").DurableConversationRuntimePort["wait"]>) => NonNullable<import("../../src/agent-pool/durable-runtime-adapter.js").DurableConversationRuntimePort["wait"]>;
}

export async function createApplicationBootstrapBundle(config: ApplicationBootstrapOptions, context: Context) {
  const lease = config.ownership.borrow(), assert = () => lease.assertCurrentOwner();
  assert();
  const root = config.root, path = config.path, r = { ...config.runtime };
  const wrapWait = config.wrapWait;
  const createConversation = config.createConversation?.bind(config);
  const resolveScheduledModel = config.resolveScheduledModel?.bind(config);
  const assertInputAdmission = config.assertInputAdmission?.bind(config);
  const prepareInputText = config.prepareInputText?.bind(config);
  let database: BunSqliteDatabase | undefined;
  let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
  let releaseBranchControlGuard: (() => void) | undefined;
  try {
  const manifest = Object.freeze(config.manifest.map(b => Object.freeze({ ...b })));
  const sessions = new Map(config.sessions);
  const chats = new Set(manifest.map(b => b.chatJid));
  // Capture and validate the complete scope before the first await or port construction.
  // Never normalize identities here: session keys must match the canonical manifest exactly.
  const canonical = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id === id.trim();
  if (!manifest.length || chats.size !== manifest.length || sessions.size !== chats.size ||
    [...sessions].some(([chat, session]) => !canonical(chat) || !chats.has(chat) || !canonical(session)) ||
    new Set(manifest.map(b => b.conversationId)).size !== manifest.length ||
    manifest.some(b => !canonical(b.chatJid) || !canonical(b.branchId) || !sessions.has(b.chatJid) || !Number.isSafeInteger(b.conversationId) || b.conversationId <= 0))
    throw Error("Exact application branch manifest required");
  // Root branches already have distinct chat JIDs (UNIQUE in chat_branches).
  // Never invent a branch or choose a first/default row for an existing chat.
  assertApplicationBranchRoutes(root, manifest, config.historicalBindings === true);
  const routeIndex = new Map(manifest.map(b => [b.chatJid, Object.freeze({ ...b, sessionId: sessions.get(b.chatJid)! })]));
  const backgroundSource = config.background;
  const background = backgroundSource&&Object.freeze({contexts:backgroundSource.contexts.map(entry=>Object.freeze({...entry})),payloads:new Map(backgroundSource.payloads),
    sourceIdForAddon:backgroundSource.sourceIdForAddon.bind(backgroundSource),prepareAddon:backgroundSource.prepareAddon.bind(backgroundSource),
    assertCurrent:backgroundSource.assertCurrent.bind(backgroundSource),assertExecution:backgroundSource.assertExecution?.bind(backgroundSource),put:backgroundSource.put.bind(backgroundSource),publish:backgroundSource.publish.bind(backgroundSource)});
  const privateIndex = new Map((background?.contexts??[]).map(b=>[b.chatJid,Object.freeze({...b})]));
  const backgroundPayloads = new Map(background?.payloads??[]);
  if(privateIndex.size!==(background?.contexts.length??0)||new Set([...privateIndex.values()].map(entry=>entry.conversationId)).size!==privateIndex.size)throw Error('Duplicate private background identity');
  if([...privateIndex.values()].some(b=>routeIndex.has(b.chatJid)||manifest.some(publicBinding=>publicBinding.conversationId===b.conversationId||publicBinding.branchId===b.branchId)))throw Error('Private background context overlaps a public route');
  const recoveryManifest = [...manifest,...privateIndex.values()].map(({chatJid,branchId,conversationId})=>({chatJid,branchId,conversationId}));
  const scopeFor = (chat:string)=>routeIndex.get(chat)??privateIndex.get(chat);
  const lookup = (chat: string, branch: string) => {
    const binding = scopeFor(chat);
    if (binding?.branchId !== branch) return undefined;
    if(privateIndex.get(chat)===binding)return binding;
    // Match the explicit synthetic-main contract used by branch preflight.
    if (branch !== "main" && !root.query(
      "SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL",
    ).get(chat, branch)) return undefined;
    return binding;
  };
  if (root.inTransaction || (root.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1)
    throw Error("Open idle FK-enabled root connection required");
  // Verify physical identity BEFORE any optional host schema mutation.
  database = new BunSqliteDatabase(path, { root, assertOwner: assert, fenceTransactions: true });
  const candidateDatabase = database;
    if (config.offlineInitialize === true) initializeHostSchema(root, assert);
    else {
      assertHostSchema(root);
      migrateHostAcceptedPayloadLookup(root, assert);
    }
    const hostFollowups = new QueuedFollowupLifecycleService();
    const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {}, validateAcceptance() { assert(); return true; },
      pendingQueuedSourceOrder: chat => {
        // Materialization already selected this input and removed its queue card.
        // A concurrent reorder of the remaining cards must not steal its claim.
        const selected = root.query(`SELECT s.source_id FROM service_effect_s01_sources s
          JOIN messages m ON m.chat_jid=s.chat_jid AND m.id=s.source_id
          WHERE s.chat_jid=? AND s.state='pending' AND s.payload_ref='queued-source:' || s.source_id
          ORDER BY m.rowid`).all(chat) as { source_id: string }[];
        return [...selected.map(row => row.source_id), ...hostFollowups.getPendingQueuedSourceOrder(chat)];
      },
    }));
    const terminal = value(createCurrentPiclawTerminalSettlementStore(root, config.answers.resolver,
      { hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return true; } }));
    // Resolve only actual root messages and verify both accepted reference and source identity.
    async function content(ref: string, input: AcceptedInput | { chatJid: string; sourceId: string }) {
      assert();
      if(input.sourceId.startsWith('background:')){
        const payload=backgroundPayloads.get(input.sourceId);
        if(!payload||ref!==payload.policy.sourceId||nativeBackgroundIdentity(payload.policy).chatJid!==input.chatJid||!(privateIndex.has(input.chatJid)))throw Error('Unverified background input payload');
        return payload.prompt;
      }
      if (input.sourceId.startsWith("side-prompt:") && ref === input.sourceId &&
        (!("conversationId" in input) || bindings.resolveConversation(input) === input.conversationId)) {
        const payload = await config.answers.resolver.resolve(ref); assert();
        if (!payload || payload.ref !== ref || payload.mediaType !== "text/plain" || payload.redactionClass !== "private") throw Error("Unverified side prompt payload");
        const bytes = Uint8Array.from(payload.bytes);
        if (bytes.byteLength !== payload.byteLength || createHash("sha256").update(bytes).digest("hex") !== payload.sha256) throw Error("Unverified side prompt payload");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      if ("conversationId" in input && bindings.resolveConversation(input) === input.conversationId) {
        const row = root.query(`SELECT r.task_id,r.task_revision FROM main.service_effect_s07_occurrences r
          JOIN main.service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision
            AND h.next_run_at=r.scheduled_for AND h.status='active'
          WHERE r.run_id=? AND r.operation_id=? AND r.accepted_source_seq=?`).get(input.sourceId, input.operationId, input.sourceSeq) as
          { task_id: string; task_revision: number } | null;
        if (!row) throw Error("Unverified scheduled payload");
        const definition = readScheduledDefinition(root, row.task_id, row.task_revision);
        if (!definition.body || definition.body.chat_jid !== input.chatJid || definition.snapshot.payloadRef !== ref) throw Error("Unverified scheduled payload");
        return definition.body.prompt;
      }
      return readApplicationMessagePayload(root, r.incarnation, input, ref);
    }
    const resolveBackground = (input:AcceptedInput) => {
      if(!input.sourceId.startsWith('background:'))return undefined;
      const payload=backgroundPayloads.get(input.sourceId),scope=privateIndex.get(input.chatJid);
      if(!payload||!scope)return undefined;
      const id=nativeBackgroundIdentity(payload.policy);
      if(id.contextKey!==scope.contextKey||id.chatJid!==input.chatJid||id.branchId!==input.branchId||id.operationId!==input.operationId||id.sourceId!==input.sourceId||input.payloadRef!==id.payloadRef||input.requestId!==id.requestId||input.conversationId!==scope.conversationId||
        input.requestHash!==hashCanonicalRequest({type:'input',requestId:id.requestId,content:payload.prompt}))throw Error('Background native binding conflict');
      const proof=root.query(`SELECT 1 FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq
        JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=o.operation_id
        WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.kind='internal' AND s.provenance_ref=? AND o.operation_id=?`)
        .get(input.chatJid,input.sourceSeq,id.sourceId,id.payloadRef,backgroundPolicyProvenance(payload),id.operationId);
      if(!proof)throw Error('Background accepted source proof missing');return scope.conversationId;
    };
    const bindings = createHostDurableBindings(root, { domain: r.incarnation, incarnation: r.incarnation, manifest:recoveryManifest, getConversationBinding: lookup,
      assertOwner: assert, resolveContent: content,resolveBackground,
      assertBackgroundExecution(input){const payload=backgroundPayloads.get(input.sourceId);if(!payload||!background)throw Error('Background authority unavailable');background.assertCurrent(payload);
        if(!background.assertExecution)throw Error('Native background execution port is not qualified');
        const result:unknown=background.assertExecution(payload);if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('Background execution guard must be synchronous');}} });
    controller = await createHostController({ acquireOwnership: async () => lease,
      createStorage: async () => SqliteStorage.open(candidateDatabase),
      runtime: { ...r, work, terminal, bindings, assertAdmission: config.assertAdmission, materializeAnswer: config.materializeAnswer, prepareTerminalEffect: config.prepareTerminalEffect, onOperationSettled: config.onOperationSettled, onMaintenanceSettled: config.onMaintenanceSettled, putAnswer: config.answers.put.bind(config.answers),
        replyThreadFor(input) { assert(); return resolveAcceptedMessageThread(root, input); },
        cancelOperationSource(input, expectedVersion, retryTaskId) {
          root.transaction(() => {
            assert();
            const operation = root.query("SELECT version,phase,cancellation_source_seq FROM service_effect_s01_operations WHERE operation_id=? AND chat_jid=?")
              .get(input.operationId, input.chatJid) as { version: number; phase: string; cancellation_source_seq: number | null } | null;
            if (!operation || operation.version !== expectedVersion || operation.phase === "terminal") throw Error("Abort operation changed");
            if (operation.cancellation_source_seq !== null) return;
            if (retryTaskId !== undefined) {
              const row = root.query("SELECT record FROM tasks WHERE id=? AND abort_requested=0 AND status<>'terminal'").get(retryTaskId) as {record:string} | null;
              const task = row && JSON.parse(row.record);
              if (!task || task.kind !== "pi.generation" || task.conversationId !== input.conversationId || task.state.checkpoint?.phase !== "retry") throw Error("Retry backoff already changed; no operation was cancelled");
            }
            const id = `operator-abort:${input.operationId}`;
            work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: input.chatJid, sourceId: id,
              kind: "cancellation", payloadRef: id, targetOperationId: input.operationId, parentSourceSeq: input.sourceSeq,
              acceptedAt: r.now(), createWakeIntent: false }), expectedVersion, "operator_abort", root);
            assert();
          }).immediate();
        },
        cancelSideSource(input) {
          root.transaction(() => {
            assert();
            const operation = root.query("SELECT version,cancellation_source_seq FROM service_effect_s01_operations WHERE operation_id=?").get(input.operationId) as { version: number; cancellation_source_seq: number | null } | null;
            if (!operation) throw Error("Missing side operation");
            if (operation.cancellation_source_seq !== null) return;
            const id = `side-cancel:${input.sourceId}`;
            work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: input.chatJid, sourceId: id,
              kind: "cancellation", payloadRef: id, targetOperationId: input.operationId, parentSourceSeq: input.sourceSeq,
              acceptedAt: r.now(), createWakeIntent: false }), operation.version, "side_prompt_cancelled", root);
            assert();
          }).immediate();
        },
        withPromptContextGuard: (check, body) => candidateDatabase.withAdmissionGuard(check, body),
        withIdleModelGuard: body => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withIdleModelGuard(body)),
        withCompactionGuard: body => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withCompactionGuard(body)),
        withSessionResetGuard: (chatJid, body) => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withSessionResetGuard(chatJid, body)),
        existingConversationIds: recoveryManifest.map(b => b.conversationId),
        operationConversationFor: input => bindings.resolveConversation(input),
        conversationFor(chat, branch) { const b = lookup(chat, branch); if (!b) throw Error("Unbound conversation"); return b.conversationId; } },
      recovery: { manifest:recoveryManifest, work, bindings, async readAcceptedInput(source) {
        assert();
        if (source.kind !== "message" && source.kind !== "scheduled_agent" && source.kind !== "internal") throw Error("Unsupported recovered source");
        const binding = await bindings.findSource(source.chatJid, source.sourceSeq);
        const pendingSideOperation = !binding && source.kind === "internal" ? root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
          JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
          WHERE o.chat_jid=? AND o.primary_source_seq=? AND o.phase='claimed' AND o.harness_session_id IS NULL`).get(source.chatJid, source.sourceSeq) as { operation_id: string } | null : null;
        const operationId = binding?.operationId ?? pendingSideOperation?.operation_id ?? source.targetOperationId;
        if (!operationId) throw Error("Missing recovered operation identity");
        const operation = value(await work.getOperation(operationId));
        const scope = scopeFor(source.chatJid);
        if (!operation || !scope) throw Error("Missing recovered operation");
        return { claimed: { source, operation }, branchId: scope.branchId,
          requestId: binding?.requestId ?? (pendingSideOperation ? source.sourceId : `queued-steer:${source.sourceId}`), content: await content(source.payloadRef, (source.kind === "scheduled_agent" || source.kind === "internal") && binding ? binding : source) };
      } },
    }, context);
    const activeController = controller;
    const runtime = activeController.runtime;
    config.onRuntime?.(runtime);
    const wait = wrapWait?.(runtime.wait.bind(runtime));
    const runtimePort = new Proxy(runtime, { get(target, key) {
      if (key === "wait" && wait) return wait;
      if (key === "reconcileMaintenance") return (binding: Parameters<typeof runtime.reconcileMaintenance>[0]) => {
        assertLive();
        if (activeController.recoveredMaintenanceChat === binding.chatJid) {
          const current = lookup(binding.chatJid, binding.branchId);
          if (binding.incarnation !== r.incarnation || current?.conversationId !== binding.conversationId) throw Error("Host binding conflict");
          return activeController.resumeRecoveredMaintenance().then(() => {});
        }
        return runtime.reconcileMaintenance(binding);
      };
      const member = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const adapter = createDurableConversationAdapter({ incarnation: r.incarnation, manifest, getConversationBinding: lookup, runtime: runtimePort });
    const shutdown = new AbortController();
    const hostControls = new Map<Promise<unknown>, string>();
    const backgroundPreparing = new Map<string,Promise<AcceptedInput>>();
    const recovery = createDurableRecoveryDispatch({ assertCurrentWriter: assert, submitIntent: input => adapter.submitIntent(input),
      reconcileRecovered: controller.reconcileRecovered, shutdown: shutdown.signal });
    const dispatch = createDurableQueueDispatch({ work, adapter, branchId: chat => {
      const branch = routeIndex.get(chat)?.branchId; if (!branch) throw Error("Unbound application branch"); return branch;
    }, assertCurrentWriter: assert,
      runningCorrelation: id => ({ sessionId: r.sessionId, lane: r.lane, harnessOperationId: String(id), state: "running", watchGeneration: r.generation }),
      shutdown: shutdown.signal, waitForReconciliation: recovery.waitForReconciliation });
    const getInputSourceAdmission: NonNullable<WebChannelOpts["getInputSourceAdmission"]> = chat => {
      const current = () => { const binding = routeIndex.get(chat); return binding && lookup(chat, binding.branchId); };
      assert(); if (!current()) throw Error("Unbound application conversation");
      return ({ message, rowId, database: connection }) => {
        assert(); if (!current()) throw Error("Unbound application conversation");
        if (connection !== root || !root.inTransaction) throw Error("Root admission transaction required");
        if (message.chat_jid !== chat) throw Error("Input admission chat mismatch");
        const stored = root.query("SELECT id, chat_jid, is_bot_message FROM messages WHERE rowid=?").get(rowId) as { id: string; chat_jid: string; is_bot_message: number } | null;
        if (!Number.isSafeInteger(rowId) || rowId <= 0 || stored?.id !== message.id || stored.chat_jid !== chat || stored.is_bot_message !== 0)
          throw Error("Input admission message row mismatch");
        const input = { effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
          provenanceRef: "application:durable", redactionClass: "private" as const }, chatJid: chat, sourceId: message.id,
          kind: "message" as const, payloadRef: `message-row:${rowId}`, targetOperationId: null, parentSourceSeq: null,
          acceptedAt: message.timestamp, createWakeIntent: false };
        input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
        const checkInput = () => {
          const result = assertInputAdmission?.(chat, message.content);
          if (result !== undefined) {
            void Promise.resolve(result).catch(() => {});
            throw Error("Input admission guard must be synchronous");
          }
        };
        checkInput();
        work.acceptSourceInTransaction(input, connection);
        checkInput();
        assert();
      };
    };
    const getQueuedInputSourceAdmission: NonNullable<WebChannelOpts["getQueuedInputSourceAdmission"]> = chat => {
      const scope = routeIndex.get(chat);
      const check = () => {
        assert(); config.assertAdmission?.();
        if (!scope || routeIndex.get(chat) !== scope || lookup(chat, scope.branchId) !== scope) throw Error("Unbound queued input chat");
      };
      check();
      return ({ chatJid, item, database: connection }) => {
        check();
        if (connection !== root || !root.inTransaction || chatJid !== chat || !item.source_id) throw Error("Root queued admission required");
        work.acceptSourceInTransaction(sealed({ effect: { ...effect(`queue:${item.source_id}`),
          provenanceRef: queuedInputProvenance(item) }, chatJid: chat, sourceId: item.source_id, kind: "message",
          payloadRef: `queued-source:${item.source_id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: item.queuedAt, createWakeIntent: false }), root);
        check();
      };
    };
    const getQueuedInputMaterialization: NonNullable<WebChannelOpts["getQueuedInputMaterialization"]> = chat => {
      assert(); if (!routeIndex.get(chat) || !lookup(chat, routeIndex.get(chat)!.branchId)) throw Error("Unbound queued input chat");
      return ({ chatJid, item, message, database: connection }) => {
        assert();
        if (connection !== root || !root.inTransaction || chatJid !== chat || item.source_id !== message.id) throw Error("Root queued materialization required");
        const source = work.getAcceptedSource(chat, message.id);
        if (!source || source.kind !== "message" || source.payloadRef !== `queued-source:${message.id}` || source.provenanceRef !== queuedInputProvenance(item) || source.state !== "pending")
          throw Error("Queued source payload conflict");
        assert();
      };
    };
    const getQueuedInputSourceWithdrawal: NonNullable<WebChannelOpts["getQueuedInputSourceWithdrawal"]> = chat => {
      assert(); if (!routeIndex.get(chat) || !lookup(chat, routeIndex.get(chat)!.branchId)) throw Error("Unbound queued input chat");
      return ({ chatJid, item, database: connection }) => {
        assert();
        if (connection !== root || !root.inTransaction || chatJid !== chat || !item.source_id) throw Error("Root queued withdrawal required");
        const source = work.getAcceptedSource(chat, item.source_id);
        const stored = root.query("SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get(chat, item.source_id) as { source_hash: string } | null;
        if (!source || !stored || source.payloadRef !== `queued-source:${item.source_id}` || source.provenanceRef !== queuedInputProvenance(item))
          throw Error("Queued withdrawal payload conflict");
        const request = { effect: { ...effect(`withdraw:${item.source_id}`), provenanceRef: "application:queue-remove" },
          chatJid: chat, sourceId: item.source_id, sourceHash: stored.source_hash, payloadRef: source.payloadRef, actor: "application:queue-remove" };
        request.effect.requestHash = hashCanonicalRequest({ method: "withdrawUnclaimedSource.v1", ...request });
        work.withdrawUnclaimedSourceInTransaction(request, root);
        assert();
      };
    };
    const getDurableSession = (chat: string) => {
      const binding = routeIndex.get(chat);
      if (!binding || !lookup(chat, binding.branchId)) return undefined;
      const assertCurrent = () => {
        assertLive();
        if (routeIndex.get(chat) !== binding || lookup(chat, binding.branchId)?.conversationId !== binding.conversationId) throw Error("Host control binding changed");
      };
      const readAbortScope = async (): Promise<DurableAbortScope | null> => {
        assertCurrent();
        const frontier = value(await work.getChatFrontier(chat)); assertCurrent();
        if (!frontier.activeOperationId) return null;
        const operation = value(await work.getOperation(frontier.activeOperationId)); assertCurrent();
        if (!operation || operation.terminal) return null;
        return Object.freeze({ operationId: operation.operationId, conversationId: binding.conversationId, sourceSeq: operation.primarySourceSeq });
      };
      const abort = async (retryOnly = false, expected?: DurableAbortScope) => {
          assertCurrent();
          const frontier = value(await work.getChatFrontier(chat)); assertLive();
          if (!frontier.activeOperationId) return false;
          const operation = value(await work.getOperation(frontier.activeOperationId)); assertLive();
          if (!operation || operation.terminal) return false;
          if (expected && (expected.operationId !== operation.operationId || expected.conversationId !== binding.conversationId || expected.sourceSeq !== operation.primarySourceSeq)) return false;
          const input = await bindings.findSource(chat, operation.primarySourceSeq); assertLive();
          if (!input || input.operationId !== operation.operationId || input.conversationId !== binding.conversationId)
            throw Error("Exact ordinary abort binding required");
          return runtime.abortOperation(input, retryOnly);
      };
      return Object.freeze({ ...adapter.sessionPosition(chat, binding.branchId, binding.sessionId),
        assertCurrent, lifetimeSignal: shutdown.signal,
        ...(config.readExecutionPolicy && config.setExecutionPolicy ? {
          readExecutionPolicy: async () => { assertCurrent(); return config.readExecutionPolicy!(); },
          setExecutionPolicy: async (name: "autoCompact" | "autoRetry", enabled: boolean) => { assertCurrent(); config.assertAdmission?.(); config.setExecutionPolicy!(name, enabled); },
        } : {}),
        ...(config.requestProcessExit ? { requestExit: async (reason: string) => {
          assertCurrent(); config.assertAdmission?.();
          await config.requestProcessExit!(reason);
        } } : {}),
        runOwnedControl<T>(operation: () => Promise<T>): Promise<T> {
          assertCurrent(); config.assertAdmission?.();
          // Register before callback entry so close can join credential writes.
          const running = Promise.resolve().then(() => { assertCurrent(); config.assertAdmission?.(); return operation(); });
          hostControls.set(running, chat);
          void running.finally(() => hostControls.delete(running)).catch(() => {});
          return running;
        },
        readAbortScope, abort: (expected?: DurableAbortScope) => abort(false, expected), abortRetry: (expected?: DurableAbortScope) => abort(true, expected),
        runBash: (command: string) => { assertCurrent(); return runtime.runSessionBash({incarnation:r.incarnation,...binding}, command); },
        abortBash: () => { assertCurrent(); return runtime.abortSessionBash({incarnation:r.incarnation,...binding}); },
        async restart() {
          assertCurrent(); config.assertAdmission?.();
          await runtime.abortSessionBash({incarnation:r.incarnation,...binding}, true);
          await abort();
          const deadline = Date.now() + 5000;
          while (root.query("SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND phase<>'terminal'").get(chat)) {
            assertCurrent();
            if (Date.now() >= deadline) throw Error("Native abort is still settling; restart refused without replay. Try /restart after Idle.");
            await new Promise(resolve => setTimeout(resolve,100));
          }
          assertCurrent(); await runtime.reloadSession({incarnation:r.incarnation,...binding});
        } });
    };
    const preparing = new Map<string, Promise<void>>();
    const assertLive = () => { assert(); if (closing || shutdown.signal.aborted) throw Error("Application closing"); };
    async function prepareAddonOperation(operationId:string,signal?:AbortSignal):Promise<AcceptedInput>{
      assertLive();config.assertAdmission?.();signal?.throwIfAborted();if(!background)throw Error('Native background admission unavailable');
      const sourceId=background.sourceIdForAddon(operationId),prior=backgroundPayloads.get(sourceId);
      const payload=readNativeBackgroundPayload(background.prepareAddon(operationId,prior)),identity=nativeBackgroundIdentity(payload.policy);
      const check=()=>{assertLive();config.assertAdmission?.();signal?.throwIfAborted();const result:unknown=background.assertCurrent(payload);
        if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('Background admission guard must be synchronous');}};
      check();if(identity.sourceId!==sourceId)throw Error('Background source identity changed');
      if(routeIndex.has(identity.chatJid))throw Error('Background identity is already bound to a public/imported context');
      if(backgroundPreparing.has(sourceId))return backgroundPreparing.get(sourceId)!;
      const existing=privateIndex.get(identity.chatJid);
      if(existing&&!prior)throw Error('Explicit native continuation admission is not yet qualified');
      backgroundPayloads.set(sourceId,payload);
      let commitPossible=false;
      const preparing=(async()=>{
        await background.put(payload);check();
        let scope=existing;
        if(!scope){commitPossible=true;
          const created=await candidateDatabase.withAdmissionGuard(check,()=>activeController.addConversation(tx=>background.publish(tx,payload),check));check();
          if(created.contextKey!==identity.contextKey||created.chatJid!==identity.chatJid||created.branchId!==identity.branchId)throw Error('Published background context mismatch');
          scope=Object.freeze({...created});privateIndex.set(identity.chatJid,scope);
        }
        if(scope.contextKey!==identity.contextKey||scope.branchId!==identity.branchId)throw Error('Background owner context changed');
        const context=scope;
        commitPossible=true;
        const accepted=root.transaction(()=>{
          check();const current=work.getAcceptedSource(identity.chatJid,identity.sourceId);
          if(current){
            const row=root.query('SELECT source_seq,request_hash,conversation_id FROM piclaw_durable_bindings_v1 WHERE domain=? AND incarnation=? AND operation_id=?')
              .get(r.incarnation,r.incarnation,identity.operationId) as {source_seq:number;request_hash:string;conversation_id:number}|null;
            if(!row||row.source_seq!==current.sourceSeq||row.conversation_id!==context.conversationId||row.request_hash!==hashCanonicalRequest({type:'input',requestId:identity.requestId,content:payload.prompt}))throw Error('Background replay binding unavailable');
            const budget=getBudgetWork(operationBudgetWorkId(identity.operationId),root);
            if(!budget||budget.chat_jid!==identity.chatJid||budget.execution_kind!=='background'||budget.parent_work_id!==payload.policy.workId)throw Error('Background replay budget ancestry unavailable');
            return current.sourceSeq;
          }
          const frontier=root.query('SELECT consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?').get(identity.chatJid) as {consumed_through_source_seq:number;active_operation_id:string|null}|null;
          if(frontier?.active_operation_id)throw Error('Background owner already has accepted work');
          const provenanceRef=backgroundPolicyProvenance(payload);
          const claimed=work.acceptAndClaimSourceInTransaction(sealed({effect:{...effect(`accept:${sourceId}`),provenanceRef},chatJid:identity.chatJid,sourceId,kind:'internal',payloadRef:sourceId,targetOperationId:null,parentSourceSeq:null,acceptedAt:payload.policy.acceptedAt,createWakeIntent:false}),
            sealed({effect:{...effect(`claim:${sourceId}`),provenanceRef},chatJid:identity.chatJid,expectedFrontier:frontier?.consumed_through_source_seq??0,newOperationId:identity.operationId,claimedAt:r.now()}),root);
          root.query(`INSERT INTO piclaw_durable_bindings_v1(domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(r.incarnation,r.incarnation,context.conversationId,identity.chatJid,identity.branchId,identity.operationId,claimed.source.sourceSeq,sourceId,sourceId,sourceId,hashCanonicalRequest({type:'input',requestId:sourceId,content:payload.prompt}));
          ensureBudgetWork({id:operationBudgetWorkId(identity.operationId),chatJid:identity.chatJid,executionKind:'background',parentWorkId:payload.policy.workId},root);
          check();return claimed.source.sourceSeq;
        }).immediate();
        const input:AcceptedInput=Object.freeze({incarnation:r.incarnation,conversationId:context.conversationId,chatJid:identity.chatJid,branchId:identity.branchId,operationId:identity.operationId,
          sourceSeq:accepted,sourceId,payloadRef:sourceId,requestId:sourceId,requestHash:hashCanonicalRequest({type:'input',requestId:sourceId,content:payload.prompt})});
        check();if(resolveBackground(input)!==input.conversationId)throw Error('Accepted background correlation failed');return input;
      })();
      const pending=preparing.then(input=>{backgroundPreparing.delete(sourceId);return input;},error=>{if(!commitPossible)backgroundPreparing.delete(sourceId);throw error;});
      backgroundPreparing.set(sourceId,pending);return pending;
    }
    function prepareInputSourceAdmission(chat: string): Promise<void> {
      assert(); config.assertAdmission?.();
      if (closing || shutdown.signal.aborted) return Promise.reject(Error("Application closing"));
      const published = routeIndex.get(chat);
      if (published) return lookup(chat, published.branchId) ? Promise.resolve() : Promise.reject(Error("Native branch is archived or changed"));
      const pending = preparing.get(chat); if (pending) return pending;
      let committedPossible = false;
      const promise = (async () => {
        config.assertConversationAvailable?.();
        if (!createConversation) throw Error("Unbound application conversation");
        const row = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
        if (!row || !canonical(chat)) throw Error("Existing root branch required");
        const assertRoot = () => {
          assertLive(); config.assertAdmission?.();
          const current = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
          if (current?.branch_id !== row.branch_id) throw Error("Root branch changed");
        };
        const binding = await candidateDatabase.withAdmissionGuard(assertRoot,
          () => activeController.addConversation(async tx => {
          assertLive(); config.assertAdmission?.();
          const current = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
          if (current?.branch_id !== row.branch_id) throw Error("Root branch changed");
          const created = await createConversation(tx, chat, row.branch_id);
          assertRoot();
          return created;
        }, () => { assertRoot(); committedPossible = true; }));
        assertRoot();
        // One publication point. Every ingress and session lookup uses this record.
        routeIndex.set(chat, Object.freeze({ ...binding }));
      })().then(() => { if (preparing.get(chat) === promise) preparing.delete(chat); }, error => {
        // Only failures proven to precede the public commit attempt are retryable.
        // Any rejection after that boundary (including publication) is uncertain.
        if (!committedPossible && preparing.get(chat) === promise) preparing.delete(chat);
        throw error;
      });
      // Uncertain failures require reopening from the canonical SDK mapping.
      preparing.set(chat, promise); return promise;
    }
    let bound = false, closing: Promise<void> | undefined;
    releaseBranchControlGuard = registerNativeBranchControlGuard(root, chats => {
      assertLive(); runtime.assertBranchControlsIdle(chats);
      if ([...hostControls.values()].some(chat => chats.includes(chat))) throw Error("Native branch has active native controls");
      return undefined;
    });
    async function allocateSidePromptConversation(raw: AcceptedInput): Promise<AcceptedInput> {
      const input = Object.freeze({ ...raw });
      const scope = routeIndex.get(input.chatJid);
      const check = () => {
        assertLive(); config.assertAdmission?.();
        if (!scope || routeIndex.get(input.chatJid) !== scope || lookup(input.chatJid, scope.branchId) !== scope || input.incarnation !== r.incarnation || input.branchId !== scope.branchId ||
          !/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.sourceId) ||
          input.requestId !== input.sourceId || input.payloadRef !== input.sourceId) throw Error("Side prompt source authority unavailable");
        if (root.query("SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1").get()) throw Error("Native side prompt budget admission unavailable");
        const source = root.query(`SELECT 1 FROM service_effect_s01_sources s
          JOIN service_effect_s01_operations o ON o.operation_id=? AND o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
          JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid AND c.active_operation_id=o.operation_id
          WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.kind='internal' AND s.state='claimed'
            AND o.phase IN ('claimed','executing')`).get(input.operationId, input.chatJid, input.sourceSeq, input.sourceId, input.payloadRef);
        if (!source) throw Error("Side prompt source authority unavailable");
      };
      check();
      const prior = await bindings.findSource(input.chatJid, input.sourceSeq); check();
      if (prior) {
        if (Object.entries(input).some(([key, value]) => key !== "conversationId" && prior[key as keyof typeof prior] !== value) ||
          bindings.resolveConversation({ ...input, conversationId: prior.conversationId }) !== prior.conversationId) throw Error("Side prompt binding conflict");
        return Object.freeze({ ...input, conversationId: prior.conversationId });
      }
      if (input.conversationId !== scope!.conversationId) throw Error("Side prompt parent mismatch");
      let allocated: AcceptedInput | undefined;
      await candidateDatabase.withHostSourceGuard(check, async tx => {
        if (!allocated) return;
        const b = allocated;
        await tx.run(`INSERT INTO piclaw_durable_bindings_v1
          (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, r.incarnation, r.incarnation, b.conversationId, b.chatJid, b.branchId,
          b.operationId, b.sourceSeq, b.sourceId, b.payloadRef, b.requestId, b.requestHash);
      }, () => runtime.allocateSidePromptFork(scope!.conversationId as ConversationId, id => { allocated = Object.freeze({ ...input, conversationId: id }); }));
      check();
      if (!allocated) throw Error("Side prompt fork not published");
      return allocated;
    }
    async function allocateScheduledConversation(raw: ScheduledRunLease): Promise<AcceptedInput> {
      const lease = structuredClone(raw), record = lease.record;
      const scope = routeIndex.get(lease.task.chatJid);
      if (!scope || lease.task.kind !== "agent") throw Error("Unbound scheduled root");
      const read = () => {
        assertLive();
        const row = root.query(`SELECT s.source_seq,s.source_id,s.payload_ref,o.operation_id,v.snapshot_json
          FROM service_effect_s07_occurrences r
          JOIN service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision AND h.status='active' AND h.next_run_at=r.scheduled_for
          JOIN service_effect_s07_task_revisions v ON v.task_id=r.task_id AND v.revision=r.task_revision
          JOIN service_effect_s01_sources s ON s.source_seq=r.accepted_source_seq AND s.source_id=r.run_id
          JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=r.operation_id
          JOIN service_effect_s01_operations o ON o.operation_id=r.operation_id AND o.primary_source_seq=s.source_seq AND o.phase IN ('claimed','executing')
          JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid AND c.active_operation_id=o.operation_id
          WHERE r.run_id=? AND r.state='source_bound' AND r.worker_id=? AND r.attempt=? AND r.task_revision=?
            AND r.lease_token_hash=? AND r.lease_expires_at>? AND s.kind='scheduled_agent' AND s.state='claimed'
            AND s.chat_jid=? AND s.payload_ref=?`)
          .get(record.runId, record.workerId, record.attempt, record.taskRevision, hashScheduledLeaseToken(lease.leaseToken), r.now(),
            scope.chatJid, lease.task.payloadRef) as
            { source_seq: number; source_id: string; payload_ref: string; operation_id: string; snapshot_json: string } | null;
        if (!row || hashCanonicalRequest(JSON.parse(row.snapshot_json)) !== hashCanonicalRequest(lease.task as unknown as CanonicalJsonValue)) throw Error("Scheduled source authority unavailable");
        const definition = readScheduledDefinition(root, record.taskId, record.taskRevision);
        if (!definition.body || definition.body.chat_jid !== scope.chatJid || definition.snapshot.payloadRef !== lease.task.payloadRef) throw Error("Scheduled payload unavailable");
        return { ...row, prompt: definition.body.prompt };
      };
      const source = read(), requestId = `scheduled:${record.runId}`;
      const label = lease.task.modelLabel;
      let model: Readonly<{ provider: string; modelId: string }> | undefined;
      const checkModel = () => {
        if (label === null) return;
        const slash = label.indexOf("/");
        if (slash <= 0 || slash === label.length - 1 || /\s/.test(label)) throw Error("Malformed scheduled model");
        if (!resolveScheduledModel) throw Error("Scheduled model override unavailable");
        const resolved = resolveScheduledModel(label);
        if (resolved.provider !== label.slice(0, slash) || resolved.modelId !== label.slice(slash + 1)) throw Error("Scheduled model resolution conflict");
        if (model && (model.provider !== resolved.provider || model.modelId !== resolved.modelId)) throw Error("Scheduled model changed");
        model ??= Object.freeze({ provider: resolved.provider, modelId: resolved.modelId });
      };
      checkModel();
      const base = { incarnation: r.incarnation, chatJid: scope.chatJid, branchId: scope.branchId,
        operationId: source.operation_id, sourceSeq: source.source_seq, sourceId: source.source_id,
        payloadRef: source.payload_ref, requestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId, content: source.prompt }) };
      const prior = await bindings.findSource(scope.chatJid, source.source_seq);
      read();
      if (prior) {
        if (Object.entries(base).some(([key, val]) => prior[key as keyof AcceptedInput] !== val)) throw Error("Scheduled binding conflict");
        return prior;
      }
      let conversationId: import("@earendil-works/pi-durable").ConversationId | undefined, persisted = false;
      await candidateDatabase.withHostSourceGuard(() => { read(); checkModel(); }, async tx => {
        if (conversationId === undefined || persisted) return;
        await tx.run(`INSERT INTO piclaw_durable_bindings_v1
          (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, r.incarnation, r.incarnation, conversationId, base.chatJid, base.branchId,
          base.operationId, base.sourceSeq, base.sourceId, base.payloadRef, base.requestId, base.requestHash);
        persisted = true;
      }, () => runtime.allocateScheduledFork(scope.conversationId, id => { conversationId = id; }, model));
      if (conversationId === undefined || !persisted) throw Error("Scheduled fork not published");
      return Object.freeze({ ...base, conversationId });
    }
    const sideContinuations = new Map<string, { identity: string; promise: Promise<SidePromptResult> }>();
    function continueSidePrompt(raw: AcceptedInput, signal?: AbortSignal): Promise<SidePromptResult> {
      assertLive();
      const input = Object.freeze({ ...raw });
      const key = JSON.stringify([input.chatJid, input.sourceId]);
      const identity = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
      const pending = sideContinuations.get(key);
      if (pending) {
        if (pending.identity !== identity) throw Error("Side prompt continuation conflict");
        return pending.promise;
      }
      const continuing = (async () => {
        const allocated = await allocateSidePromptConversation(input);
        const id = await runtime.submit(allocated);
        const operation = value(await work.getOperation(allocated.operationId)); assertLive();
        if (operation && !operation.harness) value(await work.bindHarness(sealed({
          effect: effect(`side-bind:${allocated.requestId}`, allocated.operationId, allocated.sourceSeq), expectedVersion: operation.version,
          sessionId: r.sessionId, lane: r.lane, harnessOperationId: String(id), state: "running" as const, watchGeneration: r.generation })));
        let cancelling: Promise<void> | undefined;
        let timedOut = false;
        const timeoutMs = getAgentRuntimeConfig().timeoutMs;
        const cancel = () => {
          cancelling ??= runtime.abortSidePrompt(allocated);
          void cancelling.catch(() => {}); // Joined below; never leave listener rejection unobserved.
        };
        const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; cancel(); }, timeoutMs) : undefined;
        signal?.addEventListener("abort", cancel, { once: true });
        let waitFailed = false, waitError: unknown;
        try {
          if (signal?.aborted) cancel();
          if (cancelling) await cancelling;
          else await runtime.wait(allocated, id, shutdown.signal);
          if (cancelling) await cancelling;
        } catch (error) {
          waitFailed = true; waitError = error;
        } finally {
          signal?.removeEventListener("abort", cancel);
          if (timer !== undefined) clearTimeout(timer);
          if (cancelling) {
            try { await cancelling; }
            catch (error) {
              if (waitFailed && error !== waitError) throw new AggregateError([waitError, error], "Side wait and cancellation failed");
              throw error;
            }
          }
        }
        if (waitFailed) throw waitError;
        const state = await runtime.reconcile(allocated);
        if (state.operation.cancellation) {
          if (!await runtime.settle(allocated)) throw Error("Side cancellation settlement pending");
          return { status: "error" as const, result: null, thinking: null, model: null, error: timedOut ? `Timed out after ${formatTimeoutDuration(timeoutMs)}` : "Side prompt cancelled", stopReason: "aborted" };
        }
        if (!state.answer) throw Error("Side prompt answer unavailable");
        const result = { status: "success" as const, result: state.answer.text, thinking: state.answer.message.content
          .filter(block => block.type === "thinking").map(block => block.thinking).join(""),
          model: `${state.answer.message.provider}/${state.answer.message.model}`, usage: state.answer.message.usage, stopReason: state.answer.message.stopReason };
        await config.answers.put(`side-result:${allocated.sourceId}`, JSON.stringify(result)); assertLive();
        if (!await runtime.settle(allocated)) throw Error("Side prompt settlement pending");
        return result;
      })();
      const promise = continuing.then(result => {
        sideContinuations.delete(key);
        return result;
      });
      sideContinuations.set(key, { identity, promise });
      // Keep unknown failures owned until reopen; do not replay a failed storage
      // admission in a possibly sealed SDK instance. No second request identity.
      return promise;
    }
    async function reconcileSidePrompt(chatJid: string, sourceId: string): Promise<SidePromptResult> {
      assertLive();
      const scope = routeIndex.get(chatJid);
      const source = work.getAcceptedSource(chatJid, sourceId);
      if (!scope || !source || source.kind !== "internal" || source.state !== "claimed" || source.payloadRef !== sourceId ||
        !/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sourceId)) throw Error("Unverified side prompt recovery");
      const row = root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
        JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
        JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
        WHERE o.chat_jid=? AND o.primary_source_seq=? AND o.phase IN ('claimed','executing')`).get(chatJid, source.sourceSeq) as { operation_id: string } | null;
      if (!row) throw Error("Unverified side prompt recovery");
      const prompt = await content(source.payloadRef, source); assertLive();
      return continueSidePrompt({ incarnation: r.incarnation, conversationId: scope.conversationId as ConversationId,
        chatJid, branchId: scope.branchId, operationId: row.operation_id, sourceSeq: source.sourceSeq, sourceId, payloadRef: sourceId,
        requestId: sourceId, requestHash: hashCanonicalRequest({ type: "input", requestId: sourceId, content: prompt }) });
    }
    async function dispatchSidePrompt(chatJid: string, prompt: string, options: SidePromptOptions = {}): Promise<SidePromptResult> {
      assertLive(); config.assertAdmission?.();
      options.signal?.throwIfAborted();
      if (((options.onEvent || options.onTextDelta || options.onThinkingDelta) && !config.observeSidePrompt))
        throw Error("Native side prompt options unavailable");
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100_000 ||
        (options.systemPrompt !== undefined && typeof options.systemPrompt !== "string")) throw Error("Invalid side prompt");
      // Match the existing side-session composition; do not mutate parent instructions.
      prompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
      if (prompt.length > 100_000) throw Error("Invalid side prompt");
      const scope = routeIndex.get(chatJid);
      if (!scope) throw Error("Unbound side prompt chat");
      const checkScope = () => {
        assertLive(); config.assertAdmission?.();
        if (!scope || routeIndex.get(chatJid) !== scope || lookup(chatJid, scope.branchId) !== scope) throw Error("Unbound side prompt chat");
      };
      checkScope();
      if (await runtime.readSessionPosition({ incarnation: r.incarnation, ...scope }) === null) throw Error("Side prompt history unavailable");
      checkScope();
      const context = getBudgetWorkContext();
      if (context && context.chatJid !== chatJid) throw Error("Side prompt budget context mismatch");
      const parentWorkId = options.budgetParentWorkId ?? context?.workId ?? null;
      if (parentWorkId !== null && (typeof parentWorkId !== "string" || !parentWorkId.trim() || parentWorkId.length > 1024)) throw Error("Invalid side prompt budget parent");
      const assertParent = () => {
        if (context && context.chatJid !== chatJid) throw Error("Side prompt budget context mismatch");
        if (parentWorkId !== null) {
          const parent = getBudgetWork(parentWorkId, root);
          if (!parent || parent.chat_jid !== chatJid || parent.status !== "active") throw Error("Side prompt budget parent unavailable");
        }
      };
      if (options.budgetWorkId !== undefined && typeof options.budgetWorkId !== "string") throw Error("Invalid side prompt budget identity");
      const retryId = options.budgetWorkId?.trim();
      if (options.budgetWorkId !== undefined && (!retryId || retryId.length > 1024)) throw Error("Invalid side prompt budget identity");
      const sourceId = retryId ? sidePromptSourceId(chatJid, retryId) : `side-prompt:${crypto.randomUUID()}`;
      const prior = work.getAcceptedSource(chatJid, sourceId);
      if (prior) {
        const storedPrompt = await content(sourceId, prior); checkScope();
        if (storedPrompt !== prompt || prior.kind !== "internal") throw Error("Side prompt retry identity conflict");
        const row = root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
          WHERE o.chat_jid=? AND o.primary_source_seq=?`).get(chatJid, prior.sourceSeq) as { operation_id: string } | null;
        const budget = row && getBudgetWork(operationBudgetWorkId(row.operation_id), root);
        const retryWork = retryId ? getBudgetWork(retryId, root) : null;
        if (!row || !budget || (retryId ? budget.parent_work_id !== retryId || !retryWork || retryWork.chat_jid !== chatJid ||
          retryWork.execution_kind !== "side_prompt" || retryWork.parent_work_id !== parentWorkId : budget.parent_work_id !== parentWorkId)) throw Error("Side prompt retry identity conflict");
        const committed = value(await terminal.getTerminal(row.operation_id)); checkScope();
        if (!committed) { assertParent(); return reconcileSidePrompt(chatJid, sourceId); }
        if (committed.disposition !== "completed") return { status: "error", result: null, thinking: null, model: null, error: "Side prompt cancelled", stopReason: "aborted" };
        const payload = await config.answers.resolver.resolve(`side-result:${sourceId}`); checkScope();
        if (!payload || payload.ref !== `side-result:${sourceId}` || payload.mediaType !== "text/plain" || payload.redactionClass !== "private") throw Error("Side prompt result unavailable");
        const bytes = Uint8Array.from(payload.bytes);
        if (bytes.byteLength !== payload.byteLength || createHash("sha256").update(bytes).digest("hex") !== payload.sha256) throw Error("Side prompt result unavailable");
        const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SidePromptResult;
        if (!result || result.status !== "success" || typeof result.result !== "string" ||
          (result.thinking !== null && typeof result.thinking !== "string") || typeof result.model !== "string" ||
          (result.stopReason !== "stop" && result.stopReason !== "length") ||
          !result.usage || [result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheWrite, result.usage.totalTokens,
            result.usage.cost?.input, result.usage.cost?.output, result.usage.cost?.cacheRead, result.usage.cost?.cacheWrite, result.usage.cost?.total]
            .some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw Error("Invalid side prompt stored result");
        return result;
      }
      assertParent();
      // Immutable payload may outlive denied admission; it never grants authority.
      await config.answers.put(sourceId, prompt); checkScope(); options.signal?.throwIfAborted();
      const claimed = root.transaction(() => {
        checkScope(); assertParent();
        if (root.query("SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1").get()) throw Error("Native side prompt budget admission unavailable");
        const busy = root.query(`SELECT consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?`).get(chatJid) as
          { consumed_through_source_seq: number; active_operation_id: string | null } | null;
        if (busy?.active_operation_id) throw Error("Side prompt chat is busy");
        const accepted = work.acceptAndClaimSourceInTransaction(sealed({ effect: { ...effect(`accept:${sourceId}`), provenanceRef: "application:side-prompt" },
          chatJid, sourceId, kind: "internal" as const, payloadRef: sourceId, targetOperationId: null, parentSourceSeq: null,
          acceptedAt: r.now(), createWakeIntent: false }), sealed({ effect: { ...effect(`claim:${sourceId}`), provenanceRef: "application:side-prompt" },
          chatJid, expectedFrontier: busy?.consumed_through_source_seq ?? 0, newOperationId: `operation:${sourceId}`, claimedAt: r.now() }), root);
        if (retryId) {
          if (getBudgetWork(retryId, root)) throw Error("Side prompt budget identity already used");
          ensureBudgetWork({ id: retryId, chatJid, executionKind: "side_prompt", parentWorkId }, root);
        }
        ensureBudgetWork({ id: operationBudgetWorkId(accepted.operation.operationId), chatJid, executionKind: "side_prompt", parentWorkId: retryId ?? parentWorkId }, root);
        checkScope(); return accepted;
      }).immediate();
      let observerFailed = false;
      const unobserve = config.observeSidePrompt?.(sourceId, event => {
        assertLive();
        if (observerFailed || options.signal?.aborted) return;
        try {
          const text = event.type === "text_delta" ? event.delta : undefined;
          const thinking = event.type === "thinking_delta" ? event.delta : undefined;
          options.onEvent?.(event);
          if (text !== undefined) options.onTextDelta?.(text);
          if (thinking !== undefined) options.onThinkingDelta?.(thinking);
        } catch {
          // Callback failures detach this observer, not provider accounting.
          observerFailed = true;
        }
      });
      try {
        return await continueSidePrompt({ incarnation: r.incarnation, conversationId: scope.conversationId as ConversationId,
          chatJid, branchId: scope.branchId, operationId: claimed.operation.operationId, sourceSeq: claimed.source.sourceSeq,
          sourceId, payloadRef: sourceId, requestId: sourceId, requestHash: hashCanonicalRequest({ type: "input", requestId: sourceId, content: prompt }) }, options.signal);
      } finally { unobserve?.(); }
    }
    async function dispatchScheduledAgent(lease: ScheduledRunLease): Promise<import("../../src/agent-pool.js").AgentOutput> {
      assertLive(); config.assertAdmission?.();
      // The native SDK task does not yet carry the host's per-request budget
      // reservation authority. Never treat ALS or an interactive root work ID
      // as proof of scheduled admission. Until that binding is qualified, only
      // schedules without an applicable enabled cap may allocate a fork.
      assertNativeScheduledBudgetAvailable(root, lease.task.taskId);
      const input = await allocateScheduledConversation(lease);
      const id = await runtime.submit(input); assertLive();
      const operation = value(await work.getOperation(input.operationId));
      if (!operation) throw Error("Missing scheduled operation");
      if (!operation.harness) {
        const request = { effect: { idempotencyKey: `running:${input.operationId}:${id}`, requestHash: "", operationId: input.operationId,
          sourceSeq: input.sourceSeq, provenanceRef: `scheduled_run:${input.sourceId}`, redactionClass: "private" as const },
          expectedVersion: operation.version, sessionId: r.sessionId, lane: r.lane, harnessOperationId: String(id),
          state: "running" as const, watchGeneration: r.generation };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        value(await work.bindHarness(request)); assertLive();
      }
      await runtime.wait(input, id, shutdown.signal); assertLive();
      const state = await runtime.reconcile(input);
      if (!state.answer) throw Error("Scheduled answer unavailable");
      if (!await runtime.settle(input)) throw Error("Scheduled settlement pending");
      return { status: "success", result: state.answer.text };
    }
    let inputProjection: Parameters<typeof storeWebMessage>[0] | undefined;
    const getAcceptedQueuedSteering = (chat: string, check = assertLive) => {
      assertLive(); check();
      const projection = inputProjection, scope = routeIndex.get(chat);
      if (!projection || !scope || !lookup(chat, scope.branchId)) return undefined;
      const running = root.query(`SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND phase='executing'
        AND harness_state='running' AND harness_session_id=? AND harness_lane=? AND harness_watch_generation=?`)
        .get(chat, r.sessionId, r.lane, r.generation);
      if (!running) return undefined;
      const checkProjection = () => { assertLive(); check(); if (inputProjection !== projection) throw Error("Application input projection detached"); };
      return createDurableQueuedSteering({ work, adapter, chatJid: chat, branchId: scope.branchId,
        assertCurrentWriter: checkProjection, runningBinding: { sessionId: r.sessionId, lane: r.lane, watchGeneration: r.generation },
        readQueued: id => hostFollowups.getQueuedFollowupItems(chat).find(item => item.rowId === id),
        validatePayload: stored => { checkProjection(); getQueuedInputMaterialization(chat)!(stored); checkProjection(); },
        materialize: (item, accept) => storeWebMessage(projection,
          { chatJid: chat, content: item.queuedContent, isBot: false, mediaIds: item.mediaIds ?? [], agentId: "default", agentName: "User" },
          { consumeDeferredFollowupRowId: item.rowId, materializeQueuedSource: accept, isSteeringMessage: true,
            contentBlocks: item.contentBlocks, linkPreviews: item.linkPreviews, threadId: item.threadId, screenHint: item.screenHint }),
        onPendingIntent: recovery.onPendingIntent });
    };
    const applicationInput = createApplicationHostInput({ root, domain: r.incarnation, assertCurrent: assertLive,
      routes: () => [...routeIndex.values()].filter(b => lookup(b.chatJid, b.branchId)),
      followups: hostFollowups, admission: getQueuedInputSourceAdmission,
       async steer(input, receipt, check) {
         try {
           check();
           const projection = inputProjection;
           if (!projection) throw Error("Application input projection unavailable");
           const checkProjection = () => { check(); if (inputProjection !== projection) throw Error("Application input projection detached"); };
           const steering = getAcceptedQueuedSteering(receipt.chatJid, checkProjection);
           if (!steering) return { ...receipt, mode: "new_input" as const };
           const accepted = await steering.accept(receipt.rowId);
           // Native timeline surface, after the materialization transaction committed.
           try { projection.broadcastEvent("new_post", accepted.interaction); } catch { /* Publication cannot revoke committed input. */ }
           await accepted.dispatch();
           return { ...receipt, mode: "steer" as const };
         } catch (error) {
           await hostFollowups.removeQueuedFollowupForAction(receipt.chatJid, receipt.rowId,
             { withdrawAcceptedSource: getQueuedInputSourceWithdrawal(receipt.chatJid) });
           throw error;
         }
       } });
    return Object.freeze({
      ...applicationInput,
      // Inventory only. The process coordinator supplies the original owner
      // fence, including its final check after the borrowed SDK lease closes.
      assertProcessControlIdle() {
        if (preparing.size || hostControls.size || backgroundPreparing.size) throw Error("Host admission or credential/control work is active or uncertain");
      },
      bindInputProjection(projection: Parameters<typeof storeWebMessage>[0] | undefined) {
        if (projection) { assertLive(); if (inputProjection) throw Error("Application input projection already bound"); }
        inputProjection = projection;
      },
      /** Existing native dispatcher; call only after ordinary queue materialisation. */
      dispatchAcceptedInput: dispatch,
      /** Construct pool first from this snapshot, then bind its existing channel constructor. */
      admitHostFollowup(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }, onlyIfIdle = false) {
        assertLive(); config.assertAdmission?.();
        const admission = getQueuedInputSourceAdmission(input.chatJid);
        if (!admission) throw Error("Queued admission unavailable");
        return hostFollowups.enqueueAcceptedFollowupOnce(input.sourceId, input.chatJid, input.text, input.queuedAt,
          { source: "goal.continuation" }, admission, onlyIfIdle);
      },
      prepareAddonOperation,
      sessionOptions: Object.freeze({ getDurableSession, dispatchScheduledAgent, dispatchSidePrompt,prepareAddonOperation,
        dispatchHostCommand: config.dispatchHostCommand ? (chat: string, text: string) => { assertLive(); if (!routeIndex.has(chat)) throw Error("Unbound command chat"); return config.dispatchHostCommand!(chat, text); } : undefined }),
      allocateScheduledConversation, allocateSidePromptConversation, dispatchSidePrompt, reconcileSidePrompt,
      bind(options: Pick<WebChannelOpts, "queue" | "agentPool">): Readonly<WebChannelOpts> {
        assert(); if (bound || closing) throw Error("Application bundle already bound or closing");
        bound = true;
        return Object.freeze({ ...options, prepareInputSourceAdmission, getInputSourceAdmission, getQueuedInputSourceAdmission, getQueuedInputMaterialization, getQueuedInputSourceWithdrawal,
          prepareInputText: prepareInputText ? (chat: string, text: string) => { assertLive(); if (!routeIndex.has(chat)) throw Error("Unbound input preparation"); return prepareInputText(chat, text); } : undefined,
          dispatchAcceptedInput: dispatch, getAcceptedQueuedSteering });
      },
      /** Continue the existing command worker's same-task settlement; no queue replay. */
      reconcileMaintenance(chatJid: string): Promise<void> {
        assertLive();
        const position = getDurableSession(chatJid);
        if (!position?.reconcileMaintenance) throw Error("Unbound maintenance reconciliation");
        return position.reconcileMaintenance();
      },
      retryRecoveredWork: recovery.retryRecoveredWork,
      onPendingIntent: recovery.onPendingIntent,
      stop() { inputProjection = undefined; shutdown.abort(); },
      close() { inputProjection = undefined; return closing ??= (async () => {
        shutdown.abort();
        await Promise.allSettled([...hostControls.keys()]);
        await activeController.close();
        releaseBranchControlGuard?.();
      })(); },
    } satisfies RuntimeBackend & ReturnType<typeof createApplicationHostInput> & {
      assertProcessControlIdle(): void;
      prepareAddonOperation(operationId:string,signal?:AbortSignal):Promise<AcceptedInput>;
      bindInputProjection(projection: Parameters<typeof storeWebMessage>[0] | undefined): void;
      dispatchAcceptedInput: typeof dispatch;
      admitHostFollowup(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }, onlyIfIdle?: boolean): number | null;
      allocateScheduledConversation(lease: ScheduledRunLease): Promise<AcceptedInput>;
      allocateSidePromptConversation(input: AcceptedInput): Promise<AcceptedInput>;
      dispatchSidePrompt(chatJid: string, prompt: string, options?: SidePromptOptions): Promise<SidePromptResult>;
      reconcileSidePrompt(chatJid: string, sourceId: string): Promise<SidePromptResult>;
      reconcileMaintenance(chatJid: string): Promise<void>;
      retryRecoveredWork: typeof recovery.retryRecoveredWork;
      onPendingIntent: typeof recovery.onPendingIntent;
    });
  } catch (error) {
    try {
      if (controller) await controller.close();
      else await database?.close();
      releaseBranchControlGuard?.();
      lease.release();
    } catch (cleanupError) {
      throw new RuntimeStartupCleanupError([error, cleanupError], "Application backend preparation cleanup uncertain");
    }
    throw error;
  }
}
