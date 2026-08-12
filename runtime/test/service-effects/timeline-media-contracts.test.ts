import "../helpers.js";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { getDb, initDatabase } from "../../src/db/connection.js";

import {
  attachMediaToMessage,
  attachMediaToMessageInDatabase,
  createMedia,
  createMediaInDatabase,
  deleteUnreferencedMedia,
  deleteUnreferencedMediaInDatabase,
  getMediaByIdFromDatabase,
  getMediaIdsForMessage,
} from "../../src/db/media.js";
import {
  replaceMessageContent,
  replaceMessageContentInDatabase,
  storeMessage,
  storeMessageInDatabase,
} from "../../src/db/messages.js";
import type { CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import { CurrentPiclawOperationMediaStore } from "../../src/service-effects/current-piclaw/operation-media-store.js";
import { CurrentPiclawTimelineDraftStore } from "../../src/service-effects/current-piclaw/timeline-draft-store.js";
import { installTimelineMediaAdapterTestSchema } from "../../src/service-effects/current-piclaw/timeline-media-test-schema.js";
import { defineOperationMediaStoreContract, type OperationMediaContractSubject } from "../../src/service-effects/testing/contract-suites/operation-media-store-contract.js";
import { defineTimelineDraftStoreContract, type TimelineDraftContractSubject } from "../../src/service-effects/testing/contract-suites/timeline-draft-store-contract.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan, type PlannedFault } from "../../src/service-effects/testing/fault-plan.js";
import { FakeOperationMediaStore } from "../../src/service-effects/testing/fakes/fake-operation-media-store.js";
import { FakeTimelineDraftStore } from "../../src/service-effects/testing/fakes/fake-timeline-draft-store.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";

function createContext(faults: readonly PlannedFault[] = []): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-12T00:00:00.000Z"),
    ids: new SequenceEffectIdSource("contract"),
    faults: new DeterministicFaultPlan(faults),
  };
}

const currentMediaFactory: ContractSubjectFactory<OperationMediaContractSubject> = {
  name: "current-piclaw-operation-media",
  create(context) {
    return currentMediaSubject(freshDatabase(), new InMemoryEffectPayloadResolver(), context);
  },
  crashAndRestore(subject, context) {
    const current = subject as CurrentMediaSubject;
    return { subject: currentMediaSubject(current.database, current.payloads, context), context };
  },
  inspectTrace(subject) {
    return (subject as CurrentMediaSubject).runtime.snapshot();
  },
};

const fakeMediaFactory: ContractSubjectFactory<OperationMediaContractSubject> = {
  name: "fake-operation-media",
  create(context) {
    return fakeMediaSubject(new InMemoryEffectPayloadResolver(), context);
  },
  crashAndRestore(subject, context) {
    const current = subject as FakeMediaSubject;
    const snapshot = current.store.snapshot();
    const restored = fakeMediaSubject(current.payloads, context);
    restored.store.restore(snapshot);
    return { subject: restored, context };
  },
  inspectTrace(subject) {
    return (subject.store as FakeOperationMediaStore).trace.snapshot();
  },
};

const currentTimelineFactory: ContractSubjectFactory<TimelineDraftContractSubject> = {
  name: "current-piclaw-timeline-draft",
  create(context) {
    return currentTimelineSubject(freshDatabase(), new InMemoryEffectPayloadResolver(), context);
  },
  crashAndRestore(subject, context) {
    const current = subject as CurrentTimelineSubject;
    return { subject: currentTimelineSubject(current.database, current.payloads, context), context };
  },
  inspectTrace(subject) {
    return (subject as CurrentTimelineSubject).runtime.snapshot();
  },
};

const fakeTimelineFactory: ContractSubjectFactory<TimelineDraftContractSubject> = {
  name: "fake-timeline-draft",
  create(context) {
    return fakeTimelineSubject(new InMemoryEffectPayloadResolver(), context);
  },
  crashAndRestore(subject, context) {
    const current = subject as FakeTimelineSubject;
    const snapshot = current.store.snapshot();
    const restored = fakeTimelineSubject(current.payloads, context, new Set(current.ownedMedia));
    restored.store.restore(snapshot);
    return { subject: restored, context };
  },
  inspectTrace(subject) {
    return (subject.store as FakeTimelineDraftStore).trace.snapshot();
  },
};

describe("EF-S03 TimelineDraftStore shared contract", () => {
  test("current-Piclaw adapter", async () => {
    const results = await defineTimelineDraftStoreContract(currentTimelineFactory, createContext);
    expect(results.map((result) => result.caseName)).toHaveLength(11);
  });

  test("independent deterministic fake", async () => {
    const results = await defineTimelineDraftStoreContract(fakeTimelineFactory, createContext);
    expect(results.map((result) => result.caseName)).toHaveLength(11);
  });
});

describe("EF-S04 OperationMediaStore shared contract", () => {
  test("current-Piclaw adapter", async () => {
    const results = await defineOperationMediaStoreContract(currentMediaFactory, createContext);
    expect(results.map((result) => result.caseName)).toHaveLength(13);
  });

  test("independent deterministic fake", async () => {
    const results = await defineOperationMediaStoreContract(fakeMediaFactory, createContext);
    expect(results.map((result) => result.caseName)).toHaveLength(13);
  });
});

describe("current singleton wrapper parity", () => {
  test("message wrappers delegate with unchanged storage and replacement semantics", () => {
    initDatabase();
    const database = getDb();
    const suffix = `parity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const chatJid = `web:${suffix}`;
    database.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)")
      .run(chatJid, chatJid, "2026-08-12T00:00:00.000Z");
    const first = storeMessage({ ...parityMessage(chatJid, `${suffix}-wrapper`, "wrapper one"), timestamp: "2026-08-12T00:00:00.000Z" });
    const second = storeMessageInDatabase(database, { ...parityMessage(chatJid, `${suffix}-seam`, "seam one"), timestamp: "2026-08-12T00:00:01.000Z" });
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(replaceMessageContent(chatJid, first, "wrapper two", { contentBlocks: [{ type: "text" }] })?.data.content).toBe("wrapper two");
    expect(replaceMessageContentInDatabase(database, chatJid, second, "seam two", { contentBlocks: [{ type: "text" }] })).toBeTrue();
    const rows = database.prepare("SELECT rowid, content, content_blocks FROM messages WHERE rowid IN (?, ?) ORDER BY rowid")
      .all(first, second) as Array<{ rowid: number; content: string; content_blocks: string }>;
    expect(rows).toEqual([
      { rowid: first, content: "wrapper two", content_blocks: '[{"type":"text"}]' },
      { rowid: second, content: "seam two", content_blocks: '[{"type":"text"}]' },
    ]);
  });

  test("media wrappers preserve create attach read and delete behaviour", () => {
    initDatabase();
    const database = getDb();
    const suffix = `media-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = new TextEncoder().encode("singleton parity");
    const wrapperId = createMedia(`${suffix}-wrapper.txt`, "text/plain", bytes, null, { owner: "wrapper" });
    const seamId = createMediaInDatabase(database, `${suffix}-seam.txt`, "text/plain", bytes, null, { owner: "seam" });
    expect(getMediaByIdFromDatabase(database, wrapperId)?.data).toEqual(bytes);
    expect(getMediaByIdFromDatabase(database, seamId)?.data).toEqual(bytes);

    const chatJid = `web:${suffix}`;
    database.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)")
      .run(chatJid, chatJid, "2026-08-12T00:00:00.000Z");
    const first = storeMessage(parityMessage(chatJid, `${suffix}-wrapper-message`, "wrapper media"));
    const second = storeMessage(parityMessage(chatJid, `${suffix}-seam-message`, "seam media"));
    attachMediaToMessage(first, [wrapperId]);
    attachMediaToMessageInDatabase(database, second, [seamId]);
    expect(getMediaIdsForMessage(first)).toEqual([wrapperId]);
    expect(getMediaIdsForMessage(second)).toEqual([seamId]);

    database.prepare("DELETE FROM message_media WHERE message_rowid IN (?, ?)").run(first, second);
    expect(deleteUnreferencedMedia([wrapperId])).toBe(1);
    expect(deleteUnreferencedMediaInDatabase(database, [seamId])).toBe(1);
  });
});

function freshDatabase(): Database {
  const database = new Database(":memory:", { strict: true });
  installTimelineMediaAdapterTestSchema(database);
  return database;
}

interface CurrentMediaSubject extends OperationMediaContractSubject {
  readonly database: Database;
  readonly payloads: InMemoryEffectPayloadResolver;
  readonly runtime: TestingCurrentPiclawAdapterRuntime;
  readonly store: CurrentPiclawOperationMediaStore;
}

function currentMediaSubject(
  database: Database,
  payloads: InMemoryEffectPayloadResolver,
  context: ContractTestContext,
): CurrentMediaSubject {
  const runtime = new TestingCurrentPiclawAdapterRuntime(context);
  const store = new CurrentPiclawOperationMediaStore(database, payloads, runtime);
  return {
    database,
    payloads,
    runtime,
    store,
    inspectStoredBytes(mediaId) {
      return getMediaByIdFromDatabase(database, mediaId)?.data ?? null;
    },
    addMessageReference(mediaId) {
      ensureIndexMessage(database, mediaId, false);
    },
    addOutboxReference(mediaId) {
      database.prepare("INSERT INTO service_effect_outbox_media_refs (outbox_id, media_id) VALUES (?, ?)")
        .run(`outbox-${mediaId}`, mediaId);
    },
    indexTextMedia(mediaId, expectedTerm) {
      ensureIndexMessage(database, mediaId, true);
      const row = database.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").get(`\"${expectedTerm.replaceAll('"', '""')}\"`);
      return Boolean(row);
    },
    countMediaRows() {
      return (database.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count;
    },
  };
}

interface FakeMediaSubject extends OperationMediaContractSubject {
  readonly payloads: InMemoryEffectPayloadResolver;
  readonly store: FakeOperationMediaStore;
}

function fakeMediaSubject(payloads: InMemoryEffectPayloadResolver, context: ContractTestContext): FakeMediaSubject {
  const store = new FakeOperationMediaStore(payloads, context);
  return {
    payloads,
    store,
    inspectStoredBytes(mediaId) {
      return store.snapshot().media.find((entry) => entry.ref.mediaId === mediaId)?.bytes ?? null;
    },
    addMessageReference(mediaId) { store.addMessageReference(mediaId); },
    addOutboxReference(mediaId) { store.addOutboxReference(mediaId); },
    indexTextMedia(mediaId, expectedTerm) {
      store.addMessageReference(mediaId);
      const bytes = store.snapshot().media.find((entry) => entry.ref.mediaId === mediaId)?.bytes;
      return Boolean(bytes && new TextDecoder().decode(bytes).includes(expectedTerm));
    },
    countMediaRows() { return store.snapshot().media.length; },
  };
}

function ensureIndexMessage(database: Database, mediaId: number, indexText: boolean): void {
  const chatJid = "web:media-contract";
  database.prepare("INSERT OR IGNORE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)")
    .run(chatJid, chatJid, "2026-08-12T00:00:00.000Z");
  const rowId = storeMessageInDatabase(database, {
    id: `media-reference-${mediaId}-${indexText ? "index" : "plain"}`,
    chat_jid: chatJid,
    sender: "web-agent",
    sender_name: "Piclaw",
    content: "media reference",
    timestamp: `2026-08-12T00:00:${String(mediaId).padStart(2, "0")}.000Z`,
    is_from_me: false,
    is_bot_message: true,
  });
  if (indexText) attachMediaToMessageInDatabase(database, rowId, [mediaId]);
  else database.prepare("INSERT INTO message_media (message_rowid, media_id) VALUES (?, ?)").run(rowId, mediaId);
}

interface CurrentTimelineSubject extends TimelineDraftContractSubject {
  readonly database: Database;
  readonly payloads: InMemoryEffectPayloadResolver;
  readonly runtime: TestingCurrentPiclawAdapterRuntime;
  readonly store: CurrentPiclawTimelineDraftStore;
}

function currentTimelineSubject(
  database: Database,
  payloads: InMemoryEffectPayloadResolver,
  context: ContractTestContext,
): CurrentTimelineSubject {
  const runtime = new TestingCurrentPiclawAdapterRuntime(context);
  const store = new CurrentPiclawTimelineDraftStore(database, payloads, runtime);
  const mediaStore = new CurrentPiclawOperationMediaStore(database, payloads, runtime);
  let nextMediaOrdinal = (database.prepare("SELECT COUNT(*) AS count FROM service_effect_media_uploads").get() as { count: number }).count + 1;
  return {
    database,
    payloads,
    runtime,
    store,
    async bindDraftMedia(operationId) {
      const ordinal = nextMediaOrdinal++;
      const dataRef = `timeline-media:${operationId}:${ordinal}`;
      const payload = payloads.putText(dataRef, `draft media ${ordinal}`, "text/plain");
      const created = await mediaStore.create(withHash({
        effect: nullableEffect(`create-${operationId}-${ordinal}`), uploadId: `upload-${operationId}-${ordinal}`,
        filename: "draft.txt", contentType: "text/plain", byteLength: payload.byteLength,
        sha256: payload.sha256, dataRef, thumbnailRef: null, metadataRef: null,
        createdAt: "2026-08-12T00:00:00.000Z",
      }));
      if (!created.ok) throw new Error(created.error._tag);
      const bound = await mediaStore.bindToOperation(withHash({
        effect: operationEffect(`bind-${operationId}-${ordinal}`, operationId), mediaId: created.value.mediaId,
        role: "draft" as const, boundAt: "2026-08-12T00:00:01.000Z",
      }));
      if (!bound.ok) throw new Error(bound.error._tag);
      return created.value.mediaId;
    },
    inspectRow(rowId) {
      const row = database.prepare("SELECT rowid, content, thread_id, is_terminal_agent_reply FROM messages WHERE rowid = ?")
        .get(rowId) as { rowid: number; content: string; thread_id: number | null; is_terminal_agent_reply: number } | undefined;
      return row ? { rowId: row.rowid, content: row.content, threadId: row.thread_id, terminal: row.is_terminal_agent_reply === 1 } : null;
    },
    injectHistoricalMedia(operationId, draftKind, mediaId) {
      const historical = database.prepare(`
        SELECT idempotency_key, message_rowid, chat_jid, written_at
        FROM service_effect_timeline_writes
        WHERE write_type = 'draft' AND operation_id = ? AND draft_kind = ?
        ORDER BY revision ASC LIMIT 1
      `).get(operationId, draftKind) as {
        idempotency_key: string; message_rowid: number; chat_jid: string; written_at: string;
      } | undefined;
      if (!historical) throw new Error("historical revision is missing");
      const rowId = storeMessageInDatabase(database, parityMessage(
        historical.chat_jid, `historical-${operationId}-${draftKind}`, "historical fixture",
      ));
      attachMediaToMessageInDatabase(database, rowId, [mediaId]);
      database.prepare("UPDATE service_effect_timeline_writes SET message_rowid = ? WHERE idempotency_key = ?")
        .run(rowId, historical.idempotency_key);
    },
    countTimelineRows() {
      return (database.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
    },
  };
}

interface FakeTimelineSubject extends TimelineDraftContractSubject {
  readonly payloads: InMemoryEffectPayloadResolver;
  readonly store: FakeTimelineDraftStore;
  readonly ownedMedia: Set<number>;
}

function fakeTimelineSubject(
  payloads: InMemoryEffectPayloadResolver,
  context: ContractTestContext,
  ownedMedia = new Set<number>(),
): FakeTimelineSubject {
  let nextMediaId = ownedMedia.size + 1;
  const store = new FakeTimelineDraftStore(payloads, context, (_operationId, mediaId) => ownedMedia.has(mediaId));
  return {
    payloads,
    store,
    ownedMedia,
    bindDraftMedia() {
      const mediaId = nextMediaId++;
      ownedMedia.add(mediaId);
      return mediaId;
    },
    inspectRow(rowId) {
      const row = store.inspectRows().find((entry) => entry.rowId === rowId);
      return row ? { rowId: row.rowId, content: row.content, threadId: row.threadId, terminal: row.terminal } : null;
    },
    injectHistoricalMedia(operationId, draftKind, mediaId) {
      store.injectHistoricalMedia(operationId, draftKind, mediaId);
    },
    countTimelineRows() { return store.inspectRows().length; },
  };
}

function parityMessage(chatJid: string, id: string, content: string) {
  return {
    id, chat_jid: chatJid, sender: "web-agent", sender_name: "Piclaw", content,
    timestamp: "2026-08-12T00:00:02.000Z", is_from_me: false, is_bot_message: true,
  };
}

function nullableEffect(idempotencyKey: string) {
  return {
    idempotencyKey, requestHash: "", operationId: null, sourceSeq: null,
    provenanceRef: "contract-test", redactionClass: "private" as const,
  };
}

function operationEffect(idempotencyKey: string, operationId: string) {
  return { ...nullableEffect(idempotencyKey), operationId };
}

function withHash<T extends { effect: { requestHash: string } }>(request: T): T {
  return { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } };
}
