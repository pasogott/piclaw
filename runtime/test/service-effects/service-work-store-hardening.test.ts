import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
  type NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import type {
  AcceptSourceRequest,
  ClaimNextSourceRequest,
  OperationSnapshot,
  ServiceWorkError,
} from "../../src/service-effects/contracts/service-work-store.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import {
  CurrentPiclawServiceWorkStore,
  type ServiceWorkAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-work-store.js";
import type { MutationMethod } from "../../src/service-effects/current-piclaw/service-work-request-normalizer.js";

class Runtime implements ServiceWorkAdapterRuntime {
  readonly traces: NormalisedTraceInput[] = [];
  hitFault(
    _point: "before_effect" | "effect_then_lost_acknowledgement",
    _method: MutationMethod,
  ): unknown {
    return false;
  }
  recordTrace(input: NormalisedTraceInput): void {
    this.traces.push(input);
  }
}

function open(path = ":memory:"): {
  database: Database;
  runtime: Runtime;
  store: CurrentPiclawServiceWorkStore;
} {
  const database = new Database(path, { strict: true });
  installServiceWorkSchema(database);
  const runtime = new Runtime();
  return {
    database,
    runtime,
    store: new CurrentPiclawServiceWorkStore(database, runtime),
  };
}

function effect(key: string): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId: null,
    sourceSeq: null,
    provenanceRef: "opaque:provenance",
    redactionClass: "secret",
  };
}

function hashed<T extends { effect: EffectIdentity }>(request: T): T {
  const base = { ...request, effect: { ...request.effect, requestHash: "" } };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  } as T;
}

function source(
  id: string,
  chatJid = "chat-1",
  key = `source:${id}`,
): AcceptSourceRequest {
  return hashed({
    effect: effect(key),
    chatJid,
    sourceId: id,
    kind: "message",
    payloadRef: `opaque:${id}`,
    targetOperationId: null,
    parentSourceSeq: null,
    acceptedAt: "2026-08-13T07:00:00.000Z",
    createWakeIntent: false,
  });
}

function claim(
  chatJid: string,
  operationId: string,
  key: string,
): ClaimNextSourceRequest {
  return hashed({
    effect: effect(key),
    chatJid,
    expectedFrontier: 0,
    newOperationId: operationId,
    claimedAt: "2026-08-13T07:00:01.000Z",
  });
}

function expectTypedFailure(
  result: { ok: true } | { ok: false; error: ServiceWorkError },
  tag: ServiceWorkError["_tag"],
): void {
  expect(result.ok).toBeFalse();
  if (!result.ok) {
    expect(result.error._tag).toBe(tag);
    expect(JSON.stringify(result.error)).not.toContain("SQLITE");
  }
}

describe("EF-S01 schema and two-connection concurrency", () => {
  test("failed installation rolls back every EF-S01 table", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec(
      "CREATE VIEW service_effect_s01_operations AS SELECT 1 AS value",
    );
    expect(() => installServiceWorkSchema(database)).toThrow();
    const tables = database
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s01_%'",
      )
      .all();
    expect(tables).toHaveLength(0);
    database.close();
  });

  test("two independent writers allocate consecutive sources and one owner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s01-race-"));
    const path = join(directory, "store.sqlite");
    const left = open(path);
    const right = open(path);
    try {
      const accepted = await Promise.all([
        left.store.acceptSource(source("a")),
        right.store.acceptSource(source("b")),
      ]);
      expect(accepted.every((result) => result.ok)).toBeTrue();
      expect(
        accepted
          .flatMap((result) => (result.ok ? [result.value.sourceSeq] : []))
          .sort(),
      ).toEqual([1, 2]);
      const claimed = await Promise.all([
        left.store.claimNext(claim("chat-1", "operation-a", "claim:a")),
        right.store.claimNext(claim("chat-1", "operation-b", "claim:b")),
      ]);
      expect(claimed.filter((result) => result.ok)).toHaveLength(1);
      expect(
        claimed.filter(
          (result) => !result.ok && result.error._tag === "owner_conflict",
        ),
      ).toHaveLength(1);
    } finally {
      left.database.close();
      right.database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("EF-S01 hostile boundaries and identity", () => {
  test("rejects malformed hashes, enums, timestamps, extra fields, getters and proxies before SQL", async () => {
    const fixture = open();
    try {
      const malformed = source("bad");
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const sparse: unknown[] = [];
      sparse.length = 2;
      const candidates: unknown[] = [
        { ...malformed, effect: { ...malformed.effect, requestHash: "x" } },
        hashed({
          ...malformed,
          kind: "unknown" as AcceptSourceRequest["kind"],
        }),
        hashed({ ...malformed, acceptedAt: "2026-08-13" }),
        hashed({ ...malformed, extra: true } as AcceptSourceRequest & {
          extra: boolean;
        }),
        { ...malformed, extra: cyclic },
        { ...malformed, extra: sparse },
        { ...malformed, extra: Symbol("invalid") },
        { ...malformed, extra: () => undefined },
        Object.defineProperty({}, "effect", {
          enumerable: true,
          get() {
            throw new Error("protected");
          },
        }),
        new Proxy(malformed, {
          ownKeys() {
            throw new Error("protected");
          },
        }),
      ];
      for (const candidate of candidates)
        expectTypedFailure(
          await fixture.store.acceptSource(candidate as AcceptSourceRequest),
          "invalid_transition",
        );
      expect((await fixture.store.getChatFrontier("chat-1")).ok).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("canonical hashes are lowercase SHA-256 and omit transport-only fields", () => {
    const request = source("vector");
    expect(request.effect.requestHash).toMatch(/^[0-9a-f]{64}$/);
    const withAttempt = { ...request, attempt: 4, traceId: "ignored" };
    expect(
      hashCanonicalRequest(withAttempt as unknown as CanonicalJsonValue),
    ).toBe(request.effect.requestHash);
    expect(request.effect.requestHash).toBe(
      "17ed3a449b1e407dc6adf609001623d0203ecb7eaacb0c4b46c4fadf2979d0cf",
    );
  });

  test("equal source under a new effect key replays while changed source conflicts", async () => {
    const fixture = open();
    try {
      const first = source("same", "chat-1", "effect:first");
      const equal = source("same", "chat-1", "effect:second");
      const changed = hashed({
        ...equal,
        effect: effect("effect:third"),
        payloadRef: "opaque:changed",
      });
      const a = await fixture.store.acceptSource(first);
      const b = await fixture.store.acceptSource(equal);
      expect(
        a.ok && b.ok && a.value.sourceSeq === b.value.sourceSeq,
      ).toBeTrue();
      expectTypedFailure(
        await fixture.store.acceptSource(changed),
        "idempotency_conflict",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("one idempotency key cannot alias across methods", async () => {
    const fixture = open();
    try {
      expect(
        (
          await fixture.store.acceptSource(
            source("one", "chat-1", "global-key"),
          )
        ).ok,
      ).toBeTrue();
      expectTypedFailure(
        await fixture.store.claimNext(
          claim("chat-1", "operation-1", "global-key"),
        ),
        "idempotency_conflict",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("expected errors are retryable with the same key after durable state changes", async () => {
    const fixture = open();
    try {
      const missingOperationEffect = {
        ...effect("retry-key"),
        operationId: "operation-1" as string,
      };
      const intent = hashed({
        effect: missingOperationEffect,
        expectedVersion: 1,
        intentId: "intent-1",
        kind: "prompt" as const,
        payloadRef: "opaque:intent",
        createdAt: "2026-08-13T07:00:02.000Z",
      });
      expectTypedFailure(await fixture.store.appendIntent(intent), "not_found");
      expect((await fixture.store.acceptSource(source("later"))).ok).toBeTrue();
      expect(
        (
          await fixture.store.claimNext(
            claim("chat-1", "operation-1", "claim:later"),
          )
        ).ok,
      ).toBeTrue();
      expect((await fixture.store.appendIntent(intent)).ok).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("harness binding is immutable across every correlation component", async () => {
    const fixture = open();
    try {
      const operation = await seedOperation(
        fixture.store,
        "chat-1",
        "operation-1",
      );
      const base = {
        effect: { ...effect("bind:first"), operationId: operation.operationId },
        expectedVersion: operation.version,
        sessionId: "session-1",
        lane: "main",
        harnessOperationId: "run-1",
        state: "running" as const,
        watchGeneration: 7,
      };
      const request = hashed(base);
      expect((await fixture.store.bindHarness(request)).ok).toBeTrue();
      for (const [key, patch] of [
        ["session", { sessionId: "session-2" }],
        ["lane", { lane: "other" }],
        ["run", { harnessOperationId: "run-2" }],
        ["state", { state: "suspended" as const }],
        ["generation", { watchGeneration: 8 }],
      ] as const) {
        const changed = hashed({
          ...request,
          ...patch,
          effect: { ...request.effect, idempotencyKey: `bind:${key}` },
        });
        expectTypedFailure(
          await fixture.store.bindHarness(changed),
          "owner_conflict",
        );
      }
    } finally {
      fixture.database.close();
    }
  });

  test("queue transition matrix supports dispose paths and rejects regressions", async () => {
    const fixture = open();
    try {
      let operation = await seedOperation(
        fixture.store,
        "chat-1",
        "operation-1",
      );
      const direct = await fixture.store.acceptSource(
        hashed({
          ...source("dispose-direct"),
          targetOperationId: operation.operationId,
        }),
      );
      expect(direct.ok).toBeTrue();
      if (!direct.ok) return;
      const accepted = await fixture.store.recordQueuedInput(
        queueRequest(
          operation,
          direct.value.sourceSeq,
          "direct:accepted",
          "accepted",
          null,
        ),
      );
      expect(accepted.ok).toBeTrue();
      if (!accepted.ok) return;
      const disposed = await fixture.store.recordQueuedInput(
        queueRequest(
          accepted.value,
          direct.value.sourceSeq,
          "direct:disposed",
          "disposed",
          null,
        ),
      );
      expect(disposed.ok).toBeTrue();
      if (!disposed.ok) return;
      expectTypedFailure(
        await fixture.store.recordQueuedInput(
          queueRequest(
            disposed.value,
            direct.value.sourceSeq,
            "direct:regress",
            "queued",
            "entry",
          ),
        ),
        "invalid_transition",
      );
      operation = disposed.value;
      const second = await fixture.store.acceptSource(
        hashed({
          ...source("dispose-queued"),
          targetOperationId: operation.operationId,
        }),
      );
      expect(second.ok).toBeTrue();
      if (!second.ok) return;
      const secondAccepted = await fixture.store.recordQueuedInput(
        queueRequest(
          operation,
          second.value.sourceSeq,
          "queued:accepted",
          "accepted",
          null,
        ),
      );
      expect(secondAccepted.ok).toBeTrue();
      if (!secondAccepted.ok) return;
      const queued = await fixture.store.recordQueuedInput(
        queueRequest(
          secondAccepted.value,
          second.value.sourceSeq,
          "queued:queued",
          "queued",
          "entry",
        ),
      );
      expect(queued.ok).toBeTrue();
      if (!queued.ok) return;
      expect(
        (
          await fixture.store.recordQueuedInput(
            queueRequest(
              queued.value,
              second.value.sourceSeq,
              "queued:disposed",
              "disposed",
              "entry",
            ),
          )
        ).ok,
      ).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("read boundaries reject hostile identifiers consistently", async () => {
    const fixture = open();
    try {
      expectTypedFailure(
        await fixture.store.getOperation(" "),
        "invalid_transition",
      );
      expectTypedFailure(
        await fixture.store.getChatFrontier(" "),
        "invalid_transition",
      );
      const hostile = Object.defineProperty({}, "limit", {
        enumerable: true,
        get() {
          throw new Error("protected");
        },
      });
      expectTypedFailure(
        await fixture.store.listOpenOperations(hostile),
        "invalid_transition",
      );
    } finally {
      fixture.database.close();
    }
  });
});

describe("EF-S01 corruption, redaction and callback faults", () => {
  test("malformed decisions and rows return closed corrupt_state", async () => {
    const fixture = open();
    try {
      const request = source("corrupt");
      expect((await fixture.store.acceptSource(request)).ok).toBeTrue();
      fixture.database
        .query(
          "UPDATE service_effect_s01_decisions SET result_json = ? WHERE idempotency_key = ?",
        )
        .run(
          '{"kind":"source","payload":"secret"}',
          request.effect.idempotencyKey,
        );
      expectTypedFailure(
        await fixture.store.acceptSource(request),
        "corrupt_state",
      );
      fixture.database.exec("PRAGMA ignore_check_constraints = ON");
      fixture.database
        .query(
          "UPDATE service_effect_s01_sources SET state = 'broken' WHERE chat_jid = 'chat-1'",
        )
        .run();
      fixture.database
        .query(
          "UPDATE service_effect_s01_sources SET source_hash = 'broken' WHERE chat_jid = 'chat-1' AND source_id = 'corrupt'",
        )
        .run();
      expectTypedFailure(
        await fixture.store.acceptSource(request),
        "corrupt_state",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("traces and decisions omit opaque payload and provenance values", async () => {
    const fixture = open();
    try {
      const request = source("secret-source");
      expect((await fixture.store.acceptSource(request)).ok).toBeTrue();
      const traces = JSON.stringify(fixture.runtime.traces);
      const decision = fixture.database
        .query(
          "SELECT result_json FROM service_effect_s01_decisions WHERE idempotency_key = ?",
        )
        .get(request.effect.idempotencyKey) as { result_json: string };
      expect(traces).not.toContain(request.payloadRef);
      expect(traces).not.toContain(request.effect.provenanceRef);
      expect(decision.result_json).not.toContain(request.payloadRef);
      expect(decision.result_json).not.toContain(request.effect.provenanceRef);
    } finally {
      fixture.database.close();
    }
  });

  test("throwing and nonboolean fault callbacks are bounded not_applied", async () => {
    for (const value of [
      Symbol("invalid"),
      Promise.resolve(true),
    ] as unknown[]) {
      const database = new Database(":memory:", { strict: true });
      installServiceWorkSchema(database);
      const runtime: ServiceWorkAdapterRuntime = {
        hitFault: () => value,
        recordTrace: () => undefined,
      };
      const store = new CurrentPiclawServiceWorkStore(database, runtime);
      const result = await store.acceptSource(source("callback"));
      expectTypedFailure(result, "storage_unavailable");
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      database.close();
    }
    const database = new Database(":memory:", { strict: true });
    installServiceWorkSchema(database);
    const runtime: ServiceWorkAdapterRuntime = {
      hitFault: () => {
        throw new Error("protected");
      },
      recordTrace: () => {
        throw new Error("protected");
      },
    };
    const result = await new CurrentPiclawServiceWorkStore(
      database,
      runtime,
    ).acceptSource(source("throwing"));
    expectTypedFailure(result, "storage_unavailable");
    database.close();
  });
});

async function seedOperation(
  store: CurrentPiclawServiceWorkStore,
  chatJid: string,
  operationId: string,
): Promise<OperationSnapshot> {
  const accepted = await store.acceptSource(
    source(`primary:${chatJid}`, chatJid),
  );
  if (!accepted.ok) throw new Error("seed acceptance failed");
  const claimed = await store.claimNext(
    claim(chatJid, operationId, `claim:${chatJid}`),
  );
  if (!claimed.ok || !claimed.value) throw new Error("seed claim failed");
  return claimed.value.operation;
}

function queueRequest(
  operation: OperationSnapshot,
  sourceSeq: number,
  key: string,
  state: "accepted" | "queued" | "consumed" | "disposed",
  harnessEntryId: string | null,
) {
  return hashed({
    effect: { ...effect(key), operationId: operation.operationId },
    expectedVersion: operation.version,
    sourceSeq,
    queueKind: "follow_up" as const,
    harnessEntryId,
    state,
  });
}
