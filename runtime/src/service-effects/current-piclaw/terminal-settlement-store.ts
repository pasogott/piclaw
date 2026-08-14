import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";
import type Database from "bun:sqlite";

import { validateServiceEffectContentBlocks } from "../../channels/web/messaging/content-block-safety.js";
import {
  replaceMessageContentInDatabase,
  storeMessageInDatabase,
} from "../../db/messages.js";
import type { NewMessage } from "../../types.js";
import type { NormalisedTraceInput } from "../contracts/common.js";
import type { EffectPayloadResolver } from "../contracts/payload-resolver.js";
import type {
  OutboxStoreError,
  ServiceOutboxEnqueueInserter,
} from "../contracts/service-outbox-store.js";
import type {
  HarnessCorrelation,
  HarnessState,
  PiclawDisposition,
  PiclawOperationPhase,
} from "../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  TerminalCommit,
  TerminalSettlementError,
  TerminalSettlementErrorTag,
  TerminalSettlementStore,
} from "../contracts/terminal-settlement-store.js";
import { resolveVerifiedPayload } from "../payloads.js";
import { createServiceOutboxEnqueueInserter } from "./service-outbox-store.js";
import {
  normaliseCommitTerminalRequest,
  normaliseTerminalLookupId,
} from "./terminal-settlement-request-normalizer.js";

const PHASES = new Set<PiclawOperationPhase>([
  "accepted",
  "claimed",
  "starting_harness",
  "executing",
  "suspended",
  "cancelling",
  "settling",
  "terminal",
]);
const HARNESS_STATES = new Set<HarnessState>([
  "not_started",
  "running",
  "suspended",
  "aborting",
  "finished",
]);
const DISPOSITIONS = new Set<PiclawDisposition>([
  "completed",
  "cancelled",
  "failed",
  "skipped",
  "superseded",
]);
const CLOSED_SOURCE_STATES = new Set(["consumed", "disposed"]);
const REQUIRED_SCHEMA = Object.freeze([
  "chats",
  "media",
  "message_media",
  "messages",
  "messages_fts",
  "service_effect_media_uploads",
  "service_effect_operation_media",
  "service_effect_s01_chats",
  "service_effect_s01_operation_sources",
  "service_effect_s01_operations",
  "service_effect_s01_queued_inputs",
  "service_effect_s01_sources",
  "service_effect_s02_commit_outbox",
  "service_effect_s02_commits",
  "service_effect_s05_decisions",
  "service_effect_s05_outbox",
  "service_effect_timeline_writes",
]);
const REQUIRED_TRIGGERS = Object.freeze([
  "messages_ad",
  "messages_ai",
  "messages_au",
]);
const REQUIRED_SCHEMA_PROBES = Object.freeze([
  "SELECT jid,name,last_message_time FROM chats LIMIT 1",
  "SELECT rowid,id,chat_jid,content,content_blocks,thread_id,timestamp,is_bot_message,is_terminal_agent_reply FROM messages LIMIT 1",
  "SELECT rowid,content,chat_jid FROM messages_fts LIMIT 1",
  "SELECT id,filename,content_type,data FROM media LIMIT 1",
  "SELECT message_rowid,media_id FROM message_media LIMIT 1",
  "SELECT chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats LIMIT 1",
  "SELECT chat_jid,source_seq,state,target_operation_id,disposition_reason FROM service_effect_s01_sources LIMIT 1",
  "SELECT operation_id,chat_jid,version,phase,harness_session_id,harness_lane,harness_operation_id,harness_state,harness_watch_generation,terminal_disposition FROM service_effect_s01_operations LIMIT 1",
  "SELECT chat_jid,operation_id,source_seq FROM service_effect_s01_operation_sources LIMIT 1",
  "SELECT chat_jid,operation_id,source_seq,state FROM service_effect_s01_queued_inputs LIMIT 1",
  "SELECT operation_id,media_id,role FROM service_effect_operation_media LIMIT 1",
  "SELECT idempotency_key,request_hash,operation_id,chat_jid,operation_version,disposition,message_row_id,consumed_through_source_seq,committed_at,terminal_authority_ref FROM service_effect_s02_commits LIMIT 1",
  "SELECT operation_id,ordinal,outbox_id FROM service_effect_s02_commit_outbox LIMIT 1",
  "SELECT outbox_id,kind,state,idempotency_key,request_hash,operation_id,source_seq FROM service_effect_s05_outbox LIMIT 1",
]);

export type TerminalSettlementStatement =
  | "ensure_timeline_chat"
  | "insert_terminal_message"
  | "replace_terminal_message"
  | "settle_source"
  | "settle_queued_input"
  | "advance_frontier_release_owner"
  | "terminalise_operation"
  | "enqueue_outbox"
  | "insert_commit"
  | "link_commit_outbox";

export interface TerminalSettlementAdapterRuntime {
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ): unknown;
  checkpoint?(statement: TerminalSettlementStatement, occurrence: number): unknown;
  recordTrace(input: NormalisedTraceInput): void;
}

export type TerminalSettlementConstructionResult = ResultValue<
  TerminalSettlementStore,
  TerminalSettlementError
>;

interface CommitRow {
  idempotency_key: unknown;
  request_hash: unknown;
  operation_id: unknown;
  chat_jid: unknown;
  operation_version: unknown;
  disposition: unknown;
  message_row_id: unknown;
  consumed_through_source_seq: unknown;
  committed_at: unknown;
  terminal_authority_ref: unknown;
}

interface OperationRow {
  operation_id: unknown;
  chat_jid: unknown;
  version: unknown;
  phase: unknown;
  cancellation_source_id: unknown;
  cancellation_source_seq: unknown;
  cancellation_cause: unknown;
  cancellation_requested_at: unknown;
  harness_session_id: unknown;
  harness_lane: unknown;
  harness_operation_id: unknown;
  harness_state: unknown;
  harness_watch_generation: unknown;
  terminal_disposition: unknown;
  terminal_message_row_id: unknown;
  terminal_error_code: unknown;
  terminal_committed_at: unknown;
  active_operation_id: unknown;
  consumed_through_source_seq: unknown;
  next_source_seq: unknown;
}

interface ClosedOperation {
  operationId: string;
  chatJid: string;
  version: number;
  phase: PiclawOperationPhase;
  cancellationSourceSeq: number | null;
  harness: HarnessCorrelation | null;
  terminalDisposition: PiclawDisposition | null;
  activeOperationId: string | null;
  consumedThroughSourceSeq: number;
  nextSourceSeq: number;
}

interface ResolvedTimeline {
  content: string;
  blocks: readonly Readonly<Record<string, unknown>>[] | null;
}

class SettlementAbort extends Error {
  constructor(readonly error: TerminalSettlementError) {
    super(error._tag);
  }
}
class CorruptSettlementState extends Error {}
class InjectedStatementRollback extends Error {}

export function createCurrentPiclawTerminalSettlementStore(
  database: Database,
  payloads: EffectPayloadResolver,
  runtime: TerminalSettlementAdapterRuntime,
): TerminalSettlementConstructionResult {
  try {
    validateConstruction(database);
    const inserter = createServiceOutboxEnqueueInserter(database);
    if (!inserter.ok) return Result.err(mapOutboxConstructionError(inserter.error));
    return Result.ok(
      new CurrentPiclawTerminalSettlementStore(
        database,
        payloads,
        runtime,
        inserter.value,
      ),
    );
  } catch (error) {
    void error;
    return Result.err(settlementError("storage_unavailable", "not_applied", true));
  }
}

export class CurrentPiclawTerminalSettlementStore
  implements TerminalSettlementStore
{
  private checkpointOccurrence = 0;

  constructor(
    readonly database: Database,
    private readonly payloads: EffectPayloadResolver,
    private readonly runtime: TerminalSettlementAdapterRuntime,
    private readonly outbox: ServiceOutboxEnqueueInserter,
  ) {}

  async commitTerminal(
    input: CommitTerminalRequest,
  ): Promise<ResultValue<TerminalCommit, TerminalSettlementError>> {
    const request = normaliseCommitTerminalRequest(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    const operationId = request?.effect.operationId ?? null;
    this.trace(
      "commitTerminal",
      effectId,
      operationId,
      request?.expectedVersion ?? null,
      "call",
      null,
    );
    if (!request) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        null,
        settlementError("invalid_source_disposition"),
      );
    }

    try {
      const fast = this.reconcile(request);
      if (fast) return this.finishReconciliation(request, fast);
    } catch (error) {
      return this.caught("commitTerminal", request, error);
    }

    if (beforeEffectInjected(this.runtime)) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        settlementError("storage_unavailable", "not_applied", true),
      );
    }

    const resolved = await this.resolveTimeline(request);
    if (!resolved.ok) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        resolved.error,
      );
    }

    this.checkpointOccurrence = 0;
    try {
      const outcome = this.database
        .transaction(() => {
          const reconciled = this.reconcile(request);
          if (reconciled) {
            if (reconciled.kind === "replay") return reconciled.commit;
            throw new SettlementAbort(reconciled.error);
          }
          return this.apply(request, resolved.value);
        })
        .immediate();

      if (lostAcknowledgement(this.runtime)) {
        return this.failure(
          "commitTerminal",
          effectId,
          operationId,
          request.expectedVersion,
          settlementError("storage_unavailable", "unknown", true),
        );
      }
      return this.success(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        outcome,
        "applied",
      );
    } catch (error) {
      return this.caught("commitTerminal", request, error);
    }
  }

  async getTerminal(
    operationId: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const id = normaliseTerminalLookupId(operationId);
    if (!id) return Result.err(settlementError("corrupt_state"));
    try {
      const row = this.commitByOperation(id);
      if (!row) {
        const operation = this.database
          .query(
            "SELECT phase FROM service_effect_s01_operations WHERE operation_id=?",
          )
          .get(id) as { phase?: unknown } | undefined;
        if (operation?.phase === "terminal") {
          return Result.err(settlementError("corrupt_state"));
        }
        return Result.ok(null);
      }
      return Result.ok(this.materialiseCommit(row));
    } catch (error) {
      return Result.err(
        error instanceof CorruptSettlementState
          ? settlementError("corrupt_state")
          : settlementError("storage_unavailable", "not_applied", true),
      );
    }
  }

  async getTerminalByKey(
    idempotencyKey: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const key = normaliseTerminalLookupId(idempotencyKey);
    if (!key) return Result.err(settlementError("corrupt_state"));
    try {
      const row = this.commitByKey(key);
      if (!row) return Result.ok(null);
      return Result.ok(this.materialiseCommit(row));
    } catch (error) {
      return Result.err(
        error instanceof CorruptSettlementState
          ? settlementError("corrupt_state")
          : settlementError("storage_unavailable", "not_applied", true),
      );
    }
  }

  private apply(
    request: CommitTerminalRequest,
    resolved: ResolvedTimeline | null,
  ): TerminalCommit {
    const operation = this.readOperation(request.effect.operationId);
    this.authoriseOperation(request, operation);
    this.validateOutboxAuthority(request, operation);
    this.validateSources(request, operation);
    if (request.timeline.mode !== "none") this.validateMedia(request);

    const messageRowId = this.writeTimeline(request, resolved);
    this.settleSources(request, operation);
    const consumedThroughSourceSeq = this.computeFrontier(operation);
    const operationVersion = operation.version + 1;

    this.database
      .query(
        `UPDATE service_effect_s01_operations
         SET version=?, phase='terminal', terminal_disposition=?, terminal_message_row_id=?,
             terminal_error_code=?, terminal_committed_at=?
         WHERE operation_id=? AND chat_jid=? AND version=? AND phase=?
           AND terminal_disposition IS NULL AND terminal_message_row_id IS NULL
           AND terminal_error_code IS NULL AND terminal_committed_at IS NULL`,
      )
      .run(
        operationVersion,
        request.disposition,
        messageRowId,
        request.errorCode,
        request.committedAt,
        operation.operationId,
        operation.chatJid,
        operation.version,
        operation.phase,
      );
    if (!changedOne(this.database)) {
      throw new SettlementAbort(settlementError("version_mismatch"));
    }
    this.afterStatement("terminalise_operation");

    this.database
      .query(
        `UPDATE service_effect_s01_chats
         SET consumed_through_source_seq=?, active_operation_id=NULL
         WHERE chat_jid=? AND consumed_through_source_seq=? AND active_operation_id=?`,
      )
      .run(
        consumedThroughSourceSeq,
        operation.chatJid,
        operation.consumedThroughSourceSeq,
        operation.operationId,
      );
    if (!changedOne(this.database)) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    this.afterStatement("advance_frontier_release_owner");

    for (const intent of request.outboxIntents) {
      const inserted = this.outbox.insert(intent);
      if (!inserted.ok) throw new SettlementAbort(mapOutboxError(inserted.error));
      this.afterStatement("enqueue_outbox");
    }

    const commit: TerminalCommit = freezeCommit({
      operationId: operation.operationId,
      operationVersion,
      disposition: request.disposition,
      messageRowId,
      consumedThroughSourceSeq,
      outboxIds: request.outboxIntents.map((intent) => intent.outboxId),
      committedAt: request.committedAt,
    });
    this.database
      .query(
        `INSERT INTO service_effect_s02_commits(
           idempotency_key,request_hash,operation_id,chat_jid,operation_version,
           disposition,message_row_id,consumed_through_source_seq,committed_at,
           terminal_authority_ref
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        request.effect.idempotencyKey,
        request.effect.requestHash,
        operation.operationId,
        operation.chatJid,
        operationVersion,
        request.disposition,
        messageRowId,
        consumedThroughSourceSeq,
        request.committedAt,
        request.terminalAuthorityRef,
      );
    if (!changedOne(this.database)) throw new CorruptSettlementState();
    this.afterStatement("insert_commit");

    request.outboxIntents.forEach((intent, ordinal) => {
      this.database
        .query(
          `INSERT INTO service_effect_s02_commit_outbox(operation_id,ordinal,outbox_id)
           VALUES (?,?,?)`,
        )
        .run(operation.operationId, ordinal, intent.outboxId);
      if (!changedOne(this.database)) throw new CorruptSettlementState();
      this.afterStatement("link_commit_outbox");
    });
    return commit;
  }

  private writeTimeline(
    request: CommitTerminalRequest,
    resolved: ResolvedTimeline | null,
  ): number | null {
    const timeline = request.timeline;
    if (timeline.mode === "none") return null;
    if (!resolved) throw new CorruptSettlementState();

    if (timeline.mode === "replace_placeholder") {
      const latest = this.database
        .query(
          `SELECT w.message_rowid,w.chat_jid
           FROM service_effect_timeline_writes w
           WHERE w.write_type='draft' AND w.operation_id=?
             AND w.message_rowid=?
             AND w.revision=(
               SELECT MAX(newer.revision)
               FROM service_effect_timeline_writes newer
               WHERE newer.write_type='draft' AND newer.operation_id=w.operation_id
             )
           LIMIT 1`,
        )
        .get(request.effect.operationId, timeline.placeholderRowId) as
        | { message_rowid?: unknown; chat_jid?: unknown }
        | undefined;
      if (
        !latest ||
        requiredInteger(latest.message_rowid, 1) !== timeline.placeholderRowId ||
        requiredText(latest.chat_jid, 512) !== request.expectedChatJid
      ) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
      const message = this.database
        .query(
          `SELECT chat_jid,thread_id,is_terminal_agent_reply,is_bot_message
           FROM messages WHERE rowid=?`,
        )
        .get(timeline.placeholderRowId) as
        | {
            chat_jid?: unknown;
            thread_id?: unknown;
            is_terminal_agent_reply?: unknown;
            is_bot_message?: unknown;
          }
        | undefined;
      if (!message) throw new SettlementAbort(settlementError("owner_conflict"));
      const threadId = nullableInteger(message.thread_id, 1);
      if (
        requiredText(message.chat_jid, 512) !== request.expectedChatJid ||
        threadId !== timeline.threadId ||
        requiredInteger(message.is_terminal_agent_reply, 0) !== 0 ||
        requiredInteger(message.is_bot_message, 0) !== 1
      ) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
      const replaced = replaceMessageContentInDatabase(
        this.database,
        request.expectedChatJid,
        timeline.placeholderRowId,
        resolved.content,
        {
          contentBlocks: resolved.blocks ? [...resolved.blocks] : undefined,
          mediaIds: [...timeline.mediaIds],
          isTerminalAgentReply: true,
        },
      );
      if (!replaced) throw new SettlementAbort(settlementError("owner_conflict"));
      this.afterStatement("replace_terminal_message");
      return timeline.placeholderRowId;
    }

    const existing = this.database
      .query("SELECT rowid FROM messages WHERE id=?")
      .get(`service-terminal:${request.effect.operationId}`);
    if (existing) throw new CorruptSettlementState();
    this.database
      .query(
        `INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)
         ON CONFLICT(jid) DO UPDATE SET last_message_time=MAX(last_message_time,excluded.last_message_time)`,
      )
      .run(request.expectedChatJid, request.expectedChatJid, request.committedAt);
    this.afterStatement("ensure_timeline_chat");

    const message: NewMessage = {
      id: `service-terminal:${request.effect.operationId}`,
      chat_jid: request.expectedChatJid,
      sender: "web-agent",
      sender_name: "Piclaw",
      content: resolved.content,
      timestamp: request.committedAt,
      is_from_me: false,
      is_bot_message: true,
      is_terminal_agent_reply: true,
      content_blocks: resolved.blocks ? [...resolved.blocks] : undefined,
      thread_id: timeline.threadId,
    };
    const rowId = storeMessageInDatabase(this.database, message);
    if (rowId <= 0) throw new CorruptSettlementState();
    this.afterStatement("insert_terminal_message");
    if (timeline.mediaIds.length > 0) {
      const rebound = replaceMessageContentInDatabase(
        this.database,
        request.expectedChatJid,
        rowId,
        resolved.content,
        {
          contentBlocks: resolved.blocks ? [...resolved.blocks] : undefined,
          mediaIds: [...timeline.mediaIds],
          isTerminalAgentReply: true,
        },
      );
      if (!rebound) throw new CorruptSettlementState();
      this.afterStatement("replace_terminal_message");
    }
    return rowId;
  }

  private validateMedia(request: CommitTerminalRequest): void {
    for (const mediaId of request.timeline.mediaIds) {
      const row = this.database
        .query(
          `SELECT 1 AS present
           FROM service_effect_media_uploads u
           JOIN service_effect_operation_media b ON b.media_id=u.media_id
           WHERE u.media_id=? AND b.operation_id=? AND b.role='terminal'`,
        )
        .get(mediaId, request.effect.operationId) as
        | { present?: unknown }
        | undefined;
      if (!row || requiredInteger(row.present, 1) !== 1) {
        throw new SettlementAbort(settlementError("missing_media"));
      }
    }
  }

  private validateSources(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    const claimed = this.database
      .query(
        `SELECT s.source_seq
         FROM service_effect_s01_operation_sources os
         JOIN service_effect_s01_sources s
           ON s.chat_jid=os.chat_jid AND s.source_seq=os.source_seq
         WHERE os.operation_id=? AND s.state IN ('claimed','queued')
         ORDER BY s.source_seq`,
      )
      .all(operation.operationId) as Array<{ source_seq?: unknown }>;
    const expected = claimed.map((row) => requiredInteger(row.source_seq, 1));
    const supplied = request.sourceDispositions.map((entry) => entry.sourceSeq);
    if (
      expected.length !== supplied.length ||
      expected.some((sourceSeq, index) => sourceSeq !== supplied[index])
    ) {
      throw new SettlementAbort(settlementError("invalid_source_disposition"));
    }
  }

  private settleSources(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    for (const disposition of request.sourceDispositions) {
      const owned = this.database
        .query(
          `SELECT s.state source_state,q.state queue_state
           FROM service_effect_s01_sources s
           JOIN service_effect_s01_operation_sources os
             ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
           LEFT JOIN service_effect_s01_queued_inputs q
             ON q.operation_id=os.operation_id AND q.source_seq=os.source_seq
           WHERE s.chat_jid=? AND s.source_seq=? AND os.operation_id=?`,
        )
        .get(
          operation.chatJid,
          disposition.sourceSeq,
          operation.operationId,
        ) as
        | { source_state?: unknown; queue_state?: unknown }
        | undefined;
      if (
        !owned ||
        (owned.source_state !== "claimed" && owned.source_state !== "queued")
      ) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      const expectedQueueState =
        owned.source_state === "queued" ? "queued" : "accepted";
      if (
        (owned.source_state === "queued" &&
          owned.queue_state !== expectedQueueState) ||
        (owned.queue_state !== null &&
          owned.queue_state !== undefined &&
          owned.queue_state !== expectedQueueState)
      ) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }

      this.database
        .query(
          `UPDATE service_effect_s01_sources
           SET state=?,disposition_reason=?
           WHERE chat_jid=? AND source_seq=? AND state=?`,
        )
        .run(
          disposition.state,
          disposition.reason,
          operation.chatJid,
          disposition.sourceSeq,
          owned.source_state,
        );
      if (!changedOne(this.database)) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      this.afterStatement("settle_source");

      if (owned.queue_state === null || owned.queue_state === undefined) continue;
      this.database
        .query(
          `UPDATE service_effect_s01_queued_inputs SET state=?
           WHERE operation_id=? AND source_seq=? AND state=?`,
        )
        .run(
          disposition.state,
          operation.operationId,
          disposition.sourceSeq,
          expectedQueueState,
        );
      if (!changedOne(this.database)) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      this.afterStatement("settle_queued_input");
    }
  }

  private computeFrontier(operation: ClosedOperation): number {
    let frontier = operation.consumedThroughSourceSeq;
    while (frontier + 1 < operation.nextSourceSeq) {
      const row = this.database
        .query(
          "SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?",
        )
        .get(operation.chatJid, frontier + 1) as { state?: unknown } | undefined;
      if (!row || typeof row.state !== "string") break;
      if (!CLOSED_SOURCE_STATES.has(row.state)) break;
      frontier += 1;
    }
    return frontier;
  }

  private validateOutboxAuthority(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    const operationSources = new Set(
      (
        this.database
          .query(
            "SELECT source_seq FROM service_effect_s01_operation_sources WHERE operation_id=?",
          )
          .all(operation.operationId) as Array<{ source_seq?: unknown }>
      ).map((row) => requiredInteger(row.source_seq, 1)),
    );
    if (
      request.effect.sourceSeq !== null &&
      !operationSources.has(request.effect.sourceSeq)
    ) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    for (const intent of request.outboxIntents) {
      if (intent.effect.operationId !== operation.operationId) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
      if (
        intent.effect.sourceSeq !== null &&
        !operationSources.has(intent.effect.sourceSeq)
      ) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
    }
  }

  private authoriseOperation(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    if (operation.chatJid !== request.expectedChatJid) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (operation.version !== request.expectedVersion) {
      throw new SettlementAbort(settlementError("version_mismatch"));
    }
    if (
      operation.phase === "terminal" ||
      operation.terminalDisposition !== null
    ) {
      throw new CorruptSettlementState();
    }
    if (operation.activeOperationId !== operation.operationId) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (!equalHarness(operation.harness, request.expectedHarness)) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (request.timeline.chatJid !== operation.chatJid) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (!dispositionAllowed(request, operation)) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
  }

  private readOperation(operationId: string): ClosedOperation {
    const row = this.database
      .query(
        `SELECT o.*,c.active_operation_id,c.consumed_through_source_seq,c.next_source_seq
         FROM service_effect_s01_operations o
         JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
         WHERE o.operation_id=?`,
      )
      .get(operationId) as OperationRow | undefined;
    if (!row) throw new SettlementAbort(settlementError("owner_conflict"));
    return closeOperation(row);
  }

  private async resolveTimeline(
    request: CommitTerminalRequest,
  ): Promise<
    | { ok: true; value: ResolvedTimeline | null }
    | { ok: false; error: TerminalSettlementError }
  > {
    if (request.timeline.mode === "none") return { ok: true, value: null };
    try {
      const content = await resolveVerifiedPayload(
        this.payloads,
        request.timeline.contentRef,
      );
      if (
        !content ||
        (content.mediaType !== "text/plain" &&
          content.mediaType !== "text/markdown") ||
        content.byteLength > 1_048_576
      ) {
        return {
          ok: false,
          error: settlementError("storage_unavailable", "not_applied", true),
        };
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
      } catch (error) {
        void error;
        return { ok: false, error: settlementError("corrupt_state") };
      }
      if (text.length > 1_048_576) {
        return { ok: false, error: settlementError("corrupt_state") };
      }
      let blocks: readonly Readonly<Record<string, unknown>>[] | null = null;
      if (request.timeline.contentBlocksRef !== null) {
        const payload = await resolveVerifiedPayload(
          this.payloads,
          request.timeline.contentBlocksRef,
        );
        if (
          !payload ||
          payload.mediaType !== "application/json" ||
          payload.byteLength > 262_144
        ) {
          return {
            ok: false,
            error: settlementError("storage_unavailable", "not_applied", true),
          };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes),
          );
        } catch (error) {
          void error;
          return { ok: false, error: settlementError("corrupt_state") };
        }
        blocks = validateServiceEffectContentBlocks(parsed);
        if (!blocks) return { ok: false, error: settlementError("corrupt_state") };
      }
      return { ok: true, value: Object.freeze({ content: text, blocks }) };
    } catch (error) {
      void error;
      return {
        ok: false,
        error: settlementError("storage_unavailable", "not_applied", true),
      };
    }
  }

  private reconcile(request: CommitTerminalRequest): Reconciliation | null {
    const byKey = this.commitByKey(request.effect.idempotencyKey);
    if (byKey) {
      const commit = this.materialiseCommit(byKey);
      if (
        requiredText(byKey.request_hash, 64) === request.effect.requestHash &&
        commit.operationId === request.effect.operationId
      ) {
        return { kind: "replay", commit };
      }
      return {
        kind: "error",
        error: settlementError("idempotency_conflict"),
      };
    }
    const byOperation = this.commitByOperation(request.effect.operationId);
    if (!byOperation) return null;
    const commit = this.materialiseCommit(byOperation);
    if (
      requiredText(byOperation.idempotency_key, 512) ===
        request.effect.idempotencyKey &&
      requiredText(byOperation.request_hash, 64) === request.effect.requestHash
    ) {
      return { kind: "replay", commit };
    }
    return {
      kind: "error",
      error: settlementError("already_terminal_conflict", "not_applied", false, commit),
    };
  }

  private finishReconciliation(
    request: CommitTerminalRequest,
    reconciliation: Reconciliation,
  ): ResultValue<TerminalCommit, TerminalSettlementError> {
    return reconciliation.kind === "replay"
      ? this.success(
          "commitTerminal",
          request.effect.idempotencyKey,
          request.effect.operationId,
          request.expectedVersion,
          reconciliation.commit,
          "replayed",
        )
      : this.failure(
          "commitTerminal",
          request.effect.idempotencyKey,
          request.effect.operationId,
          request.expectedVersion,
          reconciliation.error,
        );
  }

  private commitByKey(key: string): CommitRow | undefined {
    return this.database
      .query("SELECT * FROM service_effect_s02_commits WHERE idempotency_key=?")
      .get(key) as CommitRow | undefined;
  }

  private commitByOperation(operationId: string): CommitRow | undefined {
    return this.database
      .query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?")
      .get(operationId) as CommitRow | undefined;
  }

  private materialiseCommit(row: CommitRow): TerminalCommit {
    const operationId = requiredText(row.operation_id, 512);
    requiredText(row.idempotency_key, 512);
    requiredHash(row.request_hash);
    const chatJid = requiredText(row.chat_jid, 512);
    const disposition = requiredDisposition(row.disposition);
    const authority = nullableText(row.terminal_authority_ref, 2048);
    const authorityRequired =
      disposition === "skipped" || disposition === "superseded";
    if (authorityRequired !== (authority !== null)) {
      throw new CorruptSettlementState();
    }
    const outboxIds = (
      this.database
        .query(
          `SELECT l.ordinal,l.outbox_id,o.operation_id outbox_operation_id
           FROM service_effect_s02_commit_outbox l
           JOIN service_effect_s05_outbox o ON o.outbox_id=l.outbox_id
           WHERE l.operation_id=? ORDER BY l.ordinal`,
        )
        .all(operationId) as Array<{
        ordinal?: unknown;
        outbox_id?: unknown;
        outbox_operation_id?: unknown;
      }>
    ).map((entry, index) => {
      if (
        requiredInteger(entry.ordinal, 0) !== index ||
        nullableText(entry.outbox_operation_id, 512) !== operationId
      ) {
        throw new CorruptSettlementState();
      }
      return requiredText(entry.outbox_id, 512);
    });
    const operationVersion = requiredInteger(row.operation_version, 2);
    const consumedThroughSourceSeq = requiredInteger(
      row.consumed_through_source_seq,
      0,
    );
    const committedAt = requiredInstant(row.committed_at);
    const messageRowId = nullableInteger(row.message_row_id, 1);
    if (messageRowId !== null) {
      const message = this.database
        .query(
          "SELECT chat_jid,is_terminal_agent_reply FROM messages WHERE rowid=?",
        )
        .get(messageRowId) as
        | { chat_jid?: unknown; is_terminal_agent_reply?: unknown }
        | undefined;
      if (
        !message ||
        requiredText(message.chat_jid, 512) !== chatJid ||
        requiredInteger(message.is_terminal_agent_reply, 0) !== 1
      ) {
        throw new CorruptSettlementState();
      }
    }
    const terminal = this.database
      .query(
        `SELECT o.chat_jid,o.version,o.phase,o.terminal_disposition,
                o.terminal_message_row_id,o.terminal_error_code,
                o.terminal_committed_at,c.consumed_through_source_seq
         FROM service_effect_s01_operations o
         JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
         WHERE o.operation_id=?`,
      )
      .get(operationId) as
      | {
          chat_jid?: unknown;
          version?: unknown;
          phase?: unknown;
          terminal_disposition?: unknown;
          terminal_message_row_id?: unknown;
          terminal_error_code?: unknown;
          terminal_committed_at?: unknown;
          consumed_through_source_seq?: unknown;
        }
      | undefined;
    const terminalErrorCode = terminal
      ? nullableDiagnostic(terminal.terminal_error_code)
      : null;
    if (
      !terminal ||
      requiredText(terminal.chat_jid, 512) !== chatJid ||
      requiredInteger(terminal.version, 2) !== operationVersion ||
      terminal.phase !== "terminal" ||
      requiredDisposition(terminal.terminal_disposition) !== disposition ||
      nullableInteger(terminal.terminal_message_row_id, 1) !== messageRowId ||
      requiredInstant(terminal.terminal_committed_at) !== committedAt ||
      requiredInteger(terminal.consumed_through_source_seq, 0) <
        consumedThroughSourceSeq ||
      (disposition === "failed") !== (terminalErrorCode !== null)
    ) {
      throw new CorruptSettlementState();
    }
    return freezeCommit({
      operationId,
      operationVersion,
      disposition,
      messageRowId,
      consumedThroughSourceSeq,
      outboxIds,
      committedAt,
    });
  }

  private afterStatement(statement: TerminalSettlementStatement): void {
    this.checkpointOccurrence += 1;
    if (!this.runtime.checkpoint) return;
    try {
      if (this.runtime.checkpoint(statement, this.checkpointOccurrence) === true) {
        throw new InjectedStatementRollback();
      }
    } catch (error) {
      if (error instanceof InjectedStatementRollback) throw error;
      throw new InjectedStatementRollback();
    }
  }

  private caught(
    method: string,
    request: CommitTerminalRequest,
    error: unknown,
  ): ResultValue<never, TerminalSettlementError> {
    let mapped: TerminalSettlementError;
    if (error instanceof SettlementAbort) mapped = error.error;
    else if (error instanceof CorruptSettlementState) {
      mapped = settlementError("corrupt_state");
    } else if (error instanceof InjectedStatementRollback || isBusy(error)) {
      mapped = settlementError("storage_unavailable", "not_applied", true);
    } else {
      mapped = settlementError("storage_unavailable", "not_applied", true);
    }
    return this.failure(
      method,
      request.effect.idempotencyKey,
      request.effect.operationId,
      request.expectedVersion,
      mapped,
    );
  }

  private success(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    value: TerminalCommit,
    resultTag: string,
  ): ResultValue<TerminalCommit, never> {
    this.trace(method, effectId, operationId, version, resultTag, "applied");
    return Result.ok(value);
  }

  private failure(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    error: TerminalSettlementError,
  ): ResultValue<never, TerminalSettlementError> {
    this.trace(method, effectId, operationId, version, error._tag, error.certainty);
    return Result.err(error);
  }

  private trace(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    resultTag: string,
    certainty: TerminalSettlementError["certainty"] | null,
  ): void {
    try {
      this.runtime.recordTrace({
        contract: "EF-S02",
        method,
        effectId,
        operationId,
        sourceSeq: null,
        version,
        resultTag,
        certainty,
      });
    } catch (error) {
      void error;
    }
  }
}

type Reconciliation =
  | { readonly kind: "replay"; readonly commit: TerminalCommit }
  | { readonly kind: "error"; readonly error: TerminalSettlementError };

function validateConstruction(database: Database): void {
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) throw new Error("foreign keys disabled");
  const objects = database
    .query(
      "SELECT name,type FROM sqlite_master WHERE name IN (" +
        REQUIRED_SCHEMA.map(() => "?").join(",") +
        ")",
    )
    .all(...REQUIRED_SCHEMA) as Array<{ name?: unknown; type?: unknown }>;
  const names = new Set(objects.map((row) => String(row.name)));
  if (REQUIRED_SCHEMA.some((name) => !names.has(name))) throw new Error("schema");
  const triggers = database
    .query(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?)",
    )
    .all(...REQUIRED_TRIGGERS) as Array<{ name?: unknown }>;
  const triggerNames = new Set(triggers.map((row) => String(row.name)));
  if (REQUIRED_TRIGGERS.some((name) => !triggerNames.has(name))) {
    throw new Error("triggers");
  }
  for (const sql of REQUIRED_SCHEMA_PROBES) database.query(sql).get();
  const foreignKeyViolations = database.query("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length !== 0) throw new Error("foreign key state");
  const quickCheck = database.query("PRAGMA quick_check").get() as
    | { quick_check?: unknown }
    | undefined;
  if (quickCheck?.quick_check !== "ok") throw new Error("database state");
}

function closeOperation(row: OperationRow): ClosedOperation {
  const phase = row.phase;
  if (typeof phase !== "string" || !PHASES.has(phase as PiclawOperationPhase)) {
    throw new CorruptSettlementState();
  }
  const harnessSessionId = nullableText(row.harness_session_id, 512);
  const harness =
    harnessSessionId === null
      ? null
      : Object.freeze({
          sessionId: harnessSessionId,
          lane: requiredText(row.harness_lane, 512),
          harnessOperationId: nullableText(row.harness_operation_id, 512),
          state: requiredHarnessState(row.harness_state),
          watchGeneration: requiredInteger(row.harness_watch_generation, 0),
        });
  if (
    harnessSessionId === null &&
    [
      row.harness_lane,
      row.harness_operation_id,
      row.harness_state,
      row.harness_watch_generation,
    ].some((value) => value !== null)
  ) {
    throw new CorruptSettlementState();
  }
  const cancellationSourceId = nullableText(row.cancellation_source_id, 512);
  const cancellationSourceSeq = nullableInteger(row.cancellation_source_seq, 1);
  const cancellationCause = nullableText(row.cancellation_cause, 512);
  const cancellationRequestedAt =
    row.cancellation_requested_at === null
      ? null
      : requiredInstant(row.cancellation_requested_at);
  const cancellationFields = [
    cancellationSourceId,
    cancellationSourceSeq,
    cancellationCause,
    cancellationRequestedAt,
  ];
  if (
    cancellationFields.some((value) => value === null) &&
    cancellationFields.some((value) => value !== null)
  ) {
    throw new CorruptSettlementState();
  }
  const terminalDisposition =
    row.terminal_disposition === null
      ? null
      : requiredDisposition(row.terminal_disposition);
  if (
    terminalDisposition === null &&
    [row.terminal_message_row_id, row.terminal_error_code, row.terminal_committed_at].some(
      (value) => value !== null,
    )
  ) {
    throw new CorruptSettlementState();
  }
  return Object.freeze({
    operationId: requiredText(row.operation_id, 512),
    chatJid: requiredText(row.chat_jid, 512),
    version: requiredInteger(row.version, 1),
    phase: phase as PiclawOperationPhase,
    cancellationSourceSeq,
    harness,
    terminalDisposition,
    activeOperationId: nullableText(row.active_operation_id, 512),
    consumedThroughSourceSeq: requiredInteger(row.consumed_through_source_seq, 0),
    nextSourceSeq: requiredInteger(row.next_source_seq, 1),
  });
}

function dispositionAllowed(
  request: CommitTerminalRequest,
  operation: ClosedOperation,
): boolean {
  const cancellation = operation.cancellationSourceSeq !== null;
  switch (request.disposition) {
    case "completed":
      return operation.phase === "settling" && !cancellation && request.errorCode === null;
    case "cancelled":
      return (
        cancellation &&
        (operation.phase === "cancelling" || operation.phase === "settling") &&
        request.errorCode === null
      );
    case "failed":
      return (
        !cancellation &&
        request.errorCode !== null &&
        ["executing", "suspended", "cancelling", "settling"].includes(
          operation.phase,
        )
      );
    case "skipped":
      return (
        !cancellation &&
        request.errorCode === null &&
        request.terminalAuthorityRef !== null &&
        (operation.phase === "claimed" || operation.phase === "starting_harness") &&
        (operation.harness === null ||
          (operation.harness.state === "not_started" &&
            operation.harness.harnessOperationId === null))
      );
    case "superseded":
      return (
        !cancellation &&
        request.errorCode === null &&
        request.terminalAuthorityRef !== null &&
        ["claimed", "starting_harness", "suspended"].includes(operation.phase)
      );
  }
}

function equalHarness(
  left: HarnessCorrelation | null,
  right: HarnessCorrelation | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.sessionId === right.sessionId &&
    left.lane === right.lane &&
    left.harnessOperationId === right.harnessOperationId &&
    left.state === right.state &&
    left.watchGeneration === right.watchGeneration
  );
}

function mapOutboxConstructionError(
  error: OutboxStoreError,
): TerminalSettlementError {
  return settlementError(
    error._tag === "corrupt_state" ? "corrupt_state" : "storage_unavailable",
    error.certainty,
    error.retryable,
  );
}

function mapOutboxError(error: OutboxStoreError): TerminalSettlementError {
  if (error._tag === "idempotency_conflict") {
    return settlementError("idempotency_conflict");
  }
  if (error._tag === "storage_unavailable") {
    return settlementError("storage_unavailable", error.certainty, error.retryable);
  }
  return settlementError("corrupt_state");
}

function settlementError(
  tag: TerminalSettlementErrorTag,
  certainty: TerminalSettlementError["certainty"] = "not_applied",
  retryable = false,
  existing?: TerminalCommit,
): TerminalSettlementError {
  return Object.freeze({
    _tag: tag,
    certainty,
    retryable,
    ...(existing ? { existing } : {}),
  });
}

function freezeCommit(input: TerminalCommit): TerminalCommit {
  return Object.freeze({
    ...input,
    outboxIds: Object.freeze([...input.outboxIds]),
  });
}

function beforeEffectInjected(runtime: TerminalSettlementAdapterRuntime): boolean {
  try {
    return runtime.hitFault("before_effect") === true;
  } catch (error) {
    void error;
    return true;
  }
}

function lostAcknowledgement(runtime: TerminalSettlementAdapterRuntime): boolean {
  try {
    return runtime.hitFault("effect_then_lost_acknowledgement") === true;
  } catch (error) {
    void error;
    return false;
  }
}

function isBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

function changedOne(database: Database): boolean {
  const row = database.query("SELECT changes() AS changed").get() as
    | { changed?: unknown }
    | undefined;
  return row?.changed === 1;
}

function nullableDiagnostic(input: unknown): string | null {
  if (input === null) return null;
  const value = requiredText(input, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new CorruptSettlementState();
  }
  return value;
}

function requiredHash(input: unknown): string {
  const value = requiredText(input, 64);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new CorruptSettlementState();
  return value;
}

function requiredText(input: unknown, maxLength: number): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.trim().length === 0 ||
    input.length > maxLength
  ) {
    throw new CorruptSettlementState();
  }
  return input;
}

function nullableText(input: unknown, maxLength: number): string | null {
  return input === null ? null : requiredText(input, maxLength);
}

function requiredInteger(input: unknown, minimum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) {
    throw new CorruptSettlementState();
  }
  return input as number;
}

function nullableInteger(input: unknown, minimum: number): number | null {
  return input === null ? null : requiredInteger(input, minimum);
}

function requiredInstant(input: unknown): string {
  if (typeof input !== "string") throw new CorruptSettlementState();
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== input) {
    throw new CorruptSettlementState();
  }
  return input;
}

function requiredDisposition(input: unknown): PiclawDisposition {
  if (typeof input !== "string" || !DISPOSITIONS.has(input as PiclawDisposition)) {
    throw new CorruptSettlementState();
  }
  return input as PiclawDisposition;
}

function requiredHarnessState(input: unknown): HarnessState {
  if (typeof input !== "string" || !HARNESS_STATES.has(input as HarnessState)) {
    throw new CorruptSettlementState();
  }
  return input as HarnessState;
}
