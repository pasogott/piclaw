// INACTIVE application module. No bootstrap registration or production schema migration.
import { AssistantEntry, InboxDoc, Harness, type HarnessOptions, type HarnessInspection, type Storage, type ConversationId, type SubmissionId } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord/context";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
import type { ServiceWorkStore, AcceptCancellationRequest, OperationSnapshot } from "../../../runtime/src/service-effects/contracts/service-work-store.js";
import type { TerminalSettlementStore, CommitTerminalRequest } from "../../../runtime/src/service-effects/contracts/terminal-settlement-store.js";
import { value, sealed, effect } from "./host-effects.js";

/** Immutable host-persisted intent; never supplied as arbitrary user text. */
export interface AcceptedInput {
  readonly incarnation: string;
  readonly conversationId: ConversationId;
  readonly chatJid: string;
  readonly branchId: string;
  readonly operationId: string;
  readonly sourceSeq: number;
  readonly sourceId: string;
  readonly payloadRef: string;
  readonly requestId: string;
  readonly requestHash: string;
}
export interface HostInputBinding extends AcceptedInput {
  readonly submissionId: SubmissionId | null;
}
export interface HostDurableBindings {
  get(input: AcceptedInput): Promise<HostInputBinding | null>;
  bind(input: AcceptedInput): Promise<HostInputBinding>;
  getOrBind(input: AcceptedInput): Promise<{ content: string }>;
  recordSubmission(input: AcceptedInput, submissionId: SubmissionId): Promise<void>;
}
/** Host-private evidence, never a public timeline payload (message may contain thinking). */
export interface SettledAnswer {
  readonly message: AssistantMessage;
  readonly text: string;
}
export interface MaterializedAnswer {
  readonly contentRef: string;
  readonly contentBlocksRef: string | null;
  readonly mediaIds: readonly number[];
}
export interface RuntimeOptions {
  readonly incarnation: string;
  /** Caller already holds exclusive ownership of this entire store, not a per-chat lease.
   * Adapters/models/tools must fence effects themselves, including EF-S02 inside its SQL commit. */
  readonly owner: { assert(): void; release(): void | Promise<void> };
  readonly openStorage: () => Promise<Storage>;
  readonly harnessOptions: HarnessOptions;
  readonly work: ServiceWorkStore;
  readonly terminal: TerminalSettlementStore;
  /** Host-owned durable mapping. Must atomically verify the accepted source, payload and immutable
   * operation/source/hash binding in the SAME host database. No Map-based admission/dedup.
   * Production implementation/migration is NOT activated by this module. */
  readonly bindings: HostDurableBindings;
  readonly conversationFor: (chatJid: string, branchId: string) => ConversationId;
  /** All IDs must come from a caller-validated, quiescent import manifest. Never creates root. */
  readonly existingConversationIds: readonly ConversationId[];
  /** Harness scheduling is store-wide. Host must validate EVERY live task/submission's current
   * authority before explicit progress (including recovered work); deny mixed/unknown authority. */
  readonly authorizeScheduling: (inspection: HarnessInspection) => void | Promise<void>;
  readonly putAnswer: (ref: string, text: string) => void | Promise<void>;
  /** Optional host authority for ALL final answers, including operation-owned tool media.
   * Publish only authorized visible content, never raw message/thinking. Refs must resolve
   * through EF-S02's existing payload resolver with the effect's exact redaction class;
   * media must already be bound to this operation. No provider execution is granted here. */
  readonly materializeAnswer?: (ref: string, answer: SettledAnswer, operation: OperationSnapshot) => Promise<MaterializedAnswer>;
  readonly sessionId: string;
  readonly lane: string;
  readonly generation: number;
  readonly now: () => string;
}

// Copy only contract data, never serialize caller objects (or invoke toJSON).
function plainData(value: object) {
  if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new TypeError("Expected plain contract data");
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
function materializedSnapshot(answer: MaterializedAnswer): MaterializedAnswer {
  plainData(answer);
  const { contentRef, contentBlocksRef, mediaIds } = answer;
  const ids = Array.isArray(mediaIds) ? [...mediaIds] : null;
  const validRef = (ref: unknown) => typeof ref === "string" && ref.length > 0 && ref.length <= 2048;
  if (!validRef(contentRef) || (contentBlocksRef !== null && !validRef(contentBlocksRef)) ||
    !ids || ids.length > 100 ||
    ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new TypeError("Invalid materialized answer");
  return Object.freeze({ contentRef, contentBlocksRef, mediaIds: Object.freeze(ids) });
}
export function inputSnapshot(i: AcceptedInput): AcceptedInput {
  plainData(i);
  const copy = { incarnation: i.incarnation, conversationId: i.conversationId, chatJid: i.chatJid,
    branchId: i.branchId, operationId: i.operationId, sourceSeq: i.sourceSeq, sourceId: i.sourceId,
    payloadRef: i.payloadRef, requestId: i.requestId, requestHash: i.requestHash };
  for (const [key, value] of Object.entries(copy)) {
    if (key === "conversationId" || key === "sourceSeq") {
      if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError("Expected integer input identity");
    } else if (typeof value !== "string" || !value.length || value.length > (key === "requestId" ? 1024 : 2048)) throw new TypeError("Expected string input identity");
  }
  if (!/^[a-f0-9]{64}$/.test(copy.requestHash)) throw new TypeError("Invalid input hash");
  return Object.freeze(copy);
}
function cancellationSnapshot(r: AcceptCancellationRequest): AcceptCancellationRequest {
  plainData(r);
  const e = r.effect; plainData(e);
  const effect = { idempotencyKey: e.idempotencyKey, requestHash: e.requestHash, operationId: e.operationId,
    sourceSeq: e.sourceSeq, provenanceRef: e.provenanceRef, redactionClass: e.redactionClass };
  const copy = { effect: Object.freeze(effect), expectedVersion: r.expectedVersion, sourceId: r.sourceId,
    sourceSeq: r.sourceSeq, cause: r.cause, requestedAt: r.requestedAt };
  for (const [key, value] of [...Object.entries(effect), ...Object.entries(copy).filter(([key]) => key !== "effect")]) {
    if (key === "sourceSeq" || key === "expectedVersion") {
      if (!(key === "sourceSeq" && value === null) && !Number.isSafeInteger(value)) throw new TypeError("Expected integer cancellation identity");
    } else if (typeof value !== "string") throw new TypeError("Expected string cancellation identity");
  }
  return Object.freeze(copy);
}
// Private snapshot type cannot be confused with caller-owned RuntimeOptions.
type RuntimeSnapshot = Omit<RuntimeOptions, "work" | "terminal"> & {
  readonly captured: true;
  readonly work: Pick<ServiceWorkStore, "getOperation" | "acceptCancellation" | "bindHarness">;
  readonly terminal: Pick<TerminalSettlementStore, "getTerminal" | "commitTerminal">;
};
function runtimeSnapshot(o: RuntimeOptions): RuntimeSnapshot {
  const { owner, work, terminal, bindings, harnessOptions: h, existingConversationIds,
    openStorage, conversationFor, authorizeScheduling, putAnswer, materializeAnswer, now, incarnation, sessionId, lane, generation } = o;
  return Object.freeze({ incarnation, sessionId, lane, generation, captured: true as const,
    openStorage: openStorage.bind(o), conversationFor: conversationFor.bind(o),
    authorizeScheduling: authorizeScheduling.bind(o), putAnswer: putAnswer.bind(o),
    materializeAnswer: materializeAnswer?.bind(o), now: now.bind(o),
    owner: Object.freeze({ assert: owner.assert.bind(owner), release: owner.release.bind(owner) }),
    work: Object.freeze({ getOperation: work.getOperation.bind(work), acceptCancellation: work.acceptCancellation.bind(work), bindHarness: work.bindHarness.bind(work) }),
    terminal: Object.freeze({ getTerminal: terminal.getTerminal.bind(terminal), commitTerminal: terminal.commitTerminal.bind(terminal) }),
    bindings: Object.freeze({ get: bindings.get.bind(bindings), bind: bindings.bind.bind(bindings),
      getOrBind: bindings.getOrBind.bind(bindings), recordSubmission: bindings.recordSubmission.bind(bindings) }),
    existingConversationIds: Object.freeze([...existingConversationIds]),
    // Catalogs and settings are intentionally live host APIs; detach their containing options only.
    harnessOptions: Object.freeze({ models: h.models, registry: h.registry, settings: h.settings,
      env: h.env?.bind(h), conversationCreated: h.conversationCreated?.bind(h), now: h.now?.bind(h), onReport: h.onReport?.bind(h) }),
  });
}

/** One caller-owned authority domain, not a global chat/user router. */
export class HostConversationRuntime {
  private closed = false;
  private closing?: Promise<void>;
  // Lifecycle joins only: not an input queue or admission/dedup authority.
  private readonly active = new Set<Promise<unknown>>();
  private observe<T>(body: () => Promise<T>): Promise<T> {
    this.fence();
    const promise = body();
    this.active.add(promise);
    void promise.finally(() => this.active.delete(promise)).catch(() => {});
    return promise;
  }
  private constructor(private readonly options: RuntimeSnapshot, private readonly harness: Harness,
    private readonly storage: Storage, private readonly context: Context) {}

  static async open(config: RuntimeOptions, context: Context): Promise<HostConversationRuntime> {
    const options = runtimeSnapshot(config);
    options.owner.assert(); // Before storage normalization/construction, including SQLite open recovery.
    if (!options.incarnation || !Number.isSafeInteger(options.generation) || options.generation < 1 || !options.existingConversationIds.length)
      throw new Error("Explicit store identity, generation and existing manifest required");
    const storage = await options.openStorage();
    let harness: Harness | undefined;
    try {
      options.owner.assert();
      harness = await Harness.open(storage, options.harnessOptions, context);
      options.owner.assert();
      for (const id of options.existingConversationIds) {
        if (!await harness.conversation(id, context)) throw new Error("Missing manifest conversation");
        options.owner.assert();
      }
      return new HostConversationRuntime(options, harness, storage, context);
    } catch (error) {
      // Failed/uncertain cleanup never releases ownership.
      if (harness) await harness.close(context); else await storage.close(context);
      throw error;
    }
  }
  private fence() {
    if (this.closed) throw new Error("Runtime closed");
    this.options.owner.assert();
  }
  private async checked(input: AcceptedInput) {
    this.fence();
    const o = this.options;
    if (input.incarnation !== o.incarnation || !o.existingConversationIds.includes(input.conversationId) ||
      o.conversationFor(input.chatJid, input.branchId) !== input.conversationId) throw new Error("Host binding conflict");
    const operation = value(await o.work.getOperation(input.operationId)); this.fence();
    if (!operation || operation.chatJid !== input.chatJid || operation.primarySourceSeq !== input.sourceSeq ||
      !operation.claimedSourceSeqs.includes(input.sourceSeq)) throw new Error("Unaccepted operation/source");
    const { content } = await o.bindings.getOrBind(input); this.fence();
    if (typeof content !== "string") throw new TypeError("Expected string payload");
    if (hashCanonicalRequest({ type: "input", requestId: input.requestId, content }) !== input.requestHash)
      throw new Error("Host payload hash conflict");
    const conversation = await this.harness.conversation(input.conversationId, this.context); this.fence();
    if (!conversation) throw new Error("Missing existing conversation");
    return { operation, conversation, content };
  }
  private async record(input: AcceptedInput) {
    const conflict = () => new Error("Submission binding conflict");
    const binding = await this.options.bindings.get(input); this.fence();
    if (!binding) throw conflict();
    // Read status AND its original input evidence in one public transaction. Request IDs
    // alone are candidate dedup keys, not proof of content or accepted host provenance.
    const record = await this.harness.commit(async tx => {
      const record = await tx.submissionByRequest(input.conversationId, input.requestId);
      if (binding.submissionId !== null && binding.submissionId !== record?.id) throw conflict();
      if (!record) return record;
      if (record.type !== "input" || record.conversationId !== input.conversationId || record.requestId !== input.requestId) throw conflict();
      let content: unknown, entry: { kind: string; data?: unknown } | undefined;
      if (record.entry !== undefined) {
        const placed = await tx.entry(record.entry);
        if (!placed || placed.conversationId !== input.conversationId || placed.model?.length !== 1 || placed.model[0]?.role !== "user") throw conflict();
        content = placed.model[0].content; entry = placed;
      } else if (record.status === "queued") {
        const inbox = await tx.doc(InboxDoc, input.conversationId);
        const item = inbox.items.find(item => item.id === record.id);
        if (!item || item.mode === "write") throw conflict();
        content = item.content; entry = item.entry;
      } else {
        // Withdrawal removes queued evidence. Only an ID already durably recorded AFTER
        // validation may reconcile that terminal state; lost-ack unbound records fail closed.
        if (record.status !== "unanswered" || binding.submissionId !== record.id) throw conflict();
        return record;
      }
      const data = entry?.data;
      if (entry?.kind !== "host.accepted" || !data || typeof data !== "object" || Array.isArray(data) ||
        Object.entries(input).some(([key, value]) => (data as Record<string, unknown>)[key] !== value) ||
        typeof content !== "string" || hashCanonicalRequest({ type: "input", requestId: input.requestId, content }) !== input.requestHash) throw conflict();
      return record;
    }, this.context); this.fence();
    return record;
  }
  private async progress() {
    const inspection = await this.harness.inspect(this.context); this.fence();
    await this.options.authorizeScheduling(inspection); this.fence();
  }
  submit(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.submitInput(copy)); }
  private async submitInput(input: AcceptedInput) {
    const { operation, conversation, content } = await this.checked(input);
    const prior = await this.record(input);
    if (prior) {
      await this.options.bindings.recordSubmission(input, prior.id); this.fence();
      return prior.id; // Acknowledgement repair is not permission to resume.
    }
    if (operation.terminal || operation.cancellation) throw new Error("Operation no longer executable");
    await this.progress();
    const submission = await conversation.submit({ type: "input", requestId: input.requestId, content,
      entry: { kind: "host.accepted", data: { ...input } } }, this.context);
    this.fence();
    // Recheck the returned durable evidence too: submit itself deduplicates by request ID.
    const admitted = await this.record(input);
    if (!admitted || admitted.id !== submission.id) throw new Error("Submission binding conflict");
    await this.options.bindings.recordSubmission(input, submission.id); this.fence();
    return submission.id;
  }
  /** Pure lookup/status/committed-entry reads. No wait/resume, terminal write or payload publication. */
  reconcile(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.readState(copy)); }
  private async readState(input: AcceptedInput) {
    const { operation, conversation } = await this.checked(input);
    const record = await this.record(input);
    if (!record) return { operation, submissionId: null, status: null, answer: null };
    const handle = await this.harness.submission(record.id, this.context); this.fence();
    if (!handle) throw new Error("Missing submission");
    const status = await handle.status(this.context); this.fence();
    let answer: SettledAnswer | null = null;
    if (status.type === "input" && status.status === "done") {
      const entry = await conversation.commit(tx => tx.entry(AssistantEntry, status.answer), this.context); this.fence();
      if (!entry || entry.conversationId !== input.conversationId) throw new Error("Missing committed answer");
      const messages = entry.model ?? [];
      if (messages.length !== 1 || messages[0]!.role !== "assistant") throw new Error("Unsupported answer shape");
      const message = messages[0]!;
      // Public pi-ai 1.3 AssistantMessage supports text/thinking/toolCall, NOT image.
      // A tool-call generation is not a final answer. Tool media belongs to the host port.
      if (!Array.isArray(message.content) || message.content.some(part => part.type !== "text" && part.type !== "thinking"))
        throw new Error("Unsupported final assistant content");
      if (message.stopReason !== "stop" && message.stopReason !== "length") throw new Error("Unsupported final assistant stop reason");
      const text = message.content.map(part => part.type === "text" ? part.text : "").join("");
      if (text.length > 65536) throw new Error("Answer exceeds qualification bound");
      answer = freezeTree({ message: structuredClone(message), text });
    }
    return { operation, submissionId: record.id, status, answer };
  }
  cancel(input: AcceptedInput, submissionId: SubmissionId, request: AcceptCancellationRequest) {
    const copy = inputSnapshot(input), cancellation = cancellationSnapshot(request);
    return this.observe(() => this.cancelInput(copy, submissionId, cancellation));
  }
  private async cancelInput(input: AcceptedInput, submissionId: SubmissionId, request: AcceptCancellationRequest) {
    const { operation } = await this.checked(input);
    const record = await this.record(input);
    if (!record || record.id !== submissionId || request.effect.operationId !== operation.operationId ||
      request.effect.sourceSeq !== request.sourceSeq)
      throw new Error("Exact cancellation binding required");
    // EF-S01 owns version validation AND replay of a persisted decision after version advancement.
    value(await this.options.work.acceptCancellation(request)); this.fence();
    await this.progress();
    const result = await this.harness.abortSubmission(submissionId, this.context, input.conversationId);
    this.fence();
    // Placement is not exact task ownership: a generation may include other accepted steers.
    // Withdraw queued input only; never escalate to task/conversation-wide abort.
    return result;
  }
  /** Explicit progress grant after caller has revalidated the entire ownership domain. */
  resume(input: AcceptedInput, submissionId: SubmissionId) {
    input = inputSnapshot(input);
    return this.observe(async () => {
      const { operation } = await this.checked(input);
      const record = await this.record(input);
      if (!record || record.id !== submissionId || operation.terminal || operation.cancellation) throw new Error("Exact live submission required");
      await this.progress(); this.harness.resume();
    });
  }
  settle(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.settleInput(copy)); }
  private async settleInput(input: AcceptedInput) {
    const state = await this.readState(input), o = this.options;
    if (state.operation.terminal) {
      const terminal = value(await o.terminal.getTerminal(input.operationId)); this.fence(); return terminal;
    }
    const aborted = state.operation.cancellation !== null && state.status?.status === "unanswered";
    if ((!aborted && state.answer === null) || !state.submissionId) return null;
    let operation = value(await o.work.getOperation(input.operationId)); this.fence();
    if (!operation) throw new Error("Missing operation");
    if (!operation.harness) {
      operation = value(await o.work.bindHarness(sealed({ effect: effect(`runtime:bind:${input.requestId}:${o.generation}`, input.operationId, input.sourceSeq),
        expectedVersion: operation.version, sessionId: o.sessionId, lane: o.lane, harnessOperationId: String(state.submissionId),
        state: "finished" as const, watchGeneration: o.generation }))); this.fence();
    }
    const cancelled = operation.cancellation !== null, ref = `runtime-answer:${o.incarnation}:${state.submissionId}`;
    let materialized: MaterializedAnswer = Object.freeze({ contentRef: ref, contentBlocksRef: null, mediaIds: Object.freeze([]) });
    if (!cancelled) {
      // Capture and validate returned refs BEFORE the next await. Host exceptions may contain secrets.
      try {
        if (o.materializeAnswer) materialized = materializedSnapshot(await o.materializeAnswer(ref, state.answer!, freezeTree(structuredClone(operation))));
        else await o.putAnswer(ref, state.answer!.text);
      } catch { throw new Error("Host answer materialization failed"); }
      this.fence();
      // Do not refresh expectedVersion: cancellation/version changes must reject this stale
      // completion. EF-S02 repeats owner/version checks inside its terminal SQL transaction.
      const current = value(await o.work.getOperation(input.operationId)); this.fence();
      if (!current || current.version !== operation.version || current.cancellation || current.terminal)
        throw new Error("Operation changed during answer materialization");
    }
    const timeline: CommitTerminalRequest["timeline"] = cancelled
      ? { mode: "none", placeholderRowId: null, chatJid: input.chatJid, contentRef: null, threadId: null, mediaIds: [], contentBlocksRef: null }
      : { mode: "insert", placeholderRowId: null, chatJid: input.chatJid, ...materialized, threadId: null };
    const request: CommitTerminalRequest = sealed({ effect: effect(`runtime:terminal:${input.requestId}`, input.operationId, input.sourceSeq),
      expectedChatJid: input.chatJid, expectedVersion: operation.version, expectedHarness: operation.harness,
      disposition: cancelled ? "cancelled" as const : "completed" as const, errorCode: null, terminalAuthorityRef: null,
      timeline, sourceDispositions: [{ sourceSeq: input.sourceSeq, state: "consumed" as const, reason: "runtime committed answer" }],
      outboxIntents: [], committedAt: o.now() });
    const terminal = value(await o.terminal.commitTerminal(request)); this.fence(); return terminal;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; // Seal admissions, preserve pending/unknown work; close does not enable scheduling.
    return this.closing = (async () => {
      await Promise.allSettled([...this.active]);
      await this.harness.close(this.context); // May wait for cooperative providers/tools; no bounded-close claim.
      await this.options.owner.release(); // Only after confirmed resource cleanup.
    })();
  }
}
