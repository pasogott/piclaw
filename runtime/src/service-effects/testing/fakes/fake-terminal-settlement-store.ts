import { createHash } from "node:crypto";

import { Result, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type {
  NormalisedEffectTrace,
  NormalisedTraceInput,
} from "../../contracts/common.js";
import type {
  EffectPayloadResolver,
  ResolvedEffectPayload,
} from "../../contracts/payload-resolver.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
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
  readonly kind?: "message" | "steer" | "follow_up" | "continuation" | "cancellation";
  readonly acceptedAt?: string;
  readonly queuedState?: "accepted" | "queued" | "consumed" | "disposed" | null;
}

export interface FakeTerminalOperationSeed {
  readonly operationId: string;
  readonly chatJid: string;
  readonly version: number;
  readonly phase: PiclawOperationPhase;
  readonly primarySourceSeq?: number;
  readonly cancellationSourceSeq?: number | null;
  readonly cancellationRequestedAt?: string | null;
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
  primarySourceSeq: number;
  cancellationSourceSeq: number | null;
  cancellationRequestedAt: string | null;
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
  kind: "message" | "steer" | "follow_up" | "continuation" | "cancellation";
  acceptedAt: string;
  reason: string | null;
  queuedState: "accepted" | "queued" | "consumed" | "disposed" | null;
}

interface FakeMessage {
  rowId: number;
  operationId: string;
  chatJid: string;
  threadId: number | null;
  content: string;
  contentBlocks: readonly Readonly<Record<string, unknown>>[] | null;
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
  provenanceRef: string;
  redactionClass: string;
  payloadRef: string;
  destinationRef: string | null;
  availableAt: string;
  enqueuedAt: string;
  repeatability: string;
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
  | "fence_operation"
  | "fence_owner"
  | "timeline_chat_insert"
  | "timeline_chat_update"
  | "timeline_message_insert"
  | "timeline_message_replace"
  | "timeline_media_unlink"
  | "timeline_media_link"
  | "timeline_fts_media_delete"
  | "timeline_fts_media_insert"
  | "settle_source"
  | "settle_queued_input"
  | "advance_frontier_release_owner"
  | "terminalise_operation"
  | "outbox_insert"
  | "outbox_decision_insert"
  | "insert_commit"
  | "link_commit_outbox";

class FakeAbort extends Error {
  constructor(readonly error: TerminalSettlementError) {
    super(error._tag);
  }
}
class FakeStatementFault extends Error {}
class FakeCorruption extends Error {}

export interface FakeTerminalSettlementObserver {
  recordTrace?(input: NormalisedTraceInput): void;
}

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
  #statementTrace: string[] = [];
  #payloadResolutionCount = 0;
  readonly #payloads = new Map<string, ResolvedEffectPayload>();
  readonly #resolver: EffectPayloadResolver;
  readonly #observer: FakeTerminalSettlementObserver | undefined;

  constructor(
    trace: readonly NormalisedEffectTrace[] = [],
    resolver?: EffectPayloadResolver,
    observer?: FakeTerminalSettlementObserver,
  ) {
    this.trace = EffectTraceRecorder.fromSnapshot(trace);
    this.#state = emptyState();
    this.#observer = observer;
    this.#resolver = resolver ?? {
      resolve: (ref) => this.#payloads.get(ref) ?? null,
    };
    this.seedPayload("payload:terminal-content", "terminal result");
  }

  seedPayload(
    ref: string,
    content: string,
    mediaType = "text/plain",
    redactionClass: ResolvedEffectPayload["redactionClass"] = "secret",
  ): void {
    const bytes = new TextEncoder().encode(content);
    this.#payloads.set(ref, Object.freeze({
      ref,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      mediaType,
      redactionClass,
      bytes: bytes.slice(),
    }));
  }

  removePayload(ref: string): void {
    this.#payloads.delete(ref);
  }

  payloadResolutionCount(): number {
    return this.#payloadResolutionCount;
  }

  inspectStatements(): readonly string[] {
    return Object.freeze([...this.#statementTrace]);
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
      primarySourceSeq: seed.primarySourceSeq ?? seed.sources[0]?.sourceSeq ?? 1,
      cancellationSourceSeq: seed.cancellationSourceSeq ?? null,
      cancellationRequestedAt:
        seed.cancellationRequestedAt ??
        (seed.cancellationSourceSeq === undefined || seed.cancellationSourceSeq === null
          ? null
          : "2026-08-14T09:00:00.000Z"),
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
        kind: source.kind ?? "message",
        acceptedAt: source.acceptedAt ?? "2026-08-14T09:00:00.000Z",
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
      content: seed.contentRef,
      contentBlocks: null,
      mediaIds: [...(seed.mediaIds ?? [])],
      terminal: false,
    });
    this.#state.nextRowId = Math.max(this.#state.nextRowId, seed.rowId + 1);
  }

  seedMedia(operationId: string, mediaId: number, role = "terminal"): void {
    this.#state.media.push({ operationId, mediaId, role });
  }

  seedOutbox(input: EnqueueOutboxRequest): void {
    this.#state.outbox.push({
      outboxId: input.outboxId,
      kind: input.kind,
      idempotencyKey: input.effect.idempotencyKey,
      requestHash: input.effect.requestHash,
      operationId: input.effect.operationId,
      sourceSeq: input.effect.sourceSeq,
      provenanceRef: input.effect.provenanceRef,
      redactionClass: input.effect.redactionClass,
      payloadRef: input.payloadRef,
      destinationRef: input.destinationRef,
      availableAt: input.availableAt,
      enqueuedAt: input.enqueuedAt,
      repeatability: input.repeatability,
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
    this.#statementTrace = [];
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
        fakeError("invalid_request"),
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

    const resolved = await this.resolveTimeline(request);
    if (!resolved.ok) {
      return this.failure(
        effectId,
        operationId,
        request.expectedVersion,
        resolved.error,
      );
    }

    this.#statementCount = 0;
    try {
      const working = structuredClone(this.#state);
      const decision = reconcile(working, request);
      if (decision) return this.reconciled(request, decision);
      const commit = this.apply(working, request, resolved.value);
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
    if (!id) return Result.err(fakeError("invalid_request"));
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
      return Result.ok(decision ? materialiseDecision(this.#state, decision) : null);
    } catch (error) {
      return Result.err(
        error instanceof FakeCorruption
          ? fakeError("corrupt_state")
          : fakeError("storage_unavailable", "not_applied", true),
      );
    }
  }

  async getTerminalByKey(
    idempotencyKey: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const key = decodeFakeTerminalLookup(idempotencyKey);
    if (!key) return Result.err(fakeError("invalid_request"));
    try {
      const decision = this.#state.decisions.find(
        (entry) => entry.idempotencyKey === key,
      );
      return Result.ok(decision ? materialiseDecision(this.#state, decision) : null);
    } catch (error) {
      return Result.err(
        error instanceof FakeCorruption
          ? fakeError("corrupt_state")
          : fakeError("storage_unavailable", "not_applied", true),
      );
    }
  }

  private async resolveTimeline(
    request: CommitTerminalRequest,
  ): Promise<
    | { ok: true; value: { content: string; blocks: readonly Readonly<Record<string, unknown>>[] | null } | null }
    | { ok: false; error: TerminalSettlementError }
  > {
    if (request.timeline.mode === "none") return { ok: true, value: null };
    try {
      const content = await this.resolveAndSnapshot(request.timeline.contentRef);
      if (
        !content ||
        content.redactionClass !== request.effect.redactionClass ||
        (content.mediaType !== "text/plain" && content.mediaType !== "text/markdown") ||
        content.byteLength > 1_048_576
      ) {
        return {
          ok: false,
          error: fakeError("storage_unavailable", "not_applied", true),
        };
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
      } catch (error) {
        void error;
        return { ok: false, error: fakeError("corrupt_state") };
      }
      let blocks: readonly Readonly<Record<string, unknown>>[] | null = null;
      if (request.timeline.contentBlocksRef !== null) {
        const payload = await this.resolveAndSnapshot(
          request.timeline.contentBlocksRef,
        );
        if (
          !payload ||
          payload.redactionClass !== request.effect.redactionClass ||
          payload.mediaType !== "application/json" ||
          payload.byteLength > 262_144
        ) {
          return {
            ok: false,
            error: fakeError("storage_unavailable", "not_applied", true),
          };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes),
          );
        } catch (error) {
          void error;
          return { ok: false, error: fakeError("corrupt_state") };
        }
        blocks = validateFakeContentBlocks(parsed);
        if (!blocks) return { ok: false, error: fakeError("corrupt_state") };
      }
      return {
        ok: true,
        value: Object.freeze({ content: text, blocks }),
      };
    } catch (error) {
      void error;
      return {
        ok: false,
        error: fakeError("storage_unavailable", "not_applied", true),
      };
    }
  }

  private async resolveAndSnapshot(
    ref: string,
  ): Promise<ResolvedEffectPayload | null> {
    this.#payloadResolutionCount += 1;
    const candidate = await this.#resolver.resolve(ref);
    if (!candidate) return null;
    const bytes = candidate.bytes.slice();
    if (
      candidate.ref !== ref ||
      candidate.byteLength !== bytes.byteLength ||
      !/^[0-9a-f]{64}$/.test(candidate.sha256) ||
      createHash("sha256").update(bytes).digest("hex") !== candidate.sha256
    ) {
      return null;
    }
    return Object.freeze({
      ref: candidate.ref,
      sha256: candidate.sha256,
      byteLength: candidate.byteLength,
      mediaType: candidate.mediaType,
      redactionClass: candidate.redactionClass,
      bytes,
    });
  }

  private apply(
    state: FakeState,
    request: CommitTerminalRequest,
    resolved: { content: string; blocks: readonly Readonly<Record<string, unknown>>[] | null } | null,
  ): TerminalCommit {
    const operation = state.operations.find(
      (entry) => entry.operationId === request.effect.operationId,
    );
    if (!operation) throw new FakeAbort(fakeError("not_found"));
    authorise(request, operation);
    if (
      operation.cancellationRequestedAt !== null &&
      request.committedAt < operation.cancellationRequestedAt
    ) {
      throw new FakeAbort(fakeError("owner_conflict"));
    }
    const operationSources = state.sources.filter(
      (entry) =>
        entry.chatJid === operation.chatJid &&
        entry.operationId === operation.operationId,
    );
    authoriseOutbox(request, operation, operationSources);
    const claimed = operationSources.sort(
      (left, right) => left.sourceSeq - right.sourceSeq,
    );
    if (
      claimed.length === 0 ||
      claimed.length !== request.sourceDispositions.length ||
      claimed.some(
        (source, index) =>
          source.sourceSeq !== request.sourceDispositions[index]?.sourceSeq,
      )
    ) {
      throw new FakeAbort(fakeError("invalid_source_disposition"));
    }
    for (const source of claimed) {
      if (source.state !== "claimed" && source.state !== "queued") {
        throw new FakeCorruption();
      }
      if (request.committedAt < source.acceptedAt) {
        throw new FakeAbort(fakeError("owner_conflict"));
      }
      const queueExpected =
        source.sourceSeq !== operation.primarySourceSeq &&
        (source.kind === "steer" ||
          source.kind === "follow_up" ||
          source.kind === "continuation");
      if (queueExpected && source.queuedState !== source.state) {
        throw new FakeCorruption();
      }
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

    this.afterStatement("fence_operation");
    this.afterStatement("fence_owner");
    const messageRowId = this.writeTimeline(state, request, resolved);
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
      const highestSource = Math.max(
        operation.consumedThroughSourceSeq,
        ...state.sources
          .filter((entry) => entry.chatJid === operation.chatJid)
          .map((entry) => entry.sourceSeq),
      );
      if (!next) {
        if (frontier < highestSource) throw new FakeCorruption();
        break;
      }
      if (next.state !== "consumed" && next.state !== "disposed") break;
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
        throw new FakeAbort(fakeError("idempotency_conflict"));
      } else {
        state.outbox.push({
          outboxId: intent.outboxId,
          kind: intent.kind,
          idempotencyKey: intent.effect.idempotencyKey,
          requestHash: intent.effect.requestHash,
          operationId: intent.effect.operationId,
          sourceSeq: intent.effect.sourceSeq,
          provenanceRef: intent.effect.provenanceRef,
          redactionClass: intent.effect.redactionClass,
          payloadRef: intent.payloadRef,
          destinationRef: intent.destinationRef,
          availableAt: intent.availableAt,
          enqueuedAt: intent.enqueuedAt,
          repeatability: intent.repeatability,
        });
      }
      this.afterStatement("outbox_insert");
      this.afterStatement("outbox_decision_insert");
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
    resolved: { content: string; blocks: readonly Readonly<Record<string, unknown>>[] | null } | null,
  ): number | null {
    const timeline = request.timeline;
    if (timeline.mode === "none") return null;
    if (!resolved) throw new FakeCorruption();
    if (
      timeline.threadId !== null &&
      !state.messages.some(
        (entry) =>
          entry.rowId === timeline.threadId &&
          entry.chatJid === timeline.chatJid &&
          entry.threadId === null,
      )
    ) {
      throw new FakeAbort(fakeError("owner_conflict"));
    }
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
      if (message.mediaIds.length > 0) {
        this.afterStatement("timeline_fts_media_delete");
        this.afterStatement("timeline_fts_media_insert");
      }
      message.content = resolved.content;
      message.contentBlocks = resolved.blocks;
      message.mediaIds = [...timeline.mediaIds];
      message.terminal = true;
      this.afterStatement("timeline_message_replace");
      this.afterStatement("timeline_media_unlink");
      for (const _mediaId of timeline.mediaIds) {
        void _mediaId;
        this.afterStatement("timeline_media_link");
      }
      if (timeline.mediaIds.length > 0) {
        this.afterStatement("timeline_fts_media_delete");
        this.afterStatement("timeline_fts_media_insert");
      }
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
    const existingChat = state.messages.some(
      (entry) => entry.chatJid === timeline.chatJid,
    );
    this.afterStatement("timeline_chat_insert");
    if (existingChat) this.afterStatement("timeline_chat_update");
    const rowId = state.nextRowId++;
    state.messages.push({
      rowId,
      operationId: request.effect.operationId,
      chatJid: request.expectedChatJid,
      threadId: timeline.threadId,
      content: resolved.content,
      contentBlocks: resolved.blocks,
      mediaIds: [...timeline.mediaIds],
      terminal: true,
    });
    this.afterStatement("timeline_message_insert");
    for (const _mediaId of timeline.mediaIds) {
      void _mediaId;
      this.afterStatement("timeline_media_link");
    }
    if (timeline.mediaIds.length > 0) {
      this.afterStatement("timeline_fts_media_delete");
      this.afterStatement("timeline_fts_media_insert");
    }
    return rowId;
  }

  private afterStatement(statement: FakeSettlementStatement): void {
    this.#statementCount += 1;
    if (this.#statementCount === 1) this.#statementTrace = [];
    this.#statementTrace.push(`${this.#statementCount}:${statement}`);
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
    try {
      if (input.resultTag === "call") this.trace.recordCall(input);
      else this.trace.recordResult(input);
      this.#observer?.recordTrace?.(Object.freeze({ ...input }));
    } catch (error) {
      void error;
    }
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
      ? { kind: "replay", commit: materialiseDecision(state, byKey) }
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
    return { kind: "replay", commit: materialiseDecision(state, byOperation) };
  }
  return {
    kind: "error",
    error: fakeError(
      "already_terminal_conflict",
      "not_applied",
      false,
      materialiseDecision(state, byOperation),
    ),
  };
}

function materialiseDecision(
  state: FakeState,
  decision: FakeDecision,
): TerminalCommit {
  const commit = decision.commit;
  if (
    typeof decision.idempotencyKey !== "string" ||
    decision.idempotencyKey.length === 0 ||
    !/^[0-9a-f]{64}$/.test(decision.requestHash) ||
    decision.operationId !== commit.operationId ||
    !Number.isSafeInteger(commit.operationVersion) ||
    commit.operationVersion < 2 ||
    !["completed", "cancelled", "failed", "skipped", "superseded"].includes(
      commit.disposition,
    ) ||
    (commit.messageRowId !== null &&
      (!Number.isSafeInteger(commit.messageRowId) || commit.messageRowId < 1)) ||
    !Number.isSafeInteger(commit.consumedThroughSourceSeq) ||
    commit.consumedThroughSourceSeq < 0 ||
    !Array.isArray(commit.outboxIds) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(commit.committedAt)
  ) {
    throw new FakeCorruption();
  }
  const authorityRequired =
    commit.disposition === "skipped" || commit.disposition === "superseded";
  if (authorityRequired !== (decision.terminalAuthorityRef !== null)) {
    throw new FakeCorruption();
  }
  const operation = state.operations.find(
    (entry) => entry.operationId === commit.operationId,
  );
  if (
    !operation ||
    operation.phase !== "terminal" ||
    operation.version !== commit.operationVersion ||
    operation.terminalDisposition !== commit.disposition ||
    operation.terminalMessageRowId !== commit.messageRowId ||
    operation.terminalCommittedAt !== commit.committedAt ||
    (commit.disposition === "failed") !==
      (operation.terminalErrorCode !== null) ||
    (commit.disposition === "cancelled") !==
      (operation.cancellationSourceSeq !== null) ||
    state.sources.some(
      (source) =>
        source.chatJid === operation.chatJid &&
        source.operationId === operation.operationId &&
        (source.state !== "consumed" && source.state !== "disposed"),
    )
  ) {
    throw new FakeCorruption();
  }
  if (commit.messageRowId !== null) {
    const message = state.messages.find(
      (entry) => entry.rowId === commit.messageRowId,
    );
    if (!message || !message.terminal || message.chatJid !== operation.chatJid) {
      throw new FakeCorruption();
    }
  }
  if (
    new Set(commit.outboxIds).size !== commit.outboxIds.length ||
    commit.outboxIds.some((outboxId) => {
      const row = state.outbox.find((entry) => entry.outboxId === outboxId);
      return (
        !row ||
        row.operationId !== commit.operationId ||
        row.outboxId.length === 0 ||
        row.idempotencyKey.length === 0 ||
        !/^[0-9a-f]{64}$/.test(row.requestHash) ||
        row.provenanceRef.length === 0 ||
        !["public", "private", "secret"].includes(row.redactionClass) ||
        row.payloadRef.length === 0 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.enqueuedAt) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.availableAt) ||
        row.availableAt < row.enqueuedAt ||
        !["repeatable", "reconciliation_required"].includes(row.repeatability)
      );
    })
  ) {
    throw new FakeCorruption();
  }
  return cloneCommit(commit);
}

function validateFakeContentBlocks(
  input: unknown,
): readonly Readonly<Record<string, unknown>>[] | null {
  if (!Array.isArray(input)) return null;
  const protectedTypes = new Set(["restart_handoff", "self_continuation"]);
  if (
    input.some(
      (block) =>
        !block ||
        typeof block !== "object" ||
        Array.isArray(block) ||
        protectedTypes.has(
          typeof (block as { type?: unknown }).type === "string"
            ? (block as { type: string }).type
            : "",
        ),
    )
  ) {
    return null;
  }
  return Object.freeze(
    input.map((block) =>
      Object.freeze(structuredClone(block as Record<string, unknown>)),
    ),
  );
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
