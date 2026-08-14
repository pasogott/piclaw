import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type {
  NormalisedEffectTrace,
  NormalisedTraceInput,
} from "../../contracts/common.js";
import type {
  HarnessCorrelation,
  PiclawDisposition,
  PiclawOperationPhase,
} from "../../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  TerminalCommit,
  TerminalSettlementError,
  TerminalSettlementErrorTag,
  TerminalSettlementStore,
} from "../../contracts/terminal-settlement-store.js";
import { EffectTraceRecorder } from "../trace-recorder.js";
import {
  decodeFakeTerminalLookup,
  decodeFakeTerminalRequest,
} from "./fake-terminal-settlement-request-normalizer.js";

export interface FakeTerminalSourceSeed {
  readonly sourceSeq: number;
  readonly state:
    | "pending"
    | "claimed"
    | "queued"
    | "consumed"
    | "disposed";
  readonly operationId: string | null;
  readonly queuedState?: "accepted" | "queued" | "consumed" | "disposed" | null;
}

export interface FakeTerminalOperationSeed {
  readonly operationId: string;
  readonly chatJid: string;
  readonly version: number;
  readonly phase: PiclawOperationPhase;
  readonly cancellationSourceSeq?: number | null;
  readonly harness?: HarnessCorrelation | null;
  readonly activeOperationId?: string | null;
  readonly consumedThroughSourceSeq?: number;
  readonly sources: readonly FakeTerminalSourceSeed[];
}

export interface FakeTerminalDraftSeed {
  readonly operationId: string;
  readonly rowId: number;
  readonly revision: number;
  readonly chatJid: string;
  readonly threadId: number | null;
  readonly contentRef: string;
  readonly mediaIds?: readonly number[];
}

interface FakeOperation {
  operationId: string;
  chatJid: string;
  version: number;
  phase: PiclawOperationPhase;
  cancellationSourceSeq: number | null;
  harness: HarnessCorrelation | null;
  activeOperationId: string | null;
  consumedThroughSourceSeq: number;
  terminalDisposition: PiclawDisposition | null;
  terminalMessageRowId: number | null;
  terminalErrorCode: string | null;
  terminalCommittedAt: string | null;
}

interface FakeSource {
  sourceSeq: number;
  state: "pending" | "claimed" | "queued" | "consumed" | "disposed";
  operationId: string | null;
  reason: string | null;
  queuedState: "accepted" | "queued" | "consumed" | "disposed" | null;
}

interface FakeMessage {
  rowId: number;
  operationId: string;
  chatJid: string;
  threadId: number | null;
  contentRef: string;
  contentBlocksRef: string | null;
  mediaIds: number[];
  terminal: boolean;
}

interface FakeDraft extends FakeTerminalDraftSeed {
  mediaIds: readonly number[];
}

interface FakeOutbox {
  outboxId: string;
  kind: string;
  idempotencyKey: string;
  requestHash: string;
  operationId: string | null;
  sourceSeq: number | null;
}

interface FakeDecision {
  idempotencyKey: string;
  requestHash: string;
  operationId: string;
  terminalAuthorityRef: string | null;
  commit: TerminalCommit;
}

interface FakeState {
  nextRowId: number;
  operations: FakeOperation[];
  sources: Array<FakeSource & { chatJid: string }>;
  drafts: FakeDraft[];
  media: Array<{ operationId: string; mediaId: number; role: string }>;
  messages: FakeMessage[];
  outbox: FakeOutbox[];
  decisions: FakeDecision[];
}

export interface FakeTerminalSettlementSnapshot extends FakeState {
  readonly trace: readonly NormalisedEffectTrace[];
}

type StandardFault = "before_effect" | "effect_then_lost_acknowledgement";
type FakeSettlementStatement =
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

class FakeAbort extends Error {
  constructor(readonly error: TerminalSettlementError) {
    super(error._tag);
  }
}
class FakeStatementFault extends Error {}
class FakeCorruption extends Error {}

/**
 * Independent deterministic EF-S02 fake. State transitions and request decoding
 * are implemented locally rather than by importing the SQLite adapter helpers.
 */
export class FakeTerminalSettlementStore implements TerminalSettlementStore {
  trace: EffectTraceRecorder;
  #state: FakeState;
  #faults = new Map<string, Set<number>>();
  #faultCounts = new Map<string, number>();
  #statementFaults = new Set<number>();
  #statementCount = 0;

  constructor(trace: readonly NormalisedEffectTrace[] = []) {
    this.trace = EffectTraceRecorder.fromSnapshot(trace);
    this.#state = emptyState();
  }

  seedOperation(seed: FakeTerminalOperationSeed): void {
    if (this.#state.operations.some((entry) => entry.operationId === seed.operationId)) {
      throw new Error("duplicate fake operation");
    }
    this.#state.operations.push({
      operationId: seed.operationId,
      chatJid: seed.chatJid,
      version: seed.version,
      phase: seed.phase,
      cancellationSourceSeq: seed.cancellationSourceSeq ?? null,
      harness: seed.harness ? structuredClone(seed.harness) : null,
      activeOperationId: seed.activeOperationId ?? seed.operationId,
      consumedThroughSourceSeq: seed.consumedThroughSourceSeq ?? 0,
      terminalDisposition: null,
      terminalMessageRowId: null,
      terminalErrorCode: null,
      terminalCommittedAt: null,
    });
    for (const source of seed.sources) {
      this.#state.sources.push({
        ...structuredClone(source),
        chatJid: seed.chatJid,
        queuedState: source.queuedState ?? null,
        reason: null,
      });
    }
  }

  seedDraft(seed: FakeTerminalDraftSeed): void {
    this.#state.drafts.push({
      ...structuredClone(seed),
      mediaIds: Object.freeze([...(seed.mediaIds ?? [])]),
    });
    this.#state.messages.push({
      rowId: seed.rowId,
      operationId: seed.operationId,
      chatJid: seed.chatJid,
      threadId: seed.threadId,
      contentRef: seed.contentRef,
      contentBlocksRef: null,
      mediaIds: [...(seed.mediaIds ?? [])],
      terminal: false,
    });
    this.#state.nextRowId = Math.max(this.#state.nextRowId, seed.rowId + 1);
  }

  seedMedia(operationId: string, mediaId: number, role = "terminal"): void {
    this.#state.media.push({ operationId, mediaId, role });
  }

  seedOutbox(input: {
    outboxId: string;
    kind: string;
    idempotencyKey: string;
    requestHash: string;
    operationId?: string | null;
    sourceSeq?: number | null;
  }): void {
    this.#state.outbox.push({
      ...structuredClone(input),
      operationId: input.operationId ?? null,
      sourceSeq: input.sourceSeq ?? null,
    });
  }

  planFault(point: StandardFault, occurrence = 1): void {
    const current = this.#faultCounts.get(point) ?? 0;
    this.#faults.set(point, new Set([current + occurrence]));
  }

  planStatementFault(occurrence: number): void {
    this.#statementFaults.add(occurrence);
  }

  snapshot(): FakeTerminalSettlementSnapshot {
    return structuredClone({
      ...this.#state,
      trace: this.trace.snapshot(),
    });
  }

  restore(snapshot: FakeTerminalSettlementSnapshot): void {
    const restored = structuredClone(snapshot);
    this.#state = {
      nextRowId: restored.nextRowId,
      operations: restored.operations,
      sources: restored.sources,
      drafts: restored.drafts,
      media: restored.media,
      messages: restored.messages,
      outbox: restored.outbox,
      decisions: restored.decisions,
    };
    this.#faults.clear();
    this.#faultCounts.clear();
    this.#statementFaults.clear();
    this.#statementCount = 0;
    this.trace = EffectTraceRecorder.fromSnapshot(restored.trace);
  }

  inspectDurable(): FakeTerminalSettlementSnapshot {
    return this.snapshot();
  }

  async commitTerminal(
    input: CommitTerminalRequest,
  ): Promise<ResultValue<TerminalCommit, TerminalSettlementError>> {
    const request = decodeFakeTerminalRequest(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    const operationId = request?.effect.operationId ?? null;
    this.record({
      contract: "EF-S02",
      method: "commitTerminal",
      effectId,
      operationId,
      sourceSeq: null,
      version: request?.expectedVersion ?? null,
      resultTag: "call",
      certainty: null,
    });
    if (!request) {
      return this.failure(
        effectId,
        operationId,
        null,
        fakeError("invalid_source_disposition"),
      );
    }

    try {
      const decision = reconcile(this.#state, request);
      if (decision) return this.reconciled(request, decision);
    } catch (error) {
      return this.caught(request, error);
    }
    if (this.hitFault("before_effect")) {
      return this.failure(
        effectId,
        operationId,
        request.expectedVersion,
        fakeError("storage_unavailable", "not_applied", true),
      );
    }

    this.#statementCount = 0;
    try {
      const working = structuredClone(this.#state);
      const decision = reconcile(working, request);
      if (decision) return this.reconciled(request, decision);
      const commit = this.apply(working, request);
      this.#state = working;
      if (this.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure(
          effectId,
          operationId,
          request.expectedVersion,
          fakeError("storage_unavailable", "unknown", true),
        );
      }
      return this.success(request, commit, "applied");
    } catch (error) {
      return this.caught(request, error);
    }
  }

  async getTerminal(
    operationId: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const id = decodeFakeTerminalLookup(operationId);
    if (!id) return Result.err(fakeError("corrupt_state"));
    try {
      const decision = this.#state.decisions.find(
        (entry) => entry.operationId === id,
      );
      if (!decision) {
        const operation = this.#state.operations.find(
          (entry) => entry.operationId === id,
        );
        if (operation?.phase === "terminal") {
          return Result.err(fakeError("corrupt_state"));
        }
      }
      return Result.ok(decision ? cloneCommit(decision.commit) : null);
    } catch (error) {
      void error;
      return Result.err(fakeError("storage_unavailable", "not_applied", true));
    }
  }

  async getTerminalByKey(
    idempotencyKey: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const key = decodeFakeTerminalLookup(idempotencyKey);
    if (!key) return Result.err(fakeError("corrupt_state"));
    try {
      const decision = this.#state.decisions.find(
        (entry) => entry.idempotencyKey === key,
      );
      return Result.ok(decision ? cloneCommit(decision.commit) : null);
    } catch (error) {
      void error;
      return Result.err(fakeError("storage_unavailable", "not_applied", true));
    }
  }

  private apply(
    state: FakeState,
    request: CommitTerminalRequest,
  ): TerminalCommit {
    const operation = state.operations.find(
      (entry) => entry.operationId === request.effect.operationId,
    );
    if (!operation) throw new FakeAbort(fakeError("owner_conflict"));
    authorise(request, operation);
    const operationSources = state.sources.filter(
      (entry) =>
        entry.chatJid === operation.chatJid &&
        entry.operationId === operation.operationId,
    );
    authoriseOutbox(request, operation, operationSources);
    const claimed = operationSources
      .filter(
        (entry) => entry.state === "claimed" || entry.state === "queued",
      )
      .sort((left, right) => left.sourceSeq - right.sourceSeq);
    if (
      claimed.length !== request.sourceDispositions.length ||
      claimed.some(
        (source, index) =>
          source.sourceSeq !== request.sourceDispositions[index]?.sourceSeq,
      )
    ) {
      throw new FakeAbort(fakeError("invalid_source_disposition"));
    }
    for (const mediaId of request.timeline.mediaIds) {
      if (
        !state.media.some(
          (entry) =>
            entry.operationId === operation.operationId &&
            entry.mediaId === mediaId &&
            entry.role === "terminal",
        )
      ) {
        throw new FakeAbort(fakeError("missing_media"));
      }
    }

    const messageRowId = this.writeTimeline(state, request);
    for (const disposition of request.sourceDispositions) {
      const source = claimed.find(
        (entry) => entry.sourceSeq === disposition.sourceSeq,
      );
      if (!source) {
        throw new FakeAbort(fakeError("invalid_source_disposition"));
      }
      const expectedQueueState =
        source.state === "queued" ? "queued" : "accepted";
      if (
        (source.state === "queued" &&
          source.queuedState !== expectedQueueState) ||
        (source.queuedState !== null &&
          source.queuedState !== expectedQueueState)
      ) {
        throw new FakeAbort(fakeError("invalid_source_disposition"));
      }
      source.state = disposition.state;
      source.reason = disposition.reason;
      this.afterStatement("settle_source");
      if (source.queuedState !== null) {
        source.queuedState = disposition.state;
        this.afterStatement("settle_queued_input");
      }
    }

    let frontier = operation.consumedThroughSourceSeq;
    while (true) {
      const next = state.sources.find(
        (entry) =>
          entry.chatJid === operation.chatJid &&
          entry.sourceSeq === frontier + 1,
      );
      if (!next || (next.state !== "consumed" && next.state !== "disposed")) {
        break;
      }
      frontier += 1;
    }

    operation.version += 1;
    operation.phase = "terminal";
    operation.terminalDisposition = request.disposition;
    operation.terminalMessageRowId = messageRowId;
    operation.terminalErrorCode = request.errorCode;
    operation.terminalCommittedAt = request.committedAt;
    this.afterStatement("terminalise_operation");
    operation.consumedThroughSourceSeq = frontier;
    operation.activeOperationId = null;
    this.afterStatement("advance_frontier_release_owner");

    for (const intent of request.outboxIntents) {
      const byId = state.outbox.find((entry) => entry.outboxId === intent.outboxId);
      const byKey = state.outbox.find(
        (entry) =>
          entry.kind === intent.kind &&
          entry.idempotencyKey === intent.effect.idempotencyKey,
      );
      if (byId || byKey) {
        const existing = byId ?? byKey;
        if (
          !existing ||
          existing.outboxId !== intent.outboxId ||
          existing.kind !== intent.kind ||
          existing.idempotencyKey !== intent.effect.idempotencyKey ||
          existing.requestHash !== intent.effect.requestHash
        ) {
          throw new FakeAbort(fakeError("idempotency_conflict"));
        }
      } else {
        state.outbox.push({
          outboxId: intent.outboxId,
          kind: intent.kind,
          idempotencyKey: intent.effect.idempotencyKey,
          requestHash: intent.effect.requestHash,
          operationId: intent.effect.operationId,
          sourceSeq: intent.effect.sourceSeq,
        });
      }
      this.afterStatement("enqueue_outbox");
    }

    const commit = cloneCommit({
      operationId: operation.operationId,
      operationVersion: operation.version,
      disposition: request.disposition,
      messageRowId,
      consumedThroughSourceSeq: frontier,
      outboxIds: request.outboxIntents.map((intent) => intent.outboxId),
      committedAt: request.committedAt,
    });
    state.decisions.push({
      idempotencyKey: request.effect.idempotencyKey,
      requestHash: request.effect.requestHash,
      operationId: operation.operationId,
      terminalAuthorityRef: request.terminalAuthorityRef,
      commit,
    });
    this.afterStatement("insert_commit");
    for (const _intent of request.outboxIntents) {
      void _intent;
      this.afterStatement("link_commit_outbox");
    }
    return commit;
  }

  private writeTimeline(
    state: FakeState,
    request: CommitTerminalRequest,
  ): number | null {
    const timeline = request.timeline;
    if (timeline.mode === "none") return null;
    if (timeline.mode === "replace_placeholder") {
      const operationDrafts = state.drafts.filter(
        (entry) => entry.operationId === request.effect.operationId,
      );
      const latestRevision = Math.max(
        ...operationDrafts.map((entry) => entry.revision),
      );
      const latest = operationDrafts.find(
        (entry) =>
          entry.rowId === timeline.placeholderRowId &&
          entry.revision === latestRevision,
      );
      const message = state.messages.find(
        (entry) => entry.rowId === timeline.placeholderRowId,
      );
      if (
        !latest ||
        latest.chatJid !== request.expectedChatJid ||
        !message ||
        message.operationId !== request.effect.operationId ||
        message.chatJid !== request.expectedChatJid ||
        message.threadId !== timeline.threadId ||
        message.terminal
      ) {
        throw new FakeAbort(fakeError("owner_conflict"));
      }
      message.contentRef = timeline.contentRef;
      message.contentBlocksRef = timeline.contentBlocksRef;
      message.mediaIds = [...timeline.mediaIds];
      message.terminal = true;
      this.afterStatement("replace_terminal_message");
      return message.rowId;
    }
    if (
      state.messages.some(
        (entry) =>
          entry.operationId === request.effect.operationId && entry.terminal,
      )
    ) {
      throw new FakeCorruption();
    }
    this.afterStatement("ensure_timeline_chat");
    const rowId = state.nextRowId++;
    state.messages.push({
      rowId,
      operationId: request.effect.operationId,
      chatJid: request.expectedChatJid,
      threadId: timeline.threadId,
      contentRef: timeline.contentRef,
      contentBlocksRef: timeline.contentBlocksRef,
      mediaIds: [...timeline.mediaIds],
      terminal: true,
    });
    this.afterStatement("insert_terminal_message");
    if (timeline.mediaIds.length > 0) {
      this.afterStatement("replace_terminal_message");
    }
    return rowId;
  }

  private afterStatement(_statement: FakeSettlementStatement): void {
    this.#statementCount += 1;
    if (this.#statementFaults.delete(this.#statementCount)) {
      throw new FakeStatementFault();
    }
  }

  private hitFault(point: StandardFault): boolean {
    const occurrence = (this.#faultCounts.get(point) ?? 0) + 1;
    this.#faultCounts.set(point, occurrence);
    return this.#faults.get(point)?.has(occurrence) ?? false;
  }

  private reconciled(
    request: CommitTerminalRequest,
    decision: Reconciliation,
  ): ResultValue<TerminalCommit, TerminalSettlementError> {
    return decision.kind === "replay"
      ? this.success(request, decision.commit, "replayed")
      : this.failure(
          request.effect.idempotencyKey,
          request.effect.operationId,
          request.expectedVersion,
          decision.error,
        );
  }

  private caught(
    request: CommitTerminalRequest,
    error: unknown,
  ): ResultValue<never, TerminalSettlementError> {
    const mapped =
      error instanceof FakeAbort
        ? error.error
        : error instanceof FakeCorruption
          ? fakeError("corrupt_state")
          : fakeError("storage_unavailable", "not_applied", true);
    return this.failure(
      request.effect.idempotencyKey,
      request.effect.operationId,
      request.expectedVersion,
      mapped,
    );
  }

  private success(
    request: CommitTerminalRequest,
    value: TerminalCommit,
    resultTag: string,
  ): ResultValue<TerminalCommit, never> {
    this.record({
      contract: "EF-S02",
      method: "commitTerminal",
      effectId: request.effect.idempotencyKey,
      operationId: request.effect.operationId,
      sourceSeq: null,
      version: request.expectedVersion,
      resultTag,
      certainty: "applied",
    });
    return Result.ok(cloneCommit(value));
  }

  private failure(
    effectId: string,
    operationId: string | null,
    version: number | null,
    error: TerminalSettlementError,
  ): ResultValue<never, TerminalSettlementError> {
    this.record({
      contract: "EF-S02",
      method: "commitTerminal",
      effectId,
      operationId,
      sourceSeq: null,
      version,
      resultTag: error._tag,
      certainty: error.certainty,
    });
    return Result.err(error);
  }

  private record(input: NormalisedTraceInput): void {
    if (input.resultTag === "call") this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}

type Reconciliation =
  | { readonly kind: "replay"; readonly commit: TerminalCommit }
  | { readonly kind: "error"; readonly error: TerminalSettlementError };

function reconcile(
  state: FakeState,
  request: CommitTerminalRequest,
): Reconciliation | null {
  const byKey = state.decisions.find(
    (entry) => entry.idempotencyKey === request.effect.idempotencyKey,
  );
  if (byKey) {
    return byKey.requestHash === request.effect.requestHash &&
      byKey.operationId === request.effect.operationId
      ? { kind: "replay", commit: cloneCommit(byKey.commit) }
      : { kind: "error", error: fakeError("idempotency_conflict") };
  }
  const byOperation = state.decisions.find(
    (entry) => entry.operationId === request.effect.operationId,
  );
  if (!byOperation) return null;
  if (
    byOperation.idempotencyKey === request.effect.idempotencyKey &&
    byOperation.requestHash === request.effect.requestHash
  ) {
    return { kind: "replay", commit: cloneCommit(byOperation.commit) };
  }
  return {
    kind: "error",
    error: fakeError(
      "already_terminal_conflict",
      "not_applied",
      false,
      byOperation.commit,
    ),
  };
}

function authorise(
  request: CommitTerminalRequest,
  operation: FakeOperation,
): void {
  if (
    operation.chatJid !== request.expectedChatJid ||
    operation.activeOperationId !== operation.operationId ||
    !sameHarness(operation.harness, request.expectedHarness) ||
    request.timeline.chatJid !== operation.chatJid
  ) {
    throw new FakeAbort(fakeError("owner_conflict"));
  }
  if (operation.version !== request.expectedVersion) {
    throw new FakeAbort(fakeError("version_mismatch"));
  }
  if (operation.phase === "terminal" || operation.terminalDisposition !== null) {
    throw new FakeCorruption();
  }
  const cancelled = operation.cancellationSourceSeq !== null;
  let allowed = false;
  switch (request.disposition) {
    case "completed":
      allowed = operation.phase === "settling" && !cancelled;
      break;
    case "cancelled":
      allowed =
        cancelled &&
        (operation.phase === "cancelling" || operation.phase === "settling");
      break;
    case "failed":
      allowed =
        !cancelled &&
        ["executing", "suspended", "cancelling", "settling"].includes(
          operation.phase,
        );
      break;
    case "skipped":
      allowed =
        !cancelled &&
        (operation.phase === "claimed" || operation.phase === "starting_harness") &&
        (operation.harness === null ||
          (operation.harness.state === "not_started" &&
            operation.harness.harnessOperationId === null));
      break;
    case "superseded":
      allowed =
        !cancelled &&
        ["claimed", "starting_harness", "suspended"].includes(operation.phase);
      break;
  }
  if (!allowed) throw new FakeAbort(fakeError("owner_conflict"));
}

function authoriseOutbox(
  request: CommitTerminalRequest,
  operation: FakeOperation,
  sources: readonly FakeSource[],
): void {
  const sourceSeqs = new Set(sources.map((entry) => entry.sourceSeq));
  if (
    request.effect.sourceSeq !== null &&
    !sourceSeqs.has(request.effect.sourceSeq)
  ) {
    throw new FakeAbort(fakeError("owner_conflict"));
  }
  for (const intent of request.outboxIntents) {
    if (
      intent.effect.operationId !== operation.operationId ||
      (intent.effect.sourceSeq !== null &&
        !sourceSeqs.has(intent.effect.sourceSeq))
    ) {
      throw new FakeAbort(fakeError("owner_conflict"));
    }
  }
}

function sameHarness(
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

function fakeError(
  tag: TerminalSettlementErrorTag,
  certainty: TerminalSettlementError["certainty"] = "not_applied",
  retryable = false,
  existing?: TerminalCommit,
): TerminalSettlementError {
  return Object.freeze({
    _tag: tag,
    certainty,
    retryable,
    ...(existing ? { existing: cloneCommit(existing) } : {}),
  });
}

function cloneCommit(input: TerminalCommit): TerminalCommit {
  return Object.freeze({
    ...structuredClone(input),
    outboxIds: Object.freeze([...input.outboxIds]),
  });
}

function emptyState(): FakeState {
  return {
    nextRowId: 1,
    operations: [],
    sources: [],
    drafts: [],
    media: [],
    messages: [],
    outbox: [],
    decisions: [],
  };
}
