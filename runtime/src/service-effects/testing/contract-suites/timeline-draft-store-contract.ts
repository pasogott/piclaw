import type { CanonicalJsonValue } from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type {
  CommitDraftRequest,
  CommitServiceNoticeRequest,
  TimelineDraftStore,
} from "../../contracts/timeline-draft-store.js";
import type { InMemoryEffectPayloadResolver } from "../in-memory-payload-resolver.js";
import {
  runParameterisedContractSuite,
  type ContractCaseResult,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../contract-suite.js";
import type { PlannedFault } from "../fault-plan.js";

export interface TimelineDraftContractRow {
  readonly rowId: number;
  readonly content: string;
  readonly threadId: number | null;
  readonly terminal: boolean;
}

export interface TimelineDraftContractSubject {
  readonly store: TimelineDraftStore;
  readonly payloads: InMemoryEffectPayloadResolver;
  bindDraftMedia(operationId: string): Promise<number> | number;
  inspectRow(rowId: number): TimelineDraftContractRow | null;
  injectHistoricalMedia(operationId: string, draftKind: string, mediaId: number): void;
  countTimelineRows(): number;
}

export async function defineTimelineDraftStoreContract(
  factory: ContractSubjectFactory<TimelineDraftContractSubject>,
  createContext: (faults?: readonly PlannedFault[]) => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  const normal = await runParameterisedContractSuite(factory, timelineCases, () => createContext());
  const crash = await runParameterisedContractSuite(factory, timelineCrashCases, () => createContext([
    { point: "effect_then_lost_acknowledgement", occurrence: 2 },
  ]));
  return Object.freeze([...normal, ...crash]);
}

const timelineCases: readonly ParameterisedContractCase<TimelineDraftContractSubject>[] = [
  {
    name: "EF-S03-C1 duplicate equal draft revision returns original write",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = draftRequest("draft-c1", 1);
      const first = await subject.store.commitDraft(request);
      const duplicate = await subject.store.commitDraft(request);
      assert(first.ok && duplicate.ok && first.value.rowId === duplicate.value.rowId, "equal duplicate must return original write");
      const conflict = await subject.store.commitDraft(withRequestHash({ ...request, contentRef: "content:two" }));
      assert(!conflict.ok && conflict.error._tag === "idempotency_conflict", "conflicting duplicate must fail");
      assert(subject.countTimelineRows() === 1, "duplicates must not create another row");
    },
  },
  {
    name: "EF-S03-C2 conflicting or stale revision creates no row",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const current = await subject.store.commitDraft(draftRequest("draft-c2-current", 2));
      assert(current.ok, "current revision must commit");
      const stale = await subject.store.commitDraft(draftRequest("draft-c2-stale", 1));
      assert(!stale.ok && stale.error._tag === "stale_revision", "unseen stale revision must fail");
      assert(subject.countTimelineRows() === 1, "stale revision must not create a row");
    },
  },
  {
    name: "EF-S03-C3 replacement preserves row ownership and thread association",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const firstRequest = draftRequest("draft-c3-r1", 1, { threadId: 41 });
      const first = await subject.store.commitDraft(firstRequest);
      assert(first.ok, "first revision must commit");
      const replacementRequest = draftRequest("draft-c3-r2", 2, {
        mode: "replace", existingRowId: first.value.rowId, threadId: 41, contentRef: "content:two",
      });
      const replacement = await subject.store.commitDraft(replacementRequest);
      assert(replacement.ok && replacement.value.rowId === first.value.rowId, "replacement must retain row ownership");
      const row = subject.inspectRow(first.value.rowId);
      assert(row?.threadId === 41 && row.content === "draft two", "replacement must retain thread and update current content");
      const replayOld = await subject.store.commitDraft(firstRequest);
      assert(replayOld.ok && replayOld.value.revision === 1, "known old revision must replay original result");
      assert(subject.inspectRow(first.value.rowId)?.content === "draft two", "old replay must not rewrite current content");
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.draftRows.length === 1 && artifacts.value.draftRows[0].revision === 2, "artifacts must expose latest revision per kind");
      assert(artifacts.value.draftRows[0].rowId === first.value.rowId, "latest artifacts must retain the one current row");
    },
  },
  {
    name: "EF-S03-C4 later insert cannot create a second current row",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const first = await subject.store.commitDraft(draftRequest("draft-c4-r1", 1));
      assert(first.ok, "first insert must commit");
      const mediaId = await subject.bindDraftMedia("operation-1");
      const secondInsert = await subject.store.commitDraft(draftRequest("draft-c4-r2", 2, {
        contentRef: "content:two", mediaIds: [mediaId],
      }));
      assert(!secondInsert.ok && secondInsert.error._tag === "row_owner_conflict", "later insert must be rejected");
      assert(subject.countTimelineRows() === 1, "one operation/kind must retain one current row");
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.mediaIds.length === 0, "rejected insert media must not enter latest artifacts");
    },
  },
  {
    name: "EF-S03-C5 replacement artifacts include latest media only",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const oldMediaId = await subject.bindDraftMedia("operation-1");
      const newMediaId = await subject.bindDraftMedia("operation-1");
      const first = await subject.store.commitDraft(draftRequest("draft-c5-r1", 1, { mediaIds: [oldMediaId] }));
      assert(first.ok, "first media revision must commit");
      const replacement = await subject.store.commitDraft(draftRequest("draft-c5-r2", 2, {
        mode: "replace", existingRowId: first.value.rowId, contentRef: "content:two", mediaIds: [newMediaId],
      }));
      assert(replacement.ok, "media replacement must commit");
      subject.injectHistoricalMedia("operation-1", "assistant_progress", oldMediaId);
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.mediaIds.length === 1 && artifacts.value.mediaIds[0] === newMediaId, "artifacts must expose latest-row media only");
    },
  },
  {
    name: "EF-S03-C6 service notice is idempotent by kind and source",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = noticeRequest("notice-c4");
      const first = await subject.store.commitServiceNotice(request);
      const duplicate = await subject.store.commitServiceNotice(request);
      assert(first.ok && duplicate.ok && first.value.rowId === duplicate.value.rowId, "notice duplicate must return original");
      const conflict = await subject.store.commitServiceNotice(withRequestHash({ ...request, contentRef: "content:two" }));
      assert(!conflict.ok && conflict.error._tag === "idempotency_conflict", "notice conflict must fail");
      assert(subject.countTimelineRows() === 1, "notice duplicate must not add a row");
    },
  },
  {
    name: "EF-S03-C7 committed draft replay does not require payload availability",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = draftRequest("draft-c7-replay", 1);
      const first = await subject.store.commitDraft(request);
      assert(first.ok, "draft must commit before payload removal");
      subject.payloads.delete(request.contentRef);
      subject.payloads.delete(request.contentBlocksRef!);
      const replay = await subject.store.commitDraft(request);
      assert(replay.ok && replay.value.rowId === first.value.rowId, "exact replay must return persisted write without payloads");
      assert(subject.countTimelineRows() === 1, "replay without payloads must not add a row");
    },
  },
  {
    name: "EF-S03-C8 concurrent service notices decide key and source atomically",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const equal = noticeRequest("notice-c8-equal");
      const equalHeld = withRequestHash({ ...equal, contentRef: "content:notice-equal-held" });
      subject.payloads.putText(equalHeld.contentRef, "equal notice");
      const releaseEqual = subject.payloads.hold(equalHeld.contentRef);
      const delayedEqual = subject.store.commitServiceNotice(equalHeld);
      await subject.payloads.waitUntilHeld(equalHeld.contentRef);
      releaseEqual();
      const replayEqual = await delayedEqual;
      const firstEqual = await subject.store.commitServiceNotice(equalHeld);
      assert(firstEqual.ok && replayEqual.ok && firstEqual.value.rowId === replayEqual.value.rowId, "concurrent equal notice must replay original");

      const conflictBase = withRequestHash({
        ...noticeRequest("notice-c8-first"), sourceId: "restart-source-2", contentRef: "content:notice-conflict-held",
      });
      subject.payloads.putText(conflictBase.contentRef, "delayed notice");
      const releaseConflict = subject.payloads.hold(conflictBase.contentRef);
      const delayedFirst = subject.store.commitServiceNotice(conflictBase);
      await subject.payloads.waitUntilHeld(conflictBase.contentRef);
      const conflictingRequest = withRequestHash({
        ...conflictBase, effect: { ...conflictBase.effect, idempotencyKey: "notice-c8-conflict" }, contentRef: "content:two",
      });
      const winnerPromise = subject.store.commitServiceNotice(conflictingRequest);
      releaseConflict();
      const [loser, winner] = await Promise.all([delayedFirst, winnerPromise]);
      assert(winner.ok, "concurrent source winner must commit");
      assert(!loser.ok && loser.error._tag === "idempotency_conflict", "changed concurrent notice must conflict deterministically");
      assert(subject.countTimelineRows() === 2, "equal and conflicting notice races must each retain one row");
    },
  },
  {
    name: "EF-S03-C9 invalid content blocks are rejected",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      subject.payloads.putJson("blocks:invalid", [{ type: "text" }, "not-an-object"]);
      subject.payloads.putJson("blocks:reserved", [{ type: "restart_handoff" }]);
      for (const [key, ref] of [["invalid", "blocks:invalid"], ["reserved", "blocks:reserved"]] as const) {
        const result = await subject.store.commitDraft(draftRequest(`draft-c5-${key}`, 1, { contentBlocksRef: ref }));
        assert(!result.ok && result.error._tag === "invalid_content_blocks", "invalid/reserved blocks must be rejected");
      }
      assert(subject.countTimelineRows() === 0, "invalid blocks must not persist");
    },
  },
  {
    name: "EF-S03-C10 stale request hash is rejected before mutation",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const request = draftRequest("draft-c8", 1);
      const malformed = { ...request, contentRef: "content:two" };
      const result = await subject.store.commitDraft(malformed);
      assert(!result.ok && result.error._tag === "idempotency_conflict", "stale request hash must conflict");
      assert(subject.countTimelineRows() === 0, "stale request hash must not write");
    },
  },
  {
    name: "EF-S03-C11 content blocks require JSON media type",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      subject.payloads.putText("blocks:wrong-type", JSON.stringify([{ type: "text" }]), "text/plain");
      const result = await subject.store.commitDraft(draftRequest("draft-c9", 1, { contentBlocksRef: "blocks:wrong-type" }));
      assert(!result.ok && result.error._tag === "invalid_content_blocks", "content blocks must be application/json");
      assert(subject.countTimelineRows() === 0, "invalid content-block media type must not write");
    },
  },
  {
    name: "EF-S03-C12 concurrent first inserts retain one current row",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const heldRef = "content:c10-held";
      subject.payloads.putText(heldRef, "delayed draft");
      const releaseFirst = subject.payloads.hold(heldRef);
      const first = subject.store.commitDraft(draftRequest("draft-c10-r1", 1, { contentRef: heldRef }));
      await subject.payloads.waitUntilHeld(heldRef);
      const second = await subject.store.commitDraft(draftRequest("draft-c10-r2", 2, { contentRef: "content:two" }));
      releaseFirst();
      const delayed = await first;
      assert(second.ok, "higher concurrent first insert must commit");
      assert(!delayed.ok && delayed.error._tag === "stale_revision", "delayed lower first insert must become stale");
      assert(subject.countTimelineRows() === 1, "concurrent first inserts must retain one current row");
    },
  },
  {
    name: "EF-S03-C13 concurrent equal draft returns one immutable write",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const heldRef = "content:c13-held";
      subject.payloads.putText(heldRef, "equal concurrent draft");
      const request = draftRequest("draft-c13-equal", 1, { contentRef: heldRef });
      const release = subject.payloads.hold(heldRef);
      const delayed = subject.store.commitDraft(request);
      await subject.payloads.waitUntilHeld(heldRef);
      const winnerPromise = subject.store.commitDraft(request);
      release();
      const [first, second] = await Promise.all([delayed, winnerPromise]);
      assert(first.ok && second.ok && first.value.rowId === second.value.rowId, "concurrent equal draft must return one write");
      assert(subject.countTimelineRows() === 1, "concurrent equal draft must retain one row");
    },
  },
  {
    name: "EF-S03-C14 out-of-order replacement cannot overwrite a higher revision",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const initial = await subject.store.commitDraft(draftRequest("draft-c11-r1", 1));
      assert(initial.ok, "initial revision must commit");
      const heldRef = "content:c11-held";
      subject.payloads.putText(heldRef, "delayed replacement");
      const releaseLower = subject.payloads.hold(heldRef);
      const lower = subject.store.commitDraft(draftRequest("draft-c11-r2", 2, {
        mode: "replace", existingRowId: initial.value.rowId, contentRef: heldRef,
      }));
      await subject.payloads.waitUntilHeld(heldRef);
      const higher = await subject.store.commitDraft(draftRequest("draft-c11-r3", 3, {
        mode: "replace", existingRowId: initial.value.rowId, contentRef: "content:two",
      }));
      releaseLower();
      const delayed = await lower;
      assert(higher.ok, "higher replacement must commit");
      assert(!delayed.ok && delayed.error._tag === "stale_revision", "delayed lower replacement must become stale");
      assert(subject.inspectRow(initial.value.rowId)?.content === "draft two", "lower replacement must not overwrite higher content");
    },
  },
  {
    name: "EF-S03-C15 draft and notice rows remain non-terminal",
    async run({ subject }) {
      seedTimelinePayloads(subject.payloads);
      const mediaId = await subject.bindDraftMedia("operation-1");
      const draft = await subject.store.commitDraft(draftRequest("draft-c6", 1, { mediaIds: [mediaId] }));
      const notice = await subject.store.commitServiceNotice(noticeRequest("notice-c6"));
      assert(draft.ok && notice.ok, "draft and notice must commit");
      assert(subject.inspectRow(draft.value.rowId)?.terminal === false, "draft must remain non-terminal");
      assert(subject.inspectRow(notice.value.rowId)?.terminal === false, "notice must remain non-terminal");
      const artifacts = await subject.store.getOperationArtifacts("operation-1");
      assert(artifacts.ok && artifacts.value.mediaIds.includes(mediaId), "operation artifacts must retain operation-owned media");
    },
  },
];

const timelineCrashCases: readonly ParameterisedContractCase<TimelineDraftContractSubject>[] = [
  {
    name: "EF-S03-R01 committed replacement lost acknowledgement reconciles after restore",
    async run(fixture) {
      seedTimelinePayloads(fixture.subject.payloads);
      const first = await fixture.subject.store.commitDraft(draftRequest("draft-r01-r1", 1));
      assert(first.ok, "first revision must commit");
      const replacement = draftRequest("draft-r01-r2", 2, {
        mode: "replace", existingRowId: first.value.rowId, contentRef: "content:two",
      });
      const lost = await fixture.subject.store.commitDraft(replacement);
      assert(!lost.ok && lost.error.certainty === "unknown", "lost acknowledgement must report unknown");
      const traceBeforeRestore = fixture.inspectTrace();
      const idBeforeRestore = fixture.context.ids.nextId();
      await fixture.crashAndRestore();
      assert(fixture.inspectTrace().length === traceBeforeRestore.length, "pre-crash trace must survive restore");
      assert(fixture.context.ids.nextId() !== idBeforeRestore, "deterministic IDs must continue across restore");
      assert(!fixture.context.faults.hit("effect_then_lost_acknowledgement"), "consumed fault occurrence must remain consumed");
      const reconciled = await fixture.subject.store.commitDraft(replacement);
      assert(reconciled.ok && reconciled.value.rowId === first.value.rowId, "retry must recover committed replacement");
      assert(fixture.inspectTrace().length > traceBeforeRestore.length, "post-restore trace must append to prior observations");
      assert(fixture.subject.countTimelineRows() === 1, "reconciliation must retain one current row");
    },
  },
];

export function seedTimelinePayloads(payloads: InMemoryEffectPayloadResolver): void {
  payloads.putText("content:one", "draft one");
  payloads.putText("content:two", "draft two");
  payloads.putJson("blocks:valid", [{ type: "text", text: "summary" }]);
}

function draftRequest(
  key: string,
  revision: number,
  patch: Partial<CommitDraftRequest> = {},
): CommitDraftRequest {
  const request: CommitDraftRequest = {
    effect: operationEffect(key),
    chatJid: "web:contract",
    draftKind: "assistant_progress",
    revision,
    mode: "insert",
    existingRowId: null,
    contentRef: "content:one",
    threadId: null,
    mediaIds: [],
    contentBlocksRef: "blocks:valid",
    writtenAt: `2026-08-12T00:00:${String(revision).padStart(2, "0")}.000Z`,
    ...patch,
  };
  return withRequestHash(request);
}

function noticeRequest(key: string): CommitServiceNoticeRequest {
  return withRequestHash({
    effect: nullableEffect(key),
    chatJid: "web:contract",
    sourceId: "restart-source-1",
    noticeKind: "restart",
    contentRef: "content:one",
    contentBlocksRef: "blocks:valid",
    writtenAt: "2026-08-12T00:01:00.000Z",
  });
}

function operationEffect(idempotencyKey: string) {
  return { ...nullableEffect(idempotencyKey), operationId: "operation-1" };
}

function nullableEffect(idempotencyKey: string) {
  return {
    idempotencyKey,
    requestHash: "",
    operationId: null,
    sourceSeq: null,
    provenanceRef: "contract-suite",
    redactionClass: "private" as const,
  };
}

function withRequestHash<T extends { effect: { requestHash: string } }>(request: T): T {
  return { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
