// INACTIVE application-owned correlation store. No database opens or automatic migrations.
import type { Database } from "bun:sqlite";
import { listBudgetCaps } from "../../src/db/budget-limits.js";

/** Native schedules have no qualified per-request reservation authority yet. */
export function assertNativeScheduledBudgetAvailable(root: Database, taskId: string): void {
  if (listBudgetCaps({ enabledOnly: true }, root).some(cap =>
    cap.scope !== "task" && (cap.scope !== "scheduled_run" || cap.scheduled_task_id === taskId)))
    throw Error("Native scheduled budget admission unavailable");
}
import { assertHostSchema, initializeHostSchemaTables } from "./host-schema.js";
import { getQueuedInputIntent } from "../../src/service-effects/current-piclaw/queued-input-intent.js";
import type { ConversationId, SubmissionId } from "@earendil-works/pi-durable";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
import { inputSnapshot, type AcceptedInput, type HostInputBinding, type HostDurableBindings } from "./host-runtime.js";

export interface HostBindingOptions {
  readonly domain: string;
  readonly incarnation: string;
  readonly assertOwner: () => void;
  readonly manifest: readonly { readonly chatJid: string; readonly branchId: string; readonly conversationId: ConversationId }[];
  readonly getConversationBinding?: (chat: string, branch: string) => { conversationId: ConversationId } | undefined;
  /** Resolve the EXISTING host payload. Never persist another plaintext copy here. */
  readonly resolveContent: (payloadRef: string, input: AcceptedInput) => Promise<string>;
}
const conflict = () => new Error("Host binding conflict");
function identity(value: string) {
  if (typeof value !== "string" || !value.length || value.length > 2048) throw new TypeError("Invalid binding scope");
  return value;
}
/** Caller-controlled OFFLINE setup only, on the host-owned EF-S01 connection.
 * This is not a production migration and is never called by the factory/runtime. */
export function initializeHostDurableBindings(db: Database, assertOwner: () => void): void {
  initializeHostSchemaTables(db, assertOwner, [0, 1]);
}

type Row = { conversation_id: ConversationId; chat_jid: string; branch_id: string; operation_id: string;
  source_seq: number; source_id: string; payload_ref: string; request_id: string; request_hash: string;
  submission_id: SubmissionId | null };

/** Correlation, NOT admission, scheduling, authorization or an outbox. The supplied connection
 * MUST be the host's EF-S01 database. Its synchronous public SQL composition tables are verified
 * inside each write transaction (ServiceWorkStore has no synchronous snapshot method).
 * Payload resolution happens outside SQL; immutable reference/hash and source are rechecked inside.
 * The owner callback must fence this whole store; no distributed atomicity is claimed. */
export function createHostDurableBindings(db: Database, options: HostBindingOptions): HostDurableBindings & {
  findSource(chatJid: string, sourceSeq: number): Promise<HostInputBinding | null>;
  resolveConversation(input: AcceptedInput): ConversationId | undefined;
} {
  const domain = identity(options.domain), incarnation = identity(options.incarnation);
  const assertOwner = options.assertOwner.bind(options), resolveContent = options.resolveContent.bind(options);
  const manifest = options.manifest.map(b => Object.freeze({ chatJid: identity(b.chatJid),
    branchId: identity(b.branchId), conversationId: b.conversationId }));
  const lookup = options.getConversationBinding?.bind(options) ?? ((chat: string, branch: string) => manifest.find(b => b.chatJid === chat && b.branchId === branch));
  assertOwner();
  function resolveConversation(input: AcceptedInput): ConversationId | undefined {
    assertOwner();
    const i = inputSnapshot(input), root = lookup(i.chatJid, i.branchId)?.conversationId;
    if (i.incarnation !== incarnation || !root || i.conversationId === root) return undefined;
    const side = db.query(`SELECT b.* FROM piclaw_durable_bindings_v1 b
      JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq
      JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
      JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
      JOIN service_effect_s01_chats ch ON ch.chat_jid=s.chat_jid AND ch.active_operation_id=o.operation_id
      WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=?
        AND s.kind='internal' AND s.state='claimed' AND s.source_id=? AND s.payload_ref=?
        AND o.phase IN ('claimed','executing','cancelling','settling')`)
      .get(domain, incarnation, i.operationId, i.sourceSeq, i.sourceId, i.payloadRef) as Row | null;
    if (side && /^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i.sourceId) &&
      i.requestId === i.sourceId && i.payloadRef === i.sourceId && side.conversation_id !== root &&
      side.chat_jid === i.chatJid && side.branch_id === i.branchId && side.conversation_id === i.conversationId &&
      side.request_id === i.requestId && side.request_hash === i.requestHash) {
      if (db.query("SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1").get()) throw Error("Native side prompt budget admission unavailable");
      return side.conversation_id;
    }
    if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_effect_s07_occurrences'").get()) return undefined;
    const row = db.query(`SELECT b.*, r.task_id FROM piclaw_durable_bindings_v1 b
      JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq
      JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id AND r.operation_id=b.operation_id AND r.accepted_source_seq=s.source_seq
      JOIN service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision AND h.status='active' AND h.next_run_at=r.scheduled_for
      JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
      JOIN service_effect_s01_chats ch ON ch.chat_jid=b.chat_jid AND ch.active_operation_id=o.operation_id
      WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=?
        AND s.kind='scheduled_agent' AND s.state='claimed' AND s.source_id=? AND s.payload_ref=?
        AND r.state='source_bound' AND r.lease_expires_at>? AND o.phase IN ('claimed','executing','settling')`)
      .get(domain, incarnation, i.operationId, i.sourceSeq, i.sourceId, i.payloadRef, new Date().toISOString()) as (Row & { task_id: string }) | null;
    if (!row || row.conversation_id === root || row.chat_jid !== i.chatJid || row.branch_id !== i.branchId ||
      row.conversation_id !== i.conversationId || row.request_id !== i.requestId || row.request_hash !== i.requestHash) return undefined;
    assertNativeScheduledBudgetAvailable(db, row.task_id);
    return row.conversation_id;
  }
  function capture(input: AcceptedInput) {
    const i = inputSnapshot(input);
    assertOwner();
    if (i.incarnation !== incarnation || (lookup(i.chatJid, i.branchId)?.conversationId !== i.conversationId && resolveConversation(i) !== i.conversationId)) throw conflict();
    return i;
  }
  function makePort(intent = false) {
  const table = intent ? "piclaw_durable_intent_bindings_v1" : "piclaw_durable_bindings_v1";
  const otherTable = intent ? "piclaw_durable_bindings_v1" : "piclaw_durable_intent_bindings_v1";
  function read(i: AcceptedInput): HostInputBinding | null {
    assertHostSchema(db);
    const r = db.query(`SELECT * FROM ${table}
      WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=?`)
      .get(domain, incarnation, i.conversationId, i.requestId) as Row | null;
    if (!r) return null;
    const result = Object.freeze({ incarnation, conversationId: r.conversation_id, chatJid: r.chat_jid,
      branchId: r.branch_id, operationId: r.operation_id, sourceSeq: r.source_seq, sourceId: r.source_id,
      payloadRef: r.payload_ref, requestId: r.request_id, requestHash: r.request_hash, submissionId: r.submission_id });
    if (Object.entries(i).some(([k, v]) => result[k as keyof AcceptedInput] !== v)) throw conflict();
    return result;
  }
  function verifySource(i: AcceptedInput) {
    assertHostSchema(db);
    // A committed exact binding may replay after terminal settlement. Fresh admission
    // must use the same nonterminal proof as root recovery.
    if (intent) {
      if (read(i)) return;
      const proof = getQueuedInputIntent(db, i.operationId, i);
      if (!proof || proof.intentId !== i.requestId) throw new Error("Unverified host source");
      return;
    }
    const source = db.query(`SELECT s.kind,s.source_id,s.payload_ref FROM service_effect_s01_sources s
      JOIN service_effect_s01_operation_sources c ON c.chat_jid=s.chat_jid AND c.source_seq=s.source_seq
      JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id AND o.chat_jid=s.chat_jid
      WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=?
        AND s.state IN ('claimed','consumed') AND o.operation_id=?
        AND o.primary_source_seq=s.source_seq AND s.kind IN ('message','scheduled_agent','internal')`)
      .get(i.chatJid, i.sourceSeq, i.sourceId, i.payloadRef, i.operationId) as { kind: string; source_id: string; payload_ref: string } | null;
    // Internal work is not blanket tool authority. Only the exact side-prompt
    // namespace can bind here; execution/recovery still need their own routing.
    if (!source || (source.kind === "internal" &&
      (!/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.source_id) ||
        source.payload_ref !== source.source_id || i.requestId !== source.source_id))) throw new Error("Unverified host source");
  }
  async function bindContent(i: AcceptedInput) {
    assertOwner(); verifySource(i); read(i); assertOwner();
    const content = await resolveContent(i.payloadRef, i);
    assertOwner();
    if (typeof content !== "string" || hashCanonicalRequest({ type: "input", requestId: i.requestId, content }) !== i.requestHash)
      throw new Error("Host payload hash conflict");
    // Reconciliation is a read when the immutable correlation already exists.
    // Taking BEGIN IMMEDIATE here contends with the SDK's committing writer,
    // even though no host state would change, and can strand a completed reply.
    verifySource(i);
    const existing = read(i);
    if (existing) {
      if (db.query(`SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND ((conversation_id=? AND request_id=?) OR (chat_jid=? AND source_seq=?))`)
        .get(domain, incarnation, i.conversationId, i.requestId, i.chatJid, i.sourceSeq)) throw conflict();
      assertOwner(); return { binding: existing, content };
    }
    const binding = db.transaction(() => {
      assertOwner(); verifySource(i);
      if (db.query(`SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND ((conversation_id=? AND request_id=?) OR (chat_jid=? AND source_seq=?))`)
        .get(domain, incarnation, i.conversationId, i.requestId, i.chatJid, i.sourceSeq)) throw conflict();
      db.query(`INSERT OR IGNORE INTO ${table}
        (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(domain, incarnation, i.conversationId, i.chatJid, i.branchId,
          i.operationId, i.sourceSeq, i.sourceId, i.payloadRef, i.requestId, i.requestHash);
      const bound = read(i);
      if (!bound) throw conflict();
      assertOwner(); return bound;
    }).immediate();
    return { binding, content };
  }
  return Object.freeze({
    async list(input: AcceptedInput) {
      const i = capture(input);
      assertHostSchema(db);
      const rows = db.query(`SELECT request_id FROM ${table} WHERE domain=? AND incarnation=? AND operation_id=?`)
        .all(domain, incarnation, i.operationId) as { request_id: string }[];
      const result = rows.map(r => {
        const row = db.query(`SELECT * FROM ${table} WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=?`)
          .get(domain, incarnation, i.conversationId, r.request_id) as Row | null;
        if (!row) throw conflict();
        const bound = read({ incarnation, conversationId: row.conversation_id, chatJid: row.chat_jid, branchId: row.branch_id,
          operationId: row.operation_id, sourceSeq: row.source_seq, sourceId: row.source_id, payloadRef: row.payload_ref,
          requestId: row.request_id, requestHash: row.request_hash });
        if (!bound) throw conflict(); verifySource(bound); return bound;
      });
      assertOwner(); return Object.freeze(result);
    },
    async get(input: AcceptedInput) {
      const i = capture(input), result = read(i); assertOwner(); return result;
    },
    async bind(input: AcceptedInput) { const i = capture(input); return (await bindContent(i)).binding; },
    async getOrBind(input: AcceptedInput) { const i = capture(input); return { content: (await bindContent(i)).content }; },
    async recordSubmission(input: AcceptedInput, submissionId: SubmissionId) {
      const i = capture(input);
      if (!Number.isSafeInteger(submissionId) || submissionId <= 0) throw new TypeError("Invalid submission identity");
      db.transaction(() => {
        assertOwner(); verifySource(i);
        const prior = read(i);
        if (!prior || (prior.submissionId !== null && prior.submissionId !== submissionId)) throw conflict();
        const other = db.query(`SELECT 1 FROM ${table} WHERE domain=? AND incarnation=?
          AND submission_id=? AND NOT (conversation_id=? AND request_id=?)
          UNION ALL SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND submission_id=?`)
          .get(domain, incarnation, submissionId, i.conversationId, i.requestId, domain, incarnation, submissionId);
        if (other) throw conflict();
        db.query(`UPDATE ${table} SET submission_id=?
          WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=? AND submission_id IS NULL`)
          .run(submissionId, domain, incarnation, i.conversationId, i.requestId);
        if (read(i)?.submissionId !== submissionId) throw conflict();
        assertOwner();
      }).immediate();
    },
  });
  }
  return Object.freeze({ ...makePort(), intents: makePort(true), resolveConversation,
    assertSourceCurrent(input: AcceptedInput) {
      const i = capture(input);
      assertHostSchema(db);
      // Unlike correlation replay, an effect requires a currently executing,
      // uncancelled operation and its exact still-claimed accepted source.
      const current = db.query(`SELECT 1 FROM service_effect_s01_sources s
        JOIN service_effect_s01_operation_sources c ON c.chat_jid=s.chat_jid AND c.source_seq=s.source_seq
        JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id AND o.chat_jid=s.chat_jid
        JOIN service_effect_s01_chats ch ON ch.chat_jid=o.chat_jid AND ch.active_operation_id=o.operation_id
        WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=?
          AND s.state='claimed' AND o.operation_id=? AND o.phase='executing'
          AND o.cancellation_source_id IS NULL AND o.terminal_disposition IS NULL`)
        .get(i.chatJid, i.sourceSeq, i.sourceId, i.payloadRef, i.operationId);
      if (!current) throw Error("Host operation authority unavailable");
      assertOwner();
    },
    async findSource(chatJid: string, sourceSeq: number) {
      assertOwner();
      assertHostSchema(db);
      const rows = db.query(`SELECT * FROM piclaw_durable_bindings_v1
        WHERE domain=? AND incarnation=? AND chat_jid=? AND source_seq=?
        UNION ALL SELECT * FROM piclaw_durable_intent_bindings_v1
        WHERE domain=? AND incarnation=? AND chat_jid=? AND source_seq=?`)
        .all(domain, incarnation, chatJid, sourceSeq, domain, incarnation, chatJid, sourceSeq) as Row[];
      if (rows.length > 1) throw conflict();
      const row = rows[0];
      if (!row) return null;
      const input = capture({ incarnation, conversationId: row.conversation_id, chatJid: row.chat_jid,
        branchId: row.branch_id, operationId: row.operation_id, sourceSeq: row.source_seq,
        sourceId: row.source_id, payloadRef: row.payload_ref, requestId: row.request_id, requestHash: row.request_hash });
      assertOwner();
      return Object.freeze({ ...input, submissionId: row.submission_id });
    },
  });
}
