// Explicit application composition only. Not imported by the default runtime selector.
import type { Database } from "bun:sqlite";
import type { Context } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
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
import { createHostDurableBindings } from "./host-bindings.js";
import { assertHostSchema, initializeHostSchema } from "./host-schema.js";
import { value } from "./host-effects.js";

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
  runtime: Pick<HostControllerOptions["runtime"], "incarnation" | "sessionId" | "lane" | "generation" | "harnessOptions" | "now">;
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
  const routes = new Map(manifest.map(b => [b.chatJid, b.branchId]));
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
    async function content(ref: string, input: { chatJid: string; sourceId: string }) {
      assert();
      const row = (/^message-row:[1-9][0-9]*$/.test(ref)
        ? root.query("SELECT id, content FROM messages WHERE rowid=? AND chat_jid=?").get(Number(ref.slice(12)), input.chatJid)
        : ref === `queued-source:${input.sourceId}`
          ? root.query("SELECT id, content FROM messages WHERE id=? AND chat_jid=?").get(input.sourceId, input.chatJid) : null) as { id: string; content: string } | null;
      if (!row || row.id !== input.sourceId) throw Error("Unverified application payload");
      return row.content;
    }
    const bindings = createHostDurableBindings(root, { domain: r.incarnation, incarnation: r.incarnation, manifest, assertOwner: assert, resolveContent: content });
    controller = await createHostController({ acquireOwnership: async () => lease,
      createStorage: async () => SqliteStorage.open(candidateDatabase),
      runtime: { ...r, work, terminal, bindings, putAnswer: config.answers.put.bind(config.answers),
        withIdleModelGuard: body => candidateDatabase.withIdleModelGuard(body),
        existingConversationIds: manifest.map(b => b.conversationId),
        conversationFor(chat, branch) { const b = manifest.find(b => b.chatJid === chat && b.branchId === branch); if (!b) throw Error("Unbound conversation"); return b.conversationId; } },
      recovery: { manifest, work, bindings, async readAcceptedInput(source) {
        assert();
        if (source.kind !== "message") throw Error("Unsupported recovered source");
        const binding = await bindings.findSource(source.chatJid, source.sourceSeq);
        const operationId = binding?.operationId ?? source.targetOperationId;
        if (!operationId) throw Error("Missing recovered operation identity");
        const operation = value(await work.getOperation(operationId));
        const scope = manifest.find(b => b.chatJid === source.chatJid);
        if (!operation || !scope) throw Error("Missing recovered operation");
        return { claimed: { source, operation }, branchId: scope.branchId,
          requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content: await content(source.payloadRef, source) };
      } },
    }, context);
    const activeController = controller;
    const runtime = activeController.runtime;
    const wait = wrapWait?.(runtime.wait.bind(runtime));
    const runtimePort = wait ? new Proxy(runtime, { get(target, key) {
      if (key === "wait") return wait;
      const member = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } }) : runtime;
    const adapter = createDurableConversationAdapter({ incarnation: r.incarnation, manifest, runtime: runtimePort });
    const shutdown = new AbortController();
    const recovery = createDurableRecoveryDispatch({ assertCurrentWriter: assert, submitIntent: input => adapter.submitIntent(input),
      reconcileRecovered: controller.reconcileRecovered, shutdown: shutdown.signal });
    const dispatch = createDurableQueueDispatch({ work, adapter, branchId: chat => {
      const branch = routes.get(chat); if (!branch) throw Error("Unbound application branch"); return branch;
    }, assertCurrentWriter: assert,
      runningCorrelation: id => ({ sessionId: r.sessionId, lane: r.lane, harnessOperationId: String(id), state: "running", watchGeneration: r.generation }),
      shutdown: shutdown.signal, waitForReconciliation: recovery.waitForReconciliation });
    const getInputSourceAdmission: NonNullable<WebChannelOpts["getInputSourceAdmission"]> = chat => {
      assert(); if (!chats.has(chat)) return undefined;
      return ({ message, rowId, database: connection }) => {
        assert(); if (connection !== root || !root.inTransaction) throw Error("Root admission transaction required");
        const input = { effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
          provenanceRef: "application:durable", redactionClass: "private" as const }, chatJid: chat, sourceId: message.id,
          kind: "message" as const, payloadRef: `message-row:${rowId}`, targetOperationId: null, parentSourceSeq: null,
          acceptedAt: message.timestamp, createWakeIntent: false };
        input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
        work.acceptSourceInTransaction(input, connection); assert();
      };
    };
    const positions = new Map(manifest.map(b => [b.chatJid, adapter.sessionPosition(b.chatJid, b.branchId, sessions.get(b.chatJid)!)]));
    const readonlyPositions: ReadonlyMap<string, ReturnType<typeof adapter.sessionPosition>> = Object.freeze({
      get size() { return positions.size; }, get: positions.get.bind(positions), has: positions.has.bind(positions),
      entries: positions.entries.bind(positions), keys: positions.keys.bind(positions), values: positions.values.bind(positions),
      [Symbol.iterator]: positions[Symbol.iterator].bind(positions),
      forEach(callback: (value: ReturnType<typeof adapter.sessionPosition>, key: string, map: ReadonlyMap<string, ReturnType<typeof adapter.sessionPosition>>) => void, thisArg?: unknown) {
        positions.forEach((value, key) => callback.call(thisArg, value, key, readonlyPositions));
      },
    });
    let bound = false, closing: Promise<void> | undefined;
    return Object.freeze({
      /** Construct pool first from this snapshot, then bind its existing channel constructor. */
      sessionOptions: Object.freeze({ durableSessions: readonlyPositions }),
      bind(options: Pick<WebChannelOpts, "queue" | "agentPool">): Readonly<WebChannelOpts> {
        assert(); if (bound || closing) throw Error("Application bundle already bound or closing");
        bound = true;
        return Object.freeze({ ...options, getInputSourceAdmission, dispatchAcceptedInput: dispatch });
      },
      retryRecoveredWork: recovery.retryRecoveredWork,
      onPendingIntent: recovery.onPendingIntent,
      close() { return closing ??= (async () => { shutdown.abort(); await activeController.close(); })(); },
    });
  } catch (error) {
    if (controller) await controller.close();
    else await database?.close();
    lease.release(); throw error;
  }
}
