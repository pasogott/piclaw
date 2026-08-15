import "./terminal-settlement-schema-composition.test.js";
import "./terminal-settlement-lookup.test.js";
import "./terminal-settlement-atomicity-races.test.js";
import "./terminal-settlement-authority-fts.test.js";
import "./terminal-settlement-concurrency-corruption.test.js";
import "./terminal-settlement-payload-redaction.test.js";
import "./terminal-settlement-import-boundary.test.js";

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import type { CommitTerminalRequest } from "../../src/service-effects/contracts/terminal-settlement-store.js";
import { defineTerminalSettlementStoreContract, terminalOperation, terminalRequest, type TerminalSettlementContractSubject } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { context, fakeFactory, sqliteFactory } from "./terminal-settlement-test-support.js";

describe("EF-S02 TerminalSettlementStore shared contract", () => {
  test("isolated SQLite adapter", async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s02-"))
      .sort();
    expect(
      await defineTerminalSettlementStoreContract(sqliteFactory, context),
    ).toHaveLength(23);
    expect(
      readdirSync(tmpdir())
        .filter((name) => name.startsWith("piclaw-s02-"))
        .sort(),
    ).toEqual(before);
  });

  test("independent deterministic fake", async () => {
    expect(
      await defineTerminalSettlementStoreContract(fakeFactory, context),
    ).toHaveLength(23);
  });

  test("fake and SQLite expose the same exact trace matrix and leave reads untraced", async () => {
    for (const factory of [sqliteFactory, fakeFactory]) {
      const run = async (
        setup: (subject: TerminalSettlementContractSubject) => void,
        requests: readonly CommitTerminalRequest[],
      ) => {
        const subject = await factory.create(context());
        try {
          setup(subject);
          for (const request of requests) {
            await subject.store.commitTerminal(request);
          }
          const beforeRead = factory.inspectTrace(subject);
          await subject.store.getTerminal("operation-1");
          await subject.store.getTerminalByKey("terminal-key-1");
          expect(factory.inspectTrace(subject)).toEqual(beforeRead);
          return beforeRead.map((entry) => [entry.resultTag, entry.certainty]);
        } finally {
          await subject.dispose?.();
        }
      };
      expect(
        await run(
          (subject) => subject.seedOperation(terminalOperation()),
          [terminalRequest(), terminalRequest()],
        ),
      ).toEqual([
        ["call", null],
        ["applied", "applied"],
        ["call", null],
        ["replayed", "applied"],
      ]);
      for (const scenario of [
        {
          setup: (subject: TerminalSettlementContractSubject) =>
            subject.seedOperation(terminalOperation()),
          request: terminalRequest({ expectedVersion: 99 }),
          tag: "version_mismatch",
          certainty: "not_applied",
        },
        {
          setup: (subject: TerminalSettlementContractSubject) =>
            subject.seedOperation(terminalOperation()),
          request: terminalRequest({ chatJid: "web:wrong" }),
          tag: "owner_conflict",
          certainty: "not_applied",
        },
        {
          setup: (_subject: TerminalSettlementContractSubject) => {},
          request: terminalRequest(),
          tag: "not_found",
          certainty: "not_applied",
        },
        {
          setup: (subject: TerminalSettlementContractSubject) =>
            subject.seedOperation(terminalOperation()),
          request: terminalRequest({ mediaIds: [999] }),
          tag: "missing_media",
          certainty: "not_applied",
        },
        {
          setup: (subject: TerminalSettlementContractSubject) => {
            subject.seedOperation(terminalOperation());
            subject.setFaultBehavior(
              "effect_then_lost_acknowledgement",
              "true",
            );
          },
          request: terminalRequest(),
          tag: "storage_unavailable",
          certainty: "unknown",
        },
      ] as const) {
        expect(await run(scenario.setup, [scenario.request])).toEqual([
          ["call", null],
          [scenario.tag, scenario.certainty],
        ]);
      }
      const invalid = structuredClone(terminalRequest());
      Reflect.set(invalid.effect, "idempotencyKey", "");
      expect(await run(() => {}, [invalid])).toEqual([
        ["call", null],
        ["invalid_request", "not_applied"],
      ]);
      const conflictSubject = await factory.create(context());
      try {
        conflictSubject.seedOperation(terminalOperation());
        await conflictSubject.store.commitTerminal(terminalRequest());
        await conflictSubject.store.commitTerminal(
          terminalRequest({ key: "terminal-other" }),
        );
        expect(
          factory
            .inspectTrace(conflictSubject)
            .map((entry) => [entry.resultTag, entry.certainty]),
        ).toEqual([
          ["call", null],
          ["applied", "applied"],
          ["call", null],
          ["already_terminal_conflict", "not_applied"],
        ]);
      } finally {
        await conflictSubject.dispose?.();
      }
    }
  });

});
