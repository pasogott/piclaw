import { describe, expect, test } from "bun:test";
import { terminalOperation, terminalOutbox, terminalRequest, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import type { FakeTerminalOperationSeed } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

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
      expect(
        (
          subject.database
            .prepare(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'draft'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(0);
      expect(
        (
          subject.database
            .prepare(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'terminal'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
      expect(
        (subject.database.prepare("SELECT count(*) n FROM messages_fts WHERE rowid=40").get() as { n: number }).n,
      ).toBe(1);
    } finally {
      subject.dispose?.();
    }
  });

  test("placeholder replacement without new media leaves one base-only FTS row", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.seedMedia("operation-1", 74, "draft");
      subject.seedDraft({
        operationId: "operation-1",
        rowId: 40,
        revision: 1,
        chatJid: "web:terminal",
        threadId: null,
        contentRef: "payload:draft",
        mediaIds: [74],
      });
      const result = await subject.store.commitTerminal(
        terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
      );
      expect(result.ok).toBeTrue();
      for (const term of ["draft", "74"]) {
        expect(
          (subject.database.prepare("SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH ?").get(term) as { n: number }).n,
        ).toBe(0);
      }
      expect(
        (subject.database.prepare("SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'terminal'").get() as { n: number }).n,
      ).toBe(1);
      expect(
        (subject.database.prepare("SELECT count(*) n FROM messages_fts WHERE rowid=40").get() as { n: number }).n,
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
