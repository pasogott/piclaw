// INACTIVE application-owned correlation store. No database opens or automatic migrations.
import type { Database } from "bun:sqlite";
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
} {
  const domain = identity(options.domain), incarnation = identity(options.incarnation);
  const assertOwner = options.assertOwner.bind(options), resolveContent = options.resolveContent.bind(options);
  const manifest = options.manifest.map(b => Object.freeze({ chatJid: identity(b.chatJid),
    branchId: identity(b.branchId), conversationId: b.conversationId }));
  assertOwner();
  function capture(input: AcceptedInput) {
    const i = inputSnapshot(input);
    assertOwner();
    if (i.incarnation !== incarnation || !manifest.some(b => b.chatJid === i.chatJid &&
      b.branchId === i.branchId && b.conversationId === i.conversationId)) throw conflict();
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
    const source = db.query(`SELECT s.kind FROM service_effect_s01_sources s
      JOIN service_effect_s01_operation_sources c ON c.chat_jid=s.chat_jid AND c.source_seq=s.source_seq
      JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id AND o.chat_jid=s.chat_jid
      WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=?
        AND s.state IN ('claimed','consumed') AND o.operation_id=?
        AND o.primary_source_seq=s.source_seq AND s.kind IN ('message','scheduled_agent')`)
      .get(i.chatJid, i.sourceSeq, i.sourceId, i.payloadRef, i.operationId);
    if (!source) throw new Error("Unverified host source");
  }
  async function bindContent(i: AcceptedInput) {
    assertOwner(); verifySource(i); read(i); assertOwner();
    const content = await resolveContent(i.payloadRef, i);
    assertOwner();
    if (typeof content !== "string" || hashCanonicalRequest({ type: "input", requestId: i.requestId, content }) !== i.requestHash)
      throw new Error("Host payload hash conflict");
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
  return Object.freeze({ ...makePort(), intents: makePort(true),
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
