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
import { createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import {
  createCurrentPiclawTerminalSettlementStore,
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
  type TerminalSettlementContractSubject,
  type TerminalSettlementDurableView,
} from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
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

  constructor() {
    this.add("payload:terminal-content", "terminal content");
    this.add("payload:draft", "draft content");
  }

  add(ref: string, content: string, mediaType = "text/plain"): void {
    const bytes = new TextEncoder().encode(content);
    this.values.set(
      ref,
      Object.freeze({
        ref,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        mediaType,
        redactionClass: "secret" as const,
        bytes,
      }),
    );
  }

  resolve(ref: string): ResolvedEffectPayload | null {
    return this.values.get(ref) ?? null;
  }
}

class Runtime implements TerminalSettlementAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly faultCounts = new Map<string, number>();
  readonly statementFaults = new Set<number>();
  beforeValue: unknown = undefined;
  acknowledgementValue: unknown = undefined;
  throwBefore = false;
  throwAcknowledgement = false;

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
    _statement: TerminalSettlementStatement,
    occurrence: number,
  ): unknown {
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
    seedOutbox: (request) =>
      store.seedOutbox({
        outboxId: request.outboxId,
        kind: request.kind,
        idempotencyKey: request.effect.idempotencyKey,
        requestHash: request.effect.requestHash,
        operationId: request.effect.operationId,
        sourceSeq: request.effect.sourceSeq,
      }),
    planFault: (point, occurrence) => store.planFault(point, occurrence),
    planStatementFault: (occurrence) => store.planStatementFault(occurrence),
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
    ).toHaveLength(14);
    expect(
      readdirSync(tmpdir())
        .filter((name) => name.startsWith("piclaw-s02-"))
        .sort(),
    ).toEqual(before);
  });

  test("independent deterministic fake", async () => {
    expect(
      await defineTerminalSettlementStoreContract(fakeFactory, context),
    ).toHaveLength(14);
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
          "message",
          source.state,
          `payload:source-${source.sourceSeq}`,
          null,
          null,
          "2026-08-14T09:00:00.000Z",
          source.state === "consumed" || source.state === "disposed"
            ? "seed-closed"
            : null,
          "opaque:source-provenance",
          0,
        );
    }
    const primary =
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
          : "2026-08-14T09:30:00.000Z",
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
      .run(mediaId, `media-${mediaId}.txt`, "text/plain", new Uint8Array([1]));
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

  test("factory rejects missing disabled incomplete and incompatible schemas", () => {
    const payloads = new Payloads();
    const runtime = new Runtime();
    const missing = new Database(":memory:", { strict: true });
    expect(
      createCurrentPiclawTerminalSettlementStore(missing, payloads, runtime).ok,
    ).toBeFalse();
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
        expect(result.error._tag).toBe("invalid_source_disposition");
      }
      expect(corruptQueue.inspectDurable().operation?.phase).not.toBe("terminal");
    } finally {
      corruptQueue.dispose?.();
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

  test("fault and trace callbacks require exact booleans and remain bounded", async () => {
    const beforeInvalid = openSqliteSubject(":memory:", [], false);
    try {
      beforeInvalid.seedOperation(terminalOperation());
      beforeInvalid.runtime.beforeValue = "true";
      expect(
        (await beforeInvalid.store.commitTerminal(terminalRequest())).ok,
      ).toBeTrue();
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
