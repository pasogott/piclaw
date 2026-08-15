import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  NormalisedEffectTrace,
  NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import type {
  EffectPayloadResolver,
  ResolvedEffectPayload,
} from "../../src/service-effects/contracts/payload-resolver.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import { createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { installTimelineMediaAdapterTestSchema } from "../../src/service-effects/current-piclaw/timeline-media-test-schema.js";
import {
  createCurrentPiclawTerminalSettlementStore,
  CurrentPiclawTerminalSettlementStore,
  type TerminalSettlementAdapterRuntime,
  type TerminalSettlementStatement,
} from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import type {
  ContractSubjectFactory,
  ContractTestContext,
} from "../../src/service-effects/testing/contract-suite.js";
import {
  defineTerminalSettlementStoreContract,
  terminalOperation,
  terminalOutbox,
  terminalRequest,
  TERMINAL_HARNESS,
  TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES,
  type TerminalSettlementContractSubject,
  type TerminalSettlementDurableView,
} from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { EFFECTOR_CASE_CATALOGUE } from "../../src/service-effects/testing/effector-case-catalogue.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import {
  FakeTerminalSettlementStore,
  type FakeTerminalDraftSeed,
  type FakeTerminalOperationSeed,
} from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

function context(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-14T09:00:00.000Z"),
    ids: new SequenceEffectIdSource("s02"),
    faults: new DeterministicFaultPlan(),
  };
}

class Payloads implements EffectPayloadResolver {
  readonly values = new Map<string, ResolvedEffectPayload>();
  readonly barriers = new Map<
    string,
    { started: () => void; wait: Promise<void>; release: () => void }
  >();
  resolutionCount = 0;

  constructor() {
    this.add("payload:terminal-content", "terminal content");
    this.add("payload:draft", "draft content");
  }

  add(
    ref: string,
    content: string,
    mediaType = "text/plain",
    redactionClass: ResolvedEffectPayload["redactionClass"] = "secret",
  ): void {
    const bytes = new TextEncoder().encode(content);
    this.values.set(
      ref,
      Object.freeze({
        ref,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        mediaType,
        redactionClass,
        bytes,
      }),
    );
  }

  block(ref: string): { started: Promise<void>; release: () => void } {
    let signalStarted = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.barriers.set(ref, { started: signalStarted, wait, release });
    return { started, release };
  }

  async resolve(ref: string): Promise<ResolvedEffectPayload | null> {
    this.resolutionCount += 1;
    const barrier = this.barriers.get(ref);
    if (barrier) {
      barrier.started();
      await barrier.wait;
      this.barriers.delete(ref);
    }
    return this.values.get(ref) ?? null;
  }
}

class Runtime implements TerminalSettlementAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly faultCounts = new Map<string, number>();
  readonly statementFaults = new Set<number>();
  readonly statements: string[] = [];
  beforeValue: unknown = undefined;
  acknowledgementValue: unknown = undefined;
  throwBefore = false;
  throwAcknowledgement = false;
  checkpointValue: unknown = undefined;
  throwCheckpoint = false;

  constructor(snapshot: readonly NormalisedEffectTrace[] = []) {
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot);
  }

  plan(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence = 1,
  ): void {
    const current = this.faultCounts.get(point) ?? 0;
    this.faults.set(point, new Set([current + occurrence]));
  }

  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ): unknown {
    if (point === "before_effect") {
      if (this.throwBefore) throw new Error("protected-before-fault");
      if (this.beforeValue !== undefined) return this.beforeValue;
    } else {
      if (this.throwAcknowledgement) throw new Error("protected-ack-fault");
      if (this.acknowledgementValue !== undefined) {
        return this.acknowledgementValue;
      }
    }
    const occurrence = (this.faultCounts.get(point) ?? 0) + 1;
    this.faultCounts.set(point, occurrence);
    return this.faults.get(point)?.delete(occurrence) ?? false;
  }

  checkpoint(
    statement: TerminalSettlementStatement,
    occurrence: number,
  ): unknown {
    if (occurrence === 1) this.statements.length = 0;
    this.statements.push(`${occurrence}:${statement}`);
    if (this.throwCheckpoint) throw new Error("protected-checkpoint-fault");
    if (this.checkpointValue !== undefined) return this.checkpointValue;
    return this.statementFaults.delete(occurrence);
  }

  recordTrace(input: NormalisedTraceInput): void {
    if (input.resultTag === "call") this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}

interface SqliteSubject extends TerminalSettlementContractSubject {
  readonly database: Database;
  readonly path: string;
  readonly runtime: Runtime;
  readonly payloads: Payloads;
  ownsDirectory: boolean;
}

function openSqliteSubject(
  path: string,
  trace: readonly NormalisedEffectTrace[] = [],
  ownsDirectory = true,
): SqliteSubject {
  const database = new Database(path, { strict: true });
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000",
  );
  installTerminalSettlementCompositionSchema(database);
  const runtime = new Runtime(trace);
  const payloads = new Payloads();
  const made = createCurrentPiclawTerminalSettlementStore(
    database,
    payloads,
    runtime,
  );
  if (!made.ok) throw new Error("EF-S02 construction failed");

  return {
    database,
    path,
    runtime,
    payloads,
    ownsDirectory,
    store: made.value,
    seedOperation: (seed) => seedSqliteOperation(database, seed),
    seedDraft: (seed) => seedSqliteDraft(database, seed),
    seedMedia: (operationId, mediaId, role) =>
      seedSqliteMedia(database, operationId, mediaId, role),
    seedOutbox(request) {
      const inserter = createServiceOutboxEnqueueInserter(database);
      if (!inserter.ok) throw new Error("outbox seed construction");
      database.exec("BEGIN IMMEDIATE");
      const inserted = inserter.value.insert(request);
      if (!inserted.ok) {
        database.exec("ROLLBACK");
        throw new Error("outbox seed");
      }
      database.exec("COMMIT");
    },
    planFault: (point, occurrence) => runtime.plan(point, occurrence),
    planStatementFault(occurrence) {
      runtime.statementFaults.add(occurrence);
    },
    removePayload: (ref) => payloads.values.delete(ref),
    payloadResolutionCount: () => payloads.resolutionCount,
    inspectStatements: () => [...runtime.statements],
    inspectDurable: (operationId) =>
      inspectSqlite(database, operationId ?? "operation-1"),
    dispose() {
      if (database.open) database.close();
      if (this.ownsDirectory) {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    },
  };
}

const sqliteFactory: ContractSubjectFactory<TerminalSettlementContractSubject> =
  {
    name: "current-piclaw-terminal-settlement",
    create() {
      const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-"));
      return openSqliteSubject(join(directory, "store.sqlite"));
    },
    crashAndRestore(subject) {
      const old = subject as SqliteSubject;
      const trace = old.runtime.trace.snapshot();
      old.database.close();
      old.ownsDirectory = false;
      return {
        subject: openSqliteSubject(old.path, trace, true),
        context: context(),
      };
    },
    inspectTrace(subject) {
      return (subject as SqliteSubject).runtime.trace.inspect();
    },
  };

const fakeFactory: ContractSubjectFactory<TerminalSettlementContractSubject> = {
  name: "fake-terminal-settlement",
  create() {
    return fakeSubject(new FakeTerminalSettlementStore());
  },
  crashAndRestore(subject) {
    const old = subject.store as FakeTerminalSettlementStore;
    const store = new FakeTerminalSettlementStore();
    store.restore(old.snapshot());
    return { subject: fakeSubject(store), context: context() };
  },
  inspectTrace(subject) {
    return (subject.store as FakeTerminalSettlementStore).trace.inspect();
  },
};

function fakeSubject(
  store: FakeTerminalSettlementStore,
): TerminalSettlementContractSubject {
  return {
    store,
    seedOperation: (seed) => store.seedOperation(seed),
    seedDraft: (seed) => store.seedDraft(seed),
    seedMedia: (operationId, mediaId, role) =>
      store.seedMedia(operationId, mediaId, role),
    seedOutbox: (request) => store.seedOutbox(request),
    planFault: (point, occurrence) => store.planFault(point, occurrence),
    planStatementFault: (occurrence) => store.planStatementFault(occurrence),
    removePayload: (ref) => store.removePayload(ref),
    payloadResolutionCount: () => store.payloadResolutionCount(),
    inspectStatements: () => store.inspectStatements(),
    inspectDurable: (operationId) =>
      inspectFake(store, operationId ?? "operation-1"),
  };
}

describe("EF-S02 TerminalSettlementStore shared contract", () => {
  test("isolated SQLite adapter", async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s02-"))
      .sort();
    expect(
      await defineTerminalSettlementStoreContract(sqliteFactory, context),
    ).toHaveLength(16);
    expect(
      readdirSync(tmpdir())
        .filter((name) => name.startsWith("piclaw-s02-"))
        .sort(),
    ).toEqual(before);
  });

  test("independent deterministic fake", async () => {
    expect(
      await defineTerminalSettlementStoreContract(fakeFactory, context),
    ).toHaveLength(16);
  });

  test("exported C1-C9 and R01 names map exactly to the catalogue", () => {
    const entry = EFFECTOR_CASE_CATALOGUE.find(
      (candidate) => candidate.contractId === "EF-S02",
    );
    if (!entry) throw new Error("missing EF-S02 catalogue");
    const required = [
      ...entry.requiredCases.map(
        (item) => `${item.caseId} ${item.description}`,
      ),
      `${entry.crashOracle.oracleId} durable commit survives lost acknowledgement crash and replays without payload resolution`,
    ];
    for (const name of required) {
      expect(TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES).toContain(name);
    }
    expect(
      TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES.filter((name) =>
        name.startsWith("EF-S02-R01 "),
      ),
    ).toHaveLength(1);
  });
});

function seedSqliteOperation(
  database: Database,
  seed: FakeTerminalOperationSeed,
): void {
  const maximum = Math.max(...seed.sources.map((source) => source.sourceSeq));
  database.transaction(() => {
    database
      .query(
        `INSERT INTO service_effect_s01_chats(
           chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id
         ) VALUES (?,?,?,NULL)`,
      )
      .run(seed.chatJid, maximum + 1, seed.consumedThroughSourceSeq ?? 0);
    for (const source of seed.sources) {
      database
        .query(
          `INSERT INTO service_effect_s01_sources(
             chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,
             target_operation_id,parent_source_seq,accepted_at,disposition_reason,
             provenance_ref,create_wake_intent
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          seed.chatJid,
          source.sourceSeq,
          `source-${source.sourceSeq}`,
          "a".repeat(64),
          source.kind ?? "message",
          source.state,
          `payload:source-${source.sourceSeq}`,
          null,
          null,
          source.acceptedAt ?? "2026-08-14T09:00:00.000Z",
          source.state === "consumed" || source.state === "disposed"
            ? "seed-closed"
            : null,
          "opaque:source-provenance",
          0,
        );
    }
    const primary =
      seed.sources.find((source) => source.sourceSeq === seed.primarySourceSeq) ??
      seed.sources.find((source) => source.operationId === seed.operationId) ??
      seed.sources[0];
    if (!primary) throw new Error("operation requires source");
    const harness = seed.harness ?? null;
    database
      .query(
        `INSERT INTO service_effect_s01_operations(
           operation_id,chat_jid,version,phase,primary_source_seq,
           cancellation_source_id,cancellation_source_seq,cancellation_cause,
           cancellation_requested_at,harness_session_id,harness_lane,
           harness_operation_id,harness_state,harness_watch_generation,
           terminal_disposition,terminal_message_row_id,terminal_error_code,
           terminal_committed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        seed.operationId,
        seed.chatJid,
        seed.version,
        seed.phase,
        primary.sourceSeq,
        seed.cancellationSourceSeq == null ? null : `source-${seed.cancellationSourceSeq}`,
        seed.cancellationSourceSeq ?? null,
        seed.cancellationSourceSeq == null ? null : "user",
        seed.cancellationSourceSeq == null
          ? null
          : seed.cancellationRequestedAt ?? "2026-08-14T09:30:00.000Z",
        harness?.sessionId ?? null,
        harness?.lane ?? null,
        harness?.harnessOperationId ?? null,
        harness?.state ?? null,
        harness?.watchGeneration ?? null,
        null,
        null,
        null,
        null,
      );
    for (const source of seed.sources.filter(
      (entry) => entry.operationId === seed.operationId,
    )) {
      database
        .query(
          `INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq)
           VALUES (?,?,?)`,
        )
        .run(seed.chatJid, seed.operationId, source.sourceSeq);
      database
        .query(
          `UPDATE service_effect_s01_sources SET target_operation_id=?
           WHERE chat_jid=? AND source_seq=?`,
        )
        .run(seed.operationId, seed.chatJid, source.sourceSeq);
      if (source.queuedState) {
        database
          .query(
            `INSERT INTO service_effect_s01_queued_inputs(
               chat_jid,operation_id,source_seq,queue_kind,harness_entry_id,state
             ) VALUES (?,?,?,?,?,?)`,
          )
          .run(
            seed.chatJid,
            seed.operationId,
            source.sourceSeq,
            "steer",
            "harness-entry",
            source.queuedState,
          );
      }
    }
    database
      .query(
        "UPDATE service_effect_s01_chats SET active_operation_id=? WHERE chat_jid=?",
      )
      .run(seed.activeOperationId ?? seed.operationId, seed.chatJid);
  }).immediate();
}

function seedSqliteDraft(database: Database, seed: FakeTerminalDraftSeed): void {
  database.transaction(() => {
    database
      .query(
        `INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)
         ON CONFLICT(jid) DO NOTHING`,
      )
      .run(seed.chatJid, seed.chatJid, "2026-08-14T09:00:00.000Z");
    database
      .query(
        `INSERT INTO messages(
           rowid,id,chat_jid,sender,sender_name,content,thread_id,timestamp,
           is_from_me,is_bot_message,is_terminal_agent_reply
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        seed.rowId,
        `service-draft:${seed.operationId}:${seed.revision}`,
        seed.chatJid,
        "web-agent",
        "Piclaw",
        "draft content",
        seed.threadId,
        "2026-08-14T09:00:00.000Z",
        0,
        1,
        0,
      );
    for (const mediaId of seed.mediaIds ?? []) {
      database
        .prepare(
          "INSERT INTO message_media(message_rowid,media_id) VALUES (?,?)",
        )
        .run(seed.rowId, mediaId);
    }
    if ((seed.mediaIds?.length ?? 0) > 0) {
      const mediaText = (seed.mediaIds ?? [])
        .map((mediaId) => `media-${mediaId}-text`)
        .join("\n");
      database
        .prepare(
          `INSERT INTO messages_fts(
             messages_fts,rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
           ) VALUES ('delete',?,?,?,?,?,?,?)`,
        )
        .run(
          seed.rowId,
          "draft content",
          seed.chatJid,
          "web-agent",
          "Piclaw",
          "2026-08-14T09:00:00.000Z",
          1,
        );
      database
        .prepare(
          `INSERT INTO messages_fts(
             rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
           ) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          seed.rowId,
          `draft content\n\n${mediaText}`,
          seed.chatJid,
          "web-agent",
          "Piclaw",
          "2026-08-14T09:00:00.000Z",
          1,
        );
    }
    database
      .query(
        `INSERT INTO service_effect_timeline_writes(
           idempotency_key,request_hash,write_type,operation_id,draft_kind,
           revision,notice_kind,source_id,message_rowid,chat_jid,written_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `draft-key:${seed.operationId}:${seed.revision}`,
        "b".repeat(64),
        "draft",
        seed.operationId,
        "assistant",
        seed.revision,
        null,
        null,
        seed.rowId,
        seed.chatJid,
        "2026-08-14T09:00:00.000Z",
      );
  }).immediate();
}

function seedSqliteMedia(
  database: Database,
  operationId: string,
  mediaId: number,
  role = "terminal",
): void {
  database.transaction(() => {
    database
      .query(
        "INSERT INTO media(id,filename,content_type,data) VALUES (?,?,?,?)",
      )
      .run(
        mediaId,
        `media-${mediaId}.txt`,
        "text/plain",
        new TextEncoder().encode(`media-${mediaId}-text`),
      );
    database
      .query(
        `INSERT INTO service_effect_media_uploads(
           idempotency_key,request_hash,upload_id,media_id,sha256,byte_length,
           data_ref,thumbnail_ref,metadata_ref,created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `upload-key:${mediaId}`,
        "c".repeat(64),
        `upload-${mediaId}`,
        mediaId,
        "d".repeat(64),
        1,
        `payload:media-${mediaId}`,
        null,
        null,
        "2026-08-14T09:00:00.000Z",
      );
    database
      .query(
        `INSERT INTO service_effect_operation_media(
           idempotency_key,request_hash,operation_id,media_id,role,bound_at
         ) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        `bind-key:${mediaId}`,
        "e".repeat(64),
        operationId,
        mediaId,
        role,
        "2026-08-14T09:00:00.000Z",
      );
  }).immediate();
}

function inspectSqlite(
  database: Database,
  operationId: string,
): TerminalSettlementDurableView {
  const operation = database
    .query(
      `SELECT o.operation_id,o.phase,o.version,o.terminal_disposition,
              o.terminal_message_row_id,c.active_operation_id,
              c.consumed_through_source_seq
       FROM service_effect_s01_operations o
       JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
       WHERE o.operation_id=?`,
    )
    .get(operationId) as
    | {
        operation_id: string;
        phase: string;
        version: number;
        terminal_disposition: string | null;
        terminal_message_row_id: number | null;
        active_operation_id: string | null;
        consumed_through_source_seq: number;
      }
    | undefined;
  const sources = database
    .query(
      `SELECT s.source_seq,s.state,q.state queued_state
       FROM service_effect_s01_sources s
       LEFT JOIN service_effect_s01_queued_inputs q
         ON q.chat_jid=s.chat_jid AND q.source_seq=s.source_seq
       WHERE s.chat_jid=(SELECT chat_jid FROM service_effect_s01_operations WHERE operation_id=?)
       ORDER BY s.source_seq`,
    )
    .all(operationId) as Array<{
    source_seq: number;
    state: string;
    queued_state: string | null;
  }>;
  const messageRows = database
    .query(
      `SELECT rowid,thread_id,is_terminal_agent_reply
       FROM messages
       WHERE chat_jid=(SELECT chat_jid FROM service_effect_s01_operations WHERE operation_id=?)
       ORDER BY rowid`,
    )
    .all(operationId) as Array<{
    rowid: number;
    thread_id: number | null;
    is_terminal_agent_reply: number;
  }>;
  const messages = messageRows.map((row) => ({
    rowId: row.rowid,
    terminal: row.is_terminal_agent_reply === 1,
    threadId: row.thread_id,
    mediaIds: (
      database
        .query(
          "SELECT media_id FROM message_media WHERE message_rowid=? ORDER BY media_id",
        )
        .all(row.rowid) as Array<{ media_id: number }>
    ).map((entry) => entry.media_id),
  }));
  return {
    operation: operation
      ? {
          operationId: operation.operation_id,
          phase: operation.phase,
          version: operation.version,
          activeOperationId: operation.active_operation_id,
          disposition: operation.terminal_disposition,
          messageRowId: operation.terminal_message_row_id,
          consumedThroughSourceSeq: operation.consumed_through_source_seq,
        }
      : null,
    sources: sources.map((row) => ({
      sourceSeq: row.source_seq,
      state: row.state,
      queuedState: row.queued_state,
    })),
    messages,
    outboxIds: (
      database
        .query("SELECT outbox_id FROM service_effect_s05_outbox ORDER BY outbox_id")
        .all() as Array<{ outbox_id: string }>
    ).map((row) => row.outbox_id),
    commitCount: (
      database
        .query(
          "SELECT count(*) n FROM service_effect_s02_commits WHERE operation_id=?",
        )
        .get(operationId) as { n: number }
    ).n,
    projectionCount: 0,
  };
}

function inspectFake(
  store: FakeTerminalSettlementStore,
  operationId: string,
): TerminalSettlementDurableView {
  const state = store.inspectDurable();
  const operation = state.operations.find(
    (entry) => entry.operationId === operationId,
  );
  const chatJid = operation?.chatJid;
  return {
    operation: operation
      ? {
          operationId: operation.operationId,
          phase: operation.phase,
          version: operation.version,
          activeOperationId: operation.activeOperationId,
          disposition: operation.terminalDisposition,
          messageRowId: operation.terminalMessageRowId,
          consumedThroughSourceSeq: operation.consumedThroughSourceSeq,
        }
      : null,
    sources: state.sources
      .filter((entry) => entry.chatJid === chatJid)
      .sort((left, right) => left.sourceSeq - right.sourceSeq)
      .map((entry) => ({
        sourceSeq: entry.sourceSeq,
        state: entry.state,
        queuedState: entry.queuedState,
      })),
    messages: state.messages
      .filter((entry) => entry.chatJid === chatJid)
      .map((entry) => ({
        rowId: entry.rowId,
        terminal: entry.terminal,
        threadId: entry.threadId,
        mediaIds: [...entry.mediaIds],
      })),
    outboxIds: state.outbox.map((entry) => entry.outboxId).sort(),
    commitCount: state.decisions.filter(
      (entry) => entry.operationId === operationId,
    ).length,
    projectionCount: 0,
  };
}

describe("EF-S02 composition schema and construction hardening", () => {
  test("installer composes inside one caller transaction and is idempotent", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_s02_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBeGreaterThan(0);
    database.exec("ROLLBACK");
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    installTerminalSettlementCompositionSchema(database);
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s02_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(2);
    database.close();
  });

  test("installer rolls back every prerequisite and S02 object boundary", () => {
    const boundaries = [
      "service_work",
      "timeline_media",
      "service_outbox",
      "s02_commits",
      "s02_commit_outbox",
      "s02_commit_chat_index",
    ] as const;
    for (const expected of boundaries) {
      const database = new Database(":memory:", { strict: true });
      expect(() =>
        installTerminalSettlementCompositionSchema(database, {
          afterBoundary(boundary) {
            if (boundary === expected) throw new Error(`stop:${boundary}`);
          },
        }),
      ).toThrow(`stop:${expected}`);
      expect(
        (
          database
            .query(
              "SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(0);
      database.close();
    }
  });

  test("standalone transaction commit and rollback plus pre-created prerequisites compose", () => {
    const committed = new Database(":memory:", { strict: true });
    committed.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(committed);
    committed.exec("COMMIT");
    expect(
      createCurrentPiclawTerminalSettlementStore(
        committed,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    committed.close();

    const precreated = new Database(":memory:", { strict: true });
    precreated.exec("PRAGMA foreign_keys=ON");
    installServiceWorkSchema(precreated);
    installTimelineMediaAdapterTestSchema(precreated);
    installServiceOutboxSchema(precreated);
    installTerminalSettlementCompositionSchema(precreated);
    expect(
      createCurrentPiclawTerminalSettlementStore(
        precreated,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    precreated.close();
  });

  test("FTS object collision aborts without leaking prerequisite objects", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; CREATE TABLE messages_fts(x TEXT)");
    expect(() => installTerminalSettlementCompositionSchema(database)).toThrow();
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        database
          .query("SELECT count(*) n FROM pragma_table_info('messages_fts')")
          .get() as { n: number }
      ).n,
    ).toBe(1);
    database.close();
  });

  test("factory rejects missing disabled incomplete and incompatible schemas", () => {
    const payloads = new Payloads();
    const runtime = new Runtime();
    const missing = new Database(":memory:", { strict: true });
    expect(
      createCurrentPiclawTerminalSettlementStore(missing, payloads, runtime).ok,
    ).toBeFalse();
    expect(() =>
      CurrentPiclawTerminalSettlementStore.create(missing, payloads, runtime),
    ).toThrow();
    missing.close();

    const disabled = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(disabled);
    disabled.exec("PRAGMA foreign_keys=OFF");
    expect(
      createCurrentPiclawTerminalSettlementStore(disabled, payloads, runtime).ok,
    ).toBeFalse();
    disabled.close();

    const incomplete = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incomplete);
    incomplete.exec("DROP TRIGGER messages_ai");
    expect(
      createCurrentPiclawTerminalSettlementStore(incomplete, payloads, runtime)
        .ok,
    ).toBeFalse();
    incomplete.close();

    const incompatible = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incompatible);
    incompatible.exec(`
      PRAGMA foreign_keys=OFF;
      DROP TABLE service_effect_s02_commit_outbox;
      DROP TABLE service_effect_s02_commits;
      CREATE TABLE service_effect_s02_commits(idempotency_key TEXT PRIMARY KEY);
      CREATE TABLE service_effect_s02_commit_outbox(operation_id TEXT PRIMARY KEY);
      PRAGMA foreign_keys=ON;
    `);
    expect(
      createCurrentPiclawTerminalSettlementStore(incompatible, payloads, runtime)
        .ok,
    ).toBeFalse();
    incompatible.close();
  });

  test("factory rejects each required table index and trigger when absent", () => {
    const required = {
      table: [
        "chats",
        "media",
        "message_media",
        "messages",
        "messages_fts",
        "service_effect_media_deletions",
        "service_effect_media_upload_history",
        "service_effect_media_uploads",
        "service_effect_operation_media",
        "service_effect_outbox_media_refs",
        "service_effect_s01_chats",
        "service_effect_s01_decisions",
        "service_effect_s01_intents",
        "service_effect_s01_operation_sources",
        "service_effect_s01_operations",
        "service_effect_s01_queued_inputs",
        "service_effect_s01_sources",
        "service_effect_s01_wake_intents",
        "service_effect_s02_commit_outbox",
        "service_effect_s02_commits",
        "service_effect_s05_decisions",
        "service_effect_s05_leases",
        "service_effect_s05_outbox",
        "service_effect_s05_outcomes",
        "service_effect_s05_resolutions",
        "service_effect_timeline_writes",
      ],
      index: [
        "service_effect_draft_revision",
        "service_effect_notice_source",
        "service_effect_operation_media_id",
        "service_effect_outbox_media_id",
        "service_effect_s01_one_active_operation",
        "service_effect_s01_open_operations",
        "service_effect_s01_pending_sources",
        "service_effect_s02_commit_chat",
        "service_effect_s05_decision_outbox",
        "service_effect_s05_expired_started",
        "service_effect_s05_failed_claim",
        "service_effect_s05_lease_outbox",
        "service_effect_s05_operation_lookup",
        "service_effect_s05_pending_claim",
        "service_effect_s05_terminal_cleanup",
        "service_effect_s05_unknown_list",
        "service_effect_timeline_operation",
      ],
      trigger: ["messages_ad", "messages_ai", "messages_au"],
    } as const;
    for (const [type, names] of Object.entries(required)) {
      for (const name of names) {
        const database = new Database(":memory:", { strict: true });
        installTerminalSettlementCompositionSchema(database);
        database.exec("PRAGMA foreign_keys=OFF");
        database.exec(`DROP ${type.toUpperCase()} ${name}`);
        database.exec("PRAGMA foreign_keys=ON");
        expect(
          createCurrentPiclawTerminalSettlementStore(
            database,
            new Payloads(),
            new Runtime(),
          ).ok,
        ).toBeFalse();
        database.close();
      }
    }
  });
});

describe("EF-S02 lookup and error taxonomy", () => {
  test("invalid lookup missing operation and untraced read semantics are distinct", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      const before = subject.runtime.trace.inspect().length;
      const invalid = await subject.store.getTerminal(" ");
      expect(invalid.ok).toBeFalse();
      if (!invalid.ok) expect(invalid.error._tag).toBe("invalid_request");
      const absent = await subject.store.getTerminal("operation-absent");
      expect(absent.ok && absent.value).toBeNull();
      const commit = await subject.store.commitTerminal(terminalRequest());
      expect(commit.ok).toBeFalse();
      if (!commit.ok) expect(commit.error._tag).toBe("not_found");
      expect(subject.runtime.trace.inspect().length).toBe(before + 2);
    } finally {
      subject.dispose?.();
    }
  });

  test("every public error tag is reachable without leaking adapter details", async () => {
    const seen = new Set<string>();
    const run = async (
      setup: (subject: SqliteSubject) => void,
      request: ReturnType<typeof terminalRequest>,
    ) => {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        setup(subject);
        const result = await subject.store.commitTerminal(request);
        expect(result.ok).toBeFalse();
        if (!result.ok) seen.add(result.error._tag);
      } finally {
        subject.dispose?.();
      }
    };
    const invalid = openSqliteSubject(":memory:", [], false);
    try {
      const result = await invalid.store.commitTerminal(
        {} as ReturnType<typeof terminalRequest>,
      );
      if (!result.ok) seen.add(result.error._tag);
    } finally {
      invalid.dispose?.();
    }
    await run(() => {}, terminalRequest());
    await run(
      (subject) => {
        subject.seedOperation(terminalOperation());
        subject.seedOutbox(terminalOutbox("error-collision"));
      },
      terminalRequest({ outboxIntents: [terminalOutbox("error-collision")] }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ expectedVersion: 2 }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ chatJid: "web:wrong" }),
    );
    const closed = openSqliteSubject(":memory:", [], false);
    try {
      closed.seedOperation(terminalOperation());
      expect((await closed.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      const conflict = await closed.store.commitTerminal(
        terminalRequest({ key: "closed-other" }),
      );
      if (!conflict.ok) seen.add(conflict.error._tag);
    } finally {
      closed.dispose?.();
    }
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({
        sourceDispositions: [
          { sourceSeq: 1, state: "consumed", reason: "terminal" },
          { sourceSeq: 2, state: "disposed", reason: "extra" },
        ],
      }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ mediaIds: [404] }),
    );
    await run(
      (subject) =>
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "consumed", operationId: "operation-1" },
            ],
          }),
        ),
      terminalRequest(),
    );
    await run(
      (subject) => {
        subject.seedOperation(terminalOperation());
        subject.planFault("before_effect");
      },
      terminalRequest(),
    );
    expect([...seen].sort()).toEqual(
      [
        "already_terminal_conflict",
        "corrupt_state",
        "idempotency_conflict",
        "invalid_request",
        "invalid_source_disposition",
        "missing_media",
        "not_found",
        "owner_conflict",
        "storage_unavailable",
        "version_mismatch",
      ].sort(),
    );
  });
});

describe("EF-S02 exhaustive statement rollback coverage", () => {
  const shapes = [
    {
      name: "insert-media-outbox",
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 81);
        subject.seedMedia("operation-1", 82);
        return terminalRequest({
          mediaIds: [81, 82],
          outboxIntents: [terminalOutbox("rollback-a"), terminalOutbox("rollback-b")],
        });
      },
    },
    {
      name: "replace-multiple-sources",
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(
          terminalOperation({
            primarySourceSeq: 1,
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              {
                sourceSeq: 2,
                state: "queued",
                kind: "follow_up",
                operationId: "operation-1",
                queuedState: "queued",
              },
            ],
          }),
        );
        subject.seedMedia("operation-1", 79, "draft");
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
          mediaIds: [79],
        });
        return terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
          sourceDispositions: [
            { sourceSeq: 1, state: "consumed", reason: "primary" },
            { sourceSeq: 2, state: "disposed", reason: "follow-up" },
          ],
        });
      },
    },
    {
      name: "insert-existing-chat",
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 39,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
        });
        return terminalRequest();
      },
    },
    {
      name: "no-timeline",
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        return terminalRequest({ mode: "none" });
      },
    },
  ] as const;

  for (const factory of [sqliteFactory, fakeFactory]) {
    for (const shape of shapes) {
      test(`${factory.name} ${shape.name} rolls back after every executed statement`, async () => {
        const subject = await factory.create(context());
        try {
          const request = shape.setup(subject);
          const baseline = JSON.stringify(subject.inspectDurable());
          let occurrence = 1;
          for (; occurrence <= 100; occurrence += 1) {
            subject.planStatementFault(occurrence);
            const result = await subject.store.commitTerminal(request);
            if (result.ok) break;
            expect(result.error._tag).toBe("storage_unavailable");
            expect(result.error.certainty).toBe("not_applied");
            expect(JSON.stringify(subject.inspectDurable())).toBe(baseline);
          }
          expect(occurrence).toBeGreaterThan(1);
          expect(occurrence).toBeLessThanOrEqual(100);
          const executed = subject.inspectStatements();
          expect(executed).toHaveLength(occurrence - 1);
          expect(
            executed.every((entry, index) => entry.startsWith(`${index + 1}:`)),
          ).toBeTrue();
        } finally {
          await subject.dispose?.();
        }
      });
    }
  }
});

describe("EF-S02 authority matrix and composed state", () => {
  test("all five dispositions close only their authorised phase", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    const variants = [
      {
        disposition: "completed" as const,
        phase: "settling" as const,
        cancellation: null,
        harness: TERMINAL_HARNESS,
      },
      {
        disposition: "cancelled" as const,
        phase: "cancelling" as const,
        cancellation: 1,
        harness: TERMINAL_HARNESS,
      },
      {
        disposition: "failed" as const,
        phase: "executing" as const,
        cancellation: null,
        harness: { ...TERMINAL_HARNESS, state: "running" as const },
      },
      {
        disposition: "skipped" as const,
        phase: "claimed" as const,
        cancellation: null,
        harness: null,
      },
      {
        disposition: "superseded" as const,
        phase: "suspended" as const,
        cancellation: null,
        harness: { ...TERMINAL_HARNESS, state: "suspended" as const },
      },
    ];
    try {
      for (const [index, variant] of variants.entries()) {
        const operationId = `matrix-operation-${index}`;
        const chatJid = `web:matrix-${index}`;
        subject.seedOperation(
          terminalOperation({
            operationId,
            chatJid,
            phase: variant.phase,
            cancellationSourceSeq: variant.cancellation,
            harness: variant.harness,
            activeOperationId: operationId,
            sources: [
              {
                sourceSeq: 1,
                state: "claimed",
                operationId,
              },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(
          terminalRequest({
            key: `matrix-key-${index}`,
            operationId,
            chatJid,
            expectedHarness: variant.harness,
            disposition: variant.disposition,
            mode: "none",
          }),
        );
        expect(result.ok).toBeTrue();
        expect(subject.inspectDurable(operationId).operation?.version).toBe(4);
        expect(subject.inspectDurable(operationId).operation?.disposition).toBe(
          variant.disposition,
        );
      }
    } finally {
      subject.dispose?.();
    }
  });

  test("timeline thread roots and nullable chat timestamps are validated exactly", async () => {
    const valid = openSqliteSubject(":memory:", [], false);
    try {
      valid.seedOperation(terminalOperation());
      valid.seedDraft({
        operationId: "operation-1",
        rowId: 20,
        revision: 1,
        chatJid: "web:terminal",
        threadId: null,
        contentRef: "payload:draft",
      });
      valid.database
        .prepare("UPDATE chats SET last_message_time=NULL WHERE jid=?")
        .run("web:terminal");
      const result = await valid.store.commitTerminal(
        terminalRequest({ threadId: 20 }),
      );
      expect(result.ok).toBeTrue();
      expect(
        (
          valid.database
            .prepare("SELECT last_message_time FROM chats WHERE jid=?")
            .get("web:terminal") as { last_message_time: string }
        ).last_message_time,
      ).toBe("2026-08-14T10:00:00.000Z");
    } finally {
      valid.dispose?.();
    }

    for (const threadId of [999, 30]) {
      const invalid = openSqliteSubject(":memory:", [], false);
      try {
        invalid.seedOperation(terminalOperation());
        if (threadId === 30) {
          invalid.database.exec(
            `INSERT INTO chats(jid,name) VALUES ('web:other','web:other');
             INSERT INTO messages(rowid,id,chat_jid,content,thread_id)
             VALUES (30,'root','web:other','root',NULL)`,
          );
        }
        const result = await invalid.store.commitTerminal(
          terminalRequest({ threadId }),
        );
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("owner_conflict");
        expect(invalid.inspectDurable().commitCount).toBe(0);
      } finally {
        invalid.dispose?.();
      }
    }
  });

  test("terminal and outbox timestamps obey durable lower bounds", async () => {
    const accepted = openSqliteSubject(":memory:", [], false);
    try {
      accepted.seedOperation(
        terminalOperation({
          sources: [
            {
              sourceSeq: 1,
              state: "claimed",
              operationId: "operation-1",
              acceptedAt: "2026-08-14T10:30:00.000Z",
            },
          ],
        }),
      );
      const result = await accepted.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("owner_conflict");
    } finally {
      accepted.dispose?.();
    }

    const cancellation = openSqliteSubject(":memory:", [], false);
    try {
      cancellation.seedOperation(
        terminalOperation({
          phase: "cancelling",
          cancellationSourceSeq: 1,
          cancellationRequestedAt: "2026-08-14T10:30:00.000Z",
        }),
      );
      const result = await cancellation.store.commitTerminal(
        terminalRequest({ disposition: "cancelled" }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("owner_conflict");
    } finally {
      cancellation.dispose?.();
    }

    const outbox = openSqliteSubject(":memory:", [], false);
    try {
      outbox.seedOperation(terminalOperation());
      const intent = {
        ...terminalOutbox("bad-time"),
        enqueuedAt: "2026-08-14T09:59:59.000Z",
      };
      const result = await outbox.store.commitTerminal(
        terminalRequest({ outboxIntents: [intent] }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("invalid_request");
      expect(outbox.inspectDurable().commitCount).toBe(0);
    } finally {
      outbox.dispose?.();
    }
  });

  test("exact source coverage rejects missing extra and corrupt queued ownership", async () => {
    for (const sourceDispositions of [
      [] as const,
      [
        { sourceSeq: 1, state: "consumed" as const, reason: "terminal" },
        { sourceSeq: 2, state: "disposed" as const, reason: "foreign" },
      ],
    ]) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(
          terminalRequest({ sourceDispositions }),
        );
        expect(result.ok).toBeFalse();
        expect(subject.inspectDurable().commitCount).toBe(0);
      } finally {
        subject.dispose?.();
      }
    }

    const corruptQueue = openSqliteSubject(":memory:", [], false);
    try {
      corruptQueue.seedOperation(
        terminalOperation({
          sources: [
            {
              sourceSeq: 1,
              state: "claimed",
              operationId: "operation-1",
              queuedState: "consumed",
            },
          ],
        }),
      );
      const result = await corruptQueue.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) {
        expect(result.error._tag).toBe("corrupt_state");
      }
      expect(corruptQueue.inspectDurable().operation?.phase).not.toBe("terminal");
    } finally {
      corruptQueue.dispose?.();
    }

    const malformedSeeds: FakeTerminalOperationSeed[] = [
      terminalOperation({
        sources: [
          { sourceSeq: 1, state: "consumed", operationId: "operation-1" },
        ],
      }),
      terminalOperation({
        sources: [
          { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
          { sourceSeq: 3, state: "pending", operationId: null },
        ],
      }),
      terminalOperation({
        primarySourceSeq: 1,
        sources: [
          { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
          {
            sourceSeq: 2,
            state: "claimed",
            kind: "follow_up",
            operationId: "operation-1",
          },
        ],
      }),
    ];
    for (const seed of malformedSeeds) {
      const malformed = openSqliteSubject(":memory:", [], false);
      try {
        malformed.seedOperation(seed);
        const result = await malformed.store.commitTerminal(
          terminalRequest({
            sourceDispositions: seed.sources
              .filter((entry) => entry.operationId === "operation-1")
              .map((entry) => ({
                sourceSeq: entry.sourceSeq,
                state: "consumed" as const,
                reason: "terminal",
              })),
          }),
        );
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
        expect(malformed.inspectDurable().commitCount).toBe(0);
      } finally {
        malformed.dispose?.();
      }
    }
  });

  test("latest placeholder and terminal media role are exact", async () => {
    const placeholder = openSqliteSubject(":memory:", [], false);
    try {
      placeholder.seedOperation(terminalOperation());
      placeholder.seedDraft({
        operationId: "operation-1",
        rowId: 40,
        revision: 1,
        chatJid: "web:terminal",
        threadId: 7,
        contentRef: "payload:draft",
      });
      placeholder.seedDraft({
        operationId: "operation-1",
        rowId: 41,
        revision: 2,
        chatJid: "web:terminal",
        threadId: 7,
        contentRef: "payload:draft",
      });
      const stale = await placeholder.store.commitTerminal(
        terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
        }),
      );
      expect(stale.ok).toBeFalse();
      if (!stale.ok) expect(stale.error._tag).toBe("owner_conflict");
      expect(placeholder.inspectDurable().messages.every((row) => !row.terminal)).toBeTrue();
    } finally {
      placeholder.dispose?.();
    }

    const media = openSqliteSubject(":memory:", [], false);
    try {
      media.seedOperation(terminalOperation());
      media.seedMedia("operation-1", 61, "draft");
      const wrongRole = await media.store.commitTerminal(
        terminalRequest({ mediaIds: [61] }),
      );
      expect(wrongRole.ok).toBeFalse();
      if (!wrongRole.ok) expect(wrongRole.error._tag).toBe("missing_media");
      expect(media.inspectDurable().messages).toHaveLength(0);
    } finally {
      media.dispose?.();
    }
  });

  test("placeholder replacement removes old media terms and indexes the new terminal media", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.seedMedia("operation-1", 72, "draft");
      subject.seedMedia("operation-1", 73, "terminal");
      subject.seedDraft({
        operationId: "operation-1",
        rowId: 40,
        revision: 1,
        chatJid: "web:terminal",
        threadId: null,
        contentRef: "payload:draft",
        mediaIds: [72],
      });
      const result = await subject.store.commitTerminal(
        terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
          mediaIds: [73],
        }),
      );
      expect(result.ok).toBeTrue();
      expect(
        (
          subject.database
            .prepare(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'media AND 72'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(0);
      expect(
        (
          subject.database
            .prepare(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'media AND 73'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      subject.dispose?.();
    }
  });

  test("ordered outbox ids media links and FTS share terminal visibility", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.seedMedia("operation-1", 71);
      const result = await subject.store.commitTerminal(
        terminalRequest({
          mediaIds: [71],
          outboxIntents: [
            terminalOutbox("ordered-a"),
            terminalOutbox("ordered-b"),
          ],
        }),
      );
      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(result.value.outboxIds).toEqual(["ordered-a", "ordered-b"]);
      const view = subject.inspectDurable();
      expect(view.messages[0]?.mediaIds).toEqual([71]);
      expect(
        (
          subject.database
            .query(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'terminal'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
      expect(
        subject.database
          .query(
            "SELECT outbox_id FROM service_effect_s02_commit_outbox ORDER BY ordinal",
          )
          .all(),
      ).toEqual([{ outbox_id: "ordered-a" }, { outbox_id: "ordered-b" }]);
    } finally {
      subject.dispose?.();
    }
  });
});

describe("EF-S02 concurrency crash and corruption hardening", () => {
  test("two connections terminalise one operation exactly once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-race-"));
    const path = join(directory, "store.sqlite");
    const first = openSqliteSubject(path, [], true);
    const second = openSqliteSubject(path, [], false);
    try {
      first.seedOperation(terminalOperation());
      const [left, right] = await Promise.all([
        first.store.commitTerminal(terminalRequest({ key: "race-left" })),
        second.store.commitTerminal(terminalRequest({ key: "race-right" })),
      ]);
      expect(Number(left.ok) + Number(right.ok)).toBe(1);
      const loser = left.ok ? right : left;
      expect(loser.ok).toBeFalse();
      if (!loser.ok) {
        expect(loser.error._tag).toBe("already_terminal_conflict");
      }
      expect(first.inspectDurable().commitCount).toBe(1);
      expect(first.inspectDurable().messages).toHaveLength(1);
    } finally {
      second.dispose?.();
      first.dispose?.();
    }
  });

  test("valid competing disposition candidates converge to one terminal commit", async () => {
    const variants = [
      {
        operation: terminalOperation(),
        left: terminalRequest({ key: "candidate-completed" }),
        right: terminalRequest({
          key: "candidate-failed",
          disposition: "failed",
          errorCode: "HARNESS_FAILED",
        }),
      },
      {
        operation: terminalOperation({ phase: "claimed", harness: null }),
        left: terminalRequest({
          key: "candidate-skipped",
          disposition: "skipped",
          expectedHarness: null,
          mode: "none",
        }),
        right: terminalRequest({
          key: "candidate-superseded",
          disposition: "superseded",
          expectedHarness: null,
          mode: "none",
        }),
      },
    ] as const;
    for (const variant of variants) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(variant.operation);
        const [left, right] = await Promise.all([
          subject.store.commitTerminal(variant.left),
          subject.store.commitTerminal(variant.right),
        ]);
        expect(Number(left.ok) + Number(right.ok)).toBe(1);
        const loser = left.ok ? right : left;
        expect(loser.ok).toBeFalse();
        if (!loser.ok) {
          expect(loser.error._tag).toBe("already_terminal_conflict");
        }
        expect(subject.inspectDurable().commitCount).toBe(1);
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("held writer lock is bounded and leaves no partial state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-busy-"));
    const path = join(directory, "store.sqlite");
    const owner = openSqliteSubject(path, [], true);
    const contender = openSqliteSubject(path, [], false);
    try {
      owner.seedOperation(terminalOperation());
      contender.database.exec("PRAGMA busy_timeout=0");
      owner.database.exec("BEGIN IMMEDIATE");
      const blocked = await contender.store.commitTerminal(terminalRequest());
      expect(blocked.ok).toBeFalse();
      if (!blocked.ok) {
        expect(blocked.error._tag).toBe("storage_unavailable");
        expect(blocked.error.certainty).toBe("not_applied");
      }
      expect(contender.inspectDurable().commitCount).toBe(0);
      owner.database.exec("ROLLBACK");
    } finally {
      if (owner.database.inTransaction) owner.database.exec("ROLLBACK");
      contender.dispose?.();
      owner.dispose?.();
    }
  });

  test("earlier terminal decisions remain readable after a later operation advances the chat frontier", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      expect((await subject.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      subject.database.transaction(() => {
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_sources(
               chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,
               target_operation_id,accepted_at,provenance_ref,create_wake_intent
             ) VALUES (?,?,?,?,?,'claimed',?,?,?,?,0)`,
          )
          .run(
            "web:terminal",
            2,
            "source-2",
            "c".repeat(64),
            "message",
            "payload:source-2",
            "operation-2",
            "2026-08-14T09:30:00.000Z",
            "opaque:source-2",
          );
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_operations(
               operation_id,chat_jid,version,phase,primary_source_seq,
               harness_session_id,harness_lane,harness_operation_id,harness_state,
               harness_watch_generation
             ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            "operation-2",
            "web:terminal",
            3,
            "settling",
            2,
            TERMINAL_HARNESS.sessionId,
            TERMINAL_HARNESS.lane,
            TERMINAL_HARNESS.harnessOperationId,
            TERMINAL_HARNESS.state,
            TERMINAL_HARNESS.watchGeneration,
          );
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq)
             VALUES ('web:terminal','operation-2',2)`,
          )
          .run();
        subject.database
          .prepare(
            `UPDATE service_effect_s01_chats
             SET next_source_seq=3,active_operation_id='operation-2'
             WHERE chat_jid='web:terminal'`,
          )
          .run();
      }).immediate();
      expect(
        (
          await subject.store.commitTerminal(
            terminalRequest({
              key: "terminal-key-2",
              operationId: "operation-2",
              effectSourceSeq: 2,
              sourceDispositions: [
                { sourceSeq: 2, state: "consumed", reason: "terminal" },
              ],
            }),
          )
        ).ok,
      ).toBeTrue();
      const first = await subject.store.getTerminal("operation-1");
      const second = await subject.store.getTerminal("operation-2");
      expect(first.ok && first.value?.consumedThroughSourceSeq).toBe(1);
      expect(second.ok && second.value?.consumedThroughSourceSeq).toBe(2);
    } finally {
      subject.dispose?.();
    }
  });

  test("malformed operation and ledger rows return bounded corruption", async () => {
    const operation = openSqliteSubject(":memory:", [], false);
    try {
      operation.seedOperation(terminalOperation());
      operation.database.exec("PRAGMA ignore_check_constraints=ON");
      operation.database
        .query(
          "UPDATE service_effect_s01_operations SET phase='impossible' WHERE operation_id='operation-1'",
        )
        .run();
      const result = await operation.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
    } finally {
      operation.dispose?.();
    }

    const ledger = openSqliteSubject(":memory:", [], false);
    try {
      ledger.seedOperation(terminalOperation());
      expect((await ledger.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      ledger.database.exec("PRAGMA ignore_check_constraints=ON");
      ledger.database
        .query(
          "UPDATE service_effect_s02_commits SET committed_at='protected-invalid'",
        )
        .run();
      const read = await ledger.store.getTerminal("operation-1");
      expect(read.ok).toBeFalse();
      if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
      expect(JSON.stringify(read)).not.toContain("protected-invalid");
    } finally {
      ledger.dispose?.();
    }
  });

  test("persisted scalar edge and ordinal corruption is rejected by public reads", async () => {
    const mutations = [
      "UPDATE service_effect_s02_commits SET disposition='impossible'",
      "UPDATE service_effect_s02_commits SET outbox_count=2",
      "DELETE FROM service_effect_s02_commit_outbox",
      "UPDATE service_effect_s05_outbox SET operation_id='other'",
      "UPDATE service_effect_s05_decisions SET outcome='empty'",
      "UPDATE messages SET is_terminal_agent_reply=0 WHERE is_terminal_agent_reply=1",
      "UPDATE service_effect_s01_operations SET version=99",
      "UPDATE service_effect_s02_commits SET operation_version=99",
      "UPDATE service_effect_s02_commit_outbox SET ordinal=1",
      "UPDATE service_effect_s02_commits SET terminal_authority_ref='unexpected'",
      "UPDATE service_effect_s01_operations SET terminal_committed_at='2026-08-14T11:00:00.000Z'",
    ];
    for (const mutation of mutations) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        const committed = await subject.store.commitTerminal(
          terminalRequest({ outboxIntents: [terminalOutbox("corrupt-edge")] }),
        );
        expect(committed.ok).toBeTrue();
        subject.database.exec(
          "PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON",
        );
        subject.database.exec(mutation);
        const read = await subject.store.getTerminal("operation-1");
        expect(read.ok).toBeFalse();
        if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("mutated fake snapshots are validated through public entry points", async () => {
    const original = new FakeTerminalSettlementStore();
    original.seedOperation(terminalOperation());
    expect(
      (
        await original.commitTerminal(
          terminalRequest({ outboxIntents: [terminalOutbox("fake-corrupt")] }),
        )
      ).ok,
    ).toBeTrue();
    const mutations = [
      (snapshot: ReturnType<FakeTerminalSettlementStore["snapshot"]>) =>
        Reflect.set(snapshot.decisions[0]!.commit, "operationVersion", 99),
      (snapshot: ReturnType<FakeTerminalSettlementStore["snapshot"]>) =>
        Reflect.set(snapshot.operations[0]!, "phase", "settling"),
      (snapshot: ReturnType<FakeTerminalSettlementStore["snapshot"]>) =>
        Reflect.set(snapshot.messages[0]!, "terminal", false),
      (snapshot: ReturnType<FakeTerminalSettlementStore["snapshot"]>) =>
        snapshot.outbox.splice(0, 1),
      (snapshot: ReturnType<FakeTerminalSettlementStore["snapshot"]>) =>
        Reflect.set(snapshot.decisions[0]!.commit, "committedAt", "invalid"),
    ];
    for (const mutate of mutations) {
      const snapshot = original.snapshot();
      mutate(snapshot);
      const restored = new FakeTerminalSettlementStore();
      restored.restore(snapshot);
      const read = await restored.getTerminal("operation-1");
      expect(read.ok).toBeFalse();
      if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
    }
  });
});

describe("EF-S02 payload observer and redaction hardening", () => {
  test("payload media type and content-block validation fail before mutation", async () => {
    const wrongText = openSqliteSubject(":memory:", [], false);
    try {
      wrongText.seedOperation(terminalOperation());
      wrongText.payloads.add(
        "payload:wrong-text",
        "protected payload",
        "application/octet-stream",
      );
      const result = await wrongText.store.commitTerminal(
        terminalRequest({ contentRef: "payload:wrong-text" }),
      );
      expect(result.ok).toBeFalse();
      expect(wrongText.inspectDurable().commitCount).toBe(0);
    } finally {
      wrongText.dispose?.();
    }

    const blocks = openSqliteSubject(":memory:", [], false);
    try {
      blocks.seedOperation(terminalOperation());
      blocks.payloads.add(
        "payload:bad-blocks",
        '{"protected":"value"}',
        "application/json",
      );
      const result = await blocks.store.commitTerminal(
        terminalRequest({ contentBlocksRef: "payload:bad-blocks" }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
      expect(blocks.inspectDurable().messages).toHaveLength(0);
    } finally {
      blocks.dispose?.();
    }
  });

  test("independent fake enforces missing digest redaction blocks and resolved-content snapshots", async () => {
    const missing = new FakeTerminalSettlementStore();
    missing.seedOperation(terminalOperation());
    missing.removePayload("payload:terminal-content");
    const absent = await missing.commitTerminal(terminalRequest());
    expect(absent.ok).toBeFalse();
    expect(inspectFake(missing, "operation-1").commitCount).toBe(0);

    const mismatched = new FakeTerminalSettlementStore();
    mismatched.seedOperation(terminalOperation());
    mismatched.seedPayload(
      "payload:terminal-content",
      "private",
      "text/plain",
      "private",
    );
    expect((await mismatched.commitTerminal(terminalRequest())).ok).toBeFalse();

    const bytes = new TextEncoder().encode("protected-digest");
    const digest = new FakeTerminalSettlementStore([], {
      resolve: () => ({
        ref: "payload:terminal-content",
        sha256: "0".repeat(64),
        byteLength: bytes.byteLength,
        mediaType: "text/plain",
        redactionClass: "secret",
        bytes,
      }),
    });
    digest.seedOperation(terminalOperation());
    expect((await digest.commitTerminal(terminalRequest())).ok).toBeFalse();

    const blocks = new FakeTerminalSettlementStore();
    blocks.seedOperation(terminalOperation());
    blocks.seedPayload(
      "payload:fake-blocks",
      '[{"type":"restart_handoff"}]',
      "application/json",
    );
    const blocked = await blocks.commitTerminal(
      terminalRequest({ contentBlocksRef: "payload:fake-blocks" }),
    );
    expect(blocked.ok).toBeFalse();

    const valid = new FakeTerminalSettlementStore();
    valid.seedOperation(terminalOperation());
    const committed = await valid.commitTerminal(terminalRequest());
    expect(committed.ok).toBeTrue();
    expect(valid.snapshot().messages[0]?.content).toBe("terminal result");
  });

  test("redaction tuples and NFC-normalised identities are pinned before mutation", async () => {
    const redaction = openSqliteSubject(":memory:", [], false);
    try {
      redaction.seedOperation(terminalOperation());
      redaction.payloads.add(
        "payload:private-content",
        "private content",
        "text/plain",
        "private",
      );
      const result = await redaction.store.commitTerminal(
        terminalRequest({ contentRef: "payload:private-content" }),
      );
      expect(result.ok).toBeFalse();
      expect(redaction.inspectDurable().commitCount).toBe(0);
    } finally {
      redaction.dispose?.();
    }

    const unicode = openSqliteSubject(":memory:", [], false);
    try {
      unicode.seedOperation(terminalOperation());
      const result = await unicode.store.commitTerminal(
        terminalRequest({ key: "terminal-e\u0301" }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("invalid_request");
    } finally {
      unicode.dispose?.();
    }
  });

  test("post-resolution payload bytes and caller request mutation cannot alter the accepted snapshot", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.payloads.add(
        "payload:blocks-barrier",
        '[{"type":"text","value":"original"}]',
        "application/json",
      );
      const barrier = subject.payloads.block("payload:blocks-barrier");
      const mutable = structuredClone(
        terminalRequest({
          contentBlocksRef: "payload:blocks-barrier",
          outboxIntents: [terminalOutbox("snapshot-outbox")],
        }),
      );
      const pending = subject.store.commitTerminal(mutable);
      await barrier.started;
      const content = subject.payloads.values.get("payload:terminal-content");
      if (!content) throw new Error("missing test payload");
      content.bytes.fill(120);
      Reflect.set(mutable.expectedHarness!, "watchGeneration", 999);
      Reflect.set(mutable.sourceDispositions[0]!, "reason", "mutated");
      Reflect.set(mutable.outboxIntents[0]!, "outboxId", "mutated-outbox");
      barrier.release();
      const result = await pending;
      expect(result.ok).toBeTrue();
      expect(
        (
          subject.database
            .prepare("SELECT content FROM messages WHERE is_terminal_agent_reply=1")
            .get() as { content: string }
        ).content,
      ).toBe("terminal content");
      expect(subject.inspectDurable().outboxIds).toEqual(["snapshot-outbox"]);
    } finally {
      subject.dispose?.();
    }
  });

  test("barriers revalidate owner harness placeholder and media authority before mutation", async () => {
    const variants = [
      {
        name: "owner",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid='web:terminal'",
            )
            .run();
        },
        request: () => terminalRequest(),
      },
      {
        name: "harness",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_s01_operations SET harness_watch_generation=9 WHERE operation_id='operation-1'",
            )
            .run();
        },
        request: () => terminalRequest(),
      },
      {
        name: "placeholder",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE messages SET is_terminal_agent_reply=1 WHERE rowid=40",
            )
            .run();
        },
        request: () =>
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        draft: true,
      },
      {
        name: "media",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_operation_media SET role='draft' WHERE operation_id='operation-1' AND media_id=91",
            )
            .run();
        },
        request: () => terminalRequest({ mediaIds: [91] }),
        media: true,
      },
    ] as const;
    for (const variant of variants) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        if (variant.draft) {
          subject.seedDraft({
            operationId: "operation-1",
            rowId: 40,
            revision: 1,
            chatJid: "web:terminal",
            threadId: null,
            contentRef: "payload:draft",
          });
        }
        if (variant.media) subject.seedMedia("operation-1", 91);
        const barrier = subject.payloads.block("payload:terminal-content");
        const pending = subject.store.commitTerminal(variant.request());
        await barrier.started;
        variant.setup(subject);
        barrier.release();
        const result = await pending;
        expect(result.ok).toBeFalse();
        expect(subject.inspectDurable().commitCount).toBe(0);
        expect(subject.inspectDurable().operation?.phase).not.toBe("terminal");
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("fault and trace callbacks require exact booleans and remain bounded", async () => {
    const beforeInvalid = openSqliteSubject(":memory:", [], false);
    try {
      beforeInvalid.seedOperation(terminalOperation());
      beforeInvalid.runtime.beforeValue = "true";
      const invalid = await beforeInvalid.store.commitTerminal(terminalRequest());
      expect(invalid.ok).toBeFalse();
      if (!invalid.ok) expect(invalid.error.certainty).toBe("not_applied");
    } finally {
      beforeInvalid.dispose?.();
    }

    const beforeThrow = openSqliteSubject(":memory:", [], false);
    try {
      beforeThrow.seedOperation(terminalOperation());
      beforeThrow.runtime.throwBefore = true;
      const result = await beforeThrow.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      expect(JSON.stringify(result)).not.toContain("protected-before-fault");
    } finally {
      beforeThrow.dispose?.();
    }

    const acknowledgement = openSqliteSubject(":memory:", [], false);
    try {
      acknowledgement.seedOperation(terminalOperation());
      acknowledgement.runtime.acknowledgementValue = Promise.resolve(true);
      expect(
        (await acknowledgement.store.commitTerminal(terminalRequest())).ok,
      ).toBeTrue();
    } finally {
      acknowledgement.dispose?.();
    }

    for (const mode of ["nonboolean", "throw"] as const) {
      const checkpoint = openSqliteSubject(":memory:", [], false);
      try {
        checkpoint.seedOperation(terminalOperation());
        if (mode === "throw") checkpoint.runtime.throwCheckpoint = true;
        else checkpoint.runtime.checkpointValue = "false";
        const result = await checkpoint.store.commitTerminal(terminalRequest());
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error.certainty).toBe("not_applied");
        expect(checkpoint.inspectDurable().commitCount).toBe(0);
        expect(JSON.stringify(result)).not.toContain("protected-checkpoint-fault");
      } finally {
        checkpoint.dispose?.();
      }
    }

    const acknowledgementThrow = openSqliteSubject(":memory:", [], false);
    try {
      acknowledgementThrow.seedOperation(terminalOperation());
      acknowledgementThrow.runtime.throwAcknowledgement = true;
      expect(
        (await acknowledgementThrow.store.commitTerminal(terminalRequest())).ok,
      ).toBeTrue();
    } finally {
      acknowledgementThrow.dispose?.();
    }

    const traceThrow = openSqliteSubject(":memory:", [], false);
    try {
      traceThrow.seedOperation(terminalOperation());
      traceThrow.runtime.recordTrace = () => {
        throw new Error("protected-trace-fault");
      };
      expect((await traceThrow.store.commitTerminal(terminalRequest())).ok).toBeTrue();
    } finally {
      traceThrow.dispose?.();
    }

    const fake = new FakeTerminalSettlementStore([], undefined, {
      recordTrace() {
        throw new Error("protected-fake-observer");
      },
    });
    fake.seedOperation(terminalOperation());
    expect((await fake.commitTerminal(terminalRequest())).ok).toBeTrue();
  });

  test("hostile input and SQLite failures never escape protected values", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("protected-ownkeys");
          },
        },
      );
      const result = await subject.store.commitTerminal(
        hostile as unknown as ReturnType<typeof terminalRequest>,
      );
      expect(result.ok).toBeFalse();
      const encoded = JSON.stringify(result);
      expect(encoded).not.toContain("protected-ownkeys");
      expect(encoded).not.toContain("SQLITE");
      expect(encoded).not.toContain("opaque:protected");
    } finally {
      subject.dispose?.();
    }
  });
});

describe("EF-S02 latent import boundary", () => {
  test("fake is independent and no production entrypoint activates EF-S02", () => {
    const root = join(import.meta.dir, "../..");
    const fakeStore = readFileSync(
      join(
        root,
        "src/service-effects/testing/fakes/fake-terminal-settlement-store.ts",
      ),
      "utf8",
    );
    const fakeNormalizer = readFileSync(
      join(
        root,
        "src/service-effects/testing/fakes/fake-terminal-settlement-request-normalizer.ts",
      ),
      "utf8",
    );
    for (const source of [fakeStore, fakeNormalizer]) {
      expect(source).not.toContain("bun:sqlite");
      expect(source).not.toContain("current-piclaw/");
    }
    for (const relative of [
      "src/index.ts",
      "src/db/connection.ts",
      "src/channels/web/handlers/agent.ts",
      "src/channels/web/runtime/process-chat-finalization-runtime.ts",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toContain("terminal-settlement");
      expect(source).not.toContain("TerminalSettlementStore");
    }
  });
});
