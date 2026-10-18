// Explicit application composition only. Not imported by the default runtime selector.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import type { WebChannelOpts } from "../../src/channels/web.js";
import type { EffectPayloadResolver } from "../../src/service-effects/contracts/payload-resolver.js";
import { createCurrentPiclawServiceWorkStore } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import { createDurableConversationAdapter } from "../../src/agent-pool/durable-runtime-adapter.js";
import { createDurableQueueDispatch } from "../../src/agent-pool/durable-queue-dispatch.js";
import { createDurableRecoveryDispatch } from "../../src/agent-pool/durable-recovery-dispatch.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { createHostController, type HostControllerOptions } from "./host-controller.js";
import { createHostDurableBindings, assertNativeScheduledBudgetAvailable } from "./host-bindings.js";
import { assertHostSchema, initializeHostSchema } from "./host-schema.js";
import { value } from "./host-effects.js";
import { hashScheduledLeaseToken } from "../../src/service-effects/current-piclaw/scheduled-run-values.js";
import type { ScheduledRunLease } from "../../src/service-effects/contracts/scheduled-run-store.js";
import type { AcceptedInput } from "./host-runtime.js";
import type { ConversationId } from "@earendil-works/pi-durable";

type Manifest = HostControllerOptions["recovery"]["manifest"];
/** Validate existing host routing before any import/journal/schema write. */
export function assertApplicationBranchRoutes(root: Database, manifest: readonly { chatJid: string; branchId: string }[]) {
  for (const binding of manifest) {
    const row = root.query("SELECT branch_id, archived_at FROM chat_branches WHERE chat_jid=?").get(binding.chatJid) as
      { branch_id: string; archived_at: string | null } | null;
    // Keep the existing explicit synthetic main binding contract unchanged.
    if (binding.branchId !== "main" && (!row || row.branch_id !== binding.branchId || row.archived_at !== null))
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
  ownership: ReturnType<typeof applicationOwnership>;
  manifest: Manifest;
  /** Original host session identities, not a new bootstrap-generated identity. */
  sessions: ReadonlyMap<string, string>;
  offlineInitialize?: boolean;
  /** Publish the existing runtime before recovery can schedule any provider. */
  onMaintenanceSettled?: (workId: string) => void;
  onOperationSettled?: (operationId: string) => void;
  onRuntime?: (runtime: import("./host-runtime.js").HostConversationRuntime) => void;
  assertConversationAvailable?: () => void;
  /** Host-owned physical catalog approval; no credentials or provider execution. */
  resolveScheduledModel?: (label: string) => { provider: string; modelId: string };
  createConversation?: (tx: import("@earendil-works/pi-durable").Tx, chatJid: string, branchId: string) => Promise<Manifest[number] & { sessionId: string }>;
  runtime: Pick<HostControllerOptions["runtime"], "incarnation" | "sessionId" | "lane" | "generation" | "harnessOptions" | "now" | "codemodeExecute">;
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
  let database: BunSqliteDatabase | undefined;
  let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
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
  assertApplicationBranchRoutes(root, manifest);
  const routeIndex = new Map(manifest.map(b => [b.chatJid, Object.freeze({ ...b, sessionId: sessions.get(b.chatJid)! })]));
  const lookup = (chat: string, branch: string) => {
    const binding = routeIndex.get(chat);
    if (binding?.branchId !== branch) return undefined;
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
    else assertHostSchema(root);
    const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {}, validateAcceptance() { assert(); return true; } }));
    const terminal = value(createCurrentPiclawTerminalSettlementStore(root, config.answers.resolver,
      { hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return true; } }));
    // Resolve only actual root messages and verify both accepted reference and source identity.
    async function content(ref: string, input: AcceptedInput | { chatJid: string; sourceId: string }) {
      assert();
      if ("conversationId" in input && input.sourceId.startsWith("side-prompt:") &&
        ref === input.sourceId && bindings.resolveConversation(input) === input.conversationId) {
        const payload = await config.answers.resolver.resolve(ref); assert();
        if (!payload || payload.ref !== ref || payload.mediaType !== "text/plain" || payload.redactionClass !== "private") throw Error("Unverified side prompt payload");
        const bytes = Uint8Array.from(payload.bytes);
        if (bytes.byteLength !== payload.byteLength || createHash("sha256").update(bytes).digest("hex") !== payload.sha256) throw Error("Unverified side prompt payload");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      if ("conversationId" in input && bindings.resolveConversation(input) === input.conversationId) {
        const row = root.query(`SELECT t.prompt FROM scheduled_tasks t
          JOIN service_effect_s07_occurrences r ON r.task_id=t.id AND r.task_revision=t.revision AND r.scheduled_for=t.next_run
          WHERE r.run_id=? AND r.operation_id=? AND r.accepted_source_seq=? AND t.chat_jid=? AND t.status='active'`).get(input.sourceId, input.operationId, input.sourceSeq, input.chatJid) as { prompt: string } | null;
        if (!row) throw Error("Unverified scheduled payload");
        return row.prompt;
      }
      const row = (/^message-row:[1-9][0-9]*$/.test(ref)
        ? root.query("SELECT id, content FROM messages WHERE rowid=? AND chat_jid=?").get(Number(ref.slice(12)), input.chatJid)
        : ref === `queued-source:${input.sourceId}`
          ? root.query("SELECT id, content FROM messages WHERE id=? AND chat_jid=?").get(input.sourceId, input.chatJid) : null) as { id: string; content: string } | null;
      if (!row || row.id !== input.sourceId) throw Error("Unverified application payload");
      return row.content;
    }
    const bindings = createHostDurableBindings(root, { domain: r.incarnation, incarnation: r.incarnation, manifest, getConversationBinding: lookup, assertOwner: assert, resolveContent: content });
    controller = await createHostController({ acquireOwnership: async () => lease,
      createStorage: async () => SqliteStorage.open(candidateDatabase),
      runtime: { ...r, work, terminal, bindings, onOperationSettled: config.onOperationSettled, onMaintenanceSettled: config.onMaintenanceSettled, putAnswer: config.answers.put.bind(config.answers),
        withIdleModelGuard: body => candidateDatabase.withIdleModelGuard(body),
        existingConversationIds: manifest.map(b => b.conversationId),
        operationConversationFor: input => bindings.resolveConversation(input),
        conversationFor(chat, branch) { const b = lookup(chat, branch); if (!b) throw Error("Unbound conversation"); return b.conversationId; } },
      recovery: { manifest, work, bindings, async readAcceptedInput(source) {
        assert();
        if (source.kind !== "message" && source.kind !== "scheduled_agent" && source.kind !== "internal") throw Error("Unsupported recovered source");
        const binding = await bindings.findSource(source.chatJid, source.sourceSeq);
        const operationId = binding?.operationId ?? source.targetOperationId;
        if (!operationId) throw Error("Missing recovered operation identity");
        const operation = value(await work.getOperation(operationId));
        const scope = routeIndex.get(source.chatJid);
        if (!operation || !scope) throw Error("Missing recovered operation");
        return { claimed: { source, operation }, branchId: scope.branchId,
          requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content: await content(source.payloadRef, (source.kind === "scheduled_agent" || source.kind === "internal") && binding ? binding : source) };
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
        work.acceptSourceInTransaction(input, connection); assert();
      };
    };
    const getDurableSession = (chat: string) => {
      const binding = routeIndex.get(chat);
      return binding && adapter.sessionPosition(chat, binding.branchId, binding.sessionId);
    };
    const preparing = new Map<string, Promise<void>>();
    const assertLive = () => { assert(); if (closing || shutdown.signal.aborted) throw Error("Application closing"); };
    function prepareInputSourceAdmission(chat: string): Promise<void> {
      assert();
      if (closing || shutdown.signal.aborted) return Promise.reject(Error("Application closing"));
      if (routeIndex.has(chat)) return Promise.resolve();
      const pending = preparing.get(chat); if (pending) return pending;
      let committedPossible = false;
      const promise = (async () => {
        config.assertConversationAvailable?.();
        if (!createConversation) throw Error("Unbound application conversation");
        const row = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
        if (!row || !canonical(chat)) throw Error("Existing root branch required");
        const binding = await activeController.addConversation(async tx => {
          assertLive();
          const current = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
          if (current?.branch_id !== row.branch_id) throw Error("Root branch changed");
          const created = await createConversation(tx, chat, row.branch_id);
          assertLive();
          return created;
        }, () => { assertLive(); committedPossible = true; });
        assertLive();
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
    async function allocateSidePromptConversation(raw: AcceptedInput): Promise<AcceptedInput> {
      const input = Object.freeze({ ...raw });
      const scope = routeIndex.get(input.chatJid);
      const check = () => {
        assertLive();
        if (!scope || input.incarnation !== r.incarnation || input.branchId !== scope.branchId ||
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
        const row = root.query(`SELECT s.source_seq,s.source_id,s.payload_ref,o.operation_id,t.prompt,v.snapshot_json
          FROM service_effect_s07_occurrences r
          JOIN service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision AND h.status='active' AND h.next_run_at=r.scheduled_for
          JOIN service_effect_s07_task_revisions v ON v.task_id=r.task_id AND v.revision=r.task_revision
          JOIN scheduled_tasks t ON t.id=r.task_id AND t.revision=r.task_revision AND t.status='active' AND t.next_run=r.scheduled_for
          JOIN service_effect_s01_sources s ON s.chat_jid=t.chat_jid AND s.source_seq=r.accepted_source_seq AND s.source_id=r.run_id
          JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=r.operation_id
          JOIN service_effect_s01_operations o ON o.operation_id=r.operation_id AND o.primary_source_seq=s.source_seq AND o.phase IN ('claimed','executing')
          JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid AND c.active_operation_id=o.operation_id
          WHERE r.run_id=? AND r.state='source_bound' AND r.worker_id=? AND r.attempt=? AND r.task_revision=?
            AND r.lease_token_hash=? AND r.lease_expires_at>? AND s.kind='scheduled_agent' AND s.state='claimed'
            AND s.chat_jid=? AND s.payload_ref=?`)
          .get(record.runId, record.workerId, record.attempt, record.taskRevision, hashScheduledLeaseToken(lease.leaseToken), r.now(),
            scope.chatJid, lease.task.payloadRef) as
            { source_seq: number; source_id: string; payload_ref: string; operation_id: string; prompt: string; snapshot_json: string } | null;
        if (!row || hashCanonicalRequest(JSON.parse(row.snapshot_json)) !== hashCanonicalRequest(lease.task as unknown as CanonicalJsonValue)) throw Error("Scheduled source authority unavailable");
        return row;
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
    async function dispatchScheduledAgent(lease: ScheduledRunLease): Promise<import("../../src/agent-pool.js").AgentOutput> {
      assertLive();
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
    return Object.freeze({
      /** Construct pool first from this snapshot, then bind its existing channel constructor. */
      sessionOptions: Object.freeze({ getDurableSession, dispatchScheduledAgent }),
      allocateScheduledConversation, allocateSidePromptConversation,
      bind(options: Pick<WebChannelOpts, "queue" | "agentPool">): Readonly<WebChannelOpts> {
        assert(); if (bound || closing) throw Error("Application bundle already bound or closing");
        bound = true;
        return Object.freeze({ ...options, prepareInputSourceAdmission, getInputSourceAdmission, dispatchAcceptedInput: dispatch });
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
      stop() { shutdown.abort(); },
      close() { return closing ??= (async () => { shutdown.abort(); await activeController.close(); })(); },
    } satisfies RuntimeBackend & {
      allocateScheduledConversation(lease: ScheduledRunLease): Promise<AcceptedInput>;
      allocateSidePromptConversation(input: AcceptedInput): Promise<AcceptedInput>;
      reconcileMaintenance(chatJid: string): Promise<void>;
      retryRecoveredWork: typeof recovery.retryRecoveredWork;
      onPendingIntent: typeof recovery.onPendingIntent;
    });
  } catch (error) {
    try {
      if (controller) await controller.close();
      else await database?.close();
      lease.release();
    } catch (cleanupError) {
      throw new RuntimeStartupCleanupError([error, cleanupError], "Application backend preparation cleanup uncertain");
    }
    throw error;
  }
}
