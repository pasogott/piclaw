import type {
  CanonicalJsonValue,
  EffectIdentity,
  NormalisedEffectTrace,
} from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type { HarnessCorrelation } from "../../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  TerminalSettlementStore,
} from "../../contracts/terminal-settlement-store.js";
import type {
  ContractSubjectFactory,
  ContractTestContext,
  ParameterisedContractCase,
} from "../contract-suite.js";
import { runParameterisedContractSuite } from "../contract-suite.js";
import type {
  FakeTerminalDraftSeed,
  FakeTerminalOperationSeed,
} from "../fakes/fake-terminal-settlement-store.js";

export interface TerminalSettlementDurableView {
  readonly operation: {
    readonly operationId: string;
    readonly phase: string;
    readonly version: number;
    readonly activeOperationId: string | null;
    readonly disposition: string | null;
    readonly messageRowId: number | null;
    readonly consumedThroughSourceSeq: number;
  } | null;
  readonly sources: readonly {
    readonly sourceSeq: number;
    readonly state: string;
    readonly queuedState: string | null;
  }[];
  readonly messages: readonly {
    readonly rowId: number;
    readonly terminal: boolean;
    readonly threadId: number | null;
    readonly mediaIds: readonly number[];
  }[];
  readonly outboxIds: readonly string[];
  readonly commitCount: number;
  readonly projectionCount: number;
}

export interface TerminalSettlementContractSubject {
  readonly store: TerminalSettlementStore;
  seedOperation(seed: FakeTerminalOperationSeed): void;
  seedDraft(seed: FakeTerminalDraftSeed): void;
  seedMedia(operationId: string, mediaId: number, role?: string): void;
  seedOutbox(request: EnqueueOutboxRequest): void;
  planFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence?: number,
  ): void;
  planStatementFault(occurrence: number): void;
  removePayload(ref: string): void;
  payloadResolutionCount(): number;
  inspectStatements(): readonly string[];
  inspectDurable(operationId?: string): TerminalSettlementDurableView;
  dispose?(): void | Promise<void>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export const TERMINAL_HARNESS = Object.freeze({
  sessionId: "harness-session-1",
  lane: "main",
  harnessOperationId: "harness-run-1",
  state: "finished",
  watchGeneration: 2,
}) satisfies HarnessCorrelation;

export function terminalOperation(
  overrides: Partial<FakeTerminalOperationSeed> = {},
): FakeTerminalOperationSeed {
  return {
    operationId: "operation-1",
    chatJid: "web:terminal",
    version: 3,
    phase: "settling",
    harness: TERMINAL_HARNESS,
    activeOperationId: "operation-1",
    consumedThroughSourceSeq: 0,
    sources: [
      {
        sourceSeq: 1,
        state: "claimed",
        operationId: "operation-1",
      },
    ],
    ...overrides,
  };
}

function effect(
  key: string,
  operationId: string,
  sourceSeq: number | null,
): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId,
    sourceSeq,
    provenanceRef: "opaque:protected-provenance",
    redactionClass: "secret",
  };
}

export function terminalOutbox(
  id: string,
  operationId = "operation-1",
  sourceSeq: number | null = 1,
): EnqueueOutboxRequest {
  const base: EnqueueOutboxRequest = {
    effect: effect(`outbox-key:${id}`, operationId, sourceSeq),
    outboxId: id,
    kind: "timeline_broadcast",
    payloadRef: `opaque:protected-outbox:${id}`,
    destinationRef: "opaque:protected-destination",
    availableAt: "2026-08-14T10:00:00.000Z",
    enqueuedAt: "2026-08-14T10:00:00.000Z",
    repeatability: "repeatable",
  };
  return withHash(base);
}

interface RequestOptions {
  readonly key?: string;
  readonly operationId?: string;
  readonly chatJid?: string;
  readonly expectedVersion?: number;
  readonly expectedHarness?: HarnessCorrelation | null;
  readonly disposition?: CommitTerminalRequest["disposition"];
  readonly errorCode?: string | null;
  readonly terminalAuthorityRef?: string | null;
  readonly mode?: "insert" | "replace_placeholder" | "none";
  readonly placeholderRowId?: number | null;
  readonly threadId?: number | null;
  readonly mediaIds?: readonly number[];
  readonly contentRef?: string;
  readonly contentBlocksRef?: string | null;
  readonly sourceDispositions?: CommitTerminalRequest["sourceDispositions"];
  readonly outboxIntents?: readonly EnqueueOutboxRequest[];
  readonly committedAt?: string;
  readonly effectSourceSeq?: number | null;
}

export function terminalRequest(
  options: RequestOptions = {},
): CommitTerminalRequest {
  const operationId = options.operationId ?? "operation-1";
  const chatJid = options.chatJid ?? "web:terminal";
  const mode = options.mode ?? "insert";
  const disposition = options.disposition ?? "completed";
  const content = {
    chatJid,
    contentRef: options.contentRef ?? "payload:terminal-content",
    threadId: options.threadId ?? null,
    mediaIds: options.mediaIds ?? [],
    contentBlocksRef: options.contentBlocksRef ?? null,
  };
  const timeline: CommitTerminalRequest["timeline"] =
    mode === "none"
      ? {
          mode: "none",
          placeholderRowId: null,
          chatJid,
          contentRef: null,
          threadId: null,
          mediaIds: [],
          contentBlocksRef: null,
        }
      : mode === "replace_placeholder"
        ? {
            mode,
            placeholderRowId: options.placeholderRowId ?? 40,
            ...content,
          }
        : { mode, placeholderRowId: null, ...content };
  const authorityRequired =
    disposition === "skipped" || disposition === "superseded";
  const base: CommitTerminalRequest = {
    effect: effect(
      options.key ?? "terminal-key-1",
      operationId,
      options.effectSourceSeq === undefined ? 1 : options.effectSourceSeq,
    ) as
      EffectIdentity & { readonly operationId: string },
    expectedChatJid: chatJid,
    expectedVersion: options.expectedVersion ?? 3,
    expectedHarness:
      options.expectedHarness === undefined
        ? TERMINAL_HARNESS
        : options.expectedHarness,
    disposition,
    errorCode:
      options.errorCode === undefined
        ? disposition === "failed"
          ? "HARNESS_FAILED"
          : null
        : options.errorCode,
    terminalAuthorityRef:
      options.terminalAuthorityRef === undefined
        ? authorityRequired
          ? "opaque:terminal-authority"
          : null
        : options.terminalAuthorityRef,
    timeline,
    sourceDispositions:
      options.sourceDispositions ??
      Object.freeze([{ sourceSeq: 1, state: "consumed", reason: "terminal" }]),
    outboxIntents: options.outboxIntents ?? Object.freeze([]),
    committedAt: options.committedAt ?? "2026-08-14T10:00:00.000Z",
  };
  return withHash(base);
}

function withHash<T extends { readonly effect: EffectIdentity }>(input: T): T {
  const base = {
    ...input,
    effect: { ...input.effect, requestHash: "" },
  };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  } as T;
}

function untouched(view: TerminalSettlementDurableView): boolean {
  return (
    view.operation?.phase !== "terminal" &&
    view.operation?.disposition === null &&
    view.operation?.activeOperationId === view.operation?.operationId &&
    view.sources.every((source) => source.state === "claimed") &&
    view.messages.every((message) => !message.terminal) &&
    view.commitCount === 0
  );
}

const cases: readonly ParameterisedContractCase<TerminalSettlementContractSubject>[] =
  Object.freeze([
    {
      name: "EF-S02-C1 rollback after every statement leaves no partial terminal state",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest({
          outboxIntents: [terminalOutbox("terminal-c1")],
        });
        let statement = 1;
        for (; statement <= 100; statement += 1) {
          subject.planStatementFault(statement);
          const result = await subject.store.commitTerminal(request);
          if (result.ok) break;
          assert(
            result.error._tag === "storage_unavailable" &&
              result.error.certainty === "not_applied",
            `statement ${statement} must roll back: ${result.error._tag}:${result.error.certainty}`,
          );
          assert(untouched(subject.inspectDurable()), `partial state at ${statement}`);
        }
        assert(statement > 1 && statement <= 100, "rollback sweep reached every executed statement");
        const executed = subject.inspectStatements();
        assert(executed.length === statement - 1, "statement trace cardinality matches sweep");
        assert(
          executed.every((entry, index) => entry.startsWith(`${index + 1}:`)),
          "statement trace occurrences are consecutive",
        );
      },
    },
    {
      name: "EF-S02-C2 commit followed by lost acknowledgement returns original result",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest();
        subject.planFault("effect_then_lost_acknowledgement");
        const lost = await subject.store.commitTerminal(request);
        assert(
          !lost.ok && lost.error.certainty === "unknown",
          "lost response must be unknown",
        );
        const replay = await subject.store.commitTerminal(request);
        assert(replay.ok && replay.value.operationVersion === 4, "replay original");
        assert(subject.inspectDurable().commitCount === 1, "one commit");
      },
    },
    {
      name: "EF-S02-C3 durable cancellation cause authorises cancellation and rejects completion",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({ cancellationSourceSeq: 1, phase: "settling" }),
        );
        const [completion, cancellation] = await Promise.all([
          subject.store.commitTerminal(terminalRequest({ key: "race-complete" })),
          subject.store.commitTerminal(
            terminalRequest({ key: "race-cancel", disposition: "cancelled" }),
          ),
        ]);
        assert(
          Number(completion.ok) + Number(cancellation.ok) === 1,
          "one winner",
        );
        assert(subject.inspectDurable().operation?.disposition === "cancelled", "cancel wins authority");
        assert(subject.inspectDurable().commitCount === 1, "one decision");
      },
    },
    {
      name: "EF-S02-C4 stale Piclaw version chat owner and complete harness correlation are no-ops",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        for (const invalid of [
          terminalRequest({ key: "stale-version", expectedVersion: 2 }),
          terminalRequest({ key: "stale-chat", chatJid: "web:other" }),
          terminalRequest({
            key: "stale-harness",
            expectedHarness: { ...TERMINAL_HARNESS, watchGeneration: 1 },
          }),
        ]) {
          const result = await subject.store.commitTerminal(invalid);
          assert(!result.ok, "stale fence rejected");
          assert(untouched(subject.inspectDurable()), "stale fence is no-op");
        }
      },
    },
    {
      name: "EF-S02-C5 missing or duplicate media cannot create two terminal rows",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const missing = await subject.store.commitTerminal(
          terminalRequest({ key: "missing-media", mediaIds: [51] }),
        );
        assert(!missing.ok && missing.error._tag === "missing_media", "missing");
        const duplicate = await subject.store.commitTerminal(
          terminalRequest({ key: "duplicate-media", mediaIds: [51, 51] }),
        );
        assert(!duplicate.ok, "duplicate media rejected");
        subject.seedMedia("operation-1", 51);
        const committed = await subject.store.commitTerminal(
          terminalRequest({ key: "valid-media", mediaIds: [51] }),
        );
        assert(committed.ok, "valid media commits");
        const conflict = await subject.store.commitTerminal(
          terminalRequest({ key: "other-terminal", mediaIds: [51] }),
        );
        assert(
          !conflict.ok && conflict.error._tag === "already_terminal_conflict",
          "second terminal conflicts",
        );
        assert(subject.inspectDurable().messages.length === 1, "one row");
      },
    },
    {
      name: "EF-S02-C6 placeholder replacement preserves one terminal message",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 2,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
        });
        const result = await subject.store.commitTerminal(
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        );
        assert(result.ok && result.value.messageRowId === 40, "same row");
        const view = subject.inspectDurable();
        assert(view.messages.length === 1 && view.messages[0]?.terminal, "terminal replacement");
      },
    },
    {
      name: "EF-S02-C7 new-row settlement preserves one terminal message",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(terminalRequest());
        assert(result.ok && result.value.messageRowId !== null, "message committed");
        const replay = await subject.store.commitTerminal(terminalRequest());
        assert(replay.ok && replay.value.messageRowId === result.value.messageRowId, "stable row");
        assert(subject.inspectDurable().messages.length === 1, "one terminal row");
      },
    },
    {
      name: "EF-S02-C8 outbox insertion failure rolls back disposition and timeline",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const requested = terminalOutbox("terminal-c8");
        subject.seedOutbox(terminalOutbox("terminal-c8-existing"));
        const conflict = {
          ...requested,
          outboxId: "terminal-c8-existing",
        };
        const request = terminalRequest({
          outboxIntents: [withHash(conflict)],
        });
        const result = await subject.store.commitTerminal(request);
        assert(!result.ok && result.error._tag === "idempotency_conflict", "outbox conflict");
        assert(untouched(subject.inspectDurable()), "outbox failure atomic");
      },
    },
    {
      name: "EF-S02-C9 frontier cannot cross pending or claimed work and no projection occurs before commit",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              { sourceSeq: 2, state: "pending", operationId: null },
              { sourceSeq: 3, state: "disposed", operationId: null },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(terminalRequest({ mode: "none" }));
        assert(result.ok && result.value.consumedThroughSourceSeq === 1, "frontier stops");
        const view = subject.inspectDurable();
        assert(view.projectionCount === 0, "no projection");
        assert(view.sources[1]?.state === "pending", "foreign work untouched");
      },
    },
    {
      name: "EF-S02-R01 durable commit survives lost acknowledgement crash and replays without payload resolution",
      async run(fixture) {
        fixture.subject.seedOperation(terminalOperation());
        const request = terminalRequest({
          outboxIntents: [terminalOutbox("crash-oracle")],
        });
        fixture.subject.planFault("effect_then_lost_acknowledgement");
        const lost = await fixture.subject.store.commitTerminal(request);
        assert(!lost.ok && lost.error.certainty === "unknown", "lost acknowledgement is unknown");
        const restored = await fixture.crashAndRestore();
        restored.removePayload("payload:terminal-content");
        const before = restored.payloadResolutionCount();
        const replay = await restored.store.commitTerminal(request);
        assert(replay.ok, "durable replay succeeds without payload");
        assert(restored.payloadResolutionCount() === before, "replay bypasses resolver");
        const view = restored.inspectDurable();
        assert(
          view.commitCount === 1 &&
            view.operation?.disposition === "completed" &&
            view.messages.length === 1 &&
            view.messages[0]?.terminal === true &&
            JSON.stringify(view.outboxIds) === JSON.stringify(["crash-oracle"]),
          "one durable disposition timeline and outbox set",
        );
        const byOperation = await restored.store.getTerminal("operation-1");
        const byKey = await restored.store.getTerminalByKey("terminal-key-1");
        assert(
          byOperation.ok &&
            byKey.ok &&
            JSON.stringify(byOperation.value) === JSON.stringify(replay.value) &&
            JSON.stringify(byKey.value) === JSON.stringify(replay.value),
          "stable restored reads",
        );
      },
    },
    {
      name: "EF-S02-S05 equal replay is stable and altered candidate conflicts before payload resolution",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest();
        const first = await subject.store.commitTerminal(request);
        const replay = await subject.store.commitTerminal(request);
        assert(first.ok && replay.ok, "equal replay");
        assert(JSON.stringify(first.value) === JSON.stringify(replay.value), "stable commit");
        subject.removePayload("payload:terminal-content");
        const before = subject.payloadResolutionCount();
        const conflict = await subject.store.commitTerminal(
          terminalRequest({ key: "altered-terminal" }),
        );
        assert(
          !conflict.ok &&
            conflict.error._tag === "already_terminal_conflict" &&
            conflict.error.existing?.operationId === "operation-1",
          "altered candidate returns closed commit",
        );
        assert(subject.payloadResolutionCount() === before, "conflict precedes resolver");
      },
    },
    {
      name: "EF-S02-S01 queued input follows exact source disposition",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({
            sources: [
              {
                sourceSeq: 1,
                state: "queued",
                operationId: "operation-1",
                queuedState: "queued",
              },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(
          terminalRequest({
            sourceDispositions: [
              { sourceSeq: 1, state: "disposed", reason: "superseded-input" },
            ],
          }),
        );
        assert(result.ok, "commit");
        const source = subject.inspectDurable().sources[0];
        assert(source?.state === "disposed" && source.queuedState === "disposed", "queue follows source");
      },
    },
    {
      name: "EF-S02-S02 outbox authority cannot cross operation sources",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(
          terminalRequest({
            outboxIntents: [terminalOutbox("foreign-source", "operation-1", 99)],
          }),
        );
        assert(!result.ok && result.error._tag === "owner_conflict", "source authority");
        assert(untouched(subject.inspectDurable()), "authority failure no-op");
      },
    },
    {
      name: "EF-S02-S03 byte-equal pre-existing outbox rows are not EF-S02 insertion success",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const intent = terminalOutbox("preexisting-exact");
        subject.seedOutbox(intent);
        const result = await subject.store.commitTerminal(
          terminalRequest({ outboxIntents: [intent] }),
        );
        assert(!result.ok && result.error._tag === "idempotency_conflict", "preexisting row conflicts");
        assert(untouched(subject.inspectDurable()), "preexisting collision rolls back terminal state");
      },
    },
    {
      name: "EF-S02-S04 reads return immutable commit by operation and key",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const committed = await subject.store.commitTerminal(terminalRequest());
        assert(committed.ok, "commit");
        const byOperation = await subject.store.getTerminal("operation-1");
        const byKey = await subject.store.getTerminalByKey("terminal-key-1");
        assert(byOperation.ok && byKey.ok && byOperation.value && byKey.value, "reads");
        assert(Object.isFrozen(byOperation.value) && Object.isFrozen(byOperation.value.outboxIds), "immutable");
        assert(JSON.stringify(byOperation.value) === JSON.stringify(byKey.value), "same commit");
      },
    },
    {
      name: "EF-S02-S06 protected refs do not appear in traces",
      async run(fixture) {
        fixture.subject.seedOperation(terminalOperation());
        const result = await fixture.subject.store.commitTerminal(
          terminalRequest(),
        );
        assert(result.ok, "commit");
        assertTerminalTraceRedaction(fixture.inspectTrace());
      },
    },
  ]);

export const TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES = Object.freeze(
  cases.map((contractCase) => contractCase.name),
);

export async function defineTerminalSettlementStoreContract(
  factory: ContractSubjectFactory<TerminalSettlementContractSubject>,
  createContext: () => ContractTestContext,
) {
  return runParameterisedContractSuite(
    factory,
    cases,
    createContext,
    (subject) => subject.dispose?.(),
  );
}

export function assertTerminalTraceRedaction(
  trace: readonly NormalisedEffectTrace[],
): void {
  const encoded = JSON.stringify(trace);
  assert(!encoded.includes("protected"), "trace leaked protected ref");
  assert(!encoded.includes("payload:terminal-content"), "trace leaked payload ref");
}
